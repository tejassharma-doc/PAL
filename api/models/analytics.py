import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB

from .base import Base


class AnalyticsEvent(Base):
    """Fire-and-forget event stream for install attribution and conversion tracking."""
    __tablename__ = "analytics_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    # app_install | hermes_notification_sent | notification_opened | search_turn | call_started
    source: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    # docehr | play_store | app_store | direct
    ref_code: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    doctor_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    clinic_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    metadata_: Mapped[Optional[dict]] = mapped_column("metadata", JSONB, nullable=True)
    ts: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()", index=True
    )


class Attribution(Base):
    """One row per user — records how they first arrived in PAL."""
    __tablename__ = "attributions"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    ref_code: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    doctor_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    clinic_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    app_store: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    # play_store | app_store
    install_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )
