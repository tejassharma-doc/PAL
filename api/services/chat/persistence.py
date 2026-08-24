"""
Chat persistence — messages, history, inbox, receipts, reactions.

Adapted from realtime-chat-kit/backend/chat_manager.py (bottom half) and
chat_ws.py's REST helpers.

CHANGES FROM THE KIT:
  * ``from app.core.database import AsyncSessionLocal`` → ``from database import
    AsyncSessionLocal``.
  * ``resolve_sender`` joins PAL's ``patients`` table (via ``family_members``
    when available) so the hub shows "Amma" and not "anil". The kit's version
    only had ``users.email``, and PAL users have a ``username``.
  * Adds ``payload`` and ``subject_member_id`` columns to the INSERT — PAL's
    structured card messages (payment_request / access_request / care_event).
  * All queries are parameterised ``text()`` exactly as in the kit; no user
    input is ever interpolated.
"""
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from database import AsyncSessionLocal

logger = logging.getLogger(__name__)
settings = get_settings()


# ── Writes ───────────────────────────────────────────────────────────────────
async def persist_message(
    *,
    sender_id: str,
    message_type: str,                     # 'dm' | 'room' | 'system'
    content: str,
    recipient_id: Optional[str] = None,
    room_id: Optional[str] = None,
    content_type: str = "text",
    payload: Optional[dict] = None,
    subject_member_id: Optional[str] = None,
    msg_source: Optional[str] = None,
    reply_to_id: Optional[str] = None,
    session: Optional[AsyncSession] = None,
) -> str:
    """Persist one message and return its id.

    ``session`` lets a caller enlist this write in an existing transaction (the
    family service does, so a payment request and its hub card commit together
    or not at all). Without it we open our own session and commit.
    """
    msg_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    params = {
        "id": msg_id,
        "sender_id": str(sender_id),
        "recipient_id": str(recipient_id) if recipient_id else None,
        "room_id": str(room_id) if room_id else None,
        "message_type": message_type,
        "content": (content or "")[: settings.chat_max_message_length],
        "content_type": content_type,
        "payload": json.dumps(payload) if payload is not None else None,
        "subject_member_id": str(subject_member_id) if subject_member_id else None,
        "created_at": now,
        "msg_source": msg_source,
        "reply_to_id": str(reply_to_id) if reply_to_id else None,
    }
    stmt = text(
        """
        INSERT INTO chat_messages
            (id, sender_id, recipient_id, room_id, message_type, content,
             content_type, payload, subject_member_id, created_at,
             is_deleted, msg_source, reply_to_id)
        VALUES
            (CAST(:id AS uuid), :sender_id, :recipient_id, :room_id, :message_type,
             :content, :content_type, CAST(:payload AS jsonb),
             CAST(:subject_member_id AS uuid), :created_at,
             false, :msg_source, :reply_to_id)
        """
    )

    if session is not None:
        await session.execute(stmt, params)
        await session.flush()
    else:
        async with AsyncSessionLocal() as own:
            await own.execute(stmt, params)
            await own.commit()
    return msg_id


async def create_or_get_dm(user_a: str, user_b: str) -> str:
    """Find-or-create the DM room for two users. A DM is just a room with
    room_type='dm' and exactly those two members."""
    a, b = sorted([str(user_a), str(user_b)])
    slug = f"dm-{a}-{b}"
    async with AsyncSessionLocal() as session:
        existing = (
            await session.execute(
                text("SELECT id::text FROM chat_rooms WHERE slug = :slug LIMIT 1"),
                {"slug": slug},
            )
        ).first()
        if existing:
            return existing[0]

        room_id = str(uuid.uuid4())
        await session.execute(
            text(
                """
                INSERT INTO chat_rooms
                    (id, name, slug, room_type, is_private, is_moderated,
                     member_count, created_by, created_at)
                VALUES
                    (CAST(:id AS uuid), :name, :slug, 'dm', true, true, 2,
                     CAST(:created_by AS uuid), NOW())
                ON CONFLICT (slug) DO NOTHING
                """
            ),
            {"id": room_id, "name": "Direct message", "slug": slug, "created_by": str(user_a)},
        )
        # Re-read in case a concurrent request won the race.
        row = (
            await session.execute(
                text("SELECT id::text FROM chat_rooms WHERE slug = :slug LIMIT 1"),
                {"slug": slug},
            )
        ).first()
        room_id = row[0]

        for uid in (a, b):
            await session.execute(
                text(
                    """
                    INSERT INTO chat_room_members
                        (id, room_id, user_id, role, is_muted, joined_at)
                    VALUES (gen_random_uuid(), CAST(:room_id AS uuid),
                            CAST(:user_id AS uuid), 'member', false, NOW())
                    ON CONFLICT ON CONSTRAINT uq_chat_room_member DO NOTHING
                    """
                ),
                {"room_id": room_id, "user_id": uid},
            )
        await session.commit()
    return room_id


async def mark_room_read(room_id: str, reader_id: str) -> int:
    """Advance the reader's watermark for a room, and record receipts.

    Two writes, in this order and for different reasons:

    1. **The watermark** (`chat_room_members.last_read_at`) is what zeroes the
       badge. It is a single-row UPDATE and is the authoritative "I have read up
       to here" marker.

    2. **Receipts** still back per-message "seen by", so they are still written
       — but only for messages created *after the previous watermark*.

    That second bound is the point. The original version anti-joined the whole
    room against `message_read_receipts` on every open, which made opening a
    room O(total history) even after the badge itself was fixed: a room with
    20,000 messages re-scanned all 20,000 every time someone tapped it. Now a
    room open costs O(messages since you last looked), which for an active user
    is a handful of rows.

    Returns the number of new receipts written.
    """
    async with AsyncSessionLocal() as session:
        # Read the previous watermark first — the INSERT must be bounded by the
        # OLD value, and the UPDATE below moves it.
        prev = (
            await session.execute(
                text(
                    """
                    SELECT last_read_at
                    FROM chat_room_members
                    WHERE room_id = CAST(:room_uuid AS uuid)
                      AND user_id  = CAST(:reader_uuid AS uuid)
                      AND left_at IS NULL
                    LIMIT 1
                    """
                ),
                {"room_uuid": str(room_id), "reader_uuid": str(reader_id)},
            )
        ).scalar()

        result = await session.execute(
            text(
                """
                INSERT INTO message_read_receipts (id, message_id, reader_id, read_at)
                SELECT gen_random_uuid(), cm.id, CAST(:reader_id AS varchar(36)), NOW()
                FROM chat_messages cm
                WHERE cm.room_id = CAST(:room_id AS varchar(36))
                  AND cm.created_at > COALESCE(
                        CAST(:since AS timestamptz), '-infinity'::timestamptz)
                  AND cm.is_deleted = false
                  AND cm.sender_id <> CAST(:reader_id AS varchar(36))
                ON CONFLICT ON CONSTRAINT uq_read_receipt DO NOTHING
                """
            ),
            # Explicit casts: in an INSERT..SELECT asyncpg deduces the type of a
            # placeholder from its first use (here the SELECT list -> text) and
            # then conflicts with the varchar comparisons below.
            #
            # The NOT EXISTS anti-join the original had is gone: the
            # created_at bound already excludes everything previously
            # acknowledged, and ON CONFLICT DO NOTHING covers the remaining
            # race (two devices opening the same room at once).
            {
                "room_id": str(room_id),
                "reader_id": str(reader_id),
                "since": prev,
            },
        )

        # Advance the watermark. NOW() rather than the newest message's
        # created_at: a message that lands mid-transaction is genuinely unread,
        # and it is far better to leave a badge on than to silently clear one.
        await session.execute(
            text(
                """
                UPDATE chat_room_members
                   SET last_read_at = NOW()
                 WHERE room_id = CAST(:room_uuid AS uuid)
                   AND user_id  = CAST(:reader_uuid AS uuid)
                   AND left_at IS NULL
                """
            ),
            {"room_uuid": str(room_id), "reader_uuid": str(reader_id)},
        )
        await session.commit()
        return result.rowcount or 0


async def mark_message_read(message_id: str, reader_id: str) -> None:
    async with AsyncSessionLocal() as session:
        await session.execute(
            text(
                """
                INSERT INTO message_read_receipts (id, message_id, reader_id, read_at)
                VALUES (gen_random_uuid(), CAST(:mid AS uuid), :reader_id, NOW())
                ON CONFLICT ON CONSTRAINT uq_read_receipt DO NOTHING
                """
            ),
            {"mid": str(message_id), "reader_id": str(reader_id)},
        )
        await session.commit()


async def toggle_reaction(message_id: str, user_id: str, reaction: str = "like") -> dict:
    """Toggle a reaction. Returns {'liked': bool, 'count': int}."""
    async with AsyncSessionLocal() as session:
        existing = (
            await session.execute(
                text(
                    """
                    SELECT id FROM chat_message_reactions
                    WHERE message_id = :mid AND user_id = :uid AND reaction = :r
                    LIMIT 1
                    """
                ),
                {"mid": str(message_id), "uid": str(user_id), "r": reaction},
            )
        ).first()

        if existing:
            await session.execute(
                text("DELETE FROM chat_message_reactions WHERE id = :id"),
                {"id": existing[0]},
            )
            liked = False
        else:
            await session.execute(
                text(
                    """
                    INSERT INTO chat_message_reactions
                        (id, message_id, user_id, reaction, created_at)
                    VALUES (gen_random_uuid(), :mid, :uid, :r, NOW())
                    ON CONFLICT ON CONSTRAINT uq_chat_msg_reaction DO NOTHING
                    """
                ),
                {"mid": str(message_id), "uid": str(user_id), "r": reaction},
            )
            liked = True

        count = (
            await session.execute(
                text(
                    """
                    SELECT COUNT(*) FROM chat_message_reactions
                    WHERE message_id = :mid AND reaction = :r
                    """
                ),
                {"mid": str(message_id), "r": reaction},
            )
        ).scalar() or 0
        await session.commit()
    return {"liked": liked, "count": int(count)}


async def soft_delete_message(message_id: str, actor_id: str) -> bool:
    """Soft delete only — healthcare conversations are an audit record.
    Only the sender may delete their own message."""
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text(
                """
                UPDATE chat_messages
                SET is_deleted = true, deleted_at = NOW()
                WHERE id = CAST(:mid AS uuid)
                  AND sender_id = :uid
                  AND is_deleted = false
                """
            ),
            {"mid": str(message_id), "uid": str(actor_id)},
        )
        await session.commit()
        return (result.rowcount or 0) > 0


# ── Reads ────────────────────────────────────────────────────────────────────
def _row_to_message(row: Any) -> dict:
    m = dict(row._mapping)
    for key in ("id", "room_id", "subject_member_id", "reply_to_id"):
        if m.get(key) is not None:
            m[key] = str(m[key])
    if isinstance(m.get("created_at"), datetime):
        m["created_at"] = m["created_at"].isoformat()
    return m


async def get_room_history(room_id: str, limit: int = 50, before: Optional[str] = None) -> list[dict]:
    """Room history, newest first. ``before`` is an ISO timestamp for paging."""
    limit = max(1, min(int(limit), 200))
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text(
                """
                SELECT cm.id, cm.sender_id, cm.content, cm.content_type, cm.payload,
                       cm.subject_member_id, cm.reply_to_id, cm.message_type,
                       cm.created_at, cm.is_deleted,
                       COALESCE(p.full_name, u.username, 'PAL') AS sender_name
                FROM chat_messages cm
                -- Compare as TEXT, never CAST(cm.sender_id AS uuid).
                -- chat_messages.sender_id is VARCHAR(36) and legitimately holds
                -- the non-UUID literal 'pal-system' for system cards. A regex
                -- guard in the ON clause does NOT save you: PostgreSQL does not
                -- promise to short-circuit AND, so it still evaluates the cast
                -- and the whole query dies with
                -- "invalid input syntax for type uuid: pal-system".
                -- u.id::text is always a valid uuid string, so a non-UUID
                -- sender simply fails to match and falls through to 'PAL'.
                LEFT JOIN users u
                       ON u.id::text = cm.sender_id
                LEFT JOIN family_members fm
                       ON fm.user_id = u.id
                LEFT JOIN patients p
                       ON p.id = fm.patient_id
                WHERE cm.room_id = :room_id
                  AND cm.is_deleted = false
                  AND (CAST(:before AS timestamptz) IS NULL
                       OR cm.created_at < CAST(:before AS timestamptz))
                ORDER BY cm.created_at DESC
                LIMIT :limit
                """
            ),
            {"room_id": str(room_id), "limit": limit, "before": before},
        )
        return [_row_to_message(r) for r in result]


async def get_dm_history(user_a: str, user_b: str, limit: int = 50) -> list[dict]:
    limit = max(1, min(int(limit), 200))
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text(
                """
                SELECT id, sender_id, recipient_id, content, content_type,
                       created_at, is_deleted
                FROM chat_messages
                WHERE message_type = 'dm'
                  AND ((sender_id = :a AND recipient_id = :b)
                    OR (sender_id = :b AND recipient_id = :a))
                  AND is_deleted = false
                ORDER BY created_at DESC
                LIMIT :limit
                """
            ),
            {"a": str(user_a), "b": str(user_b), "limit": limit},
        )
        return [_row_to_message(r) for r in result]


async def list_conversations(user_id: str) -> list[dict]:
    """Inbox: every room the user is in, with last message and unread count.

    Unread = messages from others in the room with no read receipt from me
    (the kit's NOT EXISTS subquery, kept verbatim in spirit).
    """
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text(
                """
                SELECT
                    r.id::text                AS room_id,
                    r.name                    AS name,
                    r.room_type               AS room_type,
                    r.owner_org_type          AS owner_org_type,
                    r.owner_org_id::text      AS owner_org_id,
                    last_msg.content          AS last_message,
                    last_msg.content_type     AS last_content_type,
                    last_msg.created_at       AS last_message_at,
                    COALESCE(unread.n, 0)     AS unread_count
                FROM chat_room_members m
                JOIN chat_rooms r ON r.id = m.room_id
                LEFT JOIN LATERAL (
                    SELECT cm.content, cm.content_type, cm.created_at
                    FROM chat_messages cm
                    WHERE cm.room_id = r.id::text AND cm.is_deleted = false
                    ORDER BY cm.created_at DESC
                    LIMIT 1
                ) last_msg ON true
                LEFT JOIN LATERAL (
                    -- Counts forward from this membership's watermark, so the
                    -- (room_id, created_at) index does the work. The previous
                    -- version anti-joined message_read_receipts per message,
                    -- which made the inbox O(total history) per room.
                    SELECT COUNT(*) AS n
                    FROM chat_messages cm
                    WHERE cm.room_id = r.id::text
                      AND cm.created_at > COALESCE(
                            m.last_read_at, '-infinity'::timestamptz)
                      AND cm.is_deleted = false
                      AND cm.sender_id <> :uid_txt
                ) unread ON true
                WHERE m.user_id = CAST(:uid_uuid AS uuid)
                  AND m.left_at IS NULL
                ORDER BY last_msg.created_at DESC NULLS LAST
                """
            ),
            # NOTE: two distinct bind params for the same value on purpose.
            # asyncpg infers a single type per placeholder; reusing one `:uid`
            # in both `CAST(... AS uuid)` and a VARCHAR comparison makes it
            # infer uuid and then fail with
            # "operator does not exist: character varying <> uuid".
            {"uid_txt": str(user_id), "uid_uuid": str(user_id)},
        )
        out: list[dict] = []
        for row in result:
            d = dict(row._mapping)
            if isinstance(d.get("last_message_at"), datetime):
                d["last_message_at"] = d["last_message_at"].isoformat()
            d["unread_count"] = int(d.get("unread_count") or 0)
            out.append(d)
        return out


async def unread_total(user_id: str) -> int:
    async with AsyncSessionLocal() as session:
        n = (
            await session.execute(
                text(
                    """
                    SELECT COALESCE(SUM(s.n), 0)
                    FROM chat_room_members m
                    CROSS JOIN LATERAL (
                        SELECT COUNT(*) AS n
                        FROM chat_messages cm
                        WHERE cm.room_id = m.room_id::text
                          AND cm.created_at > COALESCE(
                                m.last_read_at, '-infinity'::timestamptz)
                          AND cm.is_deleted = false
                          AND cm.sender_id <> :uid_txt
                    ) s
                    WHERE m.user_id = CAST(:uid_uuid AS uuid)
                      AND m.left_at IS NULL
                    """
                ),
                # See list_conversations: separate params to keep asyncpg from
                # inferring uuid for the VARCHAR comparisons.
                {"uid_txt": str(user_id), "uid_uuid": str(user_id)},
            )
        ).scalar()
    return int(n or 0)


async def resolve_sender(user_id: str) -> dict:
    """Display fields for outbound payloads.

    THE one place to enrich messages with PAL profile data. The kit's version
    joined only ``users.email``; PAL users have a ``username`` and their human
    name lives on ``patients.full_name``, reachable through ``family_members``.
    """
    try:
        uuid.UUID(str(user_id))
    except (ValueError, AttributeError, TypeError):
        # System messages use a non-UUID sender id like 'pal-system'.
        return {"sender_name": "PAL", "sender_role": "system", "sender_avatar": None}

    async with AsyncSessionLocal() as session:
        row = (
            await session.execute(
                text(
                    """
                    SELECT u.username,
                           u.email,
                           u.roles,
                           p.full_name,
                           p.photo_url
                    FROM users u
                    LEFT JOIN family_members fm ON fm.user_id = u.id
                    LEFT JOIN patients p        ON p.id = fm.patient_id
                    WHERE u.id = CAST(:uid AS uuid)
                    LIMIT 1
                    """
                ),
                {"uid": str(user_id)},
            )
        ).first()

    if not row:
        return {"sender_name": "Guest", "sender_role": None, "sender_avatar": None}

    roles = row.roles or []
    return {
        "sender_name": row.full_name or row.username or (row.email or "guest").split("@")[0],
        "sender_role": roles[0] if roles else None,
        "sender_avatar": row.photo_url,
    }
