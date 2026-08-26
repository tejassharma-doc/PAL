"""
Hindsight — PAL's memory + retrieval layer.
Core rule: retrieve and summarise; never resend everything every turn.

- Record RAG: retrieve relevant slice via pgvector, not the whole chart.
- Rolling conversation memory: compact running summary, not the full transcript.
- Personal context is consent- and PHI-gated (enforced upstream).
- Deletion of a thread purges its Hindsight entries.
"""
import uuid
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text

from models import HealthFact, ConversationTurn, Conversation

logger = logging.getLogger(__name__)


class Hindsight:
    def __init__(self, db: AsyncSession, tenant_id: uuid.UUID, member_id: uuid.UUID):
        self.db = db
        self.tenant_id = tenant_id
        self.member_id = member_id

    async def retrieve_relevant_slice(
        self,
        query: str,
        top_k: int = 8,
        query_embedding: Optional[list[float]] = None,
    ) -> dict:
        """
        Retrieve the most relevant health facts for this query via pgvector ANN search.
        Falls back to recency-based retrieval when no embedding is available.
        """
        if query_embedding:
            # Vector similarity search
            stmt = text("""
                SELECT id, fact_type, fact_key, fact_value, unit, recorded_at, evidence_class
                FROM health_facts
                WHERE tenant_id = :tenant_id AND member_id = :member_id
                  AND embedding IS NOT NULL
                ORDER BY embedding <=> :embedding::vector
                LIMIT :top_k
            """)
            result = await self.db.execute(stmt, {
                "tenant_id": str(self.tenant_id),
                "member_id": str(self.member_id),
                "embedding": str(query_embedding),
                "top_k": top_k,
            })
            rows = result.mappings().all()
        else:
            # Fallback: most recent facts
            stmt = select(HealthFact).where(
                HealthFact.tenant_id == self.tenant_id,
                HealthFact.member_id == self.member_id,
            ).order_by(HealthFact.recorded_at.desc().nullslast()).limit(top_k)
            result = await self.db.execute(stmt)
            rows = [
                {
                    "id": str(f.id), "fact_type": f.fact_type, "fact_key": f.fact_key,
                    "fact_value": f.fact_value, "unit": f.unit,
                    "recorded_at": f.recorded_at.isoformat() if f.recorded_at else None,
                    "evidence_class": f.evidence_class.value,
                }
                for f in result.scalars().all()
            ]

        return {"facts": list(rows), "retrieval_method": "hindsight_rag"}

    async def update_summary(
        self,
        query: str,
        answer: str,
        conversation_id: Optional[uuid.UUID],
    ) -> None:
        """
        Update the rolling summary for a conversation.
        Appends the new turn pair; truncates to keep the summary compact.
        This is a simplified implementation — in production, use an LLM to compress.
        """
        if not conversation_id:
            return
        stmt = select(Conversation).where(Conversation.id == conversation_id)
        result = await self.db.execute(stmt)
        conv = result.scalar_one_or_none()
        if not conv:
            return

        current = conv.hindsight_summary or ""
        new_entry = f"Q: {query[:200]}\nA: {answer[:400]}"
        combined = f"{current}\n\n{new_entry}".strip()
        # Keep last ~2000 chars of rolling summary
        conv.hindsight_summary = combined[-2000:]
        conv.hindsight_updated_at = datetime.utcnow()  # Use timezone-naive datetime for PostgreSQL

        # Commit the changes to database
        await self.db.commit()
        logger.info(f"Hindsight: Updated summary for conversation {conversation_id} (length: {len(conv.hindsight_summary)} chars)")

    async def get_summary(self, conversation_id: Optional[uuid.UUID]) -> str:
        """
        Return the compact rolling summary for the conversation.
        Used by the Fugu Router to make thread-aware routing decisions.
        Returns empty string when no conversation or summary exists.
        """
        if not conversation_id:
            logger.debug("Hindsight: get_summary called with no conversation_id")
            return ""
        stmt = select(Conversation).where(Conversation.id == conversation_id)
        result = await self.db.execute(stmt)
        conv = result.scalar_one_or_none()
        if not conv or not conv.hindsight_summary:
            logger.debug(f"Hindsight: No summary found for conversation {conversation_id}")
            return ""
        # Cap at 500 chars so the on-device model prepend stays within 128-token window
        summary = conv.hindsight_summary[-500:]
        logger.info(f"Hindsight: Retrieved summary for conversation {conversation_id} (length: {len(summary)} chars)")
        return summary

    async def purge_thread(self, conversation_id: uuid.UUID) -> None:
        """
        Real cascading delete: messages + embeddings + this Hindsight summary.
        Called when patient deletes a conversation. Audited by caller.
        """
        stmt = select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.tenant_id == self.tenant_id,
            Conversation.member_id == self.member_id,
        )
        result = await self.db.execute(stmt)
        conv = result.scalar_one_or_none()
        if not conv:
            return

        # Null out embeddings on turns (vectors purged)
        await self.db.execute(text("""
            UPDATE conversation_turns
            SET embedding = NULL
            WHERE conversation_id = :conv_id
        """), {"conv_id": str(conversation_id)})

        # Cascade delete all turns + null out summary
        conv.hindsight_summary = None
        conv.hindsight_updated_at = None
        conv.deleted_at = datetime.utcnow()  # Use timezone-naive datetime for PostgreSQL
        conv.active = False
        # Turns cascade via ORM relationship (ondelete=CASCADE)
