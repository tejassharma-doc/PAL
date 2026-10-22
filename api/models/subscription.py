"""Subscription model — Razorpay recurring subscription per phone user.

One row per phone_user tracking their Razorpay subscription lifecycle. Login is
gated on an *active* subscription (see routers/subscription.py + phone_auth).
No FK to users (phone-user based app); phone_user_id is a soft reference.
"""
from datetime import datetime
from typing import Optional
import uuid

from sqlalchemy import String, DateTime
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base, UUIDMixin, TimestampMixin


class Subscription(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "subscriptions"

    phone_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)

    razorpay_subscription_id: Mapped[Optional[str]] = mapped_column(String(64), index=True)
    razorpay_customer_id: Mapped[Optional[str]] = mapped_column(String(64))
    plan_id: Mapped[Optional[str]] = mapped_column(String(64))

    # created | authenticated | active | pending | halted | cancelled | completed | expired
    status: Mapped[str] = mapped_column(String(20), default="created", nullable=False, index=True)
    current_start: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    current_end: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    short_url: Mapped[Optional[str]] = mapped_column(String(512))
    notes: Mapped[Optional[dict]] = mapped_column(JSONB)

    def __repr__(self) -> str:
        return f"<Subscription(phone_user_id={self.phone_user_id}, status={self.status})>"
