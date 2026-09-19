"""Clinical Output model"""
from sqlalchemy import String, Text, JSON, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from typing import Optional
from datetime import datetime
import uuid

from models.base import Base, UUIDMixin


class ClinicalOutput(Base, UUIDMixin):
    __tablename__ = "clinical_outputs"

    consultation_id: Mapped[Optional[uuid.UUID]]
    appointment_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("appointments.id", ondelete="CASCADE"))
    soap_note: Mapped[Optional[str]] = mapped_column(Text)
    icd_codes: Mapped[Optional[list]] = mapped_column(JSON, default=[])
    snomed_codes: Mapped[Optional[list]] = mapped_column(JSON, default=[])
    management_plan: Mapped[Optional[str]] = mapped_column(Text)
    patient_summary: Mapped[Optional[str]] = mapped_column(Text)
    interactions: Mapped[Optional[dict]] = mapped_column(JSON)
    raw_api_response: Mapped[Optional[dict]] = mapped_column(JSON)
    processed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
