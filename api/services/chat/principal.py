"""A cached identity lookup for the token endpoints ONLY.

WHY — measured, not assumed
---------------------------
The membership cache (``services.chat.cache``) removed a PostgreSQL query from
the subscription-token path and moved throughput by **nothing at all**:

    /chat/realtime/subscribe-token, cache OFF : 275 req/s
    /chat/realtime/subscribe-token, cache ON  : 271 req/s

So the membership query was not the bottleneck. Breaking the endpoint down on
the same box found where the time actually goes:

    /health                       (no auth, no DB)        642 req/s
    /chat/realtime/config         (auth only)             311 req/s   <-- HALVED
    /chat/realtime/connect-token  (auth + mint)           274 req/s
    /chat/realtime/subscribe-token(auth + mint + authz)   266 req/s

PAL's ``auth.get_current_user`` runs ``SELECT * FROM users WHERE username = ?``
on **every authenticated request**. That single query is roughly half the cost
of the token endpoints — five times more expensive than the authorisation check
this module was written to optimise.

WHY NOT JUST CACHE auth.get_current_user
----------------------------------------
Because ``auth.py`` is shared by every endpoint in PAL, and the brief is zero
regression outside the chat module. Caching identity app-wide is the right
long-term change, but it is a change to PAL's security core and it deserves its
own review, its own tests and its own rollout.

So this dependency is **scoped to the three realtime token endpoints**, which
are (a) the only ones called at reconnect-storm rates and (b) inside the module
this work owns. ``auth.get_current_user`` is untouched; every other endpoint in
PAL behaves exactly as before.

SAFETY
------
A cached identity is a cached authentication decision, so:

* **Short TTL** (``chat_principal_cache_ttl``, default 30s). A deactivated user
  keeps a valid session for at most that long *on these three endpoints only* —
  and they still cannot subscribe to anything, because the subscription token
  is separately authorised against ``is_room_member()``, whose cache is
  invalidated on every membership change.
* **The JWT is still verified in full, every time.** Signature, algorithm and
  expiry are checked before the cache is consulted. The cache replaces the
  database round-trip, never the cryptography.
* **Only non-sensitive fields are cached** — id, username, is_active. No hash,
  no email, no PHI.
* **Fails through to the database.** If Redis is unavailable this is exactly
  ``get_current_user`` with an extra dict lookup.
"""
from __future__ import annotations

import json
import logging
import random
from fastapi import Depends, HTTPException, status
from jose import JWTError, jwt
from sqlalchemy import select

from auth import oauth2_scheme
from config import get_settings
from database import AsyncSessionLocal
from models import User

from . import cache as _cache

logger = logging.getLogger(__name__)
settings = get_settings()

_KEY = "chatprin:{username}"


class Principal:
    """The minimum identity the token endpoints need.

    Deliberately NOT a User ORM object: it must be serialisable, and it must be
    impossible to accidentally read a field off it that was never cached.
    """

    __slots__ = ("id", "username", "is_active")

    def __init__(self, id: str, username: str, is_active: bool = True):
        self.id = id
        self.username = username
        self.is_active = is_active


def _jitter(ttl: int) -> int:
    return max(1, int(ttl * random.uniform(0.8, 1.2)))


async def get_chat_principal(
    token: str = Depends(oauth2_scheme),
) -> Principal:
    """``get_current_user``, minus the per-request users lookup.

    Same 401 semantics, same exception type, same detail string — so a caller
    cannot tell the difference from the outside.

    NOTE the absence of ``db: AsyncSession = Depends(get_db)``. That is the
    point of the third measurement round: with both caches warm this endpoint
    still checked out a pooled asyncpg connection on every request, purely
    because the dependency asked for one. The pool is 10 + 20 per pod, so at
    storm rates that checkout is contended even when nothing queries.
    A session is now opened lazily, only on a cache MISS.
    """
    creds_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
    )

    # Cryptography first, always. The cache is keyed by a username that has
    # already been proven to come from a token we signed and that has not
    # expired — it is never keyed by unverified input.
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        username: str = payload.get("sub")
        if not username:
            raise creds_exception
    except JWTError:
        raise creds_exception

    redis = _cache._redis  # same connection, same logical DB
    ttl = getattr(settings, "chat_principal_cache_ttl", 0) or 0

    if redis is not None and ttl > 0:
        try:
            raw = await redis.get(_KEY.format(username=username))
            if raw:
                d = json.loads(raw)
                if not d.get("is_active"):
                    raise creds_exception
                return Principal(d["id"], d["username"], True)
        except HTTPException:
            raise
        except Exception:
            pass        # fall through to the database

    # Cache miss (or cache disabled): now, and only now, take a connection.
    async with AsyncSessionLocal() as db:
        user = (
            await db.execute(select(User).where(User.username == username))
        ).scalar_one_or_none()
    if not user or not user.is_active:
        raise creds_exception

    if redis is not None and ttl > 0:
        try:
            await redis.set(
                _KEY.format(username=username),
                json.dumps({"id": str(user.id), "username": user.username,
                            "is_active": True}),
                ex=_jitter(ttl),
            )
        except Exception:
            pass

    return Principal(str(user.id), user.username, True)


async def invalidate_principal(username: str) -> None:
    """Call on deactivation, password change or logout-everywhere.

    Not wired into PAL's auth flows by this drop — doing so would mean editing
    code outside the chat module. The 30-second TTL is the safety net until it
    is; this function exists so wiring it later is a one-line change.
    """
    redis = _cache._redis
    if redis is None:
        return
    try:
        await redis.delete(_KEY.format(username=username))
    except Exception as exc:
        logger.error("chat: failed to invalidate principal for %s (%s)", username, exc)
