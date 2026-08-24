"""
Hermes Planner — DETERMINISTIC policy layer.

The small on-device model outputs structured JSON (intents + confidence + scope).
This module maps that to a routing depth (one / many / all) using fixed rules.
No LLM free judgment here. Must be unit-testable from intent+confidence inputs alone.
"""
from dataclasses import dataclass
from enum import Enum
from typing import Optional


class RoutingDepth(str, Enum):
    on_device = "on_device"  # trivial turn answered on-device; no cloud call
    one = "one"              # single best-fit agent
    many = "many"            # parallel subset
    all = "all"              # all agents + cloud planner


class AgentName(str, Enum):
    records = "records"
    medication = "medication"
    appointment = "appointment"
    diet = "diet"
    evidence = "evidence"


@dataclass
class Intent:
    agent: AgentName
    confidence: float   # 0.0–1.0


@dataclass
class ClassificationResult:
    """Output from the on-device model (parsed from JSON)."""
    intents: list[Intent]
    scope: str           # "personal" | "generic" | "ambiguous"
    scope_confidence: float
    multilingual_lang: Optional[str]
    needs_action: bool
    safety_category: str  # "emergency" | "crisis" | "urgent" | "routine"
    # Fugu Router: complexity bucket from on-device classifier (default "simple" for backward compat)
    complexity: str = "simple"  # "trivial" | "simple" | "complex" | "call"
    # Present when top intent == appointment and confidence > 0.75
    # Fields: doctor, date_preference, time_preference, reason, urgency
    appointment_slots: Optional[dict] = None


@dataclass
class PlannerDecision:
    depth: RoutingDepth
    agents_to_invoke: list[AgentName]
    load_record: bool        # True only when scope == personal
    reason: str              # for audit
    appointment_slots: Optional[dict] = None  # forwarded from ClassificationResult


# Agents that always warrant multi-agent when present
_MULTI_AGENT_TRIGGERS = {AgentName.medication, AgentName.evidence}

# Confidence threshold for "high confidence" single-agent routing
_HIGH_CONFIDENCE = 0.75
_SCOPE_CONFIDENCE_THRESHOLD = 0.60


def plan(classification: ClassificationResult) -> PlannerDecision:
    """
    Deterministic routing policy. No LLM calls.
    Returns the planner decision for audit + fan-out.
    """
    intents = classification.intents
    scope = classification.scope
    safety = classification.safety_category
    complexity = classification.complexity

    # --- Safety short-circuit (emergency/crisis handled upstream; should not reach here) ---
    if safety in ("emergency", "crisis"):
        return PlannerDecision(
            depth=RoutingDepth.on_device,
            agents_to_invoke=[],
            load_record=False,
            reason="Safety short-circuit: emergency/crisis bypasses agents.",
        )

    # --- Trivial complexity → answered on-device; no cloud call, no record, no tokens ---
    if complexity == "trivial":
        return PlannerDecision(
            depth=RoutingDepth.on_device,
            agents_to_invoke=[],
            load_record=False,
            reason="Trivial complexity: answered on-device with no cloud call.",
        )

    # --- Scope: ambiguous or low confidence → ask one disambiguation question (caller handles) ---
    if scope == "ambiguous" or classification.scope_confidence < _SCOPE_CONFIDENCE_THRESHOLD:
        return PlannerDecision(
            depth=RoutingDepth.one,
            agents_to_invoke=[],
            load_record=False,
            reason="Ambiguous scope: disambiguation required before routing.",
        )

    load_record = scope == "personal"

    # --- No clear intents → all agents + cloud planner ---
    if not intents:
        return PlannerDecision(
            depth=RoutingDepth.all,
            agents_to_invoke=list(AgentName),
            load_record=load_record,
            reason="No clear intents: routing to all agents.",
        )

    top_intent = max(intents, key=lambda i: i.confidence)
    top_agents = {i.agent for i in intents}

    # --- ALL: low confidence, cross-cutting, or safety-adjacent ---
    low_confidence = top_intent.confidence < _HIGH_CONFIDENCE
    multi_intents = len(intents) > 1
    safety_adjacent = safety == "urgent"
    has_trigger = bool(top_agents & _MULTI_AGENT_TRIGGERS)

    if low_confidence or safety_adjacent:
        return PlannerDecision(
            depth=RoutingDepth.all,
            agents_to_invoke=list(AgentName),
            load_record=load_record,
            reason=f"Low confidence ({top_intent.confidence:.2f}) or safety-adjacent → all agents.",
        )

    # --- MANY: multiple intents or med/evidence trigger ---
    if multi_intents or has_trigger:
        agents = list(top_agents)
        # Evidence always added when medication is present (safety: interaction check grounded in literature)
        if AgentName.medication in top_agents and AgentName.evidence not in top_agents:
            agents.append(AgentName.evidence)
        return PlannerDecision(
            depth=RoutingDepth.many,
            agents_to_invoke=agents,
            load_record=load_record,
            reason=f"Multiple intents or med/evidence trigger → many agents: {[a.value for a in agents]}",
        )

    # --- ONE: single intent, high confidence, no trigger ---
    slots = classification.appointment_slots if top_intent.agent == AgentName.appointment else None
    return PlannerDecision(
        depth=RoutingDepth.one,
        agents_to_invoke=[top_intent.agent],
        load_record=load_record,
        reason=f"Single high-confidence intent ({top_intent.agent.value}, {top_intent.confidence:.2f}).",
        appointment_slots=slots,
    )
