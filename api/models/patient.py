"""Patient model - separate from authentication User"""
import uuid
from datetime import date, datetime
from typing import Optional
from sqlalchemy import String, Boolean, Date, DateTime, ForeignKey, Text, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB

from .base import Base, TimestampMixin, UUIDMixin


class Patient(Base, UUIDMixin, TimestampMixin):
    """
    Patient health record - contains all patient personal and medical information.
    Linked to phone_users for phone OTP authentication.
    """
    __tablename__ = "patients"
    __table_args__ = {'extend_existing': True}

    # User link - link to phone user who owns this patient record
    phone_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("phone_users.id", ondelete="CASCADE"),
        nullable=True,
        index=True
    )

    # Healthcare identifiers
    clinic_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        nullable=True,
        index=True
    )
    mrn: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)  # Medical Record Number
    abha_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True, unique=True)  # Ayushman Bharat Health Account
    abha_address: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Personal information
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    date_of_birth: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    gender: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # 'male', 'female', 'other'
    phone: Mapped[Optional[str]] = mapped_column(String(30), nullable=True, index=True)
    email: Mapped[Optional[str]] = mapped_column(String(320), nullable=True)

    # Medical information
    blood_group: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)  # 'A+', 'B+', 'O-', etc.
    address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    allergies: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # Comma-separated or JSON
    chronic_conditions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    current_medications: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Emergency contact (stored as JSON)
    emergency_contact: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    # Format: {"name": "...", "relationship": "...", "phone": "...", "email": "..."}

    # Profile
    photo_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Relationships
    phone_user: Mapped[Optional["PhoneUser"]] = relationship("PhoneUser", back_populates="patients")
    appointments: Mapped[list["Appointment"]] = relationship("Appointment", back_populates="patient")
    documents: Mapped[list["PatientDocument"]] = relationship("PatientDocument", back_populates="patient")
    lab_tests: Mapped[list["LabTest"]] = relationship("LabTest", back_populates="patient", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Patient(id={self.id}, name={self.full_name}, mrn={self.mrn})>"
