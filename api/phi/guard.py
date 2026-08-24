"""
PHI Access Guard — policy decision point.

Single function every PHI-touching endpoint calls:
  given (requesting_user, role, tenant, target_member, scope) → allow | deny + effective_scope

Default: DENY.
"""
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional
from enum import Enum

from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import TenantRole, ConsentScope, ConsentBasis


class AccessDecision(str, Enum):
    allow = "allow"
    deny = "deny"


@dataclass
class PHIAccessContext:
    requesting_user_id: uuid.UUID
    requesting_user_role: TenantRole
    tenant_id: uuid.UUID
    target_member_id: uuid.UUID
    requested_scope: ConsentScope
    session_id: Optional[str] = None
    conversation_id: Optional[uuid.UUID] = None


@dataclass
class PHIAccessDecision:
    decision: AccessDecision
    effective_scope: Optional[ConsentScope]
    consent_basis: Optional[ConsentBasis]
    consent_grant_id: Optional[uuid.UUID]
    denial_reason: Optional[str] = None


async def _resolve_access(
    ctx: PHIAccessContext,
    db: AsyncSession,
) -> PHIAccessDecision:
    """
    Core policy resolution:
    1. Self-access always allowed.
    2. operator_* roles: DENY (no auto-PHI).
    3. provider: only if live consent grant exists.
    4. caregiver: only if live family-relationship consent grant exists.
    5. member acting on behalf: only if live consent grant exists.
    """
    from sqlalchemy import select
    from models import ConsentGrant

    # --- 1. Self-access ---
    if ctx.requesting_user_id == ctx.target_member_id:
        return PHIAccessDecision(
            decision=AccessDecision.allow,
            effective_scope=ctx.requested_scope,
            consent_basis=ConsentBasis.session,
            consent_grant_id=None,
        )

    # --- 2. Operator roles: never auto-PHI ---
    operator_roles = {
        TenantRole.operator_admin,
        TenantRole.operator_developer,
        TenantRole.operator_support,
        TenantRole.operator_security,
        TenantRole.operator_billing,
    }
    if ctx.requesting_user_role in operator_roles:
        return PHIAccessDecision(
            decision=AccessDecision.deny,
            effective_scope=None,
            consent_basis=None,
            consent_grant_id=None,
            denial_reason="Operator roles do not have automatic PHI access.",
        )

    # --- 3 & 4. Check for live consent grant ---
    now = datetime.now(timezone.utc)
    stmt = select(ConsentGrant).where(
        ConsentGrant.tenant_id == ctx.tenant_id,
        ConsentGrant.subject_member_id == ctx.target_member_id,
        ConsentGrant.grantee_user_id == ctx.requesting_user_id,
        ConsentGrant.active == True,
        ConsentGrant.revoked_at == None,
    )
    result = await db.execute(stmt)
    grants = result.scalars().all()

    for grant in grants:
        if not grant.is_live:
            continue
        # Session-scoped grant must match session
        if grant.basis == ConsentBasis.session and ctx.session_id:
            if grant.session_id and grant.session_id != ctx.session_id:
                continue
        return PHIAccessDecision(
            decision=AccessDecision.allow,
            effective_scope=grant.scope,
            consent_basis=grant.basis,
            consent_grant_id=grant.id,
        )

    return PHIAccessDecision(
        decision=AccessDecision.deny,
        effective_scope=None,
        consent_basis=None,
        consent_grant_id=None,
        denial_reason="No live consent grant found.",
    )


async def require_phi_access(
    ctx: PHIAccessContext,
    db: AsyncSession,
) -> PHIAccessDecision:
    """Call from non-route service code. Raises PermissionError on deny."""
    decision = await _resolve_access(ctx, db)
    if decision.decision == AccessDecision.deny:
        raise PermissionError(decision.denial_reason or "PHI access denied.")
    return decision


async def phi_guard(
    ctx: PHIAccessContext,
    db: AsyncSession = Depends(get_db),
) -> PHIAccessDecision:
    """FastAPI dependency. Raises HTTP 403 on deny."""
    decision = await _resolve_access(ctx, db)
    if decision.decision == AccessDecision.deny:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=decision.denial_reason or "PHI access denied.",
        )
    return decision
