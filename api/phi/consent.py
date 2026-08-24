"""
Consent Registry — CRUD + lifecycle for consent grants.
Nothing is hard-deleted; full history is kept.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from models import ConsentGrant, ConsentScope, ConsentBasis
from .audit import PHIAudit, AuditEvent


class ConsentRegistry:
    def __init__(self, db: AsyncSession, audit: PHIAudit):
        self.db = db
        self.audit = audit

    async def grant(
        self,
        *,
        tenant_id: uuid.UUID,
        subject_member_id: uuid.UUID,
        grantee_user_id: uuid.UUID,
        granted_by_user_id: uuid.UUID,
        scope: ConsentScope,
        basis: ConsentBasis,
        expires_at: Optional[datetime] = None,
        session_id: Optional[str] = None,
        dossier_types: Optional[list[str]] = None,
    ) -> ConsentGrant:
        grant = ConsentGrant(
            tenant_id=tenant_id,
            subject_member_id=subject_member_id,
            grantee_user_id=grantee_user_id,
            granted_by_user_id=granted_by_user_id,
            scope=scope,
            basis=basis,
            granted_at=datetime.now(timezone.utc),
            expires_at=expires_at,
            session_id=session_id,
            dossier_types=dossier_types,
            active=True,
        )
        self.db.add(grant)
        await self.db.flush()
        await self.audit.log(AuditEvent(
            event_type="consent_granted",
            tenant_id=tenant_id,
            actor_user_id=granted_by_user_id,
            subject_member_id=subject_member_id,
            detail={"scope": scope.value, "basis": basis.value, "grant_id": str(grant.id)},
        ))
        return grant

    async def revoke(
        self,
        *,
        grant_id: uuid.UUID,
        revoked_by_user_id: uuid.UUID,
        reason: Optional[str] = None,
    ) -> ConsentGrant:
        stmt = select(ConsentGrant).where(ConsentGrant.id == grant_id)
        result = await self.db.execute(stmt)
        grant = result.scalar_one()

        grant.revoked_at = datetime.now(timezone.utc)
        grant.revoked_by_user_id = revoked_by_user_id
        grant.revocation_reason = reason
        grant.active = False

        await self.audit.log(AuditEvent(
            event_type="consent_revoked",
            tenant_id=grant.tenant_id,
            actor_user_id=revoked_by_user_id,
            subject_member_id=grant.subject_member_id,
            detail={"grant_id": str(grant_id), "reason": reason},
        ))
        return grant

    async def get_live_grants_for_member(
        self,
        tenant_id: uuid.UUID,
        subject_member_id: uuid.UUID,
    ) -> list[ConsentGrant]:
        now = datetime.now(timezone.utc)
        stmt = select(ConsentGrant).where(
            ConsentGrant.tenant_id == tenant_id,
            ConsentGrant.subject_member_id == subject_member_id,
            ConsentGrant.active == True,
            ConsentGrant.revoked_at == None,
        )
        result = await self.db.execute(stmt)
        grants = result.scalars().all()
        return [g for g in grants if g.is_live]

    async def expire_session_grants(self, session_id: str) -> None:
        """Call when a session ends to invalidate session-scoped grants."""
        now = datetime.now(timezone.utc)
        stmt = select(ConsentGrant).where(
            ConsentGrant.session_id == session_id,
            ConsentGrant.basis == ConsentBasis.session,
            ConsentGrant.active == True,
        )
        result = await self.db.execute(stmt)
        for grant in result.scalars().all():
            grant.revoked_at = now
            grant.active = False
            grant.revocation_reason = "session_ended"
