from functools import lru_cache
from pydantic_settings import BaseSettings
from typing import Literal


class Settings(BaseSettings):
    # Database
    database_url: str = "postgresql+asyncpg://pal:pal_secret@localhost:5432/pal"
    redis_url: str = "redis://localhost:6379/0"

    # Feature flags — defaults reproduce single-user OwnChart behavior exactly
    deployment_mode: Literal["self_hosted", "institutional"] = "self_hosted"
    ai_key_mode: Literal["byo", "operator"] = "byo"
    multi_user: bool = False
    family_relationships: bool = False
    admin_dashboard: bool = False
    universal_search: bool = False

    # AI provider (BYO — never logged)
    anthropic_api_key: str = ""

    # Operator AI key (institutional — write-only, never returned or logged)
    operator_anthropic_api_key: str = ""
    operator_ai_provider: Literal["anthropic", "bedrock"] = "anthropic"
    operator_bedrock_region: str = "ap-south-1"

    # Security
    secret_key: str = "dev_secret_change_in_prod"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 30
    algorithm: str = "HS256"

    # App
    app_name: str = "PAL"
    environment: Literal["development", "production"] = "development"
    debug: bool = True

    # Semantic cache — embedding model for query similarity lookup
    # all-MiniLM-L6-v2 (22 MB, English); paraphrase-multilingual-MiniLM-L12-v2 (470 MB, 100+ langs)
    semantic_cache_model: str = "paraphrase-multilingual-MiniLM-L12-v2"

    # Vectorize.io Hindsight — optional enhanced memory (semantic+BM25+graph+temporal)
    hindsight_enabled: bool = False
    hindsight_llm_provider: str = "anthropic"
    hindsight_llm_model: str = "claude-haiku-4-5-20251001"
    hindsight_llm_api_key: str = ""  # falls back to anthropic_api_key when empty
    hindsight_api_base: str = ""  # for OpenAI-compatible endpoints (e.g. LiteLLM)

    # DocEHR integration
    # Priority: docehr_mcp_url (A2A via MCP) > docehr_url (REST) > stub
    docehr_enabled: bool = False
    docehr_url: str = ""       # e.g. http://docehr.internal  (REST)
    docehr_mcp_url: str = ""   # e.g. https://docehr.internal/mcp  (MCP)

    # Document upload
    upload_dir: str = "./uploads"

    # Analytics + attribution
    analytics_enabled: bool = True

    # LLM credit rate limiting
    llm_rate_limit_enabled: bool = False   # set True when ready to enforce
    llm_free_credits_per_day: int = 20
    llm_buy_credits_url: str = "https://pal.health/buy-credits"
    # Pilot voucher codes: comma-separated CODE:PACK pairs
    # e.g. "ABC123:starter,XYZ789:power"
    voucher_codes: str = ""

    # Medical Data Toolkit (MDT) — Google Health FHIR extraction
    # Run MDT via Docker: docker run -p 8080:8080 gcr.io/cloud-medical-data-toolkit/mdt:latest
    mdt_enabled: bool = False
    mdt_url: str = "http://localhost:8080"
    # Gemini API key for MDT extraction (uses Gemini Flash for better accuracy)
    gemini_api_key: str = ""
    mdt_model: str = "gemini-2.5-flash"

    # ── Realtime chat (from realtime-chat-kit) ───────────────────────────────
    # ADDITIVE ONLY. Every field has a default, so an existing .env keeps
    # working untouched. Set CHAT_ENABLED=false to unmount the chat routers
    # and restore the pre-integration route table exactly.
    chat_enabled: bool = True
    # Blank => reuse `redis_url` on logical DB 2, so chat pub/sub can never
    # collide with the credit cache or the semantic cache. No new infra.
    chat_redis_url: str = ""
    chat_max_message_length: int = 4000
    chat_ws_heartbeat: int = 25          # seconds; server times out at 2x
    chat_rate_limit_per_min: int = 60

    # ── Centrifugo (high-concurrency transport, 1M+ sockets) ─────────────────
    # 'centrifugo' | 'native'. 'centrifugo' only takes effect once the three
    # settings below are all populated; otherwise the app logs a warning and
    # keeps using the native /ws/chat socket, so flipping this on a host where
    # Centrifugo is not running yet cannot break chat.
    chat_transport: str = "centrifugo"
    # Server-Sent Events: the transport that works without any infrastructure.
    # Kept ON even when CHAT_TRANSPORT=centrifugo, because SSE is exactly what
    # the browser falls back to when it cannot reach Centrifugo — and a
    # fallback that silently delivers nothing is worse than no fallback. The
    # cost is one extra Redis PUBLISH per message; turn it off only once
    # Centrifugo is proven reachable for every client.
    chat_sse_enabled: bool = True
    # A stream is closed and the client reconnected after this long, even when
    # nothing is wrong: authorisation is resolved when a stream OPENS, so the
    # only honest way to keep a long-lived stream authorised is to stop it
    # being long-lived. Reconnecting re-runs auth and re-resolves the rooms.
    chat_sse_max_age: int = 600
    # Between reconnects, re-check the cheap things (account still active, room
    # set unchanged) on this cadence.
    chat_sse_revalidate: int = 60
    # Browser/mobile-facing WebSocket endpoint.
    centrifugo_url: str = "ws://localhost:8100/connection/websocket"
    # Server-to-server HTTP API base (never exposed to clients).
    centrifugo_api_url: str = "http://localhost:8100/api"
    centrifugo_api_key: str = ""
    centrifugo_token_hmac_secret: str = ""
    centrifugo_token_ttl: int = 60 * 30      # seconds; clients auto-refresh
    centrifugo_api_timeout: float = 5.0

    # ── Family Plan ──────────────────────────────────────────────────────────
    # Set FAMILY_PLAN_ENABLED=false to 404 the whole /family surface.
    # NOTE: deliberately distinct from the pre-existing `family_relationships`
    # flag above, which gates the older consent/relationship code paths and is
    # left completely untouched by this integration.
    family_plan_enabled: bool = True
    family_max_members: int = 6
    # A person may hold a seat in at most this many family plans. Three covers
    # the real caregiving shape — your own nuclear family, your parents, your
    # in-laws — while capping abuse (a "family plan" resold as a group chat).
    family_max_plans_per_user: int = 3
    family_invite_ttl_minutes: int = 60 * 24 * 7   # 7 days
    family_default_currency: str = "INR"
    # Payment links are generated server-side as <base>/<payment_request_id>.
    family_payment_link_base: str = "https://pal.health/pay"

    def effective_hindsight_key(self) -> str:
        return self.hindsight_llm_api_key or self.anthropic_api_key

    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache()
def get_settings() -> Settings:
    return Settings()
