"""Prometheus instrumentation for the PAL API — OPT-IN, default OFF.

Why this exists
---------------
The official Centrifugo Grafana dashboard (grafana.com/grafana/dashboards/13039)
covers the sockets. The sockets are the part that already works: measured at
27-37 KB each, ~26-35 GB for 1M, cluster-wide.

The parts that SCALE_ASSESSMENT.md says will actually break — the O(history)
unread badge and the subscribe-token endpoint under a reconnect storm — live in
FastAPI and PostgreSQL, and no Centrifugo dashboard can see them. This module is
what makes them visible.

Design constraints, in priority order
-------------------------------------
1. **Zero regression when off.** ``METRICS_ENABLED`` defaults to ``false``. With
   it off, ``install_metrics()`` returns immediately: no middleware is added, no
   route is mounted, and the route table stays byte-identical to the one
   certified in NO_REGRESSION_REPORT.md.

2. **No new REQUIRED dependency.** ``prometheus_client`` is imported lazily
   inside a try/except. If it is missing, the flag logs a warning and becomes a
   no-op — the same degradation strategy as ``CHAT_TRANSPORT=centrifugo``
   without the Centrifugo secrets. Install it only if you want metrics:

       pip install prometheus-client

3. **Bounded cardinality.** The ``route`` label is the *route template*
   (``/chat/rooms/{room_id}/messages``), never the raw path. Labelling by raw
   path would create one time series per room UUID and take Prometheus down
   long before 1M users did — a classic way to turn monitoring into the outage.
"""

from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover
    from fastapi import FastAPI

logger = logging.getLogger(__name__)

# Buckets chosen around the numbers actually measured on this build, so the
# histograms have resolution exactly where the decisions are:
#   0.0001  the post-fix unread query (0.094 ms)
#   0.025   the pre-fix unread query at 15k messages (27.9 ms)
#   0.1     the pre-fix unread query at 60k messages (96 ms)
#   0.25    the subscribe-token alert threshold
#   0.2/0.5 the measured p95/p99 of subscribe-token on 2 shared vCPUs
_BUCKETS = (
    0.0001, 0.00025, 0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025,
    0.05, 0.1, 0.2, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0,
)

_installed = False


def install_metrics(app: "FastAPI") -> bool:
    """Attach request metrics and mount ``GET /metrics``.

    Returns True if instrumentation was installed, False if it was skipped
    (flag off, dependency missing, or already installed). Never raises —
    monitoring must not be able to break the application it monitors.
    """
    global _installed
    if _installed:
        return False

    try:
        from prometheus_client import (
            CONTENT_TYPE_LATEST,
            CollectorRegistry,
            Counter,
            Gauge,
            Histogram,
            generate_latest,
            multiprocess,
        )
    except ImportError:
        logger.warning(
            "METRICS_ENABLED=true but prometheus_client is not installed — "
            "metrics disabled. Run: pip install prometheus-client"
        )
        return False

    import os

    from fastapi import Response
    from starlette.requests import Request

    # Under `uvicorn --workers N` / gunicorn, every worker keeps its own
    # counters and Prometheus would scrape a random one. PROMETHEUS_MULTIPROC_DIR
    # makes them aggregate. Single-process (the default here) needs nothing.
    _multiproc_dir = os.environ.get("PROMETHEUS_MULTIPROC_DIR")
    if _multiproc_dir:
        registry = CollectorRegistry()
        multiprocess.MultiProcessCollector(registry)
    else:
        registry = None  # default global registry

    _kw = {"registry": registry} if registry is not None else {}

    requests_total = Counter(
        "pal_http_requests_total",
        "Total HTTP requests handled by the PAL API.",
        ["method", "route", "status"],
        **_kw,
    )
    request_duration = Histogram(
        "pal_http_request_duration_seconds",
        "HTTP request latency.",
        ["method", "route"],
        buckets=_BUCKETS,
        **_kw,
    )
    # Deliberately NOT labelled per route — this is a saturation signal, and a
    # single series is both cheaper and easier to alert on. A rising floor here
    # during a reconnect storm means the event loop is backed up.
    in_progress = Gauge(
        "pal_http_requests_in_progress",
        "Requests currently being served.",
        ["scope"],
        multiprocess_mode="livesum",
        **_kw,
    )

    def _route_template(request: "Request") -> str:
        """The matched route's path template, or a bounded fallback.

        ``request.scope["route"]`` is populated by Starlette's router AFTER
        matching, which is why the timing is taken around ``call_next`` rather
        than before it. Unmatched paths (404s) collapse to a single ``__unmatched__``
        series — otherwise a scanner hitting random URLs would explode
        cardinality, which is a genuine availability risk, not a tidiness one.
        """
        route = request.scope.get("route")
        path = getattr(route, "path", None)
        if path:
            return path
        return "__unmatched__"

    @app.middleware("http")
    async def _prometheus_middleware(request: "Request", call_next):
        # /metrics must not measure itself.
        if request.scope.get("path") == "/metrics":
            return await call_next(request)

        start = time.perf_counter()
        status = "500"          # an unhandled exception is a 500 to the client
        in_progress.labels("__all__").inc()
        try:
            response = await call_next(request)
            status = str(response.status_code)
            return response
        finally:
            # `finally`, not `except` — an exception propagates untouched, so
            # PAL's own error handling is completely unaffected, but it still
            # gets counted.
            elapsed = time.perf_counter() - start
            route = _route_template(request)
            method = request.method
            try:
                in_progress.labels("__all__").dec()
                requests_total.labels(method, route, status).inc()
                request_duration.labels(method, route).observe(elapsed)
            except Exception:  # pragma: no cover
                logger.debug("metrics: failed to record %s %s", method, route, exc_info=True)

    @app.get("/metrics", include_in_schema=False)
    async def metrics_endpoint() -> Response:
        payload = generate_latest(registry) if registry is not None else generate_latest()
        return Response(content=payload, media_type=CONTENT_TYPE_LATEST)

    _installed = True
    logger.info("metrics: Prometheus instrumentation enabled at /metrics")
    return True
