"""
PAL chat WebSocket endpoint — /ws/chat

Adapted from realtime-chat-kit/backend/chat_ws.py.

CHANGES FROM THE KIT
--------------------
1. AUTHORIZATION ON EVERY ROOM ACTION. The kit authenticates the socket but
   does not check room membership before `room_message` / `join_room` (its own
   INTEGRATION.md says so). PAL rooms carry PHI, so every room action here goes
   through ``assert_room_member``. Failing the check emits a typed error frame
   rather than closing — a client bug should not drop a caregiver's socket.
2. PAL JWT. ``sub`` is a username, not a user id, and there is no ``type``
   claim. Handled in ``services.chat.authz.authenticate_ws_token``.
3. NO LONG-LIVED DB SESSION. The kit's endpoint holds a session for the socket
   lifetime. PAL's pool is 10+20; a few hundred idle sockets would exhaust it.
   Sessions are opened per-operation and returned immediately.
4. System-message safety. `sender_id` of a system message is the literal
   'pal-system', which is not a UUID — ``resolve_sender`` handles that instead
   of raising.

PROTOCOL: unchanged from the kit — see realtime-chat-kit/PROTOCOL.md.
Client frames carry `action`; server frames carry `type`.
"""
import asyncio
import json
import logging
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from config import get_settings
from database import AsyncSessionLocal
from services.chat.authz import (
    WS_CLOSE_UNAUTHORIZED,
    authenticate_ws_token,
    is_room_member,
)
from services.chat.manager import manager
from services.chat.persistence import (
    mark_message_read,
    persist_message,
    resolve_sender,
    toggle_reaction,
)

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(tags=["chat-ws"])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _err(ws: WebSocket, code: str, message: str | None = None) -> None:
    try:
        await ws.send_json({"type": "error", "code": code, "message": message})
    except Exception:  # noqa: BLE001
        pass


class _RateLimiter:
    """Fixed-window limiter, per connection. Matches the kit's 60/min default."""

    def __init__(self, limit_per_min: int) -> None:
        self.limit = max(1, limit_per_min)
        self._window_start = time.monotonic()
        self._count = 0

    def allow(self) -> bool:
        now = time.monotonic()
        if now - self._window_start >= 60.0:
            self._window_start = now
            self._count = 0
        self._count += 1
        return self._count <= self.limit


@router.websocket("/ws/chat")
async def chat_socket(websocket: WebSocket, token: str = Query(default="")) -> None:
    # ── authenticate BEFORE accept ───────────────────────────────────────────
    async with AsyncSessionLocal() as db:
        user = await authenticate_ws_token(db, token)

    if user is None:
        # Accept FIRST, then close with 4001. Closing a not-yet-accepted socket
        # makes Starlette reject the handshake with HTTP 403, and the browser
        # then reports a generic close with NO code — so the clients cannot tell
        # "expired token" (stop, ask the user to sign in) from "network blip"
        # (reconnect with backoff), and reconnect forever against a dead token.
        # The kit documents 4001 and both PAL clients branch on it.
        await websocket.accept()
        await websocket.close(code=WS_CLOSE_UNAUTHORIZED)
        return

    user_id = str(user.id)
    await manager.connect(websocket, user_id)

    joined_rooms: set[str] = set()
    limiter = _RateLimiter(settings.chat_rate_limit_per_min)
    heartbeat_timeout = max(10, settings.chat_ws_heartbeat) * 2

    try:
        await websocket.send_json(
            {"type": "connected", "user_id": user_id, "server_time": _now_iso()}
        )

        while True:
            try:
                raw = await asyncio.wait_for(
                    websocket.receive_text(), timeout=heartbeat_timeout
                )
            except asyncio.TimeoutError:
                logger.debug("chat: heartbeat timeout user=%s", user_id)
                break

            try:
                msg = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                await _err(websocket, "INVALID_JSON")
                continue
            if not isinstance(msg, dict):
                await _err(websocket, "INVALID_JSON")
                continue

            action = msg.get("action")

            # ── ping ─────────────────────────────────────────────────────────
            if action == "ping":
                await websocket.send_json({"type": "pong", "server_time": _now_iso()})
                continue

            if not limiter.allow():
                await _err(websocket, "RATE_LIMITED", "Slow down")
                continue

            # ── join / leave ─────────────────────────────────────────────────
            if action in ("join_room", "leave_room"):
                room_id = msg.get("room_id")
                if not room_id:
                    await _err(websocket, "MISSING_FIELDS", "room_id required")
                    continue

                if action == "join_room":
                    # PAL ADDITION — membership gate.
                    async with AsyncSessionLocal() as db:
                        allowed = await is_room_member(db, room_id, user_id)
                    if not allowed:
                        await _err(websocket, "FORBIDDEN", "Not a member of this room")
                        continue
                    await manager.join_room(user_id, str(room_id))
                    joined_rooms.add(str(room_id))
                    await websocket.send_json({"type": "joined_room", "room_id": str(room_id)})
                    await manager.broadcast_presence(str(room_id))
                else:
                    await manager.leave_room(user_id, str(room_id))
                    joined_rooms.discard(str(room_id))
                    await websocket.send_json({"type": "left_room", "room_id": str(room_id)})
                    await manager.broadcast_presence(str(room_id))
                continue

            # ── room message ─────────────────────────────────────────────────
            if action == "room_message":
                room_id = msg.get("room_id")
                content = (msg.get("content") or "").strip()
                if not room_id or not content:
                    await _err(websocket, "MISSING_FIELDS", "room_id and content required")
                    continue
                if len(content) > settings.chat_max_message_length:
                    await _err(websocket, "MESSAGE_TOO_LONG")
                    continue

                # PAL ADDITION — membership gate on every write.
                async with AsyncSessionLocal() as db:
                    allowed = await is_room_member(db, room_id, user_id)
                if not allowed:
                    await _err(websocket, "FORBIDDEN", "Not a member of this room")
                    continue

                msg_id = await persist_message(
                    sender_id=user_id,
                    message_type="room",
                    content=content,
                    room_id=str(room_id),
                    content_type=(msg.get("message_subtype") or "text"),
                    reply_to_id=msg.get("reply_to_id"),
                )
                sender = await resolve_sender(user_id)
                await manager.send_to_room(
                    str(room_id),
                    {
                        "message_id": msg_id,
                        "from": user_id,
                        "sender_id": user_id,
                        "content": content,
                        "content_type": (msg.get("message_subtype") or "text"),
                        "reply_to_id": msg.get("reply_to_id"),
                        "timestamp": _now_iso(),
                        **sender,
                    },
                    exclude_user=user_id,
                )
                await websocket.send_json({"type": "room_sent", "message_id": msg_id})
                continue

            # ── direct message ───────────────────────────────────────────────
            if action == "dm":
                to = msg.get("to")
                content = (msg.get("content") or "").strip()
                if not to or not content:
                    await _err(websocket, "MISSING_FIELDS", "to and content required")
                    continue
                if len(content) > settings.chat_max_message_length:
                    await _err(websocket, "MESSAGE_TOO_LONG")
                    continue

                msg_id = await persist_message(
                    sender_id=user_id,
                    message_type="dm",
                    content=content,
                    recipient_id=str(to),
                )
                sender = await resolve_sender(user_id)
                await manager.send_dm(
                    str(to),
                    {
                        "message_id": msg_id,
                        "from": user_id,
                        "content": content,
                        "timestamp": _now_iso(),
                        **sender,
                    },
                )
                await websocket.send_json({"type": "dm_sent", "message_id": msg_id})
                continue

            # ── typing ───────────────────────────────────────────────────────
            if action == "typing":
                room_id = msg.get("room_id")
                to = msg.get("to")
                payload = {"type": "typing", "from": user_id, "timestamp": _now_iso()}
                if room_id:
                    if str(room_id) not in joined_rooms:
                        continue  # silently ignore; not a member / not joined
                    payload["room_id"] = str(room_id)
                    await manager.send_to_room(str(room_id), payload, exclude_user=user_id)
                elif to:
                    await manager.send_dm(str(to), payload)
                continue

            # ── reaction ─────────────────────────────────────────────────────
            if action == "react":
                room_id = msg.get("room_id")
                message_id = msg.get("message_id")
                reaction = msg.get("reaction") or "like"
                if not message_id:
                    await _err(websocket, "MISSING_FIELDS", "message_id required")
                    continue
                if room_id:
                    async with AsyncSessionLocal() as db:
                        allowed = await is_room_member(db, room_id, user_id)
                    if not allowed:
                        await _err(websocket, "FORBIDDEN")
                        continue

                state = await toggle_reaction(str(message_id), user_id, reaction)
                ack = {
                    "type": "reaction_ack",
                    "message_id": str(message_id),
                    "reaction": reaction,
                    **state,
                }
                await websocket.send_json(ack)
                if room_id:
                    await manager.send_to_room(
                        str(room_id),
                        {
                            "type": "message_reaction",
                            "message_id": str(message_id),
                            "reaction": reaction,
                            "by": user_id,
                            **state,
                        },
                        exclude_user=user_id,
                    )
                continue

            # ── read receipt ─────────────────────────────────────────────────
            if action == "read":
                message_id = msg.get("message_id")
                if not message_id:
                    await _err(websocket, "MISSING_FIELDS", "message_id required")
                    continue
                await mark_message_read(str(message_id), user_id)
                await websocket.send_json({"type": "read_ack", "message_id": str(message_id)})
                continue

            await _err(websocket, "UNKNOWN_ACTION", str(action))

    except WebSocketDisconnect:
        pass
    except Exception as exc:  # noqa: BLE001
        logger.warning("chat: socket error user=%s: %s", user_id, exc)
    finally:
        manager.disconnect(websocket, user_id)
        # Only drop room presence when this was the user's LAST socket on the pod.
        if not manager.is_online(user_id):
            for rid in list(joined_rooms):
                try:
                    await manager.leave_room(user_id, rid)
                    await manager.broadcast_presence(rid)
                except Exception:  # noqa: BLE001
                    pass
