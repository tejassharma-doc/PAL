"""Direction B — PAL issues and verifies JWTs for DocEHR → PAL calls.

DocEHR authenticates to PAL with OAuth2 client_credentials:
  1. POST /api/v1/oauth/token  (client_id + client_secret) -> short-lived JWT.
  2. Sends `Authorization: Bearer <jwt>` on every webhook POST.

PAL verifies that bearer on its receiving endpoints. Verification is gated by
PAL_WEBHOOK_AUTH_REQUIRED so this can be deployed with the flag OFF (DocEHR keeps
sending unauthenticated, current behaviour) and flipped ON once DocEHR has its
credentials — zero downtime.

Mirrors the same standard DocEHR uses for the PAL -> DocEHR direction.
"""
from __future__ import annotations

import hmac
import os
import time

import jwt
from fastapi import APIRouter, Form, Request, HTTPException
from fastapi.responses import JSONResponse

# ── Config (env) ─────────────────────────────────────────────────────────────
CLIENT_ID = os.getenv("PAL_OAUTH_CLIENT_ID", "docehr")
# Baked-in defaults so a plain deploy works without extra server config.
# SECURITY: these live in git history — rotate by setting the env vars (which
# override these) and, ideally, moving to env-only once provisioned.
CLIENT_SECRET = os.getenv(
    "PAL_OAUTH_CLIENT_SECRET",
    "7512e4f6104e3245c88467a0424ee00f454103352bfa1b3a073c4f7ae64be943",
)  # issued to DocEHR
SIGNING_SECRET = os.getenv(
    "PAL_OAUTH_SIGNING_SECRET",
    "0b7ee9efb99bd68e6adab40efbfbe2112028ea6a1814c80de27058b22d5b574c",
)  # HS256 key (server-only)
ISSUER = os.getenv("PAL_OAUTH_ISSUER", "pal-mcp")
AUDIENCE = os.getenv("PAL_OAUTH_AUDIENCE", "pal-mcp")
TTL = int(os.getenv("PAL_OAUTH_TOKEN_TTL", "900"))           # 15 min
AUTH_REQUIRED = os.getenv("PAL_WEBHOOK_AUTH_REQUIRED", "false").lower() in ("1", "true", "yes")

router = APIRouter()


def _mint_token(sub: str) -> tuple[str, int]:
    now = int(time.time())
    payload = {
        "iss": ISSUER,
        "aud": AUDIENCE,
        "sub": sub,
        "scope": "*",
        "iat": now,
        "exp": now + TTL,
    }
    return jwt.encode(payload, SIGNING_SECRET, algorithm="HS256"), TTL


@router.post("/api/v1/oauth/token")
async def issue_token(
    grant_type: str = Form(...),
    client_id: str = Form(...),
    client_secret: str = Form(...),
):
    """OAuth2 client-credentials token endpoint (what DocEHR calls)."""
    if grant_type != "client_credentials":
        return JSONResponse(status_code=400, content={"error": "unsupported_grant_type"})
    if not CLIENT_SECRET or not SIGNING_SECRET:
        return JSONResponse(status_code=500, content={"error": "server_auth_not_configured"})
    # Constant-time comparison of both id and secret.
    ok = hmac.compare_digest(client_id, CLIENT_ID) and hmac.compare_digest(
        client_secret, CLIENT_SECRET
    )
    if not ok:
        return JSONResponse(status_code=401, content={"error": "invalid_client"})
    token, ttl = _mint_token(client_id)
    return {"access_token": token, "token_type": "Bearer", "expires_in": ttl, "scope": "*"}


def verify_bearer_token(token: str) -> dict:
    """Verify signature, expiry, audience and issuer. Raises on failure."""
    return jwt.decode(
        token,
        SIGNING_SECRET,
        algorithms=["HS256"],
        audience=AUDIENCE,
        issuer=ISSUER,
    )


async def require_docehr_auth(request: Request):
    """FastAPI dependency: verify DocEHR's bearer on inbound webhooks.

    No-op while PAL_WEBHOOK_AUTH_REQUIRED is false, so DocEHR can keep posting
    unauthenticated until credentials are provisioned (zero-downtime rollout).
    """
    if not AUTH_REQUIRED:
        return None
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    if not SIGNING_SECRET:
        raise HTTPException(status_code=500, detail="Server auth not configured")
    token = auth.split(" ", 1)[1].strip()
    try:
        return verify_bearer_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
