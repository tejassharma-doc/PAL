"""
In-app notification bell — REST.

Live delivery rides the chat socket (see services/chat/notifications.py); these
endpoints back the bell's history and unread badge.
"""
from fastapi import APIRouter, Depends, HTTPException, Query

from auth import get_current_user
from models import User
from services.chat.notifications import (
    list_notifications,
    mark_all_notifications_read,
    mark_notification_read,
    unread_notification_count,
)

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("/")
async def get_notifications(
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
    unread_only: bool = False,
    user: User = Depends(get_current_user),
):
    items = await list_notifications(
        user.id, limit=limit, offset=offset, unread_only=unread_only
    )
    return {"notifications": items, "count": len(items)}


@router.get("/unread-count")
async def get_unread_count(user: User = Depends(get_current_user)):
    return {"unread": await unread_notification_count(user.id)}


@router.post("/{notification_id}/read")
async def read_one(notification_id: str, user: User = Depends(get_current_user)):
    ok = await mark_notification_read(notification_id, user.id)
    if not ok:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"read": True, "id": notification_id}


@router.post("/mark-all-read")
async def read_all(user: User = Depends(get_current_user)):
    n = await mark_all_notifications_read(user.id)
    return {"read": n}
