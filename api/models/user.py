import uuid
import enum
from datetime import date, datetime
from typing import Optional
from sqlalchemy import String, Boolean, Date, DateTime, ForeignKey, Enum as SAEnum, Integer, ARRAY, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from .base import Base, TimestampMixin, UUIDMixin


class TenantRole(str, enum.Enum):
    # Patient plane
    member = "member"           # patient / individual health record owner
    caregiver = "caregiver"     # acts on behalf of another member (family)
    provider = "provider"       # clinician; record access via consent grant

    # Operator plane — administer the stack, never auto-PHI
    operator_admin = "operator_admin"
    operator_developer = "operator_developer"
    operator_support = "operator_support"
    operator_security = "operator_security"
    operator_billing = "operator_billing"


# Operator-plane permissions
OPERATOR_PERMISSIONS: dict[str, set[str]] = {
    TenantRole.operator_admin: {
        "ehr.manage", "ai.keys.rotate", "audit.read", "audit.export",
        "inbox.assign", "users.manage", "billing.read", "settings.write",
    },
    TenantRole.operator_developer: {
        "ehr.manage",
    },
    TenantRole.operator_support: {
        "inbox.assign", "ehr.read_status",
    },
    TenantRole.operator_security: {
        "audit.read", "audit.export",
    },
    TenantRole.operator_billing: {
        "billing.read",
    },
}


class User(Base, UUIDMixin, TimestampMixin):
    """
    Authentication identity ONLY.
    Patient data is stored in separate patients table.
    One User can manage multiple Patients (e.g., parent managing children).
    """
    __tablename__ = "users"

    # Authentication fields
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)

    # Password management
    password_updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    password_updated_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Account status
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Roles
    roles: Mapped[Optional[list[str]]] = mapped_column(ARRAY(Text), nullable=True, default=['patient'])

    # Relationships
    memberships: Mapped[list["TenantMembership"]] = relationship(back_populates="user")


class TenantMembership(Base, UUIDMixin, TimestampMixin):
    """Links a User to a Tenant with one or more roles."""
    __tablename__ = "tenant_memberships"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[TenantRole] = mapped_column(SAEnum(TenantRole), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    # For member role: the health Record this membership governs
    member_record_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )

    user: Mapped["User"] = relationship(back_populates="memberships")
    tenant: Mapped["Tenant"] = relationship(back_populates="memberships")


class OTPSession(Base, UUIDMixin, TimestampMixin):
    """Short-lived OTP verification session. Expires in 10 minutes, max 3 attempts."""
    __tablename__ = "otp_sessions"

    phone: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    delivery_channel: Mapped[str] = mapped_column(String(10), nullable=False)   # 'sms' | 'email'
    delivery_address: Mapped[str] = mapped_column(String(320), nullable=False)  # E.164 or email
    otp_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    purpose: Mapped[str] = mapped_column(String(20), nullable=False, default='auth')
