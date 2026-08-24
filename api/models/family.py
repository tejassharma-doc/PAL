"""
PAL Family Plan — data model.

DESIGN PREMISE
--------------
A family plan is a *billing and coordination* container. It is NOT a consent
container. Joining a family plan grants a member exactly ZERO access to anyone
else's health record. Access is only ever created by one of three things:

  1. SELF          — you always see your own record.
  2. GUARDIANSHIP  — a legal guardian sees a minor's (<18) record. This grant is
                     created automatically, is scoped, is audited, and
                     AUTO-EXPIRES on the minor's 18th birthday
                     (``FamilyMember.guardianship_expires_at``), at which point
                     it flips to ``pending`` and the now-adult must re-consent.
  3. CONSENT HANDSHAKE — an adult explicitly approves a specific grantee for a
                     specific scope, in-app, with one tap. Revocable any time.

This is the difference between a family plan that passes a privacy review and
one that does not. The primary account holder is a *billing admin*, not a
records admin: paying the bill never implies the right to read the record.

TABLES (all new — no existing PAL table is modified)
  family_plans            one per household; owns the Family Care Hub room
  family_members          a seat in the plan; may exist before the person signs up
  family_invites          phone-tagged invitation with a hashed code
  family_access_grants    the consent ledger (request → grant → revoke), append-only
  family_payment_requests payment delegation, server-authoritative amounts
"""
import enum
import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    String, Text, Integer, Boolean, Date, DateTime, ForeignKey,
    UniqueConstraint, Index, func, text,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, UUIDMixin, TimestampMixin


# ── Enums ────────────────────────────────────────────────────────────────────
# Stored as VARCHAR (see the note in models/chat.py) — keeps the migration
# additive and reversible with no PG ENUM type objects to drop.

class FamilyRole(str, enum.Enum):
    """What a seat can DO in the plan. Orthogonal to what it can SEE."""
    admin = "admin"
    # Primary account holder. Billing, invites, removals, plan settings.
    # Implicit record access: ONLY to minors they are guardian of.

    adult = "adult"
    # Adult member, self-managing. Sees only their own record by default.
    # Can be made a billing delegate.

    dependent_adult = "dependent_adult"
    # Adult who has opted into assisted care (e.g. an elderly parent).
    # STILL must consent per-grantee — the label changes the UX (bigger
    # confirm buttons, caregiver nudges), never the authorization.

    minor = "minor"
    # Under 18. Guardian-managed until guardianship_expires_at.


class FamilyMemberStatus(str, enum.Enum):
    invited = "invited"      # seat exists, person has not authenticated yet
    active = "active"
    suspended = "suspended"  # temporarily off (non-payment, etc.) — keeps history
    removed = "removed"      # soft-removed; grants cascade-revoked


class FamilyRelationship(str, enum.Enum):
    self_ = "self"
    spouse = "spouse"
    parent = "parent"
    child = "child"
    sibling = "sibling"
    grandparent = "grandparent"
    grandchild = "grandchild"
    other = "other"


class AccessScope(str, enum.Enum):
    """Least-privilege ladder. A grantee gets exactly one scope per grant."""
    appointments = "appointments"
    # Appointment dates/status and payment obligations. NO clinical content.
    # This is the scope that makes payment delegation work with minimum PHI.

    medications = "medications"
    # Above + medication list and adherence. The common "help Dad take his
    # pills" scope.

    summary = "summary"
    # Above + conditions, allergies, vitals. No raw documents or notes.

    full = "full"
    # Everything the subject can see, including documents and lab reports.


# Ordered least → most privileged. Used by ``scope_satisfies``.
_SCOPE_ORDER: tuple[str, ...] = (
    AccessScope.appointments.value,
    AccessScope.medications.value,
    AccessScope.summary.value,
    AccessScope.full.value,
)


def scope_satisfies(held: Optional[str], required: str) -> bool:
    """True if a grantee holding ``held`` may perform an action needing
    ``required``. Unknown/None scopes deny."""
    if not held:
        return False
    try:
        return _SCOPE_ORDER.index(held) >= _SCOPE_ORDER.index(required)
    except ValueError:
        return False


class AccessGrantStatus(str, enum.Enum):
    pending = "pending"    # requested, awaiting the subject's tap
    granted = "granted"
    denied = "denied"
    revoked = "revoked"
    expired = "expired"


class AccessGrantBasis(str, enum.Enum):
    consent_handshake = "consent_handshake"   # subject tapped Approve
    guardianship = "guardianship"             # minor, auto-created
    self_access = "self_access"               # you, your own record
    break_glass = "break_glass"               # emergency; alerts + hard audit


class HubShareLevel(str, enum.Enum):
    """How much of THIS member's care activity may appear in the shared
    Family Care Hub. The hub is a group room — everything posted there is
    visible to every member, so it defaults to the least revealing setting."""
    none = "none"          # nothing about me is ever posted to the hub
    minimal = "minimal"    # DEFAULT. "Payment due for Amma's visit — ₹500."
                           # No provider name, no specialty, no reason.
    detailed = "detailed"  # provider name + appointment type. Opt-in only.


class PaymentRequestStatus(str, enum.Enum):
    pending = "pending"
    paid = "paid"
    cancelled = "cancelled"
    expired = "expired"
    failed = "failed"


# ── Tables ───────────────────────────────────────────────────────────────────
class FamilyPlan(Base, UUIDMixin, TimestampMixin):
    """One household. Owns billing and exactly one Family Care Hub room."""
    __tablename__ = "family_plans"

    tenant_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)

    primary_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )

    # The shared "Family Care Hub" chat room. Created lazily on first need by
    # services.family.service.ensure_hub_room(). Nullable so a plan can exist
    # before chat is enabled — the plan degrades to REST-only, it does not break.
    hub_room_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("chat_rooms.id", ondelete="SET NULL"),
        index=True,
    )

    # server_default on every NOT NULL defaulted column — see the note in
    # models/chat.py. create_all() and alembic must agree exactly.
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active", server_default="active")
    max_members: Mapped[int] = mapped_column(Integer, nullable=False, default=6, server_default="6")
    billing_currency: Mapped[str] = mapped_column(String(3), nullable=False, default="INR", server_default="INR")

    # Plan-wide ceiling on hub verbosity. The effective level for any message is
    # min(plan.hub_share_ceiling, member.hub_share_level) — a member can always
    # be quieter than the plan, never louder.
    hub_share_ceiling: Mapped[str] = mapped_column(
        String(20), nullable=False, default=HubShareLevel.minimal.value,
        server_default=HubShareLevel.minimal.value,
    )

    settings: Mapped[Optional[dict]] = mapped_column(JSONB)

    members: Mapped[list["FamilyMember"]] = relationship(
        "FamilyMember", back_populates="plan", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<FamilyPlan(id={self.id}, name={self.name!r})>"


class FamilyMember(Base, UUIDMixin, TimestampMixin):
    """A seat in a family plan.

    A seat is created by the admin BEFORE the person has an account — tagged by
    phone number. When someone authenticates with a matching phone, the seat is
    claimed (``user_id`` filled in). That is the whole "dependent routing"
    mechanism, and it is why ``user_id`` is nullable.
    """
    __tablename__ = "family_members"

    family_plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("family_plans.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )

    # NULL until the invitee authenticates and claims the seat.
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    # The health record this seat refers to. Also nullable — a minor may have a
    # patient record with no user login at all.
    patient_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("patients.id", ondelete="SET NULL"), index=True
    )

    # E.164. The routing key that connects a signup to a pre-created seat.
    phone: Mapped[Optional[str]] = mapped_column(String(30), index=True)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)

    relationship_type: Mapped[str] = mapped_column(
        String(30), nullable=False, default=FamilyRelationship.other.value,
        server_default=FamilyRelationship.other.value,
    )
    role: Mapped[str] = mapped_column(
        String(30), nullable=False, default=FamilyRole.adult.value,
        server_default=FamilyRole.adult.value,
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=FamilyMemberStatus.invited.value,
        server_default=FamilyMemberStatus.invited.value,
    )

    date_of_birth: Mapped[Optional[date]] = mapped_column(Date)

    # Guardianship (minors only). guardianship_expires_at is set to the 18th
    # birthday at seat creation; a daily job (or lazy check on read) flips any
    # grant whose basis is 'guardianship' to 'pending' once it passes.
    guardian_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    guardianship_expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), index=True
    )

    # Billing delegation: may this seat pay for OTHER members' care?
    # The admin always can; this extends it to e.g. a second adult child.
    is_billing_delegate: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )

    # Per-member ceiling on what may be said about them in the shared hub.
    hub_share_level: Mapped[str] = mapped_column(
        String(20), nullable=False, default=HubShareLevel.minimal.value,
        server_default=HubShareLevel.minimal.value,
    )
    hub_muted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))

    invited_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    invited_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    joined_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    removed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    plan: Mapped["FamilyPlan"] = relationship("FamilyPlan", back_populates="members")

    __table_args__ = (
        # One seat per phone per plan. Partial-unique would be nicer but a plain
        # unique is fine: NULL phones don't collide in PostgreSQL.
        UniqueConstraint("family_plan_id", "phone", name="uq_family_member_phone"),
        UniqueConstraint("family_plan_id", "user_id", name="uq_family_member_user"),
        Index("ix_family_members_plan_status", "family_plan_id", "status"),
    )

    @property
    def is_minor(self) -> bool:
        """Age-derived, not role-derived — the role can drift, a birthday can't."""
        if self.date_of_birth is None:
            return self.role == FamilyRole.minor.value
        today = date.today()
        years = (
            today.year - self.date_of_birth.year
            - ((today.month, today.day) < (self.date_of_birth.month, self.date_of_birth.day))
        )
        return years < 18

    def __repr__(self) -> str:  # pragma: no cover
        return f"<FamilyMember(id={self.id}, name={self.display_name!r}, role={self.role})>"


class FamilyInvite(Base, UUIDMixin, TimestampMixin):
    """A phone-tagged invitation. The code is stored hashed, never in plaintext,
    and is rate-limited by ``attempts`` exactly like PAL's existing OTPSession."""
    __tablename__ = "family_invites"

    family_plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("family_plans.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    family_member_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("family_members.id", ondelete="CASCADE"),
        index=True,
    )

    phone: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    code_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    accepted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    accepted_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    created_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )


class FamilyAccessGrant(Base, UUIDMixin, TimestampMixin):
    """The consent ledger. Append-mostly: rows are never deleted, only
    transitioned, so 'who could see what, when, and why' is always answerable.

    Mirrors the shape of the (currently stubbed) ConsentGrant that PAL's
    ``phi/consent.py`` was written against, so the two can be reconciled later
    without another migration.
    """
    __tablename__ = "family_access_grants"

    family_plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("family_plans.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # Whose record is being accessed.
    subject_member_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("family_members.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # Who wants to access it.
    grantee_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )

    scope: Mapped[str] = mapped_column(String(30), nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=AccessGrantStatus.pending.value,
        server_default=AccessGrantStatus.pending.value, index=True,
    )
    basis: Mapped[str] = mapped_column(
        String(30), nullable=False, default=AccessGrantBasis.consent_handshake.value,
        server_default=AccessGrantBasis.consent_handshake.value,
    )

    request_message: Mapped[Optional[str]] = mapped_column(Text)
    requested_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    decided_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    # 'app_tap' | 'otp' | 'admin_guardianship' | 'system_expiry'
    decision_channel: Mapped[Optional[str]] = mapped_column(String(30))

    expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), index=True
    )
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    revoked_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    revocation_reason: Mapped[Optional[str]] = mapped_column(Text)

    __table_args__ = (
        Index(
            "ix_family_grants_lookup",
            "subject_member_id", "grantee_user_id", "status",
        ),
    )

    @property
    def is_live(self) -> bool:
        """A grant is live only if granted, un-revoked and un-expired."""
        if self.status != AccessGrantStatus.granted.value:
            return False
        if self.revoked_at is not None:
            return False
        if self.expires_at is not None:
            now = datetime.now(self.expires_at.tzinfo)
            if self.expires_at <= now:
                return False
        return True


class FamilyPaymentRequest(Base, UUIDMixin, TimestampMixin):
    """Payment delegation.

    SECURITY INVARIANT: amount, currency and payee are set server-side from the
    appointment/invoice. The client never supplies an amount, and the pay link
    is generated server-side and bound to this row's id. A hub message merely
    *references* this row — tampering with the chat message cannot change what
    gets charged.
    """
    __tablename__ = "family_payment_requests"

    family_plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("family_plans.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # Who the care was for.
    subject_member_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("family_members.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    appointment_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("appointments.id", ondelete="SET NULL"),
        index=True,
    )

    # Minor units (paise for INR). Integer — never float for money.
    amount_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="INR", server_default="INR")

    # Already redacted to the effective HubShareLevel before it is written.
    description: Mapped[str] = mapped_column(String(300), nullable=False)

    payment_url: Mapped[Optional[str]] = mapped_column(String(1000))
    provider: Mapped[Optional[str]] = mapped_column(String(50))
    provider_ref: Mapped[Optional[str]] = mapped_column(String(200), index=True)

    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=PaymentRequestStatus.pending.value,
        server_default=PaymentRequestStatus.pending.value, index=True,
    )

    requested_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    paid_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # The hub message that carries the pay card, so status changes can update it.
    hub_message_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True))

    # Makes "generate a payment request for this appointment" safely retryable.
    idempotency_key: Mapped[Optional[str]] = mapped_column(String(120), unique=True)

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"<FamilyPaymentRequest(id={self.id}, "
            f"amount={self.amount_minor} {self.currency}, status={self.status})>"
        )
