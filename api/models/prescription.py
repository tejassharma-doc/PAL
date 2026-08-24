"""Prescription model"""
from sqlalchemy import String, Boolean, Integer, Text, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column
from typing import Optional
from datetime import datetime
import uuid

from models.base import Base, UUIDMixin, TimestampMixin


class Prescription(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "prescriptions"

    patient_id: Mapped[Optional[uuid.UUID]]
    consultation_id: Mapped[Optional[uuid.UUID]]
    items: Mapped[Optional[list]] = mapped_column(JSON, default=[])
    interaction_acknowledged: Mapped[bool] = mapped_column(Boolean, default=False)
    refillable: Mapped[bool] = mapped_column(Boolean, default=False)
    refills_remaining: Mapped[int] = mapped_column(Integer, default=0)
    pdf_url: Mapped[Optional[str]] = mapped_column(Text)
    shared_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
