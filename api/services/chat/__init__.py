"""PAL realtime chat services (adapted from realtime-chat-kit)."""
from .manager import ConnectionManager, manager
from .authz import (
    authenticate_ws_token,
    assert_room_member,
    is_room_member,
    room_member_ids,
    WS_CLOSE_UNAUTHORIZED,
    WS_CLOSE_FORBIDDEN,
    WS_CLOSE_TIMEOUT,
)
from .persistence import (
    persist_message,
    create_or_get_dm,
    mark_room_read,
    mark_message_read,
    toggle_reaction,
    soft_delete_message,
    get_room_history,
    get_dm_history,
    list_conversations,
    unread_total,
    resolve_sender,
)
from .notifications import (
    create_notification,
    list_notifications,
    unread_notification_count,
    mark_notification_read,
    mark_all_notifications_read,
)

__all__ = [
    "ConnectionManager", "manager",
    "authenticate_ws_token", "assert_room_member", "is_room_member", "room_member_ids",
    "WS_CLOSE_UNAUTHORIZED", "WS_CLOSE_FORBIDDEN", "WS_CLOSE_TIMEOUT",
    "persist_message", "create_or_get_dm", "mark_room_read", "mark_message_read",
    "toggle_reaction", "soft_delete_message", "get_room_history", "get_dm_history",
    "list_conversations", "unread_total", "resolve_sender",
    "create_notification", "list_notifications", "unread_notification_count",
    "mark_notification_read", "mark_all_notifications_read",
]
