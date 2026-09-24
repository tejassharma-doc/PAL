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
        # SSE listeners on THIS pod: user_id -> queues, one per open stream.
        #
        # Server-Sent Events ride the SAME fan-out as WebSockets rather than
        # getting their own plumbing, so cross-pod Redis delivery, room
        # membership and PHI redaction are shared by construction. A second
        # delivery path would be a second place for them to drift.
        self._listeners: dict[str, set[asyncio.Queue]] = {}
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
        if effective_transport() == "centrifugo" and not settings.chat_sse_enabled:
            # Centrifugo owns sockets, cross-node fan-out and presence, so the
            # Redis bus is dead weight — but ONLY once SSE is switched off.
            # While SSE is available as the browser's fallback, the bus is what
            # carries a frame to an SSE client sitting on a different pod.
            logger.info("chat: transport=centrifugo, SSE off (%s)",
                        settings.centrifugo_api_url)
            return
        if effective_transport() == "centrifugo":
            logger.info(
                "chat: transport=centrifugo with SSE fallback — the Redis bus "
                "stays up so a browser that cannot reach Centrifugo still "
                "receives messages. Set CHAT_SSE_ENABLED=false at very large "
                "scale to drop the mirrored publish."
            )
        try:
            self._redis = await aioredis.from_url(
                _chat_redis_url(), encoding="utf-8", decode_responses=True
            )
            await self._redis.ping()
            self._pubsub = self._redis.pubsub()
            await self._pubsub.psubscribe("dm:*", "room:*", "broadcast:*", "control:*")
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

    # ── revocation ───────────────────────────────────────────────────────────
    async def evict_from_room(self, user_id: str, room_id: str) -> None:
        """Stop delivering a room to a user, on EVERY pod, immediately.

        Removing a family member updates the database and, under Centrifugo,
        calls `unsubscribe`. Neither of those touches a native WebSocket or an
        SSE stream that is already open: `_room_members` still lists the user,
        so `send_to_room` keeps fanning hub messages — which in a family Care
        Hub means PHI — to somebody who was just removed, until they happen to
        disconnect.

        That was survivable while the socket was a rarely-used fallback. It is
        not survivable now that SSE is the default transport, so revocation has
        to reach the live stream too.
        """
        uid, rid = str(user_id), str(room_id)
        self._evict_local(uid, rid)
        # Also drop the cluster-wide presence entry, or room_presence keeps
        # counting somebody who was removed.
        if self._redis:
            try:
                await self._redis.srem(f"room_members:{rid}", uid)
            except Exception:  # noqa: BLE001
                pass
        # Other pods hold their own _room_members; tell them as well.
        if self._redis:
            try:
                await self._redis.publish(
                    f"control:{rid}",
                    json.dumps({"_origin": self._pod_id, "op": "evict",
                                "user_id": uid, "room_id": rid}),
                )
            except Exception as exc:  # noqa: BLE001
                logger.error(
                    "chat: FAILED to broadcast eviction user=%s room=%s (%s) — "
                    "other pods may keep delivering until the stream drops",
                    uid, rid, exc,
                )

    def _evict_local(self, uid: str, rid: str) -> None:
        members = self._room_members.get(rid)
        if members:
            members.discard(uid)
            if not members:
                self._room_members.pop(rid, None)

    # ── SSE listeners ────────────────────────────────────────────────────────
    # Why SSE exists at all: a WebSocket needs an HTTP upgrade, and an upgrade
    # cannot pass through a Next.js Route Handler (the app's /api proxy), needs
    # a WS-aware reverse proxy, and 404s outright if uvicorn was installed
    # without `uvicorn[standard]`. Every one of those failures is silent in the
    # browser and shows up as "messages only appear when I refresh".
    #
    # SSE is plain HTTP. It goes through the proxy that already works.
    SSE_QUEUE_MAX = 200
    # A user with more open streams than this is a client bug or a leak, not a
    # person with many tabs. Without a cap, one flapping tab can accumulate
    # queues until the pod runs out of memory.
    SSE_MAX_STREAMS_PER_USER = 8

    def add_listener(self, user_id: str) -> Optional["Listener"]:
        """Register an SSE stream. Returns None if the user is over the cap."""
        uid = str(user_id)
        streams = self._listeners.setdefault(uid, set())
        if len(streams) >= self.SSE_MAX_STREAMS_PER_USER:
            logger.warning(
                "chat: refusing SSE stream for user=%s — %d already open",
                uid, len(streams),
            )
            if not streams:
                del self._listeners[uid]
            return None
        lis = Listener()
        streams.add(lis)
        return lis

    def remove_listener(self, user_id: str, lis: "Listener") -> None:
        uid = str(user_id)
        lis.close()
        if uid in self._listeners:
            self._listeners[uid].discard(lis)
            if not self._listeners[uid]:
                del self._listeners[uid]

    def is_online(self, user_id: str) -> bool:
        """Per-pod presence. For cluster-wide, keep an online set in Redis."""
        uid = str(user_id)
        return uid in self._connections or uid in self._listeners

    def local_socket_count(self) -> int:
        return (sum(len(s) for s in self._connections.values())
                + sum(len(s) for s in self._listeners.values()))

    # ── rooms ────────────────────────────────────────────────────────────────
    async def join_room(self, user_id: str, room_id: str) -> None:
        # Room membership is tracked even under Centrifugo. Centrifugo owns its
        # own subscriptions, but an SSE client on this pod is NOT a Centrifugo
        # subscriber — and SSE is what the browser falls back to when it cannot
        # reach Centrifugo. Skipping this made that fallback a silent no-op:
        # the stream opened, said "ready", showed "live", and delivered nothing.
        self._room_members.setdefault(str(room_id), set()).add(str(user_id))
        if self._redis:
            try:
                await self._redis.sadd(f"room_members:{room_id}", str(user_id))
            except Exception:  # noqa: BLE001
                pass

    async def leave_room(self, user_id: str, room_id: str) -> None:
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
            # Centrifugo knows about Centrifugo subscribers only. Any client on
            # the SSE fallback is invisible to it, so take the larger of the two
            # rather than reporting a count that silently omits them.
            n = int(await centrifugo.presence_count(centrifugo.room_channel(room_id)) or 0)
            if self._redis:
                try:
                    n = max(n, int(await self._redis.scard(f"room_members:{room_id}") or 0))
                except Exception:  # noqa: BLE001
                    pass
            return n
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
        # Local transports FIRST. If Centrifugo is unreachable — the very case
        # the browser falls back to SSE for — `publish` blocks for the full
        # centrifugo_api_timeout before returning False. Publishing first would
        # put that timeout in front of every SSE delivery.
        await self._deliver_to_user(str(to_user_id), full)
        if self._redis:
            try:
                await self._redis.publish(
                    f"dm:{to_user_id}",
                    json.dumps({"_origin": self._pod_id, **full}, default=str),
                )
            except Exception:  # noqa: BLE001
                pass
        if effective_transport() == "centrifugo":
            await centrifugo.publish(centrifugo.user_channel(to_user_id), full)

    async def send_to_room(
        self, room_id: str, message: dict, exclude_user: Optional[str] = None
    ) -> None:
        full = {"type": "room_message", "room_id": str(room_id), **message}

        # Local transports FIRST, Centrifugo after.
        #
        # If Centrifugo is unreachable — the very situation the browser falls
        # back to SSE for — `publish` blocks for the whole
        # centrifugo_api_timeout before giving up. Publishing first would put
        # that timeout in front of every SSE delivery, so the fallback would
        # "work" at five seconds a message.
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
        if effective_transport() == "centrifugo":
            await centrifugo.publish(centrifugo.room_channel(room_id), full)

    async def send_notification(self, user_id: str, notification: dict) -> None:
        """Live in-app notification, delivered on the user's personal channel."""
        full = {"type": "notification", **notification}
        await self._deliver_to_user(str(user_id), full)
        if self._redis:
            try:
                await self._redis.publish(
                    f"dm:{user_id}",
                    json.dumps({"_origin": self._pod_id, **full}, default=str),
                )
            except Exception:  # noqa: BLE001
                pass
        if effective_transport() == "centrifugo":
            await centrifugo.publish(centrifugo.user_channel(user_id), full)

    async def _deliver_to_user(self, user_id: str, data: dict) -> None:
        """Fan one frame out to every live transport this user holds here.

        WebSockets and SSE streams are both served from this ONE function, so
        a frame can never reach one transport and not the other.
        """
        uid = str(user_id)

        if uid in self._connections:
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

        if uid in self._listeners:
            stalled: set["Listener"] = set()
            for lis in list(self._listeners[uid]):
                try:
                    lis.queue.put_nowait(data)
                except asyncio.QueueFull:
                    # A reader this far behind is gone, or on a link that cannot
                    # keep up. Dropping frames silently would leave holes in the
                    # conversation; closing the stream makes the client
                    # reconnect and refetch, so the gap heals itself.
                    stalled.add(lis)
                except Exception:  # noqa: BLE001
                    stalled.add(lis)
            for lis in stalled:
                self._listeners[uid].discard(lis)
                lis.close()          # an Event — always deliverable, unlike a
                                     # sentinel pushed into a queue that is full
            if uid in self._listeners and not self._listeners[uid]:
                del self._listeners[uid]

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
                    elif channel.startswith("control:"):
                        if data.get("op") == "evict":
                            self._evict_local(
                                str(data.get("user_id")), str(data.get("room_id"))
                            )
                    elif channel.startswith("broadcast:"):
                        # Both transports. Iterating only _connections meant an
                        # SSE client silently missed broadcasts a WebSocket
                        # client received.
                        for uid in set(self._connections) | set(self._listeners):
                            await self._deliver_to_user(uid, data)
                except Exception as exc:  # noqa: BLE001
                    logger.error("chat: redis listener error: %s", exc)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.error("chat: redis listener stopped: %s", exc)


# Singleton, shared for the app lifetime.
manager = ConnectionManager()

class Listener:
    """One open SSE stream.

    The close signal is an Event, NOT a sentinel pushed onto the queue.

    The first version pushed ``None`` when the queue overflowed — into the very
    queue that had just raised QueueFull, with no await in between, so the
    sentinel could never be enqueued and the exception was swallowed. The
    stream was detached from `_listeners` (so it received nothing ever again)
    while its generator kept happily emitting heartbeats, so the browser's
    EventSource stayed OPEN and the UI kept showing a green "live" dot for a
    connection that was permanently dead. That is precisely the bug this whole
    change exists to eliminate, reintroduced by the safety valve meant to
    prevent it.
    """

    __slots__ = ("queue", "closed", "task")

    def __init__(self) -> None:
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=ConnectionManager.SSE_QUEUE_MAX)
        self.closed: asyncio.Event = asyncio.Event()
        # The task running this stream's generator. Needed because setting the
        # Event is not always enough — see close().
        self.task: Optional[asyncio.Task] = None

    def close(self) -> None:
        """Signal, and if necessary force.

        Setting the Event is enough when the generator is waiting on the queue.
        It is NOT enough when the generator is parked inside `yield`, blocked
        on an ASGI write to a client that has stopped reading — which is
        exactly the client an overflow implies. In that state the generator
        never returns to the top of the loop, so it never sees the Event, and
        the stream sits there holding a full queue for as long as the tab
        exists (a suspended laptop, a tab the OS has descheduled).

        So cancel the task too. That unwinds the blocked write and lets the
        generator's `finally` release the listener and its room membership.
        """
        self.closed.set()
        t = self.task
        if t is not None and not t.done():
            t.cancel()
