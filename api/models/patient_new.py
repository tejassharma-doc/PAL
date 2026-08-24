"""Patient model - new schema without user_id"""
from sqlalchemy import String, Date, Boolean, Text, JSON, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from typing import Optional
from datetime import date
import uuid

from models.base import Base, UUIDMixin, TimestampMixin


class PatientNew(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "patients"

    clinic_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("clinics.id", ondelete="CASCADE"))
    mrn: Mapped[Optional[str]] = mapped_column(String(100))
    abha_id: Mapped[Optional[str]] = mapped_column(String(100), unique=True)
    abha_address: Mapped[Optional[str]] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    date_of_birth: Mapped[Optional[date]] = mapped_column(Date)
    gender: Mapped[Optional[str]] = mapped_column(String(20))
    phone: Mapped[Optional[str]] = mapped_column(String(30))
    email: Mapped[Optional[str]] = mapped_column(String(320))
    blood_group: Mapped[Optional[str]] = mapped_column(String(10))
    address: Mapped[Optional[str]] = mapped_column(Text)
    allergies: Mapped[Optional[str]] = mapped_column(Text)
    chronic_conditions: Mapped[Optional[str]] = mapped_column(Text)
    current_medications: Mapped[Optional[str]] = mapped_column(Text)
    emergency_contact: Mapped[Optional[dict]] = mapped_column(JSON)
    photo_url: Mapped[Optional[str]] = mapped_column(String(500))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # Relationships
    clinic: Mapped[Optional["Clinic"]] = relationship("Clinic", back_populates="patients")
    appointments: Mapped[list["Appointment"]] = relationship("Appointment", back_populates="patient")
    documents: Mapped[list["PatientDocument"]] = relationship("PatientDocument", back_populates="patient")
