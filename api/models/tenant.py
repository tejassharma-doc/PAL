import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Boolean, Text, Integer, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB
import enum

from .base import Base, TimestampMixin, UUIDMixin


class DeploymentMode(str, enum.Enum):
    self_hosted = "self_hosted"
    institutional = "institutional"


class AIProvider(str, enum.Enum):
    anthropic = "anthropic"
    bedrock = "bedrock"


class PrivacyMode(str, enum.Enum):
    # PHI stays on host; never sent to provider without explicit per-call consent
    strict = "strict"
    # PHI may be sent under session-scoped consent (default for institutional)
    session_consent = "session_consent"
    # PHI always allowed with standing consent (user opt-in only)
    standing_consent = "standing_consent"


class Tenant(Base, UUIDMixin, TimestampMixin):
    """
    One institution / self-hosted deployment. Every data row is tenant-scoped.
    The default tenant (id = DEFAULT_TENANT_ID) represents the single-user
    self-hosted mode so existing data never needs migration.
    """
    __tablename__ = "tenants"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    deployment_mode: Mapped[DeploymentMode] = mapped_column(
        SAEnum(DeploymentMode), default=DeploymentMode.self_hosted, nullable=False
    )
    privacy_mode: Mapped[PrivacyMode] = mapped_column(
        SAEnum(PrivacyMode), default=PrivacyMode.strict, nullable=False
    )

    # BAA posture (recorded for compliance)
    baa_signed: Mapped[bool] = mapped_column(Boolean, default=False)
    baa_signed_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    baa_counterparty: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Operator AI key config — stored encrypted; never returned via API
    # Serialized as: {"provider": "anthropic"|"bedrock", "region": "...", "key_last4": "..."}
    # Actual key stored in a secrets manager reference, not in DB plaintext
    operator_key_config: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    operator_key_configured: Mapped[bool] = mapped_column(Boolean, default=False)

    # Rate limits
    daily_token_budget: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    per_user_daily_token_budget: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Age of majority (days from birth) — configurable per tenant (Indian norm: 18 * 365)
    age_of_majority_days: Mapped[int] = mapped_column(Integer, default=6570)

    active: Mapped[bool] = mapped_column(Boolean, default=True)

    memberships: Mapped[list["TenantMembership"]] = relationship(back_populates="tenant")
