"""
Family Plan authorization + PHI minimum-necessary policy.

Two jobs:

  A. ``resolve_access`` — can user X see member Y's record, and at what scope?
     This is the single function every family-scoped read must call. It is
     deliberately boring and deny-by-default.

  B. ``redact_for_hub`` — what may be *said* about a member in the shared
     Family Care Hub?

Why (B) exists
--------------
The Family Care Hub is a group room. Anything posted there is visible to every
member of the plan, including members who hold no access grant over the subject.
A naive implementation posts:

    "Dr. Anita Rao (Oncology) — follow-up for Sushila is complete. Pay Rs 500"

...which discloses a cancer diagnosis to the entire household, from a *payment*
feature. Nobody granted consent for that. The hub is therefore treated as a
low-trust channel: messages are redacted to the effective share level BEFORE
they are written to ``chat_messages``, not at render time. Redacting at render
time would leave the PHI sitting in the database and in every client cache.

Effective level = min(plan.hub_share_ceiling, member.hub_share_level).
Default is 'minimal' at both layers, so the safe thing happens with no config.
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.family import (
    AccessGrantBasis,
    AccessGrantStatus,
    AccessScope,
    FamilyMember,
    FamilyMemberStatus,
    FamilyPlan,
    FamilyRole,
    HubShareLevel,
    scope_satisfies,
)
from models.family import FamilyAccessGrant

logger = logging.getLogger(__name__)

_LEVEL_ORDER = (
    HubShareLevel.none.value,
    HubShareLevel.minimal.value,
    HubShareLevel.detailed.value,
)


def effective_hub_level(plan: FamilyPlan, member: FamilyMember) -> str:
    """A member can always be quieter than the plan, never louder."""
    try:
        return _LEVEL_ORDER[
            min(
                _LEVEL_ORDER.index(plan.hub_share_ceiling),
                _LEVEL_ORDER.index(member.hub_share_level),
            )
        ]
    except ValueError:
        return HubShareLevel.minimal.value


class AccessDecision:
    """Result of an authorization check. Carries the *reason*, because every
    PHI access in PAL is audited and 'why' is the useful column."""

    __slots__ = ("allowed", "scope", "basis", "grant_id", "reason")

    def __init__(
        self,
        allowed: bool,
        scope: Optional[str] = None,
        basis: Optional[str] = None,
        grant_id: Optional[uuid.UUID] = None,
        reason: str = "",
    ) -> None:
        self.allowed = allowed
        self.scope = scope
        self.basis = basis
        self.grant_id = grant_id
        self.reason = reason

    def __bool__(self) -> bool:
        return self.allowed

    def as_dict(self) -> dict:
        return {
            "allowed": self.allowed,
            "scope": self.scope,
            "basis": self.basis,
            "grant_id": str(self.grant_id) if self.grant_id else None,
            "reason": self.reason,
        }


DENY = AccessDecision(False, reason="no_grant")


async def resolve_access(
    db: AsyncSession,
    *,
    grantee_user_id: uuid.UUID,
    subject_member: FamilyMember,
    required_scope: str = AccessScope.appointments.value,
) -> AccessDecision:
    """Can ``grantee_user_id`` read ``subject_member``'s record at
    ``required_scope``? Deny by default.

    Order matters: self, then guardianship, then explicit consent. Plan
    membership alone is checked nowhere in here on purpose — being in the same
    family plan grants nothing.
    """
    # 1. SELF
    if subject_member.user_id and subject_member.user_id == grantee_user_id:
        return AccessDecision(
            True, AccessScope.full.value, AccessGrantBasis.self_access.value,
            reason="self",
        )

    # 2. GUARDIANSHIP — minors only, and only while it has not aged out.
    if (
        subject_member.guardian_user_id == grantee_user_id
        and subject_member.is_minor
    ):
        expires = subject_member.guardianship_expires_at
        if expires is None or expires > datetime.now(timezone.utc):
            return AccessDecision(
                True, AccessScope.full.value, AccessGrantBasis.guardianship.value,
                reason="guardian_of_minor",
            )
        logger.info(
            "family: guardianship expired member=%s guardian=%s",
            subject_member.id, grantee_user_id,
        )

    # 3. EXPLICIT CONSENT
    rows = (
        await db.execute(
            select(FamilyAccessGrant).where(
                FamilyAccessGrant.subject_member_id == subject_member.id,
                FamilyAccessGrant.grantee_user_id == grantee_user_id,
                FamilyAccessGrant.status == AccessGrantStatus.granted.value,
            )
        )
    ).scalars().all()

    best: Optional[FamilyAccessGrant] = None
    for g in rows:
        if not g.is_live:
            continue
        if scope_satisfies(g.scope, required_scope):
            if best is None or scope_satisfies(g.scope, best.scope):
                best = g

    if best is not None:
        return AccessDecision(
            True, best.scope, best.basis, best.id, reason="consent_grant"
        )

    return AccessDecision(False, reason="no_grant")


def can_manage_plan(member: Optional[FamilyMember], plan: FamilyPlan, user_id: uuid.UUID) -> bool:
    """Invite, remove, change plan settings. Billing admin powers only —
    explicitly NOT record access."""
    if plan.primary_user_id == user_id:
        return True
    return bool(
        member
        and member.role == FamilyRole.admin.value
        and member.status == FamilyMemberStatus.active.value
    )


def can_pay_for(payer: Optional[FamilyMember], plan: FamilyPlan, user_id: uuid.UUID) -> bool:
    """Who may settle a payment request on someone else's behalf.

    Paying is a *financial* act, not a clinical one, so it does not require an
    access grant — but the pay card the payer sees is already redacted to the
    subject's hub share level, so they learn nothing extra by paying.
    """
    if plan.primary_user_id == user_id:
        return True
    if payer is None or payer.status != FamilyMemberStatus.active.value:
        return False
    return payer.is_billing_delegate or payer.role == FamilyRole.admin.value


# ── PHI minimum-necessary redaction for the shared hub ───────────────────────
def redact_for_hub(
    *,
    level: str,
    subject_display_name: str,
    kind: str,
    provider_name: Optional[str] = None,
    specialty: Optional[str] = None,
    reason_for_visit: Optional[str] = None,
    amount_display: Optional[str] = None,
) -> Optional[str]:
    """Build the text that may appear in the shared Family Care Hub.

    Returns None when nothing at all may be posted (level='none') — callers
    must treat None as "skip the hub, notify the authorized people directly".

    ``kind``: 'payment_due' | 'appointment_complete' | 'appointment_booked'
              | 'medication_due' | 'access_request'
    """
    if level == HubShareLevel.none.value:
        return None

    detailed = level == HubShareLevel.detailed.value
    who = subject_display_name

    if kind == "payment_due":
        base = f"Payment due for {who}'s visit"
        if detailed and provider_name:
            base = f"Payment due for {who}'s visit with {provider_name}"
        return f"{base} — {amount_display}" if amount_display else base

    if kind == "appointment_complete":
        if detailed and provider_name:
            return f"{who}'s appointment with {provider_name} is complete."
        return f"{who}'s appointment is complete."

    if kind == "appointment_booked":
        if detailed and provider_name:
            return f"{who} has an appointment booked with {provider_name}."
        return f"{who} has an appointment booked."

    if kind == "medication_due":
        # Never name the drug in a shared room, at any level. The drug name is
        # the diagnosis. Detail belongs in a 1:1 DM with a consented caregiver.
        return f"{who} has a medication reminder today."

    if kind == "access_request":
        return f"A family member has requested access to {who}'s health record."

    return f"Update for {who}."


def payment_description(
    *,
    level: str,
    subject_display_name: str,
    provider_name: Optional[str] = None,
    reason_for_visit: Optional[str] = None,
) -> str:
    """Short label stored on the payment request row itself. Same rules —
    the row is readable by any billing delegate, so it is redacted too."""
    if level == HubShareLevel.detailed.value and provider_name:
        return f"{subject_display_name} — visit with {provider_name}"[:300]
    return f"{subject_display_name} — clinic visit"[:300]
