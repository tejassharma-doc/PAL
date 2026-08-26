"""
Hermes Orchestrator — routes a query through the full universal search pipeline.

Pipeline:
  query → safety_triage → intent+scope classify → scope_gate
        → planner → fan-out agents (parallel) → synthesizer → one answer
"""
import asyncio
import uuid
import json
from datetime import datetime, timezone
from typing import Optional, AsyncIterator

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from models import PrivacyMode, ConsentBasis, Conversation, ConversationTurn
from phi import EgressControl, PHIAudit, AuditEvent, ConsentRegistry
from .planner import plan, ClassificationResult, Intent, AgentName, RoutingDepth, PlannerDecision
from .synthesizer import synthesize
from ..agents.records_agent import RecordsAgent
from ..agents.medication_agent import MedicationAgent
from ..agents.appointment_agent import AppointmentAgent
from ..agents.diet_agent import DietAgent
from ..agents.evidence_agent import EvidenceAgent
from ..hindsight import get_hindsight
from ..ai_provider import get_ai_client
from ..cache import get_semantic_cache


SAFETY_KEYWORDS_EMERGENCY = {
    "chest pain", "heart attack", "stroke", "severe bleeding", "can't breathe",
    "breathing difficulty", "unconscious", "seizure", "choking", "anaphylaxis",
    "overdose", "poisoning", "severe burn", "high fever convulsion",
}
SAFETY_KEYWORDS_CRISIS = {
    "suicide", "self-harm", "kill myself", "end my life", "want to die",
    "hurt myself",
}


async def _ensure_conversation(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    member_id: uuid.UUID,
    conversation_id: Optional[uuid.UUID],
    scope: str,
    consent_basis_str: Optional[str],
    query: str,
) -> Conversation:
    """Fetch an existing active conversation or create a new one."""
    if conversation_id:
        result = await db.execute(
            select(Conversation).where(
                Conversation.id == conversation_id,
                Conversation.tenant_id == tenant_id,
                Conversation.member_id == member_id,
                Conversation.active == True,  # noqa: E712
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            return existing
    conv = Conversation(
        tenant_id=tenant_id,
        member_id=member_id,
        title=query[:80],
        scope_tag=scope,
        consent_basis=consent_basis_str,
        active=True,
    )
    db.add(conv)
    await db.flush()
    return conv


def _keyword_safety_check(query: str) -> str:
    """Fast deterministic safety triage. Runs before the small model."""
    q = query.lower()
    for kw in SAFETY_KEYWORDS_EMERGENCY:
        if kw in q:
            return "emergency"
    for kw in SAFETY_KEYWORDS_CRISIS:
        if kw in q:
            return "crisis"
    return "routine"


def _parse_classification(raw: str) -> ClassificationResult:
    """
    Parse the on-device model's JSON output into a ClassificationResult.
    Falls back to safe defaults on parse error.
    Expected shape:
    {
      "intents": [{"agent": "records", "confidence": 0.9}],
      "scope": "personal",
      "scope_confidence": 0.85,
      "multilingual_lang": "en",
      "needs_action": false,
      "safety_category": "routine"
    }
    """
    try:
        data = json.loads(raw)
        intents = [
            Intent(agent=AgentName(i["agent"]), confidence=float(i["confidence"]))
            for i in data.get("intents", [])
            if i["agent"] in AgentName.__members__
        ]
        return ClassificationResult(
            intents=intents,
            scope=data.get("scope", "ambiguous"),
            scope_confidence=float(data.get("scope_confidence", 0.0)),
            multilingual_lang=data.get("multilingual_lang"),
            needs_action=bool(data.get("needs_action", False)),
            safety_category=data.get("safety_category", "routine"),
            complexity=data.get("complexity", "simple"),  # Fugu Router field
            appointment_slots=data.get("appointment_slots"),  # forwarded to appointment agent
        )
    except Exception:
        # Parse failure → treat as ambiguous / routine
        return ClassificationResult(
            intents=[],
            scope="ambiguous",
            scope_confidence=0.0,
            multilingual_lang=None,
            needs_action=False,
            safety_category="routine",
        )


class HermesOrchestrator:
    def __init__(
        self,
        db: AsyncSession,
        tenant_id: uuid.UUID,
        member_id: uuid.UUID,
        requesting_user_id: uuid.UUID,
        session_id: str,
        privacy_mode: PrivacyMode,
        conversation_id: Optional[uuid.UUID] = None,
    ):
        self.db = db
        self.tenant_id = tenant_id
        self.member_id = member_id
        self.requesting_user_id = requesting_user_id
        self.session_id = session_id
        self.privacy_mode = privacy_mode
        self.conversation_id = conversation_id
        self.settings = get_settings()
        self._audit = PHIAudit(db)
        self._egress = EgressControl(db, self._audit)
        self._consent = ConsentRegistry(db, self._audit)
        self._hindsight = get_hindsight(db, tenant_id, member_id)

    async def handle(
        self,
        query: str,
        *,
        on_device_classification_json: Optional[str] = None,
        is_second_opinion: bool = False,
        consent_basis: Optional[ConsentBasis] = None,
    ) -> dict:
        """
        Run the full pipeline. Returns a structured answer dict.
        Designed to be called from the API router; streaming handled by the router.
        """
        settings = self.settings

        # Stage 1 — Safety triage (keyword-deterministic runs first)
        keyword_safety = _keyword_safety_check(query)
        if keyword_safety in ("emergency", "crisis"):
            await self._audit.log(AuditEvent(
                event_type="safety_short_circuit",
                tenant_id=self.tenant_id,
                actor_user_id=self.requesting_user_id,
                subject_member_id=self.member_id,
                conversation_id=self.conversation_id,
                detail={"category": keyword_safety, "query_len": len(query)},
            ))
            return self._safety_response(keyword_safety)

        # Stage 2 — Intent + scope classification
        if on_device_classification_json:
            classification = _parse_classification(on_device_classification_json)
        else:
            # Fallback: cloud classification (should only happen in tests / no device model)
            classification = await self._cloud_classify(query)

        # Override safety if keyword check found nothing but model says urgent
        if classification.safety_category in ("emergency", "crisis"):
            return self._safety_response(classification.safety_category)

        # Stage 2b — Scope gate
        if classification.scope == "ambiguous":
            return {
                "type": "disambiguation_required",
                "question": "Do you want general information, or should I use your records to make this personal to you?",
                "classification": {
                    "scope": classification.scope,
                    "intents": [{"agent": i.agent.value, "confidence": i.confidence} for i in classification.intents],
                },
            }

        # Stage 3 — Deterministic planner
        plan_decision = plan(classification)
        await self._audit.log(AuditEvent(
            event_type="planner_decision",
            tenant_id=self.tenant_id,
            actor_user_id=self.requesting_user_id,
            subject_member_id=self.member_id,
            conversation_id=self.conversation_id,
            detail={
                "depth": plan_decision.depth.value,
                "agents": [a.value for a in plan_decision.agents_to_invoke],
                "load_record": plan_decision.load_record,
                "reason": plan_decision.reason,
            },
        ))

        # Trivial complexity → on-device answer; no fan-out, no PHI, 0 tokens
        if plan_decision.depth == RoutingDepth.on_device:
            return {
                "type": "on_device",
                "reason": plan_decision.reason,
                "conversation_id": str(self.conversation_id) if self.conversation_id else None,
                "thread_summary_for_router": await self._hindsight.get_summary(self.conversation_id),
            }

        # Re-check if disambiguation needed (planner found ambiguous scope)
        if not plan_decision.agents_to_invoke and plan_decision.depth == RoutingDepth.one:
            return {
                "type": "disambiguation_required",
                "question": "Do you want general information, or should I use your records to make this personal to you?",
            }

        # Stage 4 — Load record context (only for personal scope, through PHI egress gate)
        record_context = None
        effective_consent_basis = consent_basis

        if plan_decision.load_record:
            egress_decision = await self._egress.check(
                tenant_id=self.tenant_id,
                member_id=self.member_id,
                requesting_user_id=self.requesting_user_id,
                privacy_mode=self.privacy_mode,
                consent_basis=consent_basis,
                session_id=self.session_id,
                conversation_id=self.conversation_id,
            )
            if egress_decision.allowed:
                effective_consent_basis = egress_decision.consent_basis
                # Hindsight: retrieve relevant record slice (RAG, not dump)
                record_context = await self._hindsight.retrieve_relevant_slice(
                    query=query,
                    top_k=8,
                )
            else:
                # PHI egress denied → fall back to generic-scope answer
                classification.scope = "generic"
                plan_decision.load_record = False

        multilingual_lang = classification.multilingual_lang
        lang = multilingual_lang or "en"

        # Stage 4b — Semantic cache (generic, single-agent only; no PHI involved)
        _sem_cache = None
        single_agent = (
            len(plan_decision.agents_to_invoke) == 1
            and not plan_decision.load_record
        )
        if single_agent and not is_second_opinion:
            agent_name_str = plan_decision.agents_to_invoke[0].value
            _sem_cache = get_semantic_cache(
                self.settings.redis_url,
                model=getattr(self.settings, "semantic_cache_model", None),
            )
            if _sem_cache.is_cacheable(agent_name_str, classification.scope):
                cached_text = await _sem_cache.lookup(query, agent_name_str, lang)
                if cached_text:
                    return {
                        "type": "answer",
                        "answer": {"answer_text": cached_text, "cached": True},
                        "scope": classification.scope,
                        "agents_used": [agent_name_str],
                        "consent_basis": None,
                        "multilingual_lang": multilingual_lang,
                        "hindsight_reflection": None,
                    }

        # Stage 5 — Fan out agents in parallel
        ai_client = get_ai_client(self.settings)
        agent_results = await self._fan_out(
            query=query,
            plan=plan_decision,
            record_context=record_context,
            ai_client=ai_client,
            is_second_opinion=is_second_opinion,
            multilingual_lang=multilingual_lang,
        )

        # Stage 6 — Synthesizer (Sonnet; bumped to second-opinion path if requested)
        conversation_history = await self._hindsight.get_summary(self.conversation_id)
        answer = await synthesize(
            query=query,
            agent_results=agent_results,
            plan=plan_decision,
            ai_client=ai_client,
            record_context=record_context,
            conversation_history=conversation_history,
            is_second_opinion=is_second_opinion,
            multilingual_lang=multilingual_lang,
        )

        # Populate cache for next caller with the same query
        if _sem_cache and single_agent and not plan_decision.load_record:
            agent_name_str = plan_decision.agents_to_invoke[0].value
            if _sem_cache.is_cacheable(agent_name_str, classification.scope):
                answer_text = answer.get("answer_text", "")
                if answer_text:
                    await _sem_cache.store(query, agent_name_str, lang, answer_text)

        # Persist conversation + turns (additive — failure never breaks the answer)
        persisted_conv_id: Optional[uuid.UUID] = self.conversation_id
        try:
            consent_basis_str = effective_consent_basis.value if effective_consent_basis else None
            conv = await _ensure_conversation(
                db=self.db,
                tenant_id=self.tenant_id,
                member_id=self.member_id,
                conversation_id=self.conversation_id,
                scope=classification.scope,
                consent_basis_str=consent_basis_str,
                query=query,
            )
            persisted_conv_id = conv.id
            self.db.add(ConversationTurn(
                conversation_id=conv.id,
                tenant_id=self.tenant_id,
                member_id=self.member_id,
                role="user",
                content=query,
                scope=classification.scope,
                contains_phi=(classification.scope == "personal"),
            ))
            self.db.add(ConversationTurn(
                conversation_id=conv.id,
                tenant_id=self.tenant_id,
                member_id=self.member_id,
                role="assistant",
                content=answer.get("answer_text", ""),
                scope=classification.scope,
                citations=answer.get("citations"),
                contains_phi=bool(plan_decision.load_record),
            ))
            await self.db.commit()
        except Exception:
            try:
                await self.db.rollback()
            except Exception:
                pass

        # Update Hindsight rolling memory
        await self._hindsight.update_summary(
            query=query,
            answer=answer.get("answer_text", ""),
            conversation_id=persisted_conv_id,
        )

        # Second-opinion: run Hindsight reflect() when available — surfaces connections
        # across the conversation history that the recall alone wouldn't surface
        reflection = ""
        if is_second_opinion and self.conversation_id and hasattr(self._hindsight, "reflect"):
            reflection = await self._hindsight.reflect(
                conversation_id=self.conversation_id,
                prompt="Summarise what the patient has asked about and flag any clinical patterns across the conversation.",
            )

        return {
            "type": "answer",
            "answer": answer,
            "scope": classification.scope,
            "agents_used": [a.value for a in plan_decision.agents_to_invoke],
            "consent_basis": effective_consent_basis.value if effective_consent_basis else None,
            "multilingual_lang": multilingual_lang,
            "hindsight_reflection": reflection or None,
            "conversation_id": str(persisted_conv_id) if persisted_conv_id else None,
            "thread_summary_for_router": await self._hindsight.get_summary(persisted_conv_id),
        }

    async def _fan_out(
        self,
        query: str,
        plan: PlannerDecision,
        record_context: Optional[dict],
        ai_client,
        is_second_opinion: bool,
        multilingual_lang: Optional[str] = None,
    ) -> dict[str, dict]:
        """Fan out to agents in parallel; collect results."""
        # Get conversation history for all agents
        conversation_history = await self._hindsight.get_summary(self.conversation_id)

        agent_map = {
            AgentName.records: RecordsAgent(self.db, self.tenant_id, self.member_id),
            AgentName.medication: MedicationAgent(ai_client),
            AgentName.appointment: AppointmentAgent(ai_client),
            AgentName.diet: DietAgent(ai_client),
            AgentName.evidence: EvidenceAgent(ai_client),
        }

        tasks = {}
        for agent_name in plan.agents_to_invoke:
            agent = agent_map[agent_name]
            kwargs: dict = {
                "query": query,
                "record_context": record_context,
                "conversation_history": conversation_history,
                "is_second_opinion": is_second_opinion,
            }
            # RecordsAgent has no AI call — no multilingual_lang or slots needed
            if agent_name != AgentName.records:
                kwargs["multilingual_lang"] = multilingual_lang
            # Forward pre-extracted slots to appointment agent to avoid re-parsing
            if agent_name == AgentName.appointment:
                if plan.appointment_slots:
                    kwargs["extracted_slots"] = plan.appointment_slots
                kwargs["session_id"] = self.session_id
                kwargs["secret_key"] = self.settings.secret_key
            tasks[agent_name] = asyncio.create_task(agent.run(**kwargs))

        results = {}
        for agent_name, task in tasks.items():
            try:
                results[agent_name.value] = await task
            except Exception as e:
                results[agent_name.value] = {"error": str(e), "output": None}
        return results

    async def _cloud_classify(self, query: str) -> ClassificationResult:
        """Fallback classification when no on-device model result is available."""
        # In production this path is rare — on-device handles classification
        return ClassificationResult(
            intents=[Intent(agent=AgentName.evidence, confidence=0.5)],
            scope="generic",
            scope_confidence=0.7,
            multilingual_lang=None,
            needs_action=False,
            safety_category="routine",
            complexity="simple",
        )

    def _safety_response(self, category: str) -> dict:
        if category == "emergency":
            return {
                "type": "safety",
                "category": "emergency",
                "message": (
                    "This sounds like a medical emergency. Please call emergency services (112 in India) "
                    "or go to your nearest emergency room immediately. Do not wait."
                ),
                "action": "call_emergency",
            }
        return {
            "type": "safety",
            "category": "crisis",
            "message": (
                "I'm concerned about what you've shared. You're not alone — "
                "please reach out to iCall (9152987821) or Vandrevala Foundation (1860-2662-345). "
                "Your clinic can also help connect you to support."
            ),
            "action": "crisis_resources",
        }
