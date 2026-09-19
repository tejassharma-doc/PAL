"""
Centrifugo transport — tokens, publishing, presence.

WHY CENTRIFUGO
--------------
The native `/ws/chat` endpoint holds every socket in the API process. Each pod is
bounded by its event loop and file descriptors, and PAL's DB pool (10+20) is
shared with every REST request. That design tops out well short of 1M concurrent
users. Centrifugo is a dedicated Go server built for exactly this: sockets live
there, PAL keeps only stateless HTTP.

  browser / RN ──WSS──► Centrifugo ◄──HTTP server API── FastAPI ──► PostgreSQL
                            (sockets)                   (authz, PHI, truth)

THE SECURITY MODEL — read this before changing anything
-------------------------------------------------------
Verified empirically against Centrifugo v5.4.9 (see tests/test_centrifugo.py):

1. A client CANNOT subscribe to a `room:*` or `user:*` channel without a
   **subscription token** minted by us. Untokened subscribe → error 103
   "permission denied". This is what keeps the RBAC guarantees from
   `services.chat.authz` intact after the migration: we only mint a
   subscription token after `is_room_member()` passes.
2. A subscription token is bound to ONE channel. Presenting a token minted for
   another channel makes Centrifugo close the connection with 3500
   "invalid token" — stricter than a plain denial.
3. Clients CANNOT publish. `publish: false` on every namespace. Messages go
   REST → FastAPI (persist + authorize + redact) → server API publish. So a
   client can never inject an unpersisted, unredacted, or unauthorised frame,
   and PHI redaction still happens before anything is written or fanned out.
4. The server API requires `X-API-Key`; a wrong key returns 401.

WIRE FORMAT IS UNCHANGED. Centrifugo carries the exact same JSON frames the
native socket sent (`{"type": "room_message", ...}`), so the UI, the hook API
and PROTOCOL.md all still apply. That is what makes this a pure infrastructure
swap with no frontend redesign.
"""
from __future__ import annotations

import hashlib
import logging
import time
import uuid
from typing import Any, Optional

import httpx
from jose import jwt

from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# ── channel naming ───────────────────────────────────────────────────────────
# Namespaces must exist in the Centrifugo config (deploy/centrifugo/config.json).
ROOM_NS = "room"
USER_NS = "user"


def room_channel(room_id: str | uuid.UUID) -> str:
    """Channel for a chat room (family hub, group, or DM room)."""
    return f"{ROOM_NS}:{room_id}"


def user_channel(user_id: str | uuid.UUID) -> str:
    """Per-user channel: DMs and in-app notifications."""
    return f"{USER_NS}:{user_id}"


def parse_room_channel(channel: str) -> Optional[str]:
    """`room:<uuid>` -> `<uuid>`; anything else -> None."""
    if not channel.startswith(ROOM_NS + ":"):
        return None
    return channel.split(":", 1)[1] or None


def parse_user_channel(channel: str) -> Optional[str]:
    if not channel.startswith(USER_NS + ":"):
        return None
    return channel.split(":", 1)[1] or None


def is_enabled() -> bool:
    """True when Centrifugo is the active transport AND configured."""
    return (
        settings.chat_transport == "centrifugo"
        and bool(settings.centrifugo_api_url)
        and bool(settings.centrifugo_api_key)
        and bool(settings.centrifugo_token_hmac_secret)
    )


# ── tokens ───────────────────────────────────────────────────────────────────
def _now() -> int:
    return int(time.time())


def _ttl_for(user_id: str | uuid.UUID) -> int:
    """Token TTL with deterministic per-user jitter.

    Without jitter every token minted during one event expires in the same
    second. A Centrifugo restart mints ~1M tokens in a burst; 30 minutes later
    all 1M expire together and the reconnect storm replays itself against the
    API — forever, on a 30-minute cycle. Jitter breaks the resonance.

    Deterministic (hashed from the user id) rather than random, so a user's
    connection token and their subscription tokens share one expiry and the
    client makes a single coordinated refresh instead of several staggered
    ones. Same reason a cache uses a consistent hash rather than rand().
    """
    base = settings.centrifugo_token_ttl
    frac = getattr(settings, "centrifugo_token_ttl_jitter", 0.0) or 0.0
    if frac <= 0:
        return base
    # md5 is a hash function here, not a security primitive.
    h = int(hashlib.md5(str(user_id).encode()).hexdigest()[:8], 16)
    offset = ((h % 2001) / 1000.0) - 1.0        # -1.0 .. +1.0
    return max(60, int(base * (1.0 + frac * offset)))


def make_connection_token(user_id: str | uuid.UUID, *, info: Optional[dict] = None) -> str:
    """Connection JWT. `sub` is the PAL user id, so Centrifugo's presence and
    `user:` channel routing line up with our own identifiers.

    Deliberately does NOT carry a `channels` claim — every subscription is
    authorised individually, at subscribe time, against the live database. A
    `channels` claim would freeze authorisation at connect time and outlive a
    revoked grant or a removed family member for the whole token TTL.
    """
    claims: dict[str, Any] = {
        "sub": str(user_id),
        "iat": _now(),
        "exp": _now() + _ttl_for(user_id),
    }
    if info:
        claims["info"] = info
    return jwt.encode(claims, settings.centrifugo_token_hmac_secret, algorithm="HS256")


def make_subscription_token(user_id: str | uuid.UUID, channel: str) -> str:
    """Per-channel subscription JWT. ONLY call this after an authorisation
    check — minting one is granting access."""
    return jwt.encode(
        {
            "sub": str(user_id),
            "channel": channel,
            "iat": _now(),
            "exp": _now() + _ttl_for(user_id),
        },
        settings.centrifugo_token_hmac_secret,
        algorithm="HS256",
    )


# ── server API ───────────────────────────────────────────────────────────────
class CentrifugoError(RuntimeError):
    pass


async def _call(method: str, params: dict) -> dict:
    """POST to Centrifugo's server API. Raises CentrifugoError on failure.

    Callers in the delivery path swallow this — a transport hiccup must never
    roll back a committed message. The row is already in PostgreSQL; the client
    recovers it on reconnect via REST history.
    """
    url = f"{settings.centrifugo_api_url.rstrip('/')}/{method}"
    try:
        async with httpx.AsyncClient(timeout=settings.centrifugo_api_timeout) as client:
            resp = await client.post(
                url,
                json=params,
                headers={"X-API-Key": settings.centrifugo_api_key},
            )
    except Exception as exc:  # noqa: BLE001
        raise CentrifugoError(f"{method}: transport error: {exc}") from exc

    if resp.status_code != 200:
        raise CentrifugoError(f"{method}: HTTP {resp.status_code}: {resp.text[:200]}")

    body = resp.json()
    if "error" in body:
        raise CentrifugoError(f"{method}: {body['error']}")
    return body.get("result", {}) or {}


async def publish(channel: str, data: dict) -> bool:
    """Publish one frame. Returns False instead of raising."""
    if not is_enabled():
        return False
    try:
        await _call("publish", {"channel": channel, "data": data})
        return True
    except CentrifugoError as exc:
        logger.warning("centrifugo: publish to %s failed: %s", channel, exc)
        return False


async def broadcast(channels: list[str], data: dict) -> bool:
    """One API call for many channels — used to fan a notification out to every
    member of a plan without N round trips."""
    if not is_enabled() or not channels:
        return False
    try:
        await _call("broadcast", {"channels": channels, "data": data})
        return True
    except CentrifugoError as exc:
        logger.warning("centrifugo: broadcast to %d channels failed: %s", len(channels), exc)
        return False


async def presence_count(channel: str) -> Optional[int]:
    """Distinct clients in a channel, cluster-wide. Centrifugo owns this now,
    which replaces the Redis `room_members:*` set the native manager kept.

    Returns None when unavailable so callers can fall back.
    """
    if not is_enabled():
        return None
    try:
        result = await _call("presence_stats", {"channel": channel})
        # presence_stats returns num_clients and num_users; users is the more
        # meaningful "N watching" number when someone has several tabs open.
        return int(result.get("num_users", result.get("num_clients", 0)))
    except CentrifugoError as exc:
        logger.debug("centrifugo: presence_stats(%s) failed: %s", channel, exc)
        return None


async def presence_user_ids(channel: str) -> list[str]:
    if not is_enabled():
        return []
    try:
        result = await _call("presence", {"channel": channel})
        return sorted({c.get("user", "") for c in (result.get("presence") or {}).values() if c.get("user")})
    except CentrifugoError as exc:
        logger.debug("centrifugo: presence(%s) failed: %s", channel, exc)
        return []


async def disconnect_user(user_id: str | uuid.UUID) -> bool:
    """Force every socket of a user to close.

    Called when a member is removed from a plan or a consent grant is revoked:
    their live subscriptions must not outlive the authorisation that created
    them. Subscription tokens are short-lived, but "short-lived" is not "gone".
    """
    if not is_enabled():
        return False
    try:
        await _call("disconnect", {"user": str(user_id)})
        return True
    except CentrifugoError as exc:
        logger.warning("centrifugo: disconnect(%s) failed: %s", user_id, exc)
        return False


async def unsubscribe_user(user_id: str | uuid.UUID, channel: str) -> bool:
    """Surgically drop one user's subscription to one channel — preferred over
    disconnect when only a single room's access was withdrawn."""
    if not is_enabled():
        return False
    try:
        await _call("unsubscribe", {"user": str(user_id), "channel": channel})
        return True
    except CentrifugoError as exc:
        logger.warning("centrifugo: unsubscribe(%s, %s) failed: %s", user_id, channel, exc)
        return False


async def health() -> dict:
    """Used by /chat/realtime/config and the smoke tests."""
    if not settings.centrifugo_api_url:
        return {"configured": False, "reachable": False}
    try:
        await _call("info", {})
        return {"configured": True, "reachable": True}
    except CentrifugoError as exc:
        return {"configured": True, "reachable": False, "error": str(exc)[:200]}
