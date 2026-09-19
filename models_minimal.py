"""
Minimal models needed for webhook processing
Stripped down versions without complex relationships
"""
import uuid
from datetime import datetime, date
from typing import Optional
from sqlalchemy import String, Boolean, Date, DateTime, ForeignKey, Text, Integer, JSON
from sqlalchemy.orm import Mapped, mapped_column, DeclarativeBase
from sqlalchemy.dialects.postgresql import UUID


# Base classes
class Base(DeclarativeBase):
    pass


class UUIDMixin:
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False
    )


# Minimal models
class PhoneUser(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "phone_users"

    phone_number: Mapped[str] = mapped_column(String(10), unique=True, nullable=False)
    country_code: Mapped[str] = mapped_column(String(5), default="+91")
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Patient(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "patients"

    clinic_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    mrn: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    abha_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    abha_address: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    date_of_birth: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    gender: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(320), nullable=True)

    blood_group: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Appointment(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "appointments"

    clinic_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    patient_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    doctor_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)

    external_appointment_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, unique=True)

    appointment_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    slot_time: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=30)
    type: Mapped[Optional[str]] = mapped_column(String(50))
    status: Mapped[str] = mapped_column(String(50), default="scheduled")

    chief_complaint: Mapped[Optional[str]] = mapped_column(Text)
    reason_for_visit: Mapped[Optional[str]] = mapped_column(Text)
    notes: Mapped[Optional[str]] = mapped_column(Text)
    intake: Mapped[Optional[dict]] = mapped_column(JSON)

    doctor_name: Mapped[Optional[str]] = mapped_column(String(255))
    clinic_name: Mapped[Optional[str]] = mapped_column(String(255))


class UserPatientLink(Base, TimestampMixin):
    __tablename__ = "user_patient_links"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    phone_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)

    is_primary: Mapped[bool] = mapped_column(Boolean, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Doctor(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "doctors"

    external_id: Mapped[Optional[str]] = mapped_column(String(255), unique=True, nullable=True)

    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[Optional[str]] = mapped_column(String(320), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)

    specialization: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    license_number: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
