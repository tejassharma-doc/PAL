import uuid
from datetime import date, datetime
from typing import Optional
from sqlalchemy import Integer, String, Date, DateTime, text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID

from .base import Base, TimestampMixin


class UserLLMCredits(Base, TimestampMixin):
    """Per-user LLM credit pool. Refills daily at midnight."""
    __tablename__ = "user_llm_credits"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    balance: Mapped[int] = mapped_column(Integer, nullable=False, default=20)
    last_refill_date: Mapped[date] = mapped_column(Date, nullable=False, server_default=text("CURRENT_DATE"))
    total_purchased: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_used: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class CreditTransaction(Base):
    """Immutable log of every credit movement. Used for cost tracking during pilot."""
    __tablename__ = "credit_transactions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    delta: Mapped[int] = mapped_column(Integer, nullable=False)
    # positive = add (refill, purchase), negative = deduct
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    # daily_refill | deduct | purchase | refund
    pack_id: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    # starter | standard | power (when kind=purchase)
    tokens_used: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # actual LLM tokens — logs real usage for Gemma migration decision
    llm_model: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    # claude-haiku-4-5 | gemma-4-2b
    amount_inr: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # paise (₹49 → 4900) — populated only for purchase transactions
    balance_after: Mapped[int] = mapped_column(Integer, nullable=False)
    ts: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("NOW()"), index=True
    )
