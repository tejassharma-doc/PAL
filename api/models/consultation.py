"""Consultation model"""
from sqlalchemy import String, Text, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from typing import Optional
from datetime import datetime
import uuid

from models.base import Base, UUIDMixin, TimestampMixin


class Consultation(Base, UUIDMixin, TimestampMixin):
    """
    Medical consultation record linked to an appointment.
    Contains consultation notes and voice transcripts.
    """
    __tablename__ = "consultations"

    # Foreign keys
    appointment_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("appointments.id", ondelete="CASCADE"),
        nullable=True,
        index=True
    )
    doctor_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        nullable=True,
        index=True
    )

    # Content
    note_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    voice_transcript: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Status
    status: Mapped[str] = mapped_column(
        String(50),
        default="in_progress",
        nullable=False,
        index=True
    )

    # Timestamps
    finished_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )

    external_id: Mapped[Optional[str]] = mapped_column(
        nullable=True,
        index=True
    )

    # Relationships
    appointment: Mapped[Optional["Appointment"]] = relationship(
        "Appointment",
        back_populates="consultations"
    )

    def __repr__(self):
        return f"<Consultation(id={self.id}, appointment_id={self.appointment_id}, status={self.status})>"
