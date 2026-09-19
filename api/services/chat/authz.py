"""
Chat authorization — the piece the upstream kit deliberately left to the host app.

From realtime-chat-kit/INTEGRATION.md, Security checklist:

    "Authorisation is yours to add: this kit authenticates *who* the socket is,
     but does not, by itself, verify the sender is a *member* of a room before
     `room_message`."

For a healthcare product that is not optional. Every room read and every room
write in PAL goes through ``assert_room_member``. A user who is not in
``chat_room_members`` cannot join, read, post, react or see presence — even if
they guess a room UUID.

WEBSOCKET AUTH — the other kit adaptation
-----------------------------------------
The kit expects a JWT whose ``sub`` is the user id and which carries
``type == "access"``. PAL's ``auth.create_access_token`` issues neither:

    payload = {"sub": username, "roles": [...], "exp": ...}

So ``authenticate_ws_token`` decodes with PAL's own secret/algorithm, reads
``sub`` as a **username**, and resolves it to a User row. This keeps a single
token format across REST and WS — no second token type to issue, expire or
leak, and existing logins keep working untouched.
"""
import logging
import uuid
from typing import Optional

from fastapi import HTTPException, status
from jose import JWTError, jwt
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from models import User

from . import cache

logger = logging.getLogger(__name__)
settings = get_settings()

# WebSocket close codes
WS_CLOSE_UNAUTHORIZED = 4001
WS_CLOSE_FORBIDDEN = 4003
WS_CLOSE_TIMEOUT = 4008


async def authenticate_ws_token(db: AsyncSession, token: Optional[str]) -> Optional[User]:
    """Resolve a `?token=` query param to an active User, or None.

    Returns None (never raises) so the endpoint can close the socket with a
    proper code instead of surfacing a 500.
    """
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError:
        return None

    username = payload.get("sub")
    if not username:
        return None

    result = await db.execute(select(User).where(User.username == username))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        return None
    return user


async def is_room_member(
    db: AsyncSession, room_id: str | uuid.UUID, user_id: str | uuid.UUID
) -> bool:
    """True if the user currently holds a non-departed seat in the room.

    Read-through cached in Redis (``services.chat.cache``) because this runs on
    every Centrifugo subscription token — roughly 1,700 times a second at the
    1M target, and a measured ~230,000/s peak during a reconnect storm. Without
    a cache each of those is a PostgreSQL query.

    The cache does NOT weaken revocation: every membership change invalidates
    the exact (room, user) entry, so a removed member is denied on their next
    subscribe rather than after a TTL. If Redis is unreachable the lookup falls
    straight through to the database — slower, never wronger.
    """
    try:
        rid = uuid.UUID(str(room_id))
        uid = uuid.UUID(str(user_id))
    except (ValueError, AttributeError, TypeError):
        return False

    cached = await cache.get(str(rid), str(uid))
    if cached is not None:
        return cached

    row = (
        await db.execute(
            text(
                """
                SELECT 1
                FROM chat_room_members
                WHERE room_id = :room_id
                  AND user_id = :user_id
                  AND left_at IS NULL
                LIMIT 1
                """
            ),
            {"room_id": rid, "user_id": uid},
        )
    ).first()
    allowed = row is not None
    await cache.put(str(rid), str(uid), allowed)
    return allowed


async def is_room_member_lazy(
    room_id: str | uuid.UUID, user_id: str | uuid.UUID
) -> bool:
    """``is_room_member`` without holding a pooled connection on a cache hit.

    The subscription-token endpoint is called at reconnect-storm rates. Taking
    a session from the pool (10 + 20 per pod) on every request — purely because
    the FastAPI dependency asked for one, even when the membership cache answers
    without touching PostgreSQL — makes the pool the contention point instead of
    the database.

    So: consult the cache first with no session at all, and open one only on a
    miss. Same authorisation decision, same cache, same invalidation.
    """
    try:
        rid = uuid.UUID(str(room_id))
        uid = uuid.UUID(str(user_id))
    except (ValueError, AttributeError, TypeError):
        return False

    cached = await cache.get(str(rid), str(uid))
    if cached is not None:
        return cached

    from database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        return await is_room_member(db, rid, uid)


async def assert_room_member(
    db: AsyncSession, room_id: str | uuid.UUID, user_id: str | uuid.UUID
) -> None:
    """REST guard. 403 if the caller is not in the room.

    Deliberately returns 403 (not 404): the caller already had to be
    authenticated to get here, and leaking existence of a room id to an
    authenticated user is a far smaller problem than the ambiguity of a 404
    during debugging. Room ids are UUIDv4 and are not enumerable.
    """
    if not await is_room_member(db, room_id, user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a member of this conversation",
        )


async def is_room_muted_for(
    db: AsyncSession, room_id: str | uuid.UUID, user_id: str | uuid.UUID
) -> bool:
    row = (
        await db.execute(
            text(
                """
                SELECT is_muted FROM chat_room_members
                WHERE room_id = CAST(:room_id AS uuid) AND user_id = CAST(:user_id AS uuid)
                LIMIT 1
                """
            ),
            {"room_id": str(room_id), "user_id": str(user_id)},
        )
    ).first()
    return bool(row and row[0])


async def room_member_ids(db: AsyncSession, room_id: str | uuid.UUID) -> list[str]:
    """Every active member of a room, as strings. Used to fan notifications
    out to members who are offline (and therefore not in the manager's
    in-memory room set)."""
    rows = (
        await db.execute(
            text(
                """
                SELECT user_id::text FROM chat_room_members
                WHERE room_id = CAST(:room_id AS uuid) AND left_at IS NULL
                """
            ),
            {"room_id": str(room_id)},
        )
    ).fetchall()
    return [r[0] for r in rows]
