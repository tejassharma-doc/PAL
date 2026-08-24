"""
PAL chat REST companions — inbox, history, fallback send.

Adapted from the REST half of realtime-chat-kit/backend/chat_ws.py.
Realtime stays on the socket; these endpoints hydrate the UI and give a
degraded path when the socket is down (corporate proxies, flaky mobile data).

Every room endpoint is membership-gated via ``assert_room_member``.
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from config import get_settings
from database import get_db
from models import User
from services.chat.authz import assert_room_member
from services.chat.manager import manager
from services.chat.persistence import (
    create_or_get_dm,
    get_dm_history,
    get_room_history,
    list_conversations,
    mark_room_read,
    persist_message,
    resolve_sender,
    soft_delete_message,
    unread_total,
)

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/chat", tags=["chat"])


# ── schemas ──────────────────────────────────────────────────────────────────
class SendMessageIn(BaseModel):
    room_id: str
    content: str = Field(min_length=1)
    reply_to_id: Optional[str] = None


class CreateDMIn(BaseModel):
    peer_user_id: str


class ConversationOut(BaseModel):
    room_id: str
    name: Optional[str] = None
    room_type: str
    owner_org_type: Optional[str] = None
    owner_org_id: Optional[str] = None
    last_message: Optional[str] = None
    last_content_type: Optional[str] = None
    last_message_at: Optional[str] = None
    unread_count: int = 0


# ── endpoints ────────────────────────────────────────────────────────────────
@router.get("/conversations", response_model=list[ConversationOut])
async def get_conversations(user: User = Depends(get_current_user)):
    """Inbox — every room the caller is in, with unread counts."""
    return await list_conversations(str(user.id))


@router.get("/unread-count")
async def get_unread_count(user: User = Depends(get_current_user)):
    return {"unread": await unread_total(str(user.id))}


@router.post("/conversations", status_code=status.HTTP_201_CREATED)
async def create_dm(body: CreateDMIn, user: User = Depends(get_current_user)):
    """Get-or-create the DM room with another user."""
    try:
        uuid.UUID(body.peer_user_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="peer_user_id must be a UUID")
    if body.peer_user_id == str(user.id):
        raise HTTPException(status_code=422, detail="Cannot DM yourself")

    room_id = await create_or_get_dm(str(user.id), body.peer_user_id)
    return {"room_id": room_id}


@router.get("/rooms/{room_id}/messages")
async def get_messages(
    room_id: str,
    limit: int = Query(50, ge=1, le=200),
    before: Optional[str] = None,
    mark_read: bool = True,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Room history, newest first. Opening a conversation clears its badge."""
    await assert_room_member(db, room_id, user.id)
    messages = await get_room_history(room_id, limit=limit, before=before)
    if mark_read:
        await mark_room_read(room_id, str(user.id))
    return {"room_id": room_id, "messages": messages, "count": len(messages)}


@router.post("/rooms/{room_id}/read")
async def mark_read(
    room_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await assert_room_member(db, room_id, user.id)
    n = await mark_room_read(room_id, str(user.id))
    return {"room_id": room_id, "receipts_added": n}


@router.get("/rooms/{room_id}/presence")
async def get_presence(
    room_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await assert_room_member(db, room_id, user.id)
    return {"room_id": room_id, "count": await manager.room_presence(room_id)}


@router.post("/send", status_code=status.HTTP_201_CREATED)
async def send_message_rest(
    body: SendMessageIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """REST fallback send. Persists AND fans out over the socket, so a user on
    a broken socket can still talk to users who have a working one."""
    await assert_room_member(db, body.room_id, user.id)

    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=422, detail="content is empty")
    if len(content) > settings.chat_max_message_length:
        raise HTTPException(
            status_code=413,
            detail=f"Message exceeds {settings.chat_max_message_length} characters",
        )

    msg_id = await persist_message(
        sender_id=str(user.id),
        message_type="room",
        content=content,
        room_id=body.room_id,
        reply_to_id=body.reply_to_id,
    )
    sender = await resolve_sender(str(user.id))
    try:
        await manager.send_to_room(
            body.room_id,
            {
                "message_id": msg_id,
                "from": str(user.id),
                "sender_id": str(user.id),
                "content": content,
                "content_type": "text",
                "reply_to_id": body.reply_to_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                **sender,
            },
            exclude_user=str(user.id),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("chat: REST send fanout failed: %s", exc)

    return {"message_id": msg_id, "room_id": body.room_id}


@router.delete("/messages/{message_id}")
async def delete_message(message_id: str, user: User = Depends(get_current_user)):
    """Soft delete, sender-only. Content stays in the audit trail."""
    ok = await soft_delete_message(message_id, str(user.id))
    if not ok:
        raise HTTPException(status_code=404, detail="Message not found or not yours")
    return {"deleted": True, "message_id": message_id}


@router.get("/dm/{other_user_id}")
async def dm_history(
    other_user_id: str,
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(get_current_user),
):
    """Raw DM history between the caller and one other user.
    No membership table needed — the caller is provably one of the two ends."""
    return {
        "messages": await get_dm_history(str(user.id), other_user_id, limit=limit)
    }
