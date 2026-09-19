"""Audit Log Model - Simple database logging for all events"""
from sqlalchemy import Column, String, Text, Integer, Boolean, JSON
from sqlalchemy.dialects.postgresql import UUID, JSONB, TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column
from typing import Optional
from datetime import datetime
import uuid

from models.base import Base, UUIDMixin, TimestampMixin


class AuditLog(Base, UUIDMixin, TimestampMixin):
    """
    Centralized audit log table for all application events

    Event Types:
    - auth: login, logout, token_refresh, password_change
    - api: request_start, request_end, error
    - mdt: extraction_start, extraction_success, extraction_failed
    - patient_access: view, create, update, delete
    - file: upload, download, delete
    - database: slow_query, error
    """
    __tablename__ = "audit_logs"

    # Event Classification
    event_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
        comment="auth, api, mdt, patient_access, file, database, etc."
    )
    event_name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        index=True,
        comment="login, upload, extraction_success, etc."
    )
    severity: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="info",
        index=True,
        comment="debug, info, warning, error, critical"
    )

    # Who/What/Where
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        nullable=True,
        index=True,
        comment="User who performed the action"
    )
    tenant_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        nullable=True,
        index=True,
        comment="Tenant context"
    )
    patient_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        nullable=True,
        index=True,
        comment="Patient whose data was accessed"
    )

    # Request Context
    ip_address: Mapped[Optional[str]] = mapped_column(
        String(45),
        nullable=True,
        comment="IPv4 or IPv6 address"
    )
    user_agent: Mapped[Optional[str]] = mapped_column(
        String(512),
        nullable=True,
        comment="Browser/client user agent"
    )
    request_method: Mapped[Optional[str]] = mapped_column(
        String(10),
        nullable=True,
        comment="GET, POST, PUT, DELETE, etc."
    )
    request_path: Mapped[Optional[str]] = mapped_column(
        String(512),
        nullable=True,
        comment="API endpoint path"
    )
    request_id: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
        comment="Unique request identifier for correlation"
    )

    # Performance Metrics
    duration_ms: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
        comment="Duration in milliseconds"
    )
    status_code: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
        comment="HTTP status code"
    )

    # Event Details
    message: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        comment="Human-readable event description"
    )
    details: Mapped[Optional[dict]] = mapped_column(
        JSONB,
        nullable=True,
        comment="Additional structured data (JSON)"
    )

    # Error Information
    error_type: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
        comment="Exception class name"
    )
    error_message: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="Error message"
    )
    stack_trace: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="Full stack trace for errors"
    )

    # PHI/Security Flags
    contains_phi: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        comment="Whether this event involved PHI"
    )
    success: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        comment="Whether the action succeeded"
    )

    def __repr__(self):
        return f"<AuditLog(event_type='{self.event_type}', event_name='{self.event_name}', user_id={self.user_id})>"
