"""Server-Sent Events: realtime chat over plain HTTP.

WHY THIS EXISTS
---------------
The native transport is a WebSocket, and a WebSocket needs an HTTP *upgrade*.
That upgrade is the single most fragile thing in this whole feature, because it
fails in several ways that are all completely silent in the browser:

  1. A Next.js Route Handler cannot proxy an upgrade, so the app's own
     `/api/...` proxy cannot carry it. `APPLY.md` §4 called this "the only step
     that is not copy-and-go" — and if that step is skipped, `chatSocketUrl()`
     falls back to `window.location.origin`, which is the Next port, and the
     handshake dies there.
  2. A reverse proxy without `Upgrade`/`Connection` headers drops it.
  3. uvicorn installed WITHOUT the `[standard]` extra answers the handshake
     with a plain **HTTP 404** and logs "No supported WebSocket library
     detected". Reproduced in testing: the route exists and works in-process,
     and 404s over the network.

In every one of those cases the UI looks fine and messages only appear when the
user reloads the page — because a reload refetches history over REST. That is
exactly the bug reported.

SSE has none of those failure modes. It is an ordinary HTTP GET that never
finishes, so it travels through the same proxy that already serves every other
API call, needs no new port, no nginx change, and no Centrifugo.

COST
----
One HTTP connection per open tab and one bounded queue, and the stream rides
`ConnectionManager._deliver_to_user` — the *same* fan-out as the WebSocket, so
there is exactly one Redis subscription per pod no matter how many clients are
attached, and cross-pod delivery, room membership and PHI redaction are shared
rather than duplicated.

This is not the 1M-concurrency answer; Centrifugo is, and it still takes
priority when configured. This is the transport that works everywhere else,
including everywhere Centrifugo is not deployed.

AUTH
----
`EventSource` cannot set request headers — a browser limitation, not a choice —
so the token travels as `?token=`, exactly as the existing `/ws/chat` endpoint
already does. An `Authorization` header is also accepted for non-browser
clients. Both paths run the same `authenticate_ws_token`, and the stream only
ever carries frames addressed to the authenticated user.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import AsyncIterator, Optional

from fastapi import APIRouter, Depends, Header, Query, Request
from jose import JWTError, jwt
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from config import get_settings
from database import AsyncSessionLocal
from services.chat.authz import authenticate_ws_token
from services.chat.manager import manager

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/chat", tags=["chat-sse"])

# Keeps the connection warm through proxies that cut idle sockets, AND — just
# as important — gives the client something it can actually observe.
#
# A bare SSE comment (`: ping`) fires NO JavaScript event. A stream that is
# open but delivering nothing therefore looks identical, from the browser, to a
# stream that is merely quiet. That is the difference between "your friend has
# not messaged yet" and "this connection is dead and you must refresh", and the
# client had no way to tell them apart. So the heartbeat is a real named event.
_HEARTBEAT_S = float(settings.chat_sse_heartbeat)


def _sse(event: str, data: str) -> str:
    """One SSE frame.

    Every line of the payload needs its own `data:` prefix or the frame is
    truncated at the first newline — the classic way to ship an SSE endpoint
    that works until someone sends a multi-line message.
    """
    body = "\n".join(f"data: {line}" for line in data.split("\n"))
    return f"event: {event}\n{body}\n\n"


async def _user_by_id(db: AsyncSession, user_id: str):
    """Resolve a ticket's subject, re-checking that the account is still active.

    A ticket is a bearer credential, so the account state is verified here and
    not trusted from the claims — a user deactivated in the last 60 seconds
    must not be able to open a stream.

    PAL's PRIMARY auth is phone OTP, whose subject is a ``PhoneUser`` id, not a
    ``User`` id. A ticket carries only the raw id (no auth_type), so both tables
    are checked — PhoneUser first, since that is the common case. Resolving only
    ``User`` here was silently 401ing every phone user's stream and dropping them
    to polling (i.e. "the website only updates on refresh").
    """
    import uuid as _uuid
    from models import User
    from models.phone_user import PhoneUser
    from sqlalchemy import select
    try:
        uid = _uuid.UUID(str(user_id))
    except (ValueError, AttributeError, TypeError):  # a malformed uuid is a bad ticket
        return None
    row = (await db.execute(select(PhoneUser).where(PhoneUser.id == uid))).scalar_one_or_none()
    if row is None:
        row = (await db.execute(select(User).where(User.id == uid))).scalar_one_or_none()
    if row is None or not row.is_active:
        return None
    return row


async def _rooms_for(db: AsyncSession, user_id: str) -> list[str]:
    """Every room the user currently holds a seat in.

    The WebSocket protocol makes the client ask to join rooms. SSE is one-way,
    so the server joins them on the user's behalf at stream open. That is also
    simply better: a second family hub starts delivering without the client
    having to know it exists.
    """
    rows = (
        await db.execute(
            text(
                """
                SELECT room_id::text
                FROM chat_room_members
                WHERE user_id = CAST(:uid AS uuid) AND left_at IS NULL
                """
            ),
            {"uid": str(user_id)},
        )
    ).fetchall()
    return [r[0] for r in rows]



# ── stream tickets ───────────────────────────────────────────────────────────
# `EventSource` cannot set an Authorization header, so the credential has to be
# in the URL. Putting the user's ordinary 30-minute access token there would
# write a fully-privileged credential into the reverse-proxy access log, the
# browser history and any `Referer` — for every user, on every page, now that
# SSE is the default transport rather than a rarely-used fallback.
#
# So the URL carries a *ticket* instead: same user, signed with the same key,
# but it expires in 60 seconds and it is only accepted by this one endpoint.
# Leaking it from a log buys an attacker a chat stream for under a minute,
# not an account.
#
# `?token=` is still accepted, because /ws/chat has always worked that way and
# the rollback path must keep working.
_TICKET_TTL = 60
_TICKET_AUD = "pal-chat-sse"
_TICKET_TYP = "sse-ticket"

# A stream is closed and the client made to reconnect after this long, even if
# nothing is wrong. Authorisation is otherwise resolved ONCE, at open, and a
# stream can live for days — so without a ceiling, deactivating an account or
# changing a membership would have no effect on a tab that is already open.
# Reconnecting re-runs the full auth and re-resolves the room list.
_MAX_STREAM_S = settings.chat_sse_max_age
# ...and between reconnects, re-check the cheap things on this cadence.
_REVALIDATE_S = settings.chat_sse_revalidate


def _mint_ticket(user_id: str) -> str:
    return jwt.encode(
        {"sub": str(user_id), "aud": _TICKET_AUD, "typ": _TICKET_TYP,
         "exp": int(time.time()) + _TICKET_TTL, "iat": int(time.time())},
        settings.secret_key,
        algorithm=settings.algorithm,
    )


def _read_ticket(raw: str) -> Optional[str]:
    """Return the user id a valid ticket names, or None.

    The audience is checked HERE, explicitly, and not left to the library.
    python-jose 3.3.0 has the "audience expected but not present" raise
    commented out in `_validate_aud`, so passing `audience=` does NOT reject a
    token that simply carries no `aud` claim. Relying on it would mean any
    token signed with this key — every ordinary 7-day access token in the
    system — became a permanent SSE ticket the moment `sub` held a user id.
    """
    try:
        # `audience=` is passed so the library rejects a token whose `aud` is
        # WRONG...
        claims = jwt.decode(
            raw, settings.secret_key, algorithms=[settings.algorithm],
            audience=_TICKET_AUD,
        )
    except JWTError:
        return None
    # ...and the claims are checked here because the library does NOT reject a
    # token whose `aud` is MISSING: jose 3.3.0 has that raise commented out in
    # `_validate_aud` and simply returns. Without this line every ordinary
    # access token signed with this key would become a permanent SSE ticket the
    # day `sub` starts holding a user id. Both checks are load-bearing; neither
    # is sufficient alone.
    if claims.get("aud") != _TICKET_AUD or claims.get("typ") != _TICKET_TYP:
        return None
    return str(claims.get("sub") or "") or None


@router.post("/stream-ticket")
async def stream_ticket(user=Depends(get_current_user)):
    """Mint a short-lived ticket for the SSE URL. Ordinary bearer auth."""
    return {"ticket": _mint_ticket(str(user.id)), "expires_in": _TICKET_TTL}

@router.get("/stream")
async def chat_stream(
    request: Request,
    ticket: str = Query(default=""),
    token: str = Query(default=""),
    authorization: Optional[str] = Header(default=None),
):
    # NOTE THE ABSENCE OF `db: AsyncSession = Depends(get_db)`.
    #
    # A dependency with `yield` is finalised when the RESPONSE COMPLETES, and
    # for a StreamingResponse that is when the stream ends — which for SSE is
    # "when the user closes the tab", possibly hours later. Declaring get_db
    # here would pin one pooled asyncpg connection per open stream against a
    # pool of 10 + 20 per pod: the 31st reader would hang the entire API, not
    # just chat.
    #
    # So the session is opened by hand, used for auth and the room lookup, and
    # closed BEFORE a single byte is streamed. Nothing inside the generator
    # touches the database.
    """Open the realtime stream. Emits `chat` events carrying the same frames
    the WebSocket sends, so the client needs no second parser."""
    ticket_uid = _read_ticket(ticket) if ticket else None

    raw = token or ""
    if not raw and authorization and authorization.lower().startswith("bearer "):
        raw = authorization[7:]

    async with AsyncSessionLocal() as db:
        if ticket_uid:
            user = await _user_by_id(db, ticket_uid)
        else:
            user = await authenticate_ws_token(db, raw)
        rooms = await _rooms_for(db, user.id) if user is not None else []

    if user is None:
        # A plain 401.
        #
        # Note that a browser will NEVER read this body: per the EventSource
        # spec a non-200 response fails the connection without parsing it, so
        # the `fatal` event below reaches non-browser clients only. The browser
        # learns its session expired from the 401 on POST /chat/stream-ticket,
        # which is an ordinary fetch, and stops rather than retrying.
        return StreamingResponse(
            iter([_sse("fatal", json.dumps({"error": "unauthorized"}))]),
            media_type="text/event-stream",
            status_code=401,
        )

    uid = str(user.id)

    async def gen() -> AsyncIterator[str]:
        lis = manager.add_listener(uid)
        if lis is None:
            # NOT a `fatal` — the client renders that as "session expired", and
            # telling someone to sign in again would not help and would leave
            # chat dead. `degraded` tells it to fall back to polling instead.
            yield _sse("degraded", json.dumps({"error": "too_many_streams"}))
            return
        # So an overflow can unblock us even while we are parked in a `yield`
        # writing to a client that has stopped reading. See Listener.close().
        lis.task = asyncio.current_task()
        for room_id in rooms:
            await manager.join_room(uid, room_id)
        opened = time.monotonic()
        last_check = opened
        getter: Optional[asyncio.Task] = None
        closer: Optional[asyncio.Task] = None
        try:
            yield _sse(
                "ready",
                json.dumps({"type": "connected", "user_id": uid, "rooms": rooms,
                            "transport": "sse", "max_age": _MAX_STREAM_S,
                            "heartbeat": _HEARTBEAT_S}),
            )
            last_beat = time.monotonic()
            while True:
                if await request.is_disconnected():
                    break

                # Hard ceiling. Authorisation for this stream was resolved once,
                # at open; the only honest way to keep a long-lived stream
                # authorised is to stop being long-lived. The client reconnects
                # immediately and transparently, which re-runs auth and picks up
                # any room the user has joined since.
                if time.monotonic() - opened > _MAX_STREAM_S:
                    yield _sse("cycle", json.dumps({"reason": "max_age"}))
                    break

                # Cheaper mid-life check: is the account still active, and is
                # the room set still the same? Catches deactivation and any
                # membership change that did not route through remove_member.
                if time.monotonic() - last_check > _REVALIDATE_S:
                    last_check = time.monotonic()
                    async with AsyncSessionLocal() as db2:
                        still = await _user_by_id(db2, uid)
                        current = await _rooms_for(db2, uid) if still else []
                    if still is None or set(current) != set(rooms):
                        yield _sse("cycle", json.dumps({"reason": "access_changed"}))
                        break

                # Wake for whichever deadline comes first. Using the heartbeat
                # alone made the max-age and revalidation checks fire only at
                # the next 20s tick, so a 12s ceiling actually cut at 20s.
                now = time.monotonic()
                timeout = min(
                    _HEARTBEAT_S - (now - last_beat),
                    _MAX_STREAM_S - (now - opened),
                    _REVALIDATE_S - (now - last_check),
                )
                timeout = max(0.25, timeout)
                if getter is None:
                    getter = asyncio.create_task(lis.queue.get())
                if closer is None:
                    closer = asyncio.create_task(lis.closed.wait())
                await asyncio.wait(
                    {getter, closer}, timeout=timeout,
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if closer.done():
                    break
                if getter.done():
                    frame = getter.result()
                    getter = None
                    yield _sse("chat", json.dumps(frame, default=str))
                    continue
                # Nothing arrived. Send a real event, not a bare comment, so
                # the client can distinguish "quiet" from "dead" and fall back
                # when a proxy has silently stopped forwarding this stream.
                yield _sse("beat", json.dumps({"t": int(time.time())}))
                last_beat = time.monotonic()
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.warning("chat: SSE stream ended for user=%s: %s", uid, exc)
        finally:
            for t in (getter, closer):
                if t is not None and not t.done():
                    t.cancel()
            # Must run on every exit path, or a disconnected tab leaks a queue
            # that _deliver_to_user keeps filling until it hits SSE_QUEUE_MAX.
            manager.remove_listener(uid, lis)
            if not manager.is_online(uid):
                for room_id in rooms:
                    await manager.leave_room(uid, room_id)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            # nginx buffers proxied responses by default, which would hold every
            # frame until the buffer fills — i.e. the feature would look broken
            # in exactly the deployments it exists to rescue.
            "X-Accel-Buffering": "no",
        },
    )
