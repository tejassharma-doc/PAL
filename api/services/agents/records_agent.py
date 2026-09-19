"""
Records Agent — reads PAL/FHIR health record.
Read-only. Invoked ONLY when scope == personal.
PHI consent/egress gate is enforced in HermesOrchestrator BEFORE this agent is called.
"""
import uuid
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from models import HealthFact, EvidenceClass
from phi.isolation import tenant_and_member_filter


class RecordsAgent:
    name = "records"

    def __init__(self, db: AsyncSession, tenant_id: uuid.UUID, member_id: uuid.UUID):
        self.db = db
        self.tenant_id = tenant_id
        self.member_id = member_id

    async def run(
        self,
        query: str,
        record_context: Optional[dict] = None,
	conversation_history : str = "",
        is_second_opinion: bool = False,
    ) -> dict:
        """
        Return a structured slice of the health record relevant to the query.
        The Hindsight layer (RAG) has already done retrieval; we enrich it here
        with direct DB lookup for completeness on second-opinion.
        """
        if record_context and not is_second_opinion:
            # Hindsight already retrieved the slice; use it
            return {
                "agent": self.name,
                "output": record_context,
                "source": "hindsight_rag",
            }

        # Direct DB retrieval (second opinion or no Hindsight result)
        stmt = select(HealthFact).where(
            tenant_and_member_filter(HealthFact, self.tenant_id, self.member_id)
        ).limit(50)
        result = await self.db.execute(stmt)
        facts = result.scalars().all()

        return {
            "agent": self.name,
            "output": {
                "facts": [
                    {
                        "type": f.fact_type,
                        "key": f.fact_key,
                        "value": f.fact_value,
                        "unit": f.unit,
                        "recorded_at": f.recorded_at.isoformat() if f.recorded_at else None,
                        "evidence_class": f.evidence_class.value,
                    }
                    for f in facts
                ]
            },
            "source": "direct_db",
        }
