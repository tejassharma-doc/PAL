"""
PAL realtime chat — ConnectionManager.

Adapted from realtime-chat-kit/backend/chat_manager.py.

CHANGES FROM THE KIT (each one is load-bearing for PAL):
  1. Imports.        `app.core.config` → `config`, `app.core.database` →
                     `database`. PAL's api/ is the import root (flat modules).
  2. Redis URL.      Uses ``settings.chat_redis_url`` and falls back to PAL's
                     existing ``settings.redis_url``. PAL already runs Redis for
                     the credit manager and semantic cache, so there is no new
                     infrastructure dependency.
  3. Redis DB isolation. Chat pub/sub uses its own logical DB (default /2) so a
                     ``FLUSHDB`` on the credits cache can never wipe chat state
                     and vice versa.
  4. Graceful degradation. Unchanged from the kit and important here: if Redis
                     is down the manager logs and runs single-pod. Chat degrades;
                     it never takes the API process down.
  5. Nothing in this module imports a PAL router or model, so importing it can
     not create a circular import with existing PAL code.

DELIVERY MODEL: direct-first. Deliver to sockets on this pod immediately, then
publish to Redis so other pods deliver to theirs.

  6. FIXED A REAL BUG IN THE KIT'S CROSS-POD FAN-OUT. Its Redis listener skipped
     any recipient who was "already connected locally", which on a RECEIVING pod
     is precisely the set of users who still need the message — so with two or
     more pods, cross-pod DMs and room messages were dropped. Invisible in
     single-pod deployments. PAL stamps an origin pod id instead. See the note on
     _redis_listener; verified with two live uvicorn processes.
"""
import asyncio
import json
import logging
import uuid
from typing import Optional

import redis.asyncio as aioredis
from fastapi import WebSocket

from config import get_settings
from . import centrifugo

logger = logging.getLogger(__name__)

settings = get_settings()


def effective_transport() -> str:
    """Which transport is actually live: 'centrifugo' or 'native'.

    CHAT_TRANSPORT=centrifugo only takes effect once the URL, API key and HMAC
    secret are all set. An operator who flips the flag but has not stood
    Centrifugo up yet keeps working chat on the native socket instead of a dead
    one — that is the no-regression default, and the warning below tells them.
    """
    if settings.chat_transport == "centrifugo":
        if centrifugo.is_enabled():
            return "centrifugo"
        logger.warning(
            "chat: CHAT_TRANSPORT=centrifugo but CENTRIFUGO_API_URL / "
            "CENTRIFUGO_API_KEY / CENTRIFUGO_TOKEN_HMAC_SECRET are not all set — "
            "falling back to the native WebSocket transport"
        )
    return "native"


def _chat_redis_url() -> str:
    """Chat pub/sub URL. Explicit setting wins; otherwise reuse PAL's Redis on
    a separate logical DB so chat and the credit cache never collide."""
    if settings.chat_redis_url:
        return settings.chat_redis_url
    base = settings.redis_url or "redis://localhost:6379/0"
    # Swap the trailing /<db> for /2. If there is no db suffix, append one.
    head, sep, tail = base.rpartition("/")
    if sep and tail.isdigit():
        return f"{head}/2"
    return f"{base.rstrip('/')}/2"


class ConnectionManager:
    """All active WebSocket connections on THIS pod, plus cross-pod
    coordination via Redis pub/sub."""

    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = {}   # user_id -> sockets
        self._room_members: dict[str, set[str]] = {}        # room_id -> user_ids (this pod)
        self._redis: Optional[aioredis.Redis] = None
        self._pubsub = None
        self._listener_task: Optional[asyncio.Task] = None
        # Identifies THIS process on the Redis bus. psubscribe delivers a pod its
        # own publishes, so the listener needs a way to ignore them — see the
        # long note on _redis_listener.
        self._pod_id: str = uuid.uuid4().hex

    # ── lifecycle ────────────────────────────────────────────────────────────
    async def startup(self) -> None:
        """Called from the FastAPI lifespan. Never raises — if Redis is
        unavailable we run single-pod rather than failing app boot."""
        if effective_transport() == "centrifugo":
            # Centrifugo owns sockets, cross-node fan-out and presence, so the
            # Redis pub/sub bus and its listener task are dead weight here.
            logger.info("chat: transport=centrifugo (%s)", settings.centrifugo_api_url)
            return
        try:
            self._redis = await aioredis.from_url(
                _chat_redis_url(), encoding="utf-8", decode_responses=True
            )
            await self._redis.ping()
            self._pubsub = self._redis.pubsub()
            await self._pubsub.psubscribe("dm:*", "room:*", "broadcast:*")
            self._listener_task = asyncio.create_task(self._redis_listener())
            logger.info("chat: Redis pub/sub listener started (%s)", _chat_redis_url())
        except Exception as exc:  # noqa: BLE001 — deliberate catch-all
            self._redis = None
            self._pubsub = None
            logger.warning("chat: Redis unavailable, single-pod mode (%s)", exc)

    async def shutdown(self) -> None:
        if self._listener_task:
            self._listener_task.cancel()
            try:
                await self._listener_task
            except (asyncio.CancelledError, Exception):  # noqa: B014
                pass
            self._listener_task = None
        if self._pubsub:
            try:
                await self._pubsub.punsubscribe()
                await self._pubsub.aclose()
            except Exception:  # noqa: BLE001
                pass
            self._pubsub = None
        if self._redis:
            try:
                await self._redis.aclose()
            except Exception:  # noqa: BLE001
                pass
            self._redis = None

    # ── connection registry ──────────────────────────────────────────────────
    async def connect(self, websocket: WebSocket, user_id: str) -> None:
        await websocket.accept()
        self._connections.setdefault(str(user_id), set()).add(websocket)
        logger.debug("chat: WS connected user=%s users=%d", user_id, len(self._connections))

    def disconnect(self, websocket: WebSocket, user_id: str) -> None:
        uid = str(user_id)
        if uid in self._connections:
            self._connections[uid].discard(websocket)
            if not self._connections[uid]:
                del self._connections[uid]

    def is_online(self, user_id: str) -> bool:
        """Per-pod presence. For cluster-wide, keep an online set in Redis."""
        return str(user_id) in self._connections

    def local_socket_count(self) -> int:
        return sum(len(s) for s in self._connections.values())

    # ── rooms ────────────────────────────────────────────────────────────────
    async def join_room(self, user_id: str, room_id: str) -> None:
        if effective_transport() == "centrifugo":
            return  # subscription state lives in Centrifugo
        self._room_members.setdefault(str(room_id), set()).add(str(user_id))
        if self._redis:
            try:
                await self._redis.sadd(f"room_members:{room_id}", str(user_id))
            except Exception:  # noqa: BLE001
                pass

    async def leave_room(self, user_id: str, room_id: str) -> None:
        if effective_transport() == "centrifugo":
            return  # subscription state lives in Centrifugo
        rid = str(room_id)
        if rid in self._room_members:
            self._room_members[rid].discard(str(user_id))
            if not self._room_members[rid]:
                del self._room_members[rid]
        if self._redis:
            try:
                await self._redis.srem(f"room_members:{rid}", str(user_id))
            except Exception:  # noqa: BLE001
                pass

    async def room_presence(self, room_id: str) -> int:
        if effective_transport() == "centrifugo":
            n = await centrifugo.presence_count(centrifugo.room_channel(room_id))
            return int(n or 0)
        if self._redis:
            try:
                return int(await self._redis.scard(f"room_members:{room_id}") or 0)
            except Exception:  # noqa: BLE001
                pass
        return len(self._room_members.get(str(room_id), set()))

    async def broadcast_presence(self, room_id: str) -> int:
        count = await self.room_presence(room_id)
        payload = {"type": "presence", "room_id": str(room_id), "count": count}

        if effective_transport() == "centrifugo":
            # Centrifugo emits its own join/leave pushes, but the clients speak
            # the kit's `{type:"presence", count}` frame — keep the wire format
            # identical so no UI code changes.
            await centrifugo.publish(centrifugo.room_channel(room_id), payload)
            return count

        for uid in list(self._room_members.get(str(room_id), set())):
            await self._deliver_to_user(uid, payload)
        if self._redis:
            try:
                await self._redis.publish(
                    f"room:{room_id}", json.dumps({"_origin": self._pod_id, **payload})
                )
            except Exception:  # noqa: BLE001
                pass
        return count

    # ── delivery ─────────────────────────────────────────────────────────────
    async def send_dm(self, to_user_id: str, message: dict) -> None:
        full = {"type": "dm", **message}
        if effective_transport() == "centrifugo":
            await centrifugo.publish(centrifugo.user_channel(to_user_id), full)
            return
        await self._deliver_to_user(str(to_user_id), full)
        if self._redis:
            try:
                await self._redis.publish(
                    f"dm:{to_user_id}",
                    json.dumps({"_origin": self._pod_id, **full}, default=str),
                )
            except Exception:  # noqa: BLE001
                pass

    async def send_to_room(
        self, room_id: str, message: dict, exclude_user: Optional[str] = None
    ) -> None:
        full = {"type": "room_message", "room_id": str(room_id), **message}

        if effective_transport() == "centrifugo":
            # NOTE ON exclude_user: Centrifugo publishes to a channel, not to a
            # filtered set of subscribers, so the sender DOES receive their own
            # frame back. That is the standard Centrifugo pattern and it is
            # strictly better for multi-device (PROTOCOL.md promises your other
            # devices see your messages). Clients reconcile by message_id — they
            # adopt the id returned by POST /chat/send for their optimistic row,
            # so the echo de-dupes instead of double-rendering.
            await centrifugo.publish(centrifugo.room_channel(room_id), full)
            return

        for uid in list(self._room_members.get(str(room_id), set())):
            if uid != str(exclude_user):
                await self._deliver_to_user(uid, full)
        if self._redis:
            try:
                await self._redis.publish(
                    f"room:{room_id}",
                    json.dumps({"_origin": self._pod_id, **full}, default=str),
                )
            except Exception:  # noqa: BLE001
                pass

    async def send_notification(self, user_id: str, notification: dict) -> None:
        """Live in-app notification, delivered on the user's personal channel."""
        full = {"type": "notification", **notification}
        if effective_transport() == "centrifugo":
            await centrifugo.publish(centrifugo.user_channel(user_id), full)
            return
        await self._deliver_to_user(str(user_id), full)
        if self._redis:
            try:
                await self._redis.publish(
                    f"dm:{user_id}",
                    json.dumps({"_origin": self._pod_id, **full}, default=str),
                )
            except Exception:  # noqa: BLE001
                pass

    async def _deliver_to_user(self, user_id: str, data: dict) -> None:
        uid = str(user_id)
        if uid not in self._connections:
            return
        dead: set[WebSocket] = set()
        for ws in list(self._connections[uid]):
            try:
                await ws.send_json(data)
            except Exception:  # noqa: BLE001
                dead.add(ws)
        for ws in dead:
            self._connections[uid].discard(ws)
        if uid in self._connections and not self._connections[uid]:
            del self._connections[uid]

    async def _redis_listener(self) -> None:
        """Deliver messages published by OTHER pods to sockets on this pod.

        FIXED VS. THE UPSTREAM KIT
        --------------------------
        The kit guarded delivery with ``if uid not in self._connections`` — the
        comment says "skips users already connected locally (they were delivered
        directly), which prevents double-delivery".

        That guard is inverted for its purpose. Direct-delivery only happened on
        the pod that PUBLISHED. On every other pod, "connected locally" describes
        exactly the users who still need the message — so with more than one pod,
        cross-pod DMs and room messages were silently dropped for every connected
        recipient. It was invisible in single-pod deployments, which is why it
        shipped. Verified failing, then passing, with two live uvicorn processes.

        The correct discriminator is the ORIGIN pod, not the recipient's local
        connection state: Redis ``psubscribe`` echoes a pod its own publishes, so
        we stamp ``_origin`` on the way out and drop our own frames on the way in.

        Multi-device note: remote pods deliver to every local room member,
        including the sender's other devices — which is what PROTOCOL.md promises
        ("your own messages are delivered to your other devices"). The sender's
        additional tabs on the ORIGIN pod are still skipped by send_to_room's
        exclude_user, as in the kit; clients render optimistically and de-dupe on
        message_id.
        """
        assert self._pubsub is not None
        try:
            async for message in self._pubsub.listen():
                if message["type"] not in ("message", "pmessage"):
                    continue
                try:
                    channel = message.get("channel", "") or ""
                    data = json.loads(message["data"])

                    # Our own publish, echoed back to us. Already delivered.
                    if data.pop("_origin", None) == self._pod_id:
                        continue
                    data.pop("exclude", None)

                    if channel.startswith("dm:"):
                        uid = channel.split(":", 1)[1]
                        await self._deliver_to_user(uid, data)
                    elif channel.startswith("room:"):
                        room_id = channel.split(":", 1)[1]
                        for uid in list(self._room_members.get(room_id, set())):
                            await self._deliver_to_user(uid, data)
                    elif channel.startswith("broadcast:"):
                        for uid in list(self._connections.keys()):
                            await self._deliver_to_user(uid, data)
                except Exception as exc:  # noqa: BLE001
                    logger.error("chat: redis listener error: %s", exc)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.error("chat: redis listener stopped: %s", exc)


# Singleton, shared for the app lifetime.
manager = ConnectionManager()
