"""Appointment model"""
from sqlalchemy import String, Integer, DateTime, Text, JSON, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from typing import Optional
from datetime import datetime
import uuid

from models.base import Base, UUIDMixin, TimestampMixin


class Appointment(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "appointments"

    clinic_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("clinics.id", ondelete="CASCADE"))
    patient_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"))
    doctor_id: Mapped[Optional[uuid.UUID]]

    # External appointment ID from webhook (for deduplication)
    external_appointment_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, unique=True, index=True)

    # Appointment details
    appointment_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    slot_time: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=30)
    type: Mapped[Optional[str]] = mapped_column(String(50))
    status: Mapped[str] = mapped_column(String(50), default="scheduled")

    # Visit details
    chief_complaint: Mapped[Optional[str]] = mapped_column(Text)
    reason_for_visit: Mapped[Optional[str]] = mapped_column(Text)
    notes: Mapped[Optional[str]] = mapped_column(Text)
    intake: Mapped[Optional[dict]] = mapped_column(JSON)

    # Doctor and clinic info (from webhook)
    doctor_name: Mapped[Optional[str]] = mapped_column(String(255))
    clinic_name: Mapped[Optional[str]] = mapped_column(String(255))

    # Relationships
    clinic: Mapped[Optional["Clinic"]] = relationship("Clinic", back_populates="appointments")
    patient: Mapped[Optional["Patient"]] = relationship("Patient", back_populates="appointments")
    consultations: Mapped[list["Consultation"]] = relationship("Consultation", back_populates="appointment", cascade="all, delete-orphan")
