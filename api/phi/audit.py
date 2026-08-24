"""
PHI-aware append-only audit log.
Answers: "who saw what, whose, when, under what consent."
Never records: secrets/keys, prompt text, PHI content.
"""
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text


@dataclass
class AuditEvent:
    event_type: str                          # consent_granted | phi_access | phi_egress_decision | …
    tenant_id: uuid.UUID
    actor_user_id: Optional[uuid.UUID] = None
    subject_member_id: Optional[uuid.UUID] = None
    conversation_id: Optional[uuid.UUID] = None
    detail: dict[str, Any] = field(default_factory=dict)
    occurred_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class PHIAudit:
    """
    Writes to the phi_audit_log table (append-only; no updates, no deletes).
    Reads are available only to operator_security role.
    """
    def __init__(self, db: AsyncSession):
        self.db = db

    async def log(self, event: AuditEvent) -> None:
        await self.db.execute(
            text("""
                INSERT INTO phi_audit_log
                    (id, event_type, tenant_id, actor_user_id, subject_member_id,
                     conversation_id, detail, occurred_at)
                VALUES
                    (gen_random_uuid(), :event_type, :tenant_id, :actor_user_id,
                     :subject_member_id, :conversation_id, :detail::jsonb, :occurred_at)
            """),
            {
                "event_type": event.event_type,
                "tenant_id": str(event.tenant_id),
                "actor_user_id": str(event.actor_user_id) if event.actor_user_id else None,
                "subject_member_id": str(event.subject_member_id) if event.subject_member_id else None,
                "conversation_id": str(event.conversation_id) if event.conversation_id else None,
                "detail": __import__("json").dumps(event.detail),
                "occurred_at": event.occurred_at,
            },
        )
