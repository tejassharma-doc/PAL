"""Worker-safe realtime + push delivery for medication reminders.

This runs inside the Celery worker, which has NO FastAPI lifespan — so we do not
depend on the chat ConnectionManager's background Redis listener. Instead we:

  * PUBLISH the frame to `dm:<recipient_id>` on the chat Redis DB. The already-
    running API process's manager is psubscribed to `dm:*` and fans the frame out
    to that user's live WebSocket / SSE streams (it skips frames whose `_origin`
    equals its own pod id — ours never will).
  * Publish to Centrifugo `user:<id>` when Centrifugo is the active transport.
  * Send FCM/APNs push to the user's registered devices.

Mirrors ConnectionManager.send_notification's wire format exactly, so the client
needs no new transport code — only a handler for the new frame `type`s.
"""
from __future__ import annotations

import json
import logging
import uuid
from typing import Optional

import redis.asyncio as aioredis
from sqlalchemy import select

from config import get_settings
from database import AsyncSessionLocal
from models.medication import DeviceToken
from services.chat import centrifugo
from services.chat.manager import _chat_redis_url

logger = logging.getLogger("pal.medications.delivery")
settings = get_settings()


async def deliver_realtime(recipient_id: str | uuid.UUID, frame: dict) -> None:
    """Fan one frame out over the live transports (Redis dm:* + Centrifugo)."""
    rid = str(recipient_id)
    payload = {"_origin": "celery", **frame}

    try:
        r = aioredis.from_url(_chat_redis_url(), encoding="utf-8", decode_responses=True)
        try:
            await r.publish(f"dm:{rid}", json.dumps(payload, default=str))
        finally:
            await r.aclose()
    except Exception as exc:  # noqa: BLE001
        logger.warning("medications: redis publish to dm:%s failed: %s", rid, exc)

    try:
        if centrifugo.is_enabled():
            await centrifugo.publish(centrifugo.user_channel(rid), frame)
    except Exception as exc:  # noqa: BLE001
        logger.warning("medications: centrifugo publish to %s failed: %s", rid, exc)


async def send_push(
    phone_user_id: Optional[str | uuid.UUID],
    title: str,
    body: str,
    data: Optional[dict] = None,
) -> int:
    """Push to every active device registered for this phone user.

    Best-effort: a missing credential or dead token never raises. Returns the
    number of devices a push was accepted for.
    """
    if not phone_user_id:
        return 0

    try:
        async with AsyncSessionLocal() as db:
            rows = (
                await db.execute(
                    select(DeviceToken.platform, DeviceToken.token).where(
                        DeviceToken.phone_user_id == uuid.UUID(str(phone_user_id)),
                        DeviceToken.active.is_(True),
                    )
                )
            ).all()
    except Exception as exc:  # noqa: BLE001
        logger.warning("medications: device-token lookup failed for %s: %s", phone_user_id, exc)
        return 0

    if not rows:
        return 0

    # Imported lazily: the sarvam package __init__ pulls in the voice STT/TTS
    # stack, whose import is allowed to fail on hosts without those deps. A push
    # that cannot load must never take down realtime delivery.
    try:
        from services.sarvam import push as push_svc
    except Exception as exc:  # noqa: BLE001
        logger.warning("medications: push module unavailable, skipping push: %s", exc)
        return 0

    sent = 0
    for platform, token in rows:
        try:
            ok = await push_svc.send_push_notification(
                platform=platform, device_token=token, title=title, body=body, data=data or {}
            )
            sent += 1 if ok else 0
        except Exception as exc:  # noqa: BLE001
            logger.warning("medications: push to %s device failed: %s", platform, exc)
    return sent
