"""Patient Document model"""
from sqlalchemy import String, BigInteger, Text, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from typing import Optional
from datetime import datetime
import uuid

from models.base import Base, UUIDMixin


class PatientDocument(Base, UUIDMixin):
    __tablename__ = "patient_documents"

    clinic_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("clinics.id", ondelete="CASCADE"))
    patient_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"))
    kind: Mapped[Optional[str]] = mapped_column(String(50))
    title: Mapped[Optional[str]] = mapped_column(String(255))
    file_name: Mapped[Optional[str]] = mapped_column(String(500))
    mime_type: Mapped[Optional[str]] = mapped_column(String(100))
    size_bytes: Mapped[Optional[int]] = mapped_column(BigInteger)
    data_url: Mapped[Optional[str]] = mapped_column(Text)
    uploaded_by_id: Mapped[Optional[uuid.UUID]]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    # Relationships
    clinic: Mapped[Optional["Clinic"]] = relationship("Clinic", back_populates="patient_documents")
    patient: Mapped[Optional["Patient"]] = relationship("Patient", back_populates="documents")
