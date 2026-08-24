"""PAL API — main FastAPI application."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import get_settings
from database import init_db
from routers import auth, auth_v2, auth_new, phone_auth, records, search, conversations, admin, follow_up, upload, appointment, analytics, credits, medical_doc, user_profile, patients, visits, lab_tests, prescriptions, hermes_chat


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()

    # Vectorize.io Hindsight — start embedded server when enabled
    s = get_settings()
    _hindsight_started = False
    if s.hindsight_enabled:
        from services.hindsight.vectorize_hindsight import start as hindsight_start
        _hindsight_started = hindsight_start(
            llm_provider=s.hindsight_llm_provider,
            llm_model=s.hindsight_llm_model,
            llm_api_key=s.effective_hindsight_key(),
            llm_api_base=s.hindsight_api_base,
        )

    # ── Realtime chat: start the WS ConnectionManager ────────────────────────
    # ADDITIVE. manager.startup() already swallows Redis failures and falls
    # back to single-pod mode; the extra try/except here guarantees a chat
    # problem can never stop the API from booting.
    _chat_started = False
    if s.chat_enabled:
        try:
            from services.chat.manager import manager as chat_manager
            await chat_manager.startup()
            _chat_started = True
        except Exception as exc:  # noqa: BLE001
            import logging
            logging.getLogger(__name__).error("chat: startup failed, continuing: %s", exc)

        # Membership cache — keeps is_room_member() off PostgreSQL on the
        # subscription-token hot path. startup() never raises; if Redis is
        # unreachable it logs and every lookup falls through to the database,
        # which is exactly today's behaviour.
        try:
            from services.chat import cache as chat_cache
            await chat_cache.startup()
        except Exception as exc:  # noqa: BLE001
            import logging
            logging.getLogger(__name__).warning("chat: membership cache off: %s", exc)

    yield

    if _chat_started:
        try:
            from services.chat.manager import manager as chat_manager
            await chat_manager.shutdown()
        except Exception:  # noqa: BLE001
            pass
        try:
            from services.chat import cache as chat_cache
            await chat_cache.shutdown()
        except Exception:  # noqa: BLE001
            pass

    if _hindsight_started:
        from services.hindsight.vectorize_hindsight import stop as hindsight_stop
        hindsight_stop()


settings = get_settings()

app = FastAPI(
    title="PAL API",
    description="Patient-owned health record + Universal Health Search",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3003"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)  # Legacy auth endpoints
app.include_router(auth_v2.router, prefix="/v2")  # Auth with sessions (old signup removed)
app.include_router(auth_new.router, prefix="/v3")  # New signup/login with users+patients
app.include_router(phone_auth.router)  # Phone OTP authentication (auto-creates users)
app.include_router(user_profile.router)  # User profile and credits
app.include_router(patients.router)  # Patient CRUD
app.include_router(records.router)
app.include_router(visits.router)  # Visits with clinical outputs
app.include_router(lab_tests.router)  # Lab tests and results
app.include_router(prescriptions.router)  # Prescriptions with SOAP notes
app.include_router(hermes_chat.router)  # Hermes AI chat with MCP + Vertex AI
app.include_router(upload.router)
app.include_router(search.router)
app.include_router(conversations.router)
app.include_router(admin.router)
app.include_router(follow_up.router)
app.include_router(appointment.router)
app.include_router(analytics.router)
app.include_router(credits.router)
app.include_router(medical_doc.router)

# ── Realtime chat + Family Plan (ADDITIVE) ───────────────────────────────────
# Mounted last so they can never shadow an existing route, and imported inside
# the flag check so that with CHAT_ENABLED=false / FAMILY_PLAN_ENABLED=false the
# modules are not even loaded. Verified free prefixes: /ws, /chat,
# /notifications, /family.
if settings.chat_enabled:
    from routers import chat as chat_rest, chat_ws, notifications as notifications_rest
    from routers import chat_realtime
    from services.chat.manager import effective_transport as _chat_transport

    # The native socket stays mounted so CHAT_TRANSPORT=native is a working
    # rollback with no code change. Under Centrifugo nothing connects to it.
    app.include_router(chat_ws.router)             # WS  /ws/chat
    app.include_router(chat_rest.router)           # REST /chat/*
    app.include_router(chat_realtime.router)       # REST /chat/realtime/*
    app.include_router(notifications_rest.router)  # REST /notifications/*

if settings.family_plan_enabled:
    from routers import family as family_router

    app.include_router(family_router.router)       # REST /family/*

# ── Prometheus instrumentation (OPT-IN, default off) ─────────────────────────
# METRICS_ENABLED defaults to False, so by default this adds no middleware and
# no route and the route table is unchanged. See deploy/observability/ and
# SCALE_ASSESSMENT.md — the Centrifugo dashboard cannot see the two things most
# likely to break at scale, both of which live in this process.
_metrics_on = False
if settings.metrics_enabled:
    from services.observability import install_metrics

    _metrics_on = install_metrics(app)   # False if prometheus_client is absent


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "app": settings.app_name,
        "flags": {
            "deployment_mode": settings.deployment_mode,
            "multi_user": settings.multi_user,
            "universal_search": settings.universal_search,
            "admin_dashboard": settings.admin_dashboard,
            "chat": settings.chat_enabled,
            "chat_transport": _chat_transport() if settings.chat_enabled else None,
            "family_plan": settings.family_plan_enabled,
            "metrics": _metrics_on,
        },
    }
