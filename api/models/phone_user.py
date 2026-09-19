"""Phone user model for authentication"""
from sqlalchemy import String, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from typing import Optional

from models.base import Base, UUIDMixin, TimestampMixin


class PhoneUser(Base, UUIDMixin, TimestampMixin):
    """
    Phone-based user authentication.
    Stores phone numbers for OTP-based login.
    """
    __tablename__ = "phone_users"

    # External ID from source system
    external_id: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        index=True
    )

    # Phone number (10 digits, no country code)
    phone_number: Mapped[str] = mapped_column(
        String(10),
        unique=True,
        nullable=False,
        index=True
    )

    # Country code (default +91 for India)
    country_code: Mapped[str] = mapped_column(
        String(5),
        default="+91",
        nullable=False
    )

    # Verification status
    is_verified: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False
    )

    # Active status
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        index=True
    )

    # Relationships
    patients: Mapped[list["Patient"]] = relationship("Patient", back_populates="phone_user")

    def __repr__(self):
        return f"<PhoneUser(id={self.id}, phone={self.phone_number}, verified={self.is_verified})>"
