"""
PAL Family Plan — REST API.

Route map
---------
Plan
  POST   /family/plan                     create my plan (idempotent)
  GET    /family/plan                     my plan + my role + hub room id
  PATCH  /family/plan                     admin: rename, hub share ceiling

Members
  GET    /family/members                  seats I am allowed to see
  POST   /family/members                  admin: invite by phone -> invite code
  POST   /family/members/accept           claim a seat with phone + code
  PATCH  /family/members/{id}             admin: role / billing delegate
                                          self:  my own hub share level
  DELETE /family/members/{id}             admin: soft-remove + cascade revoke

Consent handshake
  GET    /family/access/requests          requests awaiting MY decision
  GET    /family/access/grants            grants I hold + grants over me
  POST   /family/access/requests          ask to see a member's record
  POST   /family/access/requests/{id}/approve   the 1-tap confirmation
  POST   /family/access/requests/{id}/deny
  DELETE /family/access/grants/{id}       revoke (subject or grantee)

Payments
  GET    /family/payments                 pending + recent, redacted
  POST   /family/payments/{id}/pay        mark paid (delegate/admin only)

Hub
  GET    /family/hub                      hub room id + membership, for the socket

AUTHORIZATION MODEL — read this before adding an endpoint
---------------------------------------------------------
Being in a family plan grants NOTHING. There are exactly three access paths and
they all live in ``services.family.policy.resolve_access``: self, guardianship
(minors, auto-expiring at 18), and an explicit consent grant. The plan admin is
a *billing* admin — ``can_manage_plan`` never implies ``resolve_access``.
"""
import logging
import uuid
from datetime import date, datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from config import get_settings
from database import get_db
from models import User
from models.family import (
    AccessGrantStatus,
    AccessScope,
    FamilyAccessGrant,
    FamilyMember,
    FamilyMemberStatus,
    FamilyPaymentRequest,
    FamilyPlan,
    FamilyRole,
    HubShareLevel,
    PaymentRequestStatus,
)
from services.chat import centrifugo
from services.family import policy, service

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/family", tags=["family"])


# ── schemas ──────────────────────────────────────────────────────────────────
class CreatePlanIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    display_name: str = Field(min_length=1, max_length=200)
    phone: Optional[str] = Field(default=None, max_length=30)


class UpdatePlanIn(BaseModel):
    name: Optional[str] = Field(default=None, max_length=200)
    hub_share_ceiling: Optional[Literal["none", "minimal", "detailed"]] = None


class InviteIn(BaseModel):
    display_name: str = Field(min_length=1, max_length=200)
    phone: str = Field(min_length=6, max_length=30)
    relationship_type: Literal[
        "self", "spouse", "parent", "child", "sibling",
        "grandparent", "grandchild", "other",
    ] = "other"
    role: Literal["adult", "dependent_adult", "minor"] = "adult"
    date_of_birth: Optional[date] = None
    is_billing_delegate: bool = False

    @field_validator("phone")
    @classmethod
    def _e164ish(cls, v: str) -> str:
        v = v.strip().replace(" ", "").replace("-", "")
        if not v.startswith("+") or not v[1:].isdigit():
            raise ValueError("phone must be E.164, e.g. +919876543210")
        return v


class AcceptInviteIn(BaseModel):
    phone: str = Field(min_length=6, max_length=30)
    code: str = Field(min_length=4, max_length=10)


class UpdateMemberIn(BaseModel):
    role: Optional[Literal["admin", "adult", "dependent_adult", "minor"]] = None
    is_billing_delegate: Optional[bool] = None
    hub_share_level: Optional[Literal["none", "minimal", "detailed"]] = None
    hub_muted: Optional[bool] = None
    display_name: Optional[str] = Field(default=None, max_length=200)


class AccessRequestIn(BaseModel):
    subject_member_id: uuid.UUID
    scope: Literal["appointments", "medications", "summary", "full"] = "appointments"
    message: Optional[str] = Field(default=None, max_length=1000)


class ApproveIn(BaseModel):
    expires_in_days: Optional[int] = Field(default=None, ge=1, le=3650)


class MemberOut(BaseModel):
    id: str
    user_id: Optional[str]
    display_name: str
    relationship_type: str
    role: str
    status: str
    is_minor: bool
    is_billing_delegate: bool
    hub_share_level: str
    is_self: bool
    # What the CALLER may see of this member. Deny-by-default.
    my_access_scope: Optional[str]
    my_access_basis: Optional[str]


class PaymentOut(BaseModel):
    id: str
    subject_member_id: str
    subject_name: str
    amount_minor: int
    currency: str
    amount_display: str
    description: str
    payment_url: Optional[str]
    status: str
    created_at: Optional[str]
    expires_at: Optional[str]
    can_pay: bool


# ── dependencies ─────────────────────────────────────────────────────────────
async def _require_enabled() -> None:
    if not settings.family_plan_enabled:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Family plan is not enabled"
        )


async def _ctx(
    db: AsyncSession, user: User, plan_id: Optional[uuid.UUID] = None
) -> tuple[FamilyPlan, Optional[FamilyMember]]:
    """Resolve the acting plan. A user may be in up to
    `settings.family_max_plans_per_user` plans, so every endpoint accepts an
    optional `plan_id`; without one we use their first (owned plans win)."""
    plan = await service.get_plan_for_user(db, user.id, plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="No family plan for this account")
    member = await service.get_member(db, plan.id, user.id)
    return plan, member


# ── plans list (also powers the "upgrade to Family Plan" upsell) ─────────────
@router.get("/plans", dependencies=[Depends(_require_enabled)])
async def list_my_plans(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """Every plan this user is in, plus the cap.

    Deliberately 200-with-an-empty-list rather than 404, because the individual
    -plan upsell needs to distinguish "no plan yet" (show the greyed-out chat
    icon and the upgrade prompt) from "request failed" (show nothing).
    """
    plans = await service.list_plans_for_user(db, user.id)
    out = []
    for p in plans:
        m = await service.get_member(db, p.id, user.id)
        out.append({
            "plan_id": str(p.id),
            "name": p.name,
            "status": p.status,
            "hub_room_id": str(p.hub_room_id) if p.hub_room_id else None,
            "is_admin": policy.can_manage_plan(m, p, user.id),
            "my_role": m.role if m else None,
            "member_count": len(await service.list_members(db, p.id)),
        })
    return {
        "plans": out,
        "count": len(out),
        "max_plans": service.MAX_PLANS_PER_USER,
        "can_join_more": len(out) < service.MAX_PLANS_PER_USER,
        "has_family_plan": len(out) > 0,
    }


# ── plan ─────────────────────────────────────────────────────────────────────
@router.post("/plan", status_code=status.HTTP_201_CREATED, dependencies=[Depends(_require_enabled)])
async def create_plan(
    body: CreatePlanIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        plan = await service.create_plan(
            db,
            primary_user_id=user.id,
            name=body.name,
            primary_display_name=body.display_name,
            primary_phone=body.phone,
        )
    except service.PlanLimitReached as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    await service.ensure_hub_room(db, plan)
    await db.commit()
    return {"plan_id": str(plan.id), "hub_room_id": str(plan.hub_room_id) if plan.hub_room_id else None}


@router.get("/plan", dependencies=[Depends(_require_enabled)])
async def get_plan(
    plan_id: Optional[uuid.UUID] = Query(default=None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    plan, member = await _ctx(db, user, plan_id)
    # Opportunistic age-out so a birthday takes effect without a cron job.
    await service.expire_aged_out_guardianships(db)
    await db.commit()
    return {
        "plan_id": str(plan.id),
        "name": plan.name,
        "status": plan.status,
        "max_members": plan.max_members,
        "billing_currency": plan.billing_currency,
        "hub_share_ceiling": plan.hub_share_ceiling,
        "hub_room_id": str(plan.hub_room_id) if plan.hub_room_id else None,
        "is_admin": policy.can_manage_plan(member, plan, user.id),
        "can_pay": policy.can_pay_for(member, plan, user.id),
        "my_member_id": str(member.id) if member else None,
        "my_role": member.role if member else None,
    }


@router.patch("/plan", dependencies=[Depends(_require_enabled)])
async def update_plan(
    body: UpdatePlanIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    plan, member = await _ctx(db, user)
    if not policy.can_manage_plan(member, plan, user.id):
        raise HTTPException(status_code=403, detail="Only the plan admin can do this")
    if body.name is not None:
        plan.name = body.name
    if body.hub_share_ceiling is not None:
        plan.hub_share_ceiling = body.hub_share_ceiling
    await db.commit()
    return {"updated": True}


# ── members ──────────────────────────────────────────────────────────────────
@router.get("/members", response_model=list[MemberOut], dependencies=[Depends(_require_enabled)])
async def get_members(
    plan_id: Optional[uuid.UUID] = Query(default=None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Roster with per-member access resolution.

    Everyone in the plan can see WHO is in it (names and relationships — that
    is roster data the admin already typed in). Nobody sees anyone's health
    data without a grant, which is what ``my_access_scope`` reports.
    """
    plan, _ = await _ctx(db, user, plan_id)
    await service.expire_aged_out_guardianships(db)
    members = await service.list_members(db, plan.id)

    out: list[MemberOut] = []
    for m in members:
        decision = await policy.resolve_access(
            db,
            grantee_user_id=user.id,
            subject_member=m,
            required_scope=AccessScope.appointments.value,
        )
        out.append(
            MemberOut(
                id=str(m.id),
                user_id=str(m.user_id) if m.user_id else None,
                display_name=m.display_name,
                relationship_type=m.relationship_type,
                role=m.role,
                status=m.status,
                is_minor=m.is_minor,
                is_billing_delegate=m.is_billing_delegate,
                hub_share_level=m.hub_share_level,
                is_self=bool(m.user_id and m.user_id == user.id),
                my_access_scope=decision.scope if decision.allowed else None,
                my_access_basis=decision.basis if decision.allowed else None,
            )
        )
    await db.commit()
    return out


@router.post("/members", status_code=status.HTTP_201_CREATED, dependencies=[Depends(_require_enabled)])
async def invite(
    body: InviteIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Admin invites by phone. Returns the code ONCE — send it over SMS.

    The seat exists immediately, so the admin can start coordinating before the
    invitee installs the app. The seat carries no access rights.
    """
    plan, member = await _ctx(db, user)
    if not policy.can_manage_plan(member, plan, user.id):
        raise HTTPException(status_code=403, detail="Only the plan admin can invite")

    try:
        new_member, code = await service.invite_member(
            db,
            plan=plan,
            inviter_user_id=user.id,
            display_name=body.display_name,
            phone=body.phone,
            relationship_type=body.relationship_type,
            role=body.role,
            date_of_birth=body.date_of_birth,
            is_billing_delegate=body.is_billing_delegate,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))

    await service.ensure_hub_room(db, plan)
    await db.commit()
    return {
        "member_id": str(new_member.id),
        "invite_code": code,
        "expires_in_minutes": settings.family_invite_ttl_minutes,
        "role": new_member.role,
    }


@router.post("/members/accept", dependencies=[Depends(_require_enabled)])
async def accept(
    body: AcceptInviteIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Claim a pre-created seat. This is the 'dependent routing' step: an adult
    downloads the app, authenticates with their tagged phone, and lands in the
    plan seeing ONLY their own profile."""
    try:
        member = await service.accept_invite(
            db, phone=body.phone.strip(), code=body.code.strip(), user_id=user.id
        )
    except service.PlanLimitReached as exc:
        # 409, not 400 — the code was fine, the user is simply at the cap.
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    await db.commit()
    return {
        "member_id": str(member.id),
        "family_plan_id": str(member.family_plan_id),
        "role": member.role,
        "note": "You can see your own profile. Ask a family member for access to theirs.",
    }


@router.patch("/members/{member_id}", dependencies=[Depends(_require_enabled)])
async def update_member(
    member_id: uuid.UUID,
    body: UpdateMemberIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Admin changes role/billing. A member changes their OWN hub privacy.

    Note the asymmetry: an admin can NOT raise someone else's
    ``hub_share_level``. Only the subject can decide to be more visible.
    """
    plan, me = await _ctx(db, user)
    target = (
        await db.execute(
            select(FamilyMember).where(
                FamilyMember.id == member_id, FamilyMember.family_plan_id == plan.id
            )
        )
    ).scalar_one_or_none()
    if target is None:
        raise HTTPException(status_code=404, detail="Member not found")

    is_admin = policy.can_manage_plan(me, plan, user.id)
    is_self = bool(target.user_id and target.user_id == user.id)
    is_guardian = target.is_minor and target.guardian_user_id == user.id

    if body.role is not None or body.is_billing_delegate is not None:
        if not is_admin:
            raise HTTPException(status_code=403, detail="Only the plan admin can do this")
        if body.role is not None:
            if target.user_id == plan.primary_user_id and body.role != FamilyRole.admin.value:
                raise HTTPException(
                    status_code=409, detail="The primary account holder must stay admin"
                )
            target.role = body.role
        if body.is_billing_delegate is not None:
            target.is_billing_delegate = body.is_billing_delegate

    if body.hub_share_level is not None:
        if not (is_self or is_guardian):
            raise HTTPException(
                status_code=403,
                detail="Only this member can change what is shared about them",
            )
        target.hub_share_level = body.hub_share_level

    if body.hub_muted is not None:
        if not is_self:
            raise HTTPException(status_code=403, detail="Only this member can mute themselves")
        target.hub_muted = body.hub_muted

    if body.display_name is not None:
        if not (is_admin or is_self):
            raise HTTPException(status_code=403, detail="Not allowed")
        target.display_name = body.display_name

    await db.commit()
    return {"updated": True, "member_id": str(target.id)}


@router.delete("/members/{member_id}", dependencies=[Depends(_require_enabled)])
async def delete_member(
    member_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    plan, me = await _ctx(db, user)
    if not policy.can_manage_plan(me, plan, user.id):
        raise HTTPException(status_code=403, detail="Only the plan admin can remove members")

    target = (
        await db.execute(
            select(FamilyMember).where(
                FamilyMember.id == member_id, FamilyMember.family_plan_id == plan.id
            )
        )
    ).scalar_one_or_none()
    if target is None:
        raise HTTPException(status_code=404, detail="Member not found")
    if target.user_id == plan.primary_user_id:
        raise HTTPException(status_code=409, detail="Cannot remove the primary account holder")

    await service.remove_member(db, plan=plan, member=target, actor_user_id=user.id)
    await db.commit()
    return {"removed": True, "member_id": str(member_id)}


# ── consent handshake ────────────────────────────────────────────────────────
@router.get("/access/requests", dependencies=[Depends(_require_enabled)])
async def my_pending_requests(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """Requests awaiting MY tap — over my own record, or over a minor I guard."""
    plan, _ = await _ctx(db, user)
    my_subject_ids = [
        m.id
        for m in await service.list_members(db, plan.id)
        if (m.user_id == user.id) or (m.is_minor and m.guardian_user_id == user.id)
    ]
    if not my_subject_ids:
        return {"requests": []}

    grants = (
        await db.execute(
            select(FamilyAccessGrant).where(
                FamilyAccessGrant.subject_member_id.in_(my_subject_ids),
                FamilyAccessGrant.status == AccessGrantStatus.pending.value,
            )
        )
    ).scalars().all()

    members = {m.id: m for m in await service.list_members(db, plan.id)}
    requester_by_user = {m.user_id: m for m in members.values() if m.user_id}

    return {
        "requests": [
            {
                "id": str(g.id),
                "subject_member_id": str(g.subject_member_id),
                "subject_name": members[g.subject_member_id].display_name
                if g.subject_member_id in members else "Unknown",
                "grantee_user_id": str(g.grantee_user_id),
                "grantee_name": (
                    requester_by_user[g.grantee_user_id].display_name
                    if g.grantee_user_id in requester_by_user else "A family member"
                ),
                "scope": g.scope,
                "message": g.request_message,
                "requested_at": g.requested_at.isoformat() if g.requested_at else None,
            }
            for g in grants
        ]
    }


@router.get("/access/grants", dependencies=[Depends(_require_enabled)])
async def my_grants(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """Full transparency: what I can see, and who can see me."""
    plan, _ = await _ctx(db, user)
    members = {m.id: m for m in await service.list_members(db, plan.id)}
    my_member_ids = [m.id for m in members.values() if m.user_id == user.id]

    held = (
        await db.execute(
            select(FamilyAccessGrant).where(
                FamilyAccessGrant.grantee_user_id == user.id,
                FamilyAccessGrant.status == AccessGrantStatus.granted.value,
            )
        )
    ).scalars().all()
    over_me = (
        await db.execute(
            select(FamilyAccessGrant).where(
                FamilyAccessGrant.subject_member_id.in_(my_member_ids or [uuid.uuid4()]),
                FamilyAccessGrant.status == AccessGrantStatus.granted.value,
            )
        )
    ).scalars().all()

    def _fmt(g: FamilyAccessGrant) -> dict:
        subj = members.get(g.subject_member_id)
        return {
            "id": str(g.id),
            "subject_member_id": str(g.subject_member_id),
            "subject_name": subj.display_name if subj else "Unknown",
            "grantee_user_id": str(g.grantee_user_id),
            "scope": g.scope,
            "basis": g.basis,
            "granted_at": g.decided_at.isoformat() if g.decided_at else None,
            "expires_at": g.expires_at.isoformat() if g.expires_at else None,
            "is_live": g.is_live,
        }

    return {
        "i_can_see": [_fmt(g) for g in held if g.is_live],
        "can_see_me": [_fmt(g) for g in over_me if g.is_live],
    }


@router.post("/access/requests", status_code=status.HTTP_201_CREATED, dependencies=[Depends(_require_enabled)])
async def create_access_request(
    body: AccessRequestIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    plan, _ = await _ctx(db, user)
    subject = (
        await db.execute(
            select(FamilyMember).where(
                FamilyMember.id == body.subject_member_id,
                FamilyMember.family_plan_id == plan.id,
            )
        )
    ).scalar_one_or_none()
    if subject is None:
        raise HTTPException(status_code=404, detail="Member not found")

    try:
        grant = await service.request_access(
            db, plan=plan, subject=subject,
            grantee_user_id=user.id, scope=body.scope, message=body.message,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    await db.commit()
    return {"request_id": str(grant.id), "status": grant.status}


async def _load_decidable_grant(
    db: AsyncSession, grant_id: uuid.UUID, user: User, plan: FamilyPlan
) -> tuple[FamilyAccessGrant, FamilyMember]:
    grant = (
        await db.execute(
            select(FamilyAccessGrant).where(
                FamilyAccessGrant.id == grant_id,
                FamilyAccessGrant.family_plan_id == plan.id,
            )
        )
    ).scalar_one_or_none()
    if grant is None:
        raise HTTPException(status_code=404, detail="Request not found")

    subject = (
        await db.execute(select(FamilyMember).where(FamilyMember.id == grant.subject_member_id))
    ).scalar_one()

    # ONLY the subject decides — or their guardian, if the subject is a minor.
    # The plan admin cannot approve access to someone else's record.
    may_decide = (subject.user_id == user.id) or (
        subject.is_minor and subject.guardian_user_id == user.id
    )
    if not may_decide:
        raise HTTPException(
            status_code=403, detail="Only this member can decide who sees their record"
        )
    return grant, subject


@router.post("/access/requests/{grant_id}/approve", dependencies=[Depends(_require_enabled)])
async def approve_request(
    grant_id: uuid.UUID,
    body: ApproveIn | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """The 1-tap confirmation."""
    plan, _ = await _ctx(db, user)
    grant, _subject = await _load_decidable_grant(db, grant_id, user, plan)
    if grant.status != AccessGrantStatus.pending.value:
        raise HTTPException(status_code=409, detail=f"Request is already {grant.status}")

    expires_at = None
    days = body.expires_in_days if body else None
    if days:
        from datetime import timedelta
        expires_at = datetime.now(timezone.utc) + timedelta(days=days)

    await service.decide_access(
        db, grant=grant, decider_user_id=user.id, approve=True, expires_at=expires_at
    )
    await db.commit()
    return {"status": grant.status, "expires_at": expires_at.isoformat() if expires_at else None}


@router.post("/access/requests/{grant_id}/deny", dependencies=[Depends(_require_enabled)])
async def deny_request(
    grant_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    plan, _ = await _ctx(db, user)
    grant, _subject = await _load_decidable_grant(db, grant_id, user, plan)
    if grant.status != AccessGrantStatus.pending.value:
        raise HTTPException(status_code=409, detail=f"Request is already {grant.status}")
    await service.decide_access(db, grant=grant, decider_user_id=user.id, approve=False)
    await db.commit()
    return {"status": grant.status}


@router.delete("/access/grants/{grant_id}", dependencies=[Depends(_require_enabled)])
async def revoke_grant(
    grant_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Either side can revoke: the subject withdraws consent, or the grantee
    gives up access they no longer want."""
    plan, _ = await _ctx(db, user)
    grant = (
        await db.execute(
            select(FamilyAccessGrant).where(
                FamilyAccessGrant.id == grant_id,
                FamilyAccessGrant.family_plan_id == plan.id,
            )
        )
    ).scalar_one_or_none()
    if grant is None:
        raise HTTPException(status_code=404, detail="Grant not found")

    subject = (
        await db.execute(select(FamilyMember).where(FamilyMember.id == grant.subject_member_id))
    ).scalar_one()
    may_revoke = (
        grant.grantee_user_id == user.id
        or subject.user_id == user.id
        or (subject.is_minor and subject.guardian_user_id == user.id)
    )
    if not may_revoke:
        raise HTTPException(status_code=403, detail="Not allowed")

    await service.revoke_access(
        db, grant=grant, actor_user_id=user.id, reason="revoked_by_user"
    )
    await db.commit()
    return {"revoked": True}


# ── payments ─────────────────────────────────────────────────────────────────
@router.get("/payments", response_model=list[PaymentOut], dependencies=[Depends(_require_enabled)])
async def list_payments(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """Payment requests visible to me — already redacted at write time."""
    plan, me = await _ctx(db, user)
    can_pay = policy.can_pay_for(me, plan, user.id)
    members = {m.id: m for m in await service.list_members(db, plan.id)}

    rows = (
        await db.execute(
            select(FamilyPaymentRequest)
            .where(FamilyPaymentRequest.family_plan_id == plan.id)
            .order_by(FamilyPaymentRequest.created_at.desc())
            .limit(50)
        )
    ).scalars().all()

    out: list[PaymentOut] = []
    for r in rows:
        subj = members.get(r.subject_member_id)
        # A member with hub_share_level='none' is only listed to payers.
        if subj and subj.hub_share_level == HubShareLevel.none.value and not can_pay:
            continue
        out.append(
            PaymentOut(
                id=str(r.id),
                subject_member_id=str(r.subject_member_id),
                subject_name=subj.display_name if subj else "Family member",
                amount_minor=r.amount_minor,
                currency=r.currency,
                amount_display=service.money(r.amount_minor, r.currency),
                description=r.description,
                payment_url=r.payment_url if can_pay else None,
                status=r.status,
                created_at=r.created_at.isoformat() if r.created_at else None,
                expires_at=r.expires_at.isoformat() if r.expires_at else None,
                can_pay=can_pay and r.status == PaymentRequestStatus.pending.value,
            )
        )
    return out


@router.post("/payments/{payment_id}/pay", dependencies=[Depends(_require_enabled)])
async def pay(
    payment_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Settle a payment request.

    NOTE: this marks PAL's record as paid. Wire the actual gateway callback to
    ``services.family.service.mark_payment_paid`` — the amount is read from the
    row, never from the request body, so a client cannot change what is owed.
    """
    plan, me = await _ctx(db, user)
    if not policy.can_pay_for(me, plan, user.id):
        raise HTTPException(status_code=403, detail="You are not a billing delegate")

    req = (
        await db.execute(
            select(FamilyPaymentRequest).where(
                FamilyPaymentRequest.id == payment_id,
                FamilyPaymentRequest.family_plan_id == plan.id,
            )
        )
    ).scalar_one_or_none()
    if req is None:
        raise HTTPException(status_code=404, detail="Payment request not found")
    if req.status == PaymentRequestStatus.paid.value:
        return {"status": "paid", "already": True}
    if req.expires_at and req.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=409, detail="This payment request has expired")

    await service.mark_payment_paid(db, req=req, payer_user_id=user.id)
    await db.commit()
    return {"status": req.status, "paid_at": req.paid_at.isoformat() if req.paid_at else None}


# ── hub ──────────────────────────────────────────────────────────────────────
@router.get("/hub", dependencies=[Depends(_require_enabled)])
async def get_hub(
    plan_id: Optional[uuid.UUID] = Query(default=None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """What the client needs to open the Family Care Hub socket."""
    plan, member = await _ctx(db, user, plan_id)
    if member is None or member.status != FamilyMemberStatus.active.value:
        raise HTTPException(status_code=403, detail="Not an active member of this plan")

    room_id = plan.hub_room_id or await service.ensure_hub_room(db, plan)
    await db.commit()
    if not room_id:
        raise HTTPException(status_code=503, detail="Chat is not available")
    return {
        "room_id": str(room_id),
        "plan_id": str(plan.id),
        "name": f"{plan.name} — Care Hub",
        "muted": member.hub_muted,
        "can_pay": policy.can_pay_for(member, plan, user.id),
        # Centrifugo channel for this hub. The client asks
        # /chat/realtime/subscribe-token for it; that endpoint re-checks
        # membership before minting anything.
        "channel": centrifugo.room_channel(room_id),
    }
