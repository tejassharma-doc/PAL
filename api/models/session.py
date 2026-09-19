"""User sessions with encrypted JWT tokens stored in database"""
import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, Text, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID

from .base import Base


class UserSession(Base):
    """Stores encrypted JWT tokens and session metadata"""
    __tablename__ = "user_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)

    # Encrypted JWT token stored in database
    encrypted_token: Mapped[str] = mapped_column(Text, nullable=False)

    # Session metadata
    session_name: Mapped[str] = mapped_column(String(100), nullable=True)  # e.g., "Chrome on Windows"
    ip_address: Mapped[str] = mapped_column(String(45), nullable=True)  # IPv4 or IPv6
    user_agent: Mapped[str] = mapped_column(String(500), nullable=True)

    # Session lifecycle
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_activity: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
