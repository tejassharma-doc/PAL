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


def require_uuid(value: str, field: str) -> str:
    """Reject a non-UUID path parameter with 422, not a 500.

    These ids are typed `str` on the route and then handed to SQL that casts
    them to uuid, so anything that is not a UUID reaches PostgreSQL and comes
    back as `invalid input for query argument` — an unhandled DataError, an
    HTTP 500, and a stack trace in the log. A sweep of the API surface found
    this on nine endpoints; these are the two inside the chat module.

    Routes elsewhere in PAL have the same shape. The durable fix for them is to
    type the parameter as `uuid.UUID` so FastAPI validates it before the
    handler runs.
    """
    try:
        uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"`{field}` must be a UUID",
        )
    return str(value)


async def is_room_member_lazy(
    room_id: str | uuid.UUID, user_id: str | uuid.UUID
) -> bool:
    """Session-free version — opens its own connection. Use inside endpoints
    that don't already hold a db session (e.g. Centrifugo subscribe-token)."""
    from database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        return await is_room_member(db, room_id, user_id)


async def is_room_member(
    db: AsyncSession, room_id: str | uuid.UUID, user_id: str | uuid.UUID
) -> bool:
    """True if the user currently holds a non-departed seat in the room."""
    try:
        rid = uuid.UUID(str(room_id))
        uid = uuid.UUID(str(user_id))
    except (ValueError, AttributeError, TypeError):
        return False

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
    return row is not None


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
