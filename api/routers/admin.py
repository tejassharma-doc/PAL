"""Admin API — operator-plane management.
All routes require admin_dashboard feature flag + operator role with the relevant permission.
PHI is never returned; only metadata, counts, and audit trails.
"""
import csv
import io
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user, hash_password
from config import get_settings
from database import get_db
from models import (
    User, TenantMembership, TenantRole, OPERATOR_PERMISSIONS,
    Tenant, ConsentGrant, ModelRunAudit, PHIAuditLog,
)

router = APIRouter(prefix="/admin", tags=["admin"])
settings = get_settings()


# ─── Permission dependency ────────────────────────────────────────────────────

class OperatorContext:
    def __init__(self, user: User, membership: TenantMembership, tenant: Tenant):
        self.user = user
        self.membership = membership
        self.tenant = tenant


def require_operator_permission(perm: str):
    """Dependency factory: checks flag enabled, operator role, and specific permission."""
    async def _dep(
        tenant_id: uuid.UUID,
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> OperatorContext:
        if not settings.admin_dashboard:
            raise HTTPException(status_code=404, detail="Not found.")

        result = await db.execute(
            select(TenantMembership).where(
                TenantMembership.user_id == user.id,
                TenantMembership.tenant_id == tenant_id,
                TenantMembership.active == True,
            )
        )
        membership = result.scalar_one_or_none()
        if not membership:
            raise HTTPException(status_code=403, detail="Not a member of this tenant.")

        allowed = OPERATOR_PERMISSIONS.get(membership.role, set())
        if perm not in allowed:
            raise HTTPException(status_code=403, detail=f"Missing permission: {perm}")

        tenant_result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
        tenant = tenant_result.scalar_one_or_none()
        if not tenant or not tenant.active:
            raise HTTPException(status_code=404, detail="Tenant not found.")

        return OperatorContext(user=user, membership=membership, tenant=tenant)

    return _dep


# ─── Stats overview ───────────────────────────────────────────────────────────

@router.get("/{tenant_id}/stats")
async def get_stats(
    tenant_id: uuid.UUID,
    _ctx: OperatorContext = Depends(require_operator_permission("audit.read")),
    db: AsyncSession = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    d30 = now - timedelta(days=30)
    d7  = now - timedelta(days=7)

    user_count = (await db.execute(
        select(func.count()).select_from(TenantMembership).where(
            TenantMembership.tenant_id == tenant_id,
            TenantMembership.active == True,
        )
    )).scalar_one()

    active_consents = (await db.execute(
        select(func.count()).select_from(ConsentGrant).where(
            ConsentGrant.tenant_id == tenant_id,
            ConsentGrant.active == True,
            ConsentGrant.revoked_at == None,
        )
    )).scalar_one()

    token_row = (await db.execute(
        select(
            func.coalesce(func.sum(ModelRunAudit.input_tokens), 0),
            func.coalesce(func.sum(ModelRunAudit.output_tokens), 0),
            func.count(),
        ).where(
            ModelRunAudit.tenant_id == tenant_id,
            ModelRunAudit.created_at >= d30,
        )
    )).one()

    audit_count_7d = (await db.execute(
        select(func.count()).select_from(PHIAuditLog).where(
            PHIAuditLog.tenant_id == tenant_id,
            PHIAuditLog.occurred_at >= d7,
        )
    )).scalar_one()

    recent = (await db.execute(
        select(PHIAuditLog).where(
            PHIAuditLog.tenant_id == tenant_id,
        ).order_by(PHIAuditLog.occurred_at.desc()).limit(10)
    )).scalars().all()

    return {
        "users": user_count,
        "active_consents": active_consents,
        "tokens_30d": {
            "input": int(token_row[0]),
            "output": int(token_row[1]),
            "requests": int(token_row[2]),
        },
        "audit_events_7d": audit_count_7d,
        "recent_events": [
            {
                "id": str(e.id),
                "event_type": e.event_type,
                "actor_user_id": str(e.actor_user_id) if e.actor_user_id else None,
                "subject_member_id": str(e.subject_member_id) if e.subject_member_id else None,
                "occurred_at": e.occurred_at.isoformat(),
            }
            for e in recent
        ],
    }


# ─── Users ────────────────────────────────────────────────────────────────────

@router.get("/{tenant_id}/users")
async def list_users(
    tenant_id: uuid.UUID,
    _ctx: OperatorContext = Depends(require_operator_permission("users.manage")),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(TenantMembership, User)
        .join(User, TenantMembership.user_id == User.id)
        .where(TenantMembership.tenant_id == tenant_id)
        .order_by(User.created_at.desc())
    )).all()

    return {
        "users": [
            {
                "user_id": str(u.id),
                "email": u.email,
                "full_name": u.full_name,
                "active": u.active,
                "email_verified": u.email_verified,
                "created_at": u.created_at.isoformat(),
                "membership_id": str(m.id),
                "role": m.role.value,
                "membership_active": m.active,
            }
            for m, u in rows
        ]
    }


_OPERATOR_ROLES = {
    TenantRole.operator_admin,
    TenantRole.operator_developer,
    TenantRole.operator_support,
    TenantRole.operator_security,
    TenantRole.operator_billing,
}


class InviteRequest(BaseModel):
    email: EmailStr
    full_name: str
    role: TenantRole
    temp_password: str


@router.post("/{tenant_id}/users/invite", status_code=201)
async def invite_user(
    tenant_id: uuid.UUID,
    req: InviteRequest,
    _ctx: OperatorContext = Depends(require_operator_permission("users.manage")),
    db: AsyncSession = Depends(get_db),
):
    if req.role not in _OPERATOR_ROLES:
        raise HTTPException(status_code=400, detail="Only operator roles can be invited via this endpoint.")

    existing = (await db.execute(select(User).where(User.email == req.email))).scalar_one_or_none()
    if existing:
        clash = (await db.execute(
            select(TenantMembership).where(
                TenantMembership.user_id == existing.id,
                TenantMembership.tenant_id == tenant_id,
            )
        )).scalar_one_or_none()
        if clash:
            raise HTTPException(status_code=409, detail="User already has a membership in this tenant.")
        user = existing
    else:
        user = User(
            email=req.email,
            full_name=req.full_name,
            hashed_password=hash_password(req.temp_password),
        )
        db.add(user)
        await db.flush()

    membership = TenantMembership(
        user_id=user.id,
        tenant_id=tenant_id,
        role=req.role,
        active=True,
    )
    db.add(membership)
    await db.flush()
    return {"user_id": str(user.id), "membership_id": str(membership.id), "role": req.role.value}


class PatchUserRequest(BaseModel):
    active: Optional[bool] = None
    role: Optional[TenantRole] = None


@router.patch("/{tenant_id}/users/{user_id}")
async def patch_user(
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    req: PatchUserRequest,
    _ctx: OperatorContext = Depends(require_operator_permission("users.manage")),
    db: AsyncSession = Depends(get_db),
):
    membership = (await db.execute(
        select(TenantMembership).where(
            TenantMembership.tenant_id == tenant_id,
            TenantMembership.user_id == user_id,
        )
    )).scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=404, detail="User not found in tenant.")

    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    if req.active is not None:
        user.active = req.active
        membership.active = req.active
    if req.role is not None:
        membership.role = req.role

    return {"user_id": str(user_id), "active": user.active, "role": membership.role.value}


# ─── PHI Audit log ────────────────────────────────────────────────────────────

@router.get("/{tenant_id}/audit")
async def get_audit_log(
    tenant_id: uuid.UUID,
    event_type: Optional[str] = Query(None),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    _ctx: OperatorContext = Depends(require_operator_permission("audit.read")),
    db: AsyncSession = Depends(get_db),
):
    filters = [PHIAuditLog.tenant_id == tenant_id]
    if event_type:
        filters.append(PHIAuditLog.event_type == event_type)
    if date_from:
        filters.append(PHIAuditLog.occurred_at >= date_from)
    if date_to:
        filters.append(PHIAuditLog.occurred_at <= date_to)

    total = (await db.execute(
        select(func.count()).select_from(PHIAuditLog).where(*filters)
    )).scalar_one()

    rows = (await db.execute(
        select(PHIAuditLog).where(*filters)
        .order_by(PHIAuditLog.occurred_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )).scalars().all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, (total + page_size - 1) // page_size),
        "events": [
            {
                "id": str(e.id),
                "event_type": e.event_type,
                "actor_user_id": str(e.actor_user_id) if e.actor_user_id else None,
                "subject_member_id": str(e.subject_member_id) if e.subject_member_id else None,
                "conversation_id": str(e.conversation_id) if e.conversation_id else None,
                "detail": e.detail,
                "occurred_at": e.occurred_at.isoformat(),
            }
            for e in rows
        ],
    }


@router.get("/{tenant_id}/audit/export")
async def export_audit_log(
    tenant_id: uuid.UUID,
    event_type: Optional[str] = Query(None),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    _ctx: OperatorContext = Depends(require_operator_permission("audit.export")),
    db: AsyncSession = Depends(get_db),
):
    filters = [PHIAuditLog.tenant_id == tenant_id]
    if event_type:
        filters.append(PHIAuditLog.event_type == event_type)
    if date_from:
        filters.append(PHIAuditLog.occurred_at >= date_from)
    if date_to:
        filters.append(PHIAuditLog.occurred_at <= date_to)

    rows = (await db.execute(
        select(PHIAuditLog).where(*filters).order_by(PHIAuditLog.occurred_at.desc())
    )).scalars().all()

    buf = io.StringIO()
    writer = csv.DictWriter(
        buf,
        fieldnames=["id", "event_type", "actor_user_id", "subject_member_id", "conversation_id", "detail", "occurred_at"],
    )
    writer.writeheader()
    for e in rows:
        writer.writerow({
            "id": str(e.id),
            "event_type": e.event_type,
            "actor_user_id": str(e.actor_user_id) if e.actor_user_id else "",
            "subject_member_id": str(e.subject_member_id) if e.subject_member_id else "",
            "conversation_id": str(e.conversation_id) if e.conversation_id else "",
            "detail": json.dumps(e.detail),
            "occurred_at": e.occurred_at.isoformat(),
        })
    buf.seek(0)

    filename = f"phi_audit_{tenant_id}_{datetime.now(timezone.utc).date()}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ─── Model run audit ──────────────────────────────────────────────────────────

@router.get("/{tenant_id}/model-runs")
async def get_model_runs(
    tenant_id: uuid.UUID,
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    _ctx: OperatorContext = Depends(require_operator_permission("audit.read")),
    db: AsyncSession = Depends(get_db),
):
    filters = [ModelRunAudit.tenant_id == tenant_id]
    if date_from:
        filters.append(ModelRunAudit.created_at >= date_from)
    if date_to:
        filters.append(ModelRunAudit.created_at <= date_to)

    total = (await db.execute(
        select(func.count()).select_from(ModelRunAudit).where(*filters)
    )).scalar_one()

    rows = (await db.execute(
        select(ModelRunAudit).where(*filters)
        .order_by(ModelRunAudit.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )).scalars().all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, (total + page_size - 1) // page_size),
        "runs": [
            {
                "id": str(r.id),
                "model_provider": r.model_provider,
                "model_id": r.model_id,
                "agent_name": r.agent_name,
                "input_tokens": r.input_tokens,
                "output_tokens": r.output_tokens,
                "phi_involved": r.phi_involved,
                "consent_basis": r.consent_basis,
                "latency_ms": r.latency_ms,
                "success": r.success,
                "created_at": r.created_at.isoformat(),
            }
            for r in rows
        ],
    }


# ─── Tenant settings ──────────────────────────────────────────────────────────

@router.get("/{tenant_id}/settings")
async def get_tenant_settings(
    tenant_id: uuid.UUID,
    ctx: OperatorContext = Depends(require_operator_permission("settings.write")),
):
    t = ctx.tenant
    return {
        "id": str(t.id),
        "name": t.name,
        "slug": t.slug,
        "deployment_mode": t.deployment_mode.value,
        "privacy_mode": t.privacy_mode.value,
        "baa_signed": t.baa_signed,
        "baa_signed_at": t.baa_signed_at.isoformat() if t.baa_signed_at else None,
        "baa_counterparty": t.baa_counterparty,
        "operator_key_configured": t.operator_key_configured,
        "daily_token_budget": t.daily_token_budget,
        "per_user_daily_token_budget": t.per_user_daily_token_budget,
        "age_of_majority_days": t.age_of_majority_days,
    }


class PatchSettingsRequest(BaseModel):
    privacy_mode: Optional[str] = None
    daily_token_budget: Optional[int] = None
    per_user_daily_token_budget: Optional[int] = None
    age_of_majority_days: Optional[int] = None
    baa_signed: Optional[bool] = None
    baa_counterparty: Optional[str] = None


@router.patch("/{tenant_id}/settings")
async def patch_tenant_settings(
    tenant_id: uuid.UUID,
    req: PatchSettingsRequest,
    ctx: OperatorContext = Depends(require_operator_permission("settings.write")),
    db: AsyncSession = Depends(get_db),
):
    from models.tenant import PrivacyMode
    t = ctx.tenant

    if req.privacy_mode is not None:
        try:
            t.privacy_mode = PrivacyMode(req.privacy_mode)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid privacy_mode: {req.privacy_mode!r}")
    if req.daily_token_budget is not None:
        t.daily_token_budget = req.daily_token_budget
    if req.per_user_daily_token_budget is not None:
        t.per_user_daily_token_budget = req.per_user_daily_token_budget
    if req.age_of_majority_days is not None:
        t.age_of_majority_days = req.age_of_majority_days
    if req.baa_signed is not None:
        t.baa_signed = req.baa_signed
        if req.baa_signed and not t.baa_signed_at:
            t.baa_signed_at = datetime.now(timezone.utc)
    if req.baa_counterparty is not None:
        t.baa_counterparty = req.baa_counterparty

    db.add(t)
    return {"updated": True}
