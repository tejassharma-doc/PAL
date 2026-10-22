"""Subscription API — Razorpay recurring subscriptions + login gating.

  GET  /subscription/status   -> current user's subscription state
  POST /subscription/create   -> create a Razorpay subscription, return checkout info
  POST /subscription/webhook  -> Razorpay webhook (signature-verified) -> update status
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Union

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user_unified
from config import get_settings
from database import get_db
from models import Subscription
from models.phone_user import PhoneUser
from models.user import User
from services.billing import razorpay_client
from services.billing.subscription_service import user_has_active_subscription

logger = logging.getLogger("subscription")
router = APIRouter(prefix="/subscription", tags=["subscription"])


def _ts(value) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc)
    except (TypeError, ValueError, OSError):
        return None


@router.get("/status")
async def subscription_status(
    user: Union[PhoneUser, User] = Depends(get_current_user_unified),
    db: AsyncSession = Depends(get_db),
):
    settings = get_settings()
    active = await user_has_active_subscription(user.id, db)
    sub = (await db.execute(
        select(Subscription)
        .where(Subscription.phone_user_id == user.id)
        .order_by(Subscription.created_at.desc())
    )).scalars().first()
    return {
        "active": active,
        "subscription_enabled": settings.subscription_enabled,
        "status": sub.status if sub else None,
        "current_end": sub.current_end.isoformat() if sub and sub.current_end else None,
        "pricing_url": settings.pricing_url,
    }


@router.post("/create")
async def create_subscription(
    user: Union[PhoneUser, User] = Depends(get_current_user_unified),
    db: AsyncSession = Depends(get_db),
):
    """Create a Razorpay subscription for the logged-in user and return the
    checkout parameters (subscription_id + key_id) for the frontend."""
    settings = get_settings()
    if not razorpay_client.configured():
        raise HTTPException(status_code=503, detail="Payments are not configured")

    # Reuse an existing non-terminal subscription if the user already started one.
    existing = (await db.execute(
        select(Subscription)
        .where(Subscription.phone_user_id == user.id)
        .order_by(Subscription.created_at.desc())
    )).scalars().first()
    if existing and existing.status in ("created", "authenticated", "active", "pending") and existing.razorpay_subscription_id:
        return {
            "subscription_id": existing.razorpay_subscription_id,
            "razorpay_key_id": settings.razorpay_key_id,
            "short_url": existing.short_url,
        }

    contact = getattr(user, "phone_number", None)
    try:
        sub = await razorpay_client.create_subscription(
            customer_id=None,
            notes={"phone_user_id": str(user.id), "contact": contact or ""},
        )
    except Exception as exc:
        logger.error("Razorpay create_subscription failed: %s", exc)
        raise HTTPException(status_code=502, detail="Could not start subscription")

    row = Subscription(
        phone_user_id=user.id,
        razorpay_subscription_id=sub.get("id"),
        plan_id=sub.get("plan_id") or settings.razorpay_plan_id,
        status=sub.get("status") or "created",
        short_url=sub.get("short_url"),
        current_start=_ts(sub.get("current_start")),
        current_end=_ts(sub.get("current_end")),
    )
    db.add(row)
    await db.commit()

    return {
        "subscription_id": sub.get("id"),
        "razorpay_key_id": settings.razorpay_key_id,
        "short_url": sub.get("short_url"),
    }


@router.post("/webhook")
async def razorpay_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """Razorpay subscription webhook. Verifies the signature, then updates the
    matching subscription row's status/period."""
    raw = await request.body()
    signature = request.headers.get("x-razorpay-signature", "")
    if not razorpay_client.verify_webhook_signature(raw, signature):
        raise HTTPException(status_code=400, detail="Invalid signature")

    import json
    try:
        payload = json.loads(raw)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid payload")

    event = payload.get("event", "")
    entity = (((payload.get("payload") or {}).get("subscription") or {}).get("entity")) or {}
    sub_id = entity.get("id")
    if not sub_id:
        return {"ok": True, "ignored": "no subscription entity"}

    row = (await db.execute(
        select(Subscription).where(Subscription.razorpay_subscription_id == sub_id)
    )).scalars().first()
    if not row:
        logger.warning("Webhook for unknown subscription %s (%s)", sub_id, event)
        return {"ok": True, "ignored": "unknown subscription"}

    status = entity.get("status")
    if status:
        row.status = status
    cs = _ts(entity.get("current_start"))
    ce = _ts(entity.get("current_end"))
    if cs:
        row.current_start = cs
    if ce:
        row.current_end = ce
    await db.commit()
    logger.info("Subscription %s -> %s (%s)", sub_id, row.status, event)
    return {"ok": True}
