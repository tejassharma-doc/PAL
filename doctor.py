"""Doctor model"""
from sqlalchemy import String, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from typing import Optional

from models.base import Base, UUIDMixin, TimestampMixin


class Doctor(Base, UUIDMixin, TimestampMixin):
    """
    Doctor profile from external systems.
    Linked via external_id for deduplication.
    """
    __tablename__ = "doctors"

    # External ID from source system
    external_id: Mapped[Optional[str]] = mapped_column(
        String(255),
        unique=True,
        nullable=True,
        index=True
    )

    # Doctor information
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[Optional[str]] = mapped_column(String(320), nullable=True, index=True)
    phone: Mapped[Optional[str]] = mapped_column(String(30), nullable=True, index=True)

    # Additional fields
    specialization: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    license_number: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)

    def __repr__(self):
        return f"<Doctor(id={self.id}, name={self.full_name}, external_id={self.external_id})>"
