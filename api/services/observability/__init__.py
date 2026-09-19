"""Optional Prometheus instrumentation. See metrics.py for the rationale."""

from .metrics import install_metrics

__all__ = ["install_metrics"]
