"""Subscription status helper shared by the router and phone auth."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from models import Subscription


async def user_has_active_subscription(phone_user_id, db: AsyncSession) -> bool:
    """True if the phone user has a running subscription. When subscriptions are
    disabled (subscription_enabled=false) this always returns True so login is
    not gated."""
    settings = get_settings()
    if not settings.subscription_enabled:
        return True

    rows = await db.execute(
        select(Subscription).where(Subscription.phone_user_id == phone_user_id)
    )
    now = datetime.now(timezone.utc)
    for sub in rows.scalars().all():
        if sub.status in ("active", "authenticated"):
            if sub.current_end is None or sub.current_end > now:
                return True
    return False
