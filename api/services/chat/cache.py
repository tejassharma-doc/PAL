"""Redis cache for the room-membership check.

WHY THIS EXISTS
---------------
`is_room_member()` is the hot path of the whole Centrifugo design. Because the
connection token deliberately carries **no `channels` claim** — so that a
revoked consent grant or a removed family member stops working on the next
subscribe rather than riding out a 30-minute TTL — every single subscription
must be authorised individually, live, against the database.

The arithmetic at the 1M target:

    3 tokens/user (1 connect + ~2 subscribe) / 1800 s TTL x 1,000,000 users
      ~= 1,700 requests/s sustained, each one a PostgreSQL query

...and that is the *calm* number. The measured reconnect-storm test (1,200
clients, Centrifugo killed) drove **274 token req/s**, which extrapolates
linearly to roughly **230,000 req/s at 1M** — a ~130x spike over steady state,
arriving in a single backoff window.

This cache removes PostgreSQL from that path without weakening revocation,
because revocation invalidates explicitly rather than waiting for a TTL.

THE SAFETY ARGUMENT
-------------------
A membership cache on a healthcare product is exactly the kind of optimisation
that quietly becomes a data breach, so the invariants are worth stating:

1. **Every mutation invalidates.** `join_room`, `leave_room` and
   `remove_member()` all call `invalidate()` for the precise (room, user) pair
   they changed. There is no wildcard and no SCAN — the caller always knows
   both ids, so invalidation is a single O(1) DEL.

2. **Negative results expire faster than positive ones.** A cached *deny* costs
   a user access they should have (annoying, recoverable in seconds); a cached
   *allow* costs a user access they should NOT have (a PHI incident). So denies
   get a short TTL and allows a longer one, and the asymmetry is deliberate.

3. **Failure is closed, then open.** If Redis is unreachable the cache returns
   "unknown" and the caller falls through to the database. Chat degrades to
   today's behaviour — slower, never wronger. Redis being down must not make
   PAL insecure *or* unavailable.

4. **TTL is jittered.** Without jitter, a million entries written during one
   reconnect storm all expire in the same second and reproduce the storm
   against PostgreSQL 60 seconds later. Jitter spreads the re-validation.
"""
from __future__ import annotations

import logging
import random
from typing import Optional

import redis.asyncio as aioredis

from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

_redis: Optional[aioredis.Redis] = None
_disabled = False       # set after a connection failure; retried on next startup

_KEY = "chatmem:{room}:{user}"


def _url() -> str:
    """Same logical database as the chat pub/sub — see manager._chat_redis_url."""
    if settings.chat_redis_url:
        return settings.chat_redis_url
    base = settings.redis_url or "redis://localhost:6379/0"
    if base.rstrip("/").rsplit("/", 1)[-1].isdigit():
        base = base.rstrip("/").rsplit("/", 1)[0]
    return f"{base.rstrip('/')}/2"


def _jitter(ttl: int) -> int:
    """+/-20%, floored at 1s. Prevents synchronised mass expiry."""
    return max(1, int(ttl * random.uniform(0.8, 1.2)))


async def startup() -> None:
    """Connect. Never raises — a missing cache is not a startup failure."""
    global _redis, _disabled
    if not settings.chat_membership_cache_enabled:
        logger.info("chat: membership cache disabled by config")
        return
    try:
        _redis = await aioredis.from_url(_url(), encoding="utf-8", decode_responses=True)
        await _redis.ping()
        _disabled = False
        logger.info(
            "chat: membership cache enabled (allow %ss / deny %ss, +/-20%% jitter)",
            settings.chat_membership_cache_ttl,
            settings.chat_membership_cache_deny_ttl,
        )
    except Exception as exc:
        _redis = None
        _disabled = True
        logger.warning(
            "chat: membership cache unavailable (%s) — falling back to a DB "
            "query per subscription. Fine at low scale; fix before ~100k "
            "concurrent (see SCALE_ASSESSMENT.md §2).",
            exc,
        )


async def shutdown() -> None:
    global _redis
    if _redis is not None:
        try:
            await _redis.aclose()
        except Exception:
            pass
        _redis = None


async def get(room_id: str, user_id: str) -> Optional[bool]:
    """Cached membership, or None for 'unknown — ask the database'."""
    if _redis is None:
        return None
    try:
        v = await _redis.get(_KEY.format(room=room_id, user=user_id))
    except Exception:
        return None            # fail open to the DB, never to an answer
    if v is None:
        return None
    return v == "1"


async def put(room_id: str, user_id: str, allowed: bool) -> None:
    if _redis is None:
        return
    ttl = (settings.chat_membership_cache_ttl if allowed
           else settings.chat_membership_cache_deny_ttl)
    try:
        await _redis.set(
            _KEY.format(room=room_id, user=user_id),
            "1" if allowed else "0",
            ex=_jitter(ttl),
        )
    except Exception:
        pass                    # a cache that cannot write is just a slow cache


async def invalidate(room_id: str, user_id: str) -> None:
    """Drop one (room, user) entry. Call on ANY membership change.

    Deliberately not best-effort-silent: a failed invalidation means a removed
    member keeps their seat for up to one TTL, which is a security-relevant
    event and belongs in the log.
    """
    if _redis is None:
        return
    try:
        await _redis.delete(_KEY.format(room=room_id, user=user_id))
    except Exception as exc:
        logger.error(
            "chat: FAILED to invalidate membership cache for room=%s user=%s (%s). "
            "Access may persist for up to %ss.",
            room_id, user_id, exc, settings.chat_membership_cache_ttl,
        )


async def invalidate_user(user_id: str) -> None:
    """Drop every cached room for one user.

    Used on consent revocation, where the caller knows the user but not
    necessarily every affected room. Uses SCAN (cursor-based, non-blocking) —
    never KEYS, which blocks the whole Redis instance and at 1M users would be
    an outage.
    """
    if _redis is None:
        return
    pattern = _KEY.format(room="*", user=user_id)
    try:
        deleted = 0
        async for key in _redis.scan_iter(match=pattern, count=500):
            await _redis.delete(key)
            deleted += 1
        if deleted:
            logger.info("chat: invalidated %d cached memberships for user=%s",
                        deleted, user_id)
    except Exception as exc:
        logger.error("chat: FAILED to invalidate memberships for user=%s (%s)",
                     user_id, exc)
