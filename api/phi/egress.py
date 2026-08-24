"""
Egress Control — single chokepoint for sending PHI to an external AI provider.
Honors tenant privacy_mode + per-call consent. Default: deny.
"""
import uuid
from dataclasses import dataclass
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from models import PrivacyMode, ConsentBasis
from .audit import PHIAudit, AuditEvent


@dataclass
class EgressDecision:
    allowed: bool
    consent_basis: Optional[ConsentBasis]
    reason: str


class EgressControl:
    def __init__(self, db: AsyncSession, audit: PHIAudit):
        self.db = db
        self.audit = audit

    async def check(
        self,
        *,
        tenant_id: uuid.UUID,
        member_id: uuid.UUID,
        requesting_user_id: uuid.UUID,
        privacy_mode: PrivacyMode,
        consent_basis: Optional[ConsentBasis],
        session_id: Optional[str] = None,
        conversation_id: Optional[uuid.UUID] = None,
    ) -> EgressDecision:
        """
        Can PHI for this member be sent to the cloud AI provider right now?

        Rules:
          strict mode         → deny always (PHI stays on host)
          session_consent     → allow only if consent_basis is session or stronger
          standing_consent    → allow if standing consent exists
        """
        if privacy_mode == PrivacyMode.strict:
            decision = EgressDecision(
                allowed=False,
                consent_basis=None,
                reason="Tenant privacy mode is strict; PHI stays on host.",
            )
        elif privacy_mode == PrivacyMode.session_consent:
            if consent_basis in (ConsentBasis.session, ConsentBasis.standing, ConsentBasis.per_query):
                decision = EgressDecision(
                    allowed=True,
                    consent_basis=consent_basis,
                    reason="Session consent granted.",
                )
            else:
                decision = EgressDecision(
                    allowed=False,
                    consent_basis=None,
                    reason="Session consent required but not present.",
                )
        elif privacy_mode == PrivacyMode.standing_consent:
            if consent_basis == ConsentBasis.standing:
                decision = EgressDecision(
                    allowed=True,
                    consent_basis=consent_basis,
                    reason="Standing consent in effect.",
                )
            else:
                decision = EgressDecision(
                    allowed=False,
                    consent_basis=None,
                    reason="Standing consent required but not present.",
                )
        else:
            decision = EgressDecision(allowed=False, consent_basis=None, reason="Unknown privacy mode.")

        # Audit every egress decision
        await self.audit.log(AuditEvent(
            event_type="phi_egress_decision",
            tenant_id=tenant_id,
            actor_user_id=requesting_user_id,
            subject_member_id=member_id,
            detail={
                "allowed": decision.allowed,
                "reason": decision.reason,
                "privacy_mode": privacy_mode.value,
                "consent_basis": consent_basis.value if consent_basis else None,
                "session_id": session_id,
                "conversation_id": str(conversation_id) if conversation_id else None,
            },
        ))
        return decision
