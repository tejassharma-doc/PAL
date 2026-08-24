"""
Family Plan service layer — plans, seats, invites, consent, payments, hub.

Everything that mutates family state lives here so the router stays thin and
the same logic is reachable from background jobs (guardianship age-out,
payment expiry) without going through HTTP.
"""
import hashlib
import logging
import secrets
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select, text, func
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from models.family import (
    AccessGrantBasis,
    AccessGrantStatus,
    FamilyAccessGrant,
    FamilyInvite,
    FamilyMember,
    FamilyMemberStatus,
    FamilyPaymentRequest,
    FamilyPlan,
    FamilyRelationship,
    FamilyRole,
    HubShareLevel,
    PaymentRequestStatus,
)
from services.chat import cache as chat_cache
from services.chat import centrifugo
from services.chat.manager import manager
from services.chat.notifications import create_notification
from services.chat.persistence import persist_message
from .policy import (
    effective_hub_level,
    payment_description,
    redact_for_hub,
)

logger = logging.getLogger(__name__)
settings = get_settings()

SYSTEM_SENDER_ID = "pal-system"

#: See settings.family_max_plans_per_user for the reasoning.
MAX_PLANS_PER_USER = settings.family_max_plans_per_user


class PlanLimitReached(ValueError):
    """Raised when a user would exceed the per-user family-plan cap."""


# ── helpers ──────────────────────────────────────────────────────────────────
def _hash_code(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def _gen_invite_code() -> str:
    """6 digits — matches PAL's existing OTP UX, which these users already know."""
    return f"{secrets.randbelow(1_000_000):06d}"


def _slugify_plan(plan_id: uuid.UUID) -> str:
    return f"family-hub-{plan_id}"


def eighteenth_birthday(dob: Optional[date]) -> Optional[datetime]:
    if dob is None:
        return None
    try:
        target = dob.replace(year=dob.year + 18)
    except ValueError:  # 29 Feb
        target = dob.replace(year=dob.year + 18, day=28)
    return datetime(target.year, target.month, target.day, tzinfo=timezone.utc)


def money(amount_minor: int, currency: str = "INR") -> str:
    symbol = {"INR": "Rs ", "USD": "$", "EUR": "€", "GBP": "£"}.get(currency, f"{currency} ")
    major = amount_minor / 100
    return f"{symbol}{major:,.0f}" if amount_minor % 100 == 0 else f"{symbol}{major:,.2f}"


# ── plan + seats ─────────────────────────────────────────────────────────────
async def list_plans_for_user(db: AsyncSession, user_id: uuid.UUID) -> list[FamilyPlan]:
    """Every plan this user belongs to, owned plans first.

    A user may legitimately be in several: their own household, their elderly
    parents', their in-laws'. Capped at MAX_PLANS_PER_USER.
    """
    owned = list(
        (
            await db.execute(
                select(FamilyPlan)
                .where(FamilyPlan.primary_user_id == user_id)
                .order_by(FamilyPlan.created_at)
            )
        ).scalars().all()
    )
    seat_plan_ids = [
        r[0]
        for r in (
            await db.execute(
                select(FamilyMember.family_plan_id).where(
                    FamilyMember.user_id == user_id,
                    FamilyMember.status.in_(
                        [FamilyMemberStatus.active.value, FamilyMemberStatus.invited.value]
                    ),
                )
            )
        ).fetchall()
    ]
    owned_ids = {p.id for p in owned}
    extra_ids = [pid for pid in seat_plan_ids if pid not in owned_ids]
    joined: list[FamilyPlan] = []
    if extra_ids:
        joined = list(
            (
                await db.execute(
                    select(FamilyPlan)
                    .where(FamilyPlan.id.in_(extra_ids))
                    .order_by(FamilyPlan.created_at)
                )
            ).scalars().all()
        )
    return owned + joined


async def count_plans_for_user(db: AsyncSession, user_id: uuid.UUID) -> int:
    return len(await list_plans_for_user(db, user_id))


async def assert_can_join_another_plan(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Enforce the cap. Call BEFORE creating or claiming a seat."""
    n = await count_plans_for_user(db, user_id)
    if n >= MAX_PLANS_PER_USER:
        raise PlanLimitReached(
            f"You are already in {n} family plans. "
            f"The maximum is {MAX_PLANS_PER_USER} — leave one to join another."
        )


async def get_plan_for_user(
    db: AsyncSession, user_id: uuid.UUID, plan_id: Optional[uuid.UUID] = None
) -> Optional[FamilyPlan]:
    """One plan for this user. With `plan_id`, that specific plan (only if the
    user belongs to it). Without, the first — owned plans win."""
    plans = await list_plans_for_user(db, user_id)
    if not plans:
        return None
    if plan_id is None:
        return plans[0]
    for p in plans:
        if p.id == plan_id:
            return p
    return None


async def get_member(
    db: AsyncSession, plan_id: uuid.UUID, user_id: uuid.UUID
) -> Optional[FamilyMember]:
    return (
        await db.execute(
            select(FamilyMember).where(
                FamilyMember.family_plan_id == plan_id,
                FamilyMember.user_id == user_id,
            )
        )
    ).scalar_one_or_none()


async def list_members(db: AsyncSession, plan_id: uuid.UUID) -> list[FamilyMember]:
    return list(
        (
            await db.execute(
                select(FamilyMember)
                .where(
                    FamilyMember.family_plan_id == plan_id,
                    FamilyMember.status != FamilyMemberStatus.removed.value,
                )
                .order_by(FamilyMember.created_at)
            )
        ).scalars().all()
    )


async def create_plan(
    db: AsyncSession,
    *,
    primary_user_id: uuid.UUID,
    name: str,
    primary_display_name: str,
    primary_phone: Optional[str] = None,
    primary_patient_id: Optional[uuid.UUID] = None,
    tenant_id: Optional[uuid.UUID] = None,
) -> FamilyPlan:
    """Create a plan and seat the primary holder as admin. Idempotent-ish:
    returns the existing plan if this user already owns one."""
    existing = (
        await db.execute(select(FamilyPlan).where(FamilyPlan.primary_user_id == primary_user_id))
    ).scalar_one_or_none()
    if existing:
        return existing

    # Cap check: creating a plan consumes one of the user's slots.
    await assert_can_join_another_plan(db, primary_user_id)

    plan = FamilyPlan(
        name=name[:200],
        primary_user_id=primary_user_id,
        tenant_id=tenant_id,
        status="active",
        max_members=settings.family_max_members,
        billing_currency=settings.family_default_currency,
        hub_share_ceiling=HubShareLevel.minimal.value,
    )
    db.add(plan)
    await db.flush()

    db.add(
        FamilyMember(
            family_plan_id=plan.id,
            user_id=primary_user_id,
            patient_id=primary_patient_id,
            phone=primary_phone,
            display_name=primary_display_name[:200],
            relationship_type=FamilyRelationship.self_.value,
            role=FamilyRole.admin.value,
            status=FamilyMemberStatus.active.value,
            is_billing_delegate=True,
            joined_at=datetime.now(timezone.utc),
        )
    )
    await db.flush()
    return plan


async def ensure_hub_room(db: AsyncSession, plan: FamilyPlan) -> Optional[uuid.UUID]:
    """Find-or-create the plan's Family Care Hub room and sync its membership
    to the plan's active, claimed seats.

    Returns None (and logs) rather than raising if chat is disabled — a family
    plan must keep working as a REST feature even with the socket turned off.
    """
    if not settings.chat_enabled:
        return None

    if plan.hub_room_id:
        room_id = plan.hub_room_id
    else:
        room_id = uuid.uuid4()
        await db.execute(
            text(
                """
                INSERT INTO chat_rooms
                    (id, name, slug, room_type, description, is_private,
                     is_moderated, max_members, member_count,
                     owner_org_type, owner_org_id, created_by, created_at)
                VALUES
                    (:id, :name, :slug, 'family_hub', :description, true, true,
                     :max_members, 0, 'family_plan', :plan_id, :created_by, NOW())
                ON CONFLICT (slug) DO NOTHING
                """
            ),
            {
                "id": room_id,
                "name": f"{plan.name} — Care Hub"[:300],
                "slug": _slugify_plan(plan.id),
                "description": "Shared family coordination. Clinical details stay private.",
                "max_members": plan.max_members,
                "plan_id": plan.id,
                "created_by": plan.primary_user_id,
            },
        )
        row = (
            await db.execute(
                text("SELECT id FROM chat_rooms WHERE slug = :slug LIMIT 1"),
                {"slug": _slugify_plan(plan.id)},
            )
        ).first()
        if not row:
            logger.error("family: could not create hub room for plan=%s", plan.id)
            return None
        room_id = row[0]
        plan.hub_room_id = room_id
        await db.flush()

    # Sync membership: every active seat with a claimed user account.
    #
    # Both statements RETURN the user ids they touched so the membership cache
    # can be invalidated for exactly those pairs. Without it a newly added
    # member would be denied their own hub for up to the deny TTL and — far
    # worse — a departed member would keep passing the subscription check for
    # up to the allow TTL. See services/chat/cache.py.
    changed: set[str] = set()

    added = await db.execute(
        text(
            """
            INSERT INTO chat_room_members
                (id, room_id, user_id, role, is_muted, joined_at)
            SELECT gen_random_uuid(), CAST(:room_id AS uuid), fm.user_id,
                   CASE WHEN fm.role = 'admin' THEN 'admin' ELSE 'member' END,
                   false, NOW()
            FROM family_members fm
            WHERE fm.family_plan_id = :plan_id
              AND fm.user_id IS NOT NULL
              AND fm.status = 'active'
            ON CONFLICT ON CONSTRAINT uq_chat_room_member DO NOTHING
            RETURNING user_id
            """
        ),
        {"room_id": room_id, "plan_id": plan.id},
    )
    changed.update(str(r[0]) for r in added)

    # Mark departed members as left rather than deleting (history keeps names).
    departed = await db.execute(
        text(
            """
            UPDATE chat_room_members crm
            SET left_at = NOW()
            WHERE crm.room_id = :room_id
              AND crm.left_at IS NULL
              AND NOT EXISTS (
                  SELECT 1 FROM family_members fm
                  WHERE fm.family_plan_id = :plan_id
                    AND fm.user_id = crm.user_id
                    AND fm.status = 'active'
              )
            RETURNING crm.user_id
            """
        ),
        {"room_id": room_id, "plan_id": plan.id},
    )
    changed.update(str(r[0]) for r in departed)

    for uid in changed:
        await chat_cache.invalidate(str(room_id), uid)
    await db.execute(
        text(
            """
            UPDATE chat_rooms SET member_count = (
                SELECT COUNT(*) FROM chat_room_members
                WHERE room_id = :room_id AND left_at IS NULL
            ) WHERE id = :room_id
            """
        ),
        {"room_id": room_id},
    )
    await db.flush()
    return room_id


async def post_hub_system_message(
    db: AsyncSession,
    plan: FamilyPlan,
    *,
    text_content: str,
    content_type: str = "care_event",
    payload: Optional[dict] = None,
    subject_member_id: Optional[uuid.UUID] = None,
) -> Optional[str]:
    """Write a redacted system card into the hub and fan it out live.

    ``text_content`` MUST already be redacted — see policy.redact_for_hub.
    """
    room_id = plan.hub_room_id or await ensure_hub_room(db, plan)
    if not room_id:
        return None

    msg_id = await persist_message(
        sender_id=SYSTEM_SENDER_ID,
        message_type="system",
        content=text_content,
        room_id=str(room_id),
        content_type=content_type,
        payload=payload,
        subject_member_id=str(subject_member_id) if subject_member_id else None,
        msg_source="pal",
        session=db,
    )
    try:
        await manager.send_to_room(
            str(room_id),
            {
                "message_id": msg_id,
                "from": SYSTEM_SENDER_ID,
                "sender_id": SYSTEM_SENDER_ID,
                "sender_name": "PAL",
                "sender_role": "system",
                "content": text_content,
                "content_type": content_type,
                "payload": payload,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("family: hub fanout failed plan=%s: %s", plan.id, exc)
    return msg_id


# ── invites / seat claiming ──────────────────────────────────────────────────
async def invite_member(
    db: AsyncSession,
    *,
    plan: FamilyPlan,
    inviter_user_id: uuid.UUID,
    display_name: str,
    phone: str,
    relationship_type: str,
    role: str,
    date_of_birth: Optional[date] = None,
    is_billing_delegate: bool = False,
) -> tuple[FamilyMember, str]:
    """Create (or reuse) a seat and issue an invite code.

    Returns (member, plaintext_code). The code is returned ONCE to the caller
    so it can be sent over SMS; only its hash is stored.
    """
    active = (
        await db.execute(
            select(func.count(FamilyMember.id)).where(
                FamilyMember.family_plan_id == plan.id,
                FamilyMember.status != FamilyMemberStatus.removed.value,
            )
        )
    ).scalar() or 0
    if active >= plan.max_members:
        raise ValueError(f"Family plan is full ({plan.max_members} seats)")

    member = (
        await db.execute(
            select(FamilyMember).where(
                FamilyMember.family_plan_id == plan.id,
                FamilyMember.phone == phone,
            )
        )
    ).scalar_one_or_none()

    # Age is authoritative over the caller-supplied role.
    if date_of_birth is not None:
        probe = FamilyMember(date_of_birth=date_of_birth, role=role, display_name="", family_plan_id=plan.id)
        if probe.is_minor:
            role = FamilyRole.minor.value

    if member is None:
        member = FamilyMember(
            family_plan_id=plan.id,
            display_name=display_name[:200],
            phone=phone,
            relationship_type=relationship_type,
            role=role,
            status=FamilyMemberStatus.invited.value,
            date_of_birth=date_of_birth,
            is_billing_delegate=is_billing_delegate,
            invited_by_user_id=inviter_user_id,
            invited_at=datetime.now(timezone.utc),
            hub_share_level=HubShareLevel.minimal.value,
        )
        if role == FamilyRole.minor.value:
            member.guardian_user_id = inviter_user_id
            member.guardianship_expires_at = eighteenth_birthday(date_of_birth)
        db.add(member)
        await db.flush()
    else:
        member.display_name = display_name[:200]
        member.relationship_type = relationship_type
        if member.status == FamilyMemberStatus.removed.value:
            member.status = FamilyMemberStatus.invited.value
            member.removed_at = None

    code = _gen_invite_code()
    db.add(
        FamilyInvite(
            family_plan_id=plan.id,
            family_member_id=member.id,
            phone=phone,
            code_hash=_hash_code(code),
            expires_at=datetime.now(timezone.utc)
            + timedelta(minutes=settings.family_invite_ttl_minutes),
            created_by_user_id=inviter_user_id,
        )
    )
    await db.flush()

    # A minor with no login gets seated immediately — there is nobody to accept.
    if member.role == FamilyRole.minor.value and member.user_id is None:
        member.status = FamilyMemberStatus.active.value
        member.joined_at = datetime.now(timezone.utc)
        await db.flush()

    return member, code


async def accept_invite(
    db: AsyncSession, *, phone: str, code: str, user_id: uuid.UUID
) -> FamilyMember:
    """Claim a seat. Raises ValueError with a safe message on any failure."""
    now = datetime.now(timezone.utc)
    invite = (
        await db.execute(
            select(FamilyInvite)
            .where(
                FamilyInvite.phone == phone,
                FamilyInvite.accepted_at.is_(None),
                FamilyInvite.revoked_at.is_(None),
            )
            .order_by(FamilyInvite.created_at.desc())
        )
    ).scalars().first()

    if invite is None:
        raise ValueError("No pending invitation for this number")
    if invite.expires_at <= now:
        raise ValueError("This invitation has expired")
    if invite.attempts >= 3:
        raise ValueError("Too many attempts. Ask for a new invitation.")

    invite.attempts += 1
    await db.flush()

    if not secrets.compare_digest(invite.code_hash, _hash_code(code)):
        raise ValueError("Incorrect code")

    member = (
        await db.execute(select(FamilyMember).where(FamilyMember.id == invite.family_member_id))
    ).scalar_one_or_none()
    if member is None:
        raise ValueError("This invitation is no longer valid")

    # Cap check happens HERE, at claim time — an admin can pre-create a seat for
    # anyone, but the invitee's own slot count is what governs whether they may
    # actually join.
    await assert_can_join_another_plan(db, user_id)

    member.user_id = user_id
    member.status = FamilyMemberStatus.active.value
    member.joined_at = now
    invite.accepted_at = now
    invite.accepted_user_id = user_id
    await db.flush()

    plan = (
        await db.execute(select(FamilyPlan).where(FamilyPlan.id == member.family_plan_id))
    ).scalar_one()
    await ensure_hub_room(db, plan)

    await post_hub_system_message(
        db, plan,
        text_content=f"{member.display_name} joined the family plan.",
        content_type="care_event",
        subject_member_id=member.id,
    )
    return member


async def remove_member(
    db: AsyncSession, *, plan: FamilyPlan, member: FamilyMember, actor_user_id: uuid.UUID
) -> None:
    """Soft-remove a seat and cascade-revoke every grant in both directions.

    Both directions matters: removing an adult child must revoke the access
    they held over a parent AND any access the parent held over them.
    """
    now = datetime.now(timezone.utc)
    member.status = FamilyMemberStatus.removed.value
    member.removed_at = now

    await db.execute(
        text(
            """
            UPDATE family_access_grants
            SET status = 'revoked', revoked_at = NOW(),
                revoked_by_user_id = :actor,
                revocation_reason = 'member_removed_from_plan'
            WHERE status IN ('granted', 'pending')
              AND ( subject_member_id = :member_id
                    OR (grantee_user_id = :user_id AND family_plan_id = :plan_id) )
            """
        ),
        {
            "actor": actor_user_id,
            "member_id": member.id,
            "user_id": member.user_id,
            "plan_id": plan.id,
        },
    )
    if member.user_id:
        await db.execute(
            text(
                """
                UPDATE chat_room_members SET left_at = NOW()
                WHERE room_id = :room_id AND user_id = :user_id AND left_at IS NULL
                """
            ),
            {"room_id": plan.hub_room_id, "user_id": member.user_id},
        )
        if plan.hub_room_id:
            # THREE things have to happen for a removal to be real, and they
            # are three different layers:
            #
            #  1. the DB row  — done above; stops the next authorisation
            #  2. the CACHE   — or is_room_member() keeps saying yes for up to
            #                   one TTL, which would make the cache a security
            #                   regression rather than an optimisation
            #  3. the SOCKET  — subscription tokens are short-lived, but
            #                   "short-lived" is not "gone"; without an
            #                   unsubscribe the removed member keeps receiving
            #                   live hub traffic until their token expires
            await chat_cache.invalidate(str(plan.hub_room_id), str(member.user_id))
            await centrifugo.unsubscribe_user(
                member.user_id, centrifugo.room_channel(plan.hub_room_id)
            )
    await db.flush()


# ── consent handshake ────────────────────────────────────────────────────────
async def request_access(
    db: AsyncSession,
    *,
    plan: FamilyPlan,
    subject: FamilyMember,
    grantee_user_id: uuid.UUID,
    scope: str,
    message: Optional[str] = None,
) -> FamilyAccessGrant:
    """Adult dependent asks to see a member's record. Creates a pending grant
    and notifies the subject (or their guardian, for a minor)."""
    if subject.user_id == grantee_user_id:
        raise ValueError("You already have access to your own record")

    existing = (
        await db.execute(
            select(FamilyAccessGrant).where(
                FamilyAccessGrant.subject_member_id == subject.id,
                FamilyAccessGrant.grantee_user_id == grantee_user_id,
                FamilyAccessGrant.scope == scope,
                FamilyAccessGrant.status == AccessGrantStatus.pending.value,
            )
        )
    ).scalars().first()
    if existing:
        return existing

    grant = FamilyAccessGrant(
        family_plan_id=plan.id,
        subject_member_id=subject.id,
        grantee_user_id=grantee_user_id,
        scope=scope,
        status=AccessGrantStatus.pending.value,
        basis=AccessGrantBasis.consent_handshake.value,
        request_message=(message or "")[:1000] or None,
        requested_by_user_id=grantee_user_id,
    )
    db.add(grant)
    await db.flush()

    # Notify the decision-maker: the subject if they have a login, else their
    # guardian. Never broadcast a consent request to the whole hub — who is
    # asking to see whose record is itself sensitive.
    decider = subject.user_id or subject.guardian_user_id
    if decider:
        requester = (
            await db.execute(
                select(FamilyMember).where(
                    FamilyMember.family_plan_id == plan.id,
                    FamilyMember.user_id == grantee_user_id,
                )
            )
        ).scalar_one_or_none()
        requester_name = requester.display_name if requester else "A family member"
        await create_notification(
            decider,
            "Access request",
            f"{requester_name} would like to see your {scope.replace('_', ' ')}.",
            notification_type="family_access_request",
            link="/family/requests",
            ref_id=grant.id,
            session=db,
        )
    return grant


async def decide_access(
    db: AsyncSession,
    *,
    grant: FamilyAccessGrant,
    decider_user_id: uuid.UUID,
    approve: bool,
    expires_at: Optional[datetime] = None,
    channel: str = "app_tap",
) -> FamilyAccessGrant:
    """The 1-tap confirmation."""
    grant.status = (
        AccessGrantStatus.granted.value if approve else AccessGrantStatus.denied.value
    )
    grant.decided_at = datetime.now(timezone.utc)
    grant.decided_by_user_id = decider_user_id
    grant.decision_channel = channel
    grant.expires_at = expires_at
    await db.flush()

    await create_notification(
        grant.grantee_user_id,
        "Access granted" if approve else "Access declined",
        (
            "You can now view the record you requested."
            if approve
            else "Your request was declined."
        ),
        notification_type="family_access_decision",
        link="/family",
        ref_id=grant.id,
        session=db,
    )
    return grant


async def revoke_access(
    db: AsyncSession,
    *,
    grant: FamilyAccessGrant,
    actor_user_id: uuid.UUID,
    reason: Optional[str] = None,
) -> FamilyAccessGrant:
    grant.status = AccessGrantStatus.revoked.value
    grant.revoked_at = datetime.now(timezone.utc)
    grant.revoked_by_user_id = actor_user_id
    grant.revocation_reason = reason
    await db.flush()
    return grant


async def expire_aged_out_guardianships(db: AsyncSession) -> int:
    """Flip guardianship grants to pending once the minor turns 18.

    Idempotent — safe to call from a daily job or opportunistically on read.
    Returns the number of grants transitioned.
    """
    result = await db.execute(
        text(
            """
            UPDATE family_access_grants g
            SET status = 'expired',
                decision_channel = 'system_expiry',
                decided_at = NOW()
            FROM family_members m
            WHERE g.subject_member_id = m.id
              AND g.basis = 'guardianship'
              AND g.status = 'granted'
              AND m.guardianship_expires_at IS NOT NULL
              AND m.guardianship_expires_at <= NOW()
            """
        )
    )
    n = result.rowcount or 0
    await db.execute(
        text(
            """
            UPDATE family_members
            SET role = 'adult', guardian_user_id = NULL
            WHERE role = 'minor'
              AND guardianship_expires_at IS NOT NULL
              AND guardianship_expires_at <= NOW()
            """
        )
    )
    await db.flush()
    if n:
        logger.info("family: expired %d aged-out guardianship grants", n)
    return n


# ── payment delegation ───────────────────────────────────────────────────────
async def create_payment_request(
    db: AsyncSession,
    *,
    plan: FamilyPlan,
    subject: FamilyMember,
    amount_minor: int,
    currency: Optional[str] = None,
    appointment_id: Optional[uuid.UUID] = None,
    provider_name: Optional[str] = None,
    reason_for_visit: Optional[str] = None,
    requested_by_user_id: Optional[uuid.UUID] = None,
    idempotency_key: Optional[str] = None,
    ttl_hours: int = 72,
) -> FamilyPaymentRequest:
    """Create a payment request and post a redacted pay card to the hub.

    SECURITY: ``amount_minor`` comes from the caller, which is always PAL's own
    billing/appointment code or an operator — never a patient-facing client.
    The router does not expose an amount parameter to member roles.
    """
    if amount_minor <= 0:
        raise ValueError("amount must be positive")

    if idempotency_key:
        prior = (
            await db.execute(
                select(FamilyPaymentRequest).where(
                    FamilyPaymentRequest.idempotency_key == idempotency_key
                )
            )
        ).scalar_one_or_none()
        if prior:
            return prior

    currency = currency or plan.billing_currency
    level = effective_hub_level(plan, subject)

    req = FamilyPaymentRequest(
        family_plan_id=plan.id,
        subject_member_id=subject.id,
        appointment_id=appointment_id,
        amount_minor=amount_minor,
        currency=currency,
        description=payment_description(
            level=level,
            subject_display_name=subject.display_name,
            provider_name=provider_name,
            reason_for_visit=reason_for_visit,
        ),
        status=PaymentRequestStatus.pending.value,
        requested_by_user_id=requested_by_user_id,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=ttl_hours),
        idempotency_key=idempotency_key,
    )
    db.add(req)
    await db.flush()

    # The link is derived from the row id — server-authoritative, unguessable,
    # and it cannot be re-pointed by editing the chat message.
    req.payment_url = f"{settings.family_payment_link_base.rstrip('/')}/{req.id}"
    await db.flush()

    amount_display = money(amount_minor, currency)
    hub_text = redact_for_hub(
        level=level,
        subject_display_name=subject.display_name,
        kind="payment_due",
        provider_name=provider_name,
        amount_display=amount_display,
    )

    if hub_text is not None:
        msg_id = await post_hub_system_message(
            db, plan,
            text_content=hub_text,
            content_type="payment_request",
            payload={
                "payment_request_id": str(req.id),
                "amount_minor": amount_minor,
                "currency": currency,
                "amount_display": amount_display,
                "payment_url": req.payment_url,
                "subject_member_id": str(subject.id),
                "subject_name": subject.display_name,
                "status": req.status,
                "expires_at": req.expires_at.isoformat() if req.expires_at else None,
            },
            subject_member_id=subject.id,
        )
        if msg_id:
            req.hub_message_id = uuid.UUID(msg_id)
            await db.flush()
    else:
        # hub_share_level='none' — notify only people who may already pay.
        for m in await list_members(db, plan.id):
            if m.user_id and (m.is_billing_delegate or m.role == FamilyRole.admin.value):
                await create_notification(
                    m.user_id,
                    "Payment due",
                    f"A payment of {amount_display} is due.",
                    notification_type="family_payment",
                    link="/family/payments",
                    ref_id=req.id,
                    session=db,
                )
    return req


async def mark_payment_paid(
    db: AsyncSession,
    *,
    req: FamilyPaymentRequest,
    payer_user_id: uuid.UUID,
    provider: Optional[str] = None,
    provider_ref: Optional[str] = None,
) -> FamilyPaymentRequest:
    """Settle a payment request. Idempotent — a duplicate webhook is a no-op."""
    if req.status == PaymentRequestStatus.paid.value:
        return req

    req.status = PaymentRequestStatus.paid.value
    req.paid_by_user_id = payer_user_id
    req.paid_at = datetime.now(timezone.utc)
    req.provider = provider
    req.provider_ref = provider_ref
    await db.flush()

    plan = (
        await db.execute(select(FamilyPlan).where(FamilyPlan.id == req.family_plan_id))
    ).scalar_one()
    payer = await get_member(db, plan.id, payer_user_id)
    payer_name = payer.display_name if payer else "A family member"

    await post_hub_system_message(
        db, plan,
        text_content=f"{payer_name} paid {money(req.amount_minor, req.currency)}. Thank you.",
        content_type="care_event",
        payload={"payment_request_id": str(req.id), "status": "paid"},
        subject_member_id=req.subject_member_id,
    )
    return req
