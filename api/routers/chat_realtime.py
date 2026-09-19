"""
Centrifugo token endpoints — the authorisation boundary for realtime.

  POST /chat/realtime/connect-token     issue a connection JWT
  POST /chat/realtime/subscribe-token   issue a per-channel JWT (RBAC-gated)
  GET  /chat/realtime/config            what the client needs to connect

THIS IS THE SECURITY BOUNDARY. Centrifugo will let a client subscribe to a
`room:*` / `user:*` channel if and only if we hand it a subscription token for
that exact channel (verified against v5.4.9 — an untokened subscribe is denied
with error 103, and a token minted for a different channel closes the socket).

So `subscribe-token` runs exactly the same checks the native socket ran:
  - `room:<id>`  -> `is_room_member()`, the same function `/ws/chat` used
  - `user:<id>`  -> must be your own id

If those checks are wrong, Centrifugo is wrong. Nothing else guards the channel.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from services.chat.principal import Principal, get_chat_principal
from config import get_settings
from services.chat import centrifugo
from services.chat.authz import is_room_member_lazy
from services.chat.manager import effective_transport

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/chat/realtime", tags=["chat-realtime"])


class SubscribeTokenIn(BaseModel):
    channel: str


class ConnectTokenOut(BaseModel):
    token: str
    url: str
    expires_in: int
    transport: str


@router.get("/config")
async def realtime_config(user: Principal = Depends(get_chat_principal)):
    """Lets the client discover the transport instead of hard-coding it, so a
    rollback to the native socket needs no app release."""
    transport = effective_transport()
    return {
        "transport": transport,
        "url": settings.centrifugo_url if transport == "centrifugo" else None,
        "user_channel": centrifugo.user_channel(user.id),
        "token_ttl": settings.centrifugo_token_ttl,
    }


@router.post("/connect-token", response_model=ConnectTokenOut)
async def connect_token(user: Principal = Depends(get_chat_principal)):
    """Short-lived connection JWT.

    Carries no `channels` claim on purpose — every subscription is authorised
    individually and freshly, so a revoked grant or a removed family member
    cannot ride out the token's TTL.
    """
    if effective_transport() != "centrifugo":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Realtime transport is not Centrifugo; use /ws/chat",
        )
    return ConnectTokenOut(
        token=centrifugo.make_connection_token(
            user.id, info={"username": user.username}
        ),
        url=settings.centrifugo_url,
        expires_in=settings.centrifugo_token_ttl,
        transport="centrifugo",
    )


@router.post("/subscribe-token")
async def subscribe_token(
    body: SubscribeTokenIn,
    user: Principal = Depends(get_chat_principal),
):
    """Authorise ONE channel for THIS user. Deny by default."""
    if effective_transport() != "centrifugo":
        raise HTTPException(status_code=409, detail="Realtime transport is not Centrifugo")

    channel = body.channel.strip()

    room_id = centrifugo.parse_room_channel(channel)
    if room_id:
        # Identical check to the one the native socket ran on join_room.
        if not await is_room_member_lazy(room_id, user.id):
            logger.info(
                "centrifugo: refused subscribe user=%s channel=%s (not a member)",
                user.id, channel,
            )
            raise HTTPException(status_code=403, detail="Not a member of this conversation")
        return {"token": centrifugo.make_subscription_token(user.id, channel)}

    target_user = centrifugo.parse_user_channel(channel)
    if target_user:
        if target_user != str(user.id):
            logger.warning(
                "centrifugo: user=%s tried to subscribe to ANOTHER user's channel %s",
                user.id, channel,
            )
            raise HTTPException(status_code=403, detail="Not your channel")
        return {"token": centrifugo.make_subscription_token(user.id, channel)}

    raise HTTPException(status_code=400, detail="Unknown channel namespace")


@router.get("/health")
async def realtime_health(user: Principal = Depends(get_chat_principal)):
    """Operator-facing reachability probe (authenticated: it reveals infra state)."""
    return {"transport": effective_transport(), **(await centrifugo.health())}
