"""Clinic model"""
from sqlalchemy import String, Boolean, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from typing import Optional
from models.base import Base, UUIDMixin, TimestampMixin


class Clinic(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "clinics"

    # External ID from source system (DocEHR)
    external_id: Mapped[Optional[str]] = mapped_column(
        String(255),
        unique=True,
        nullable=True,
        index=True
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    subscription_tier: Mapped[Optional[str]] = mapped_column(String(50))
    address: Mapped[Optional[str]] = mapped_column(Text)
    phone: Mapped[Optional[str]] = mapped_column(String(30))
    email: Mapped[Optional[str]] = mapped_column(String(320))
    gstin: Mapped[Optional[str]] = mapped_column(String(50))
    settings: Mapped[Optional[dict]] = mapped_column(JSON, default={})
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    code: Mapped[Optional[str]] = mapped_column(String(50), unique=True)

    # Relationships
    appointments: Mapped[list["Appointment"]] = relationship("Appointment", back_populates="clinic")
    patient_documents: Mapped[list["PatientDocument"]] = relationship("PatientDocument", back_populates="clinic")
