"""
In-app notifications — persist + live push.

Adapted from realtime-chat-kit/backend/notifications_ws.py.

PAL uses transport (A) from the kit's ARCHITECTURE.md — notifications ride the
SAME ``/ws/chat`` socket — plus a persisted row so the bell shows history and
an unread badge when the user was offline. We do NOT run the kit's second,
standalone ``/notifications/ws`` registry: one socket per user is enough, and
two sockets would double PAL's connection count for no gain.

``create_notification`` is the single seam. Call it from any domain code:

    from services.chat.notifications import create_notification
    await create_notification(
        user_id, "Payment due", "Amma's visit — Rs 500",
        notification_type="family_payment", link="/family/hub",
    )
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import AsyncSessionLocal
from .manager import manager

logger = logging.getLogger(__name__)


async def create_notification(
    user_id: str | uuid.UUID,
    title: str,
    body: Optional[str] = None,
    *,
    notification_type: str = "general",
    link: Optional[str] = None,
    ref_id: Optional[str | uuid.UUID] = None,
    push_live: bool = True,
    session: Optional[AsyncSession] = None,
) -> str:
    """Persist a notification and (by default) push it live.

    Never raises on the push path — a dead socket must not roll back a
    committed domain action.
    """
    notif_id = str(uuid.uuid4())
    params = {
        "id": notif_id,
        "user_id": str(user_id),
        "title": title[:300],
        "body": body,
        "ntype": notification_type[:50],
        "link": link[:500] if link else None,
        "ref_id": str(ref_id) if ref_id else None,
    }
    stmt = text(
        """
        INSERT INTO notifications
            (id, user_id, title, body, notification_type, channel, link,
             ref_id, is_read, created_at)
        VALUES
            (CAST(:id AS uuid), CAST(:user_id AS uuid), :title, :body, :ntype,
             'in_app', :link, CAST(:ref_id AS uuid), false, NOW())
        """
    )

    try:
        if session is not None:
            await session.execute(stmt, params)
            await session.flush()
        else:
            async with AsyncSessionLocal() as own:
                await own.execute(stmt, params)
                await own.commit()
    except Exception as exc:  # noqa: BLE001
        logger.error("notifications: persist failed for user=%s: %s", user_id, exc)
        raise

    if push_live:
        try:
            await manager.send_notification(
                str(user_id),
                {
                    "id": notif_id,
                    "title": title,
                    "body": body,
                    "notification_type": notification_type,
                    "link": link,
                    "ref_id": str(ref_id) if ref_id else None,
                    "is_read": False,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                },
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("notifications: live push failed for user=%s: %s", user_id, exc)

    return notif_id


async def list_notifications(
    user_id: str | uuid.UUID, limit: int = 30, offset: int = 0, unread_only: bool = False
) -> list[dict]:
    limit = max(1, min(int(limit), 100))
    async with AsyncSessionLocal() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT id::text, title, body, notification_type, link,
                           ref_id::text, is_read, created_at
                    FROM notifications
                    WHERE user_id = CAST(:uid AS uuid)
                      AND (:unread_only = false OR is_read = false)
                    ORDER BY created_at DESC
                    LIMIT :limit OFFSET :offset
                    """
                ),
                {
                    "uid": str(user_id),
                    "limit": limit,
                    "offset": max(0, int(offset)),
                    "unread_only": unread_only,
                },
            )
        ).fetchall()

    out = []
    for r in rows:
        d = dict(r._mapping)
        if isinstance(d.get("created_at"), datetime):
            d["created_at"] = d["created_at"].isoformat()
        out.append(d)
    return out


async def unread_notification_count(user_id: str | uuid.UUID) -> int:
    async with AsyncSessionLocal() as session:
        n = (
            await session.execute(
                text(
                    """
                    SELECT COUNT(*) FROM notifications
                    WHERE user_id = CAST(:uid AS uuid) AND is_read = false
                    """
                ),
                {"uid": str(user_id)},
            )
        ).scalar()
    return int(n or 0)


async def mark_notification_read(notification_id: str, user_id: str | uuid.UUID) -> bool:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text(
                """
                UPDATE notifications SET is_read = true
                WHERE id = CAST(:nid AS uuid) AND user_id = CAST(:uid AS uuid)
                """
            ),
            {"nid": str(notification_id), "uid": str(user_id)},
        )
        await session.commit()
        return (result.rowcount or 0) > 0


async def mark_all_notifications_read(user_id: str | uuid.UUID) -> int:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text(
                """
                UPDATE notifications SET is_read = true
                WHERE user_id = CAST(:uid AS uuid) AND is_read = false
                """
            ),
            {"uid": str(user_id)},
        )
        await session.commit()
        return result.rowcount or 0
