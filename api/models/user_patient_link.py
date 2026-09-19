"""
User-Patient Link Model
Links phone_users (or legacy users) to patient profiles
"""

from sqlalchemy import Column, String, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime
from typing import Optional
import uuid

from .base import Base, TimestampMixin

class UserPatientLink(Base, TimestampMixin):
    """
    Links authentication identities (phone_users or users) to patient profiles.
    Supports both phone OTP users (primary) and email/password users (legacy).
    """
    __tablename__ = "user_patient_links"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )

    # Authentication identity (phone_user or legacy user)
    phone_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("phone_users.id", ondelete="CASCADE"),
        nullable=True,
        index=True
    )

    # Legacy user (email/password)
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        index=True
    )

    # Patient profile
    patient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patients.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    # Metadata
    is_primary: Mapped[bool] = mapped_column(Boolean, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # Constraints
    __table_args__ = (
        # Each auth identity can have at most one primary patient
        UniqueConstraint('phone_user_id', 'is_primary', name='uq_phone_user_primary'),
        UniqueConstraint('user_id', 'is_primary', name='uq_user_primary'),
        # Each patient can be linked to only one auth identity
        UniqueConstraint('patient_id', name='uq_patient_link'),
    )

    def __repr__(self):
        auth_id = self.phone_user_id or self.user_id
        return f"<UserPatientLink {auth_id} -> {self.patient_id}>"
