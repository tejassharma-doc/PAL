"""
Unit tests for the deterministic Hermes planner.
Planner decisions must be provable from intent+confidence inputs alone (no LLM).
"""
import pytest
from services.hermes.planner import (
    plan, ClassificationResult, Intent, AgentName, RoutingDepth,
)


def make_classification(
    intents: list[tuple[str, float]],
    scope: str = "generic",
    scope_confidence: float = 0.85,
    safety: str = "routine",
    needs_action: bool = False,
) -> ClassificationResult:
    return ClassificationResult(
        intents=[Intent(agent=AgentName(a), confidence=c) for a, c in intents],
        scope=scope,
        scope_confidence=scope_confidence,
        multilingual_lang=None,
        needs_action=needs_action,
        safety_category=safety,
    )


class TestPlannerEmergency:
    def test_emergency_returns_empty_agents(self):
        c = make_classification([("evidence", 0.9)], safety="emergency")
        d = plan(c)
        assert d.agents_to_invoke == []
        assert not d.load_record

    def test_crisis_returns_empty_agents(self):
        c = make_classification([("medication", 0.8)], safety="crisis")
        d = plan(c)
        assert d.agents_to_invoke == []


class TestPlannerScope:
    def test_ambiguous_scope_returns_no_agents(self):
        c = make_classification([("evidence", 0.9)], scope="ambiguous")
        d = plan(c)
        assert d.agents_to_invoke == []
        assert not d.load_record

    def test_low_scope_confidence_returns_no_agents(self):
        c = make_classification([("evidence", 0.9)], scope="personal", scope_confidence=0.4)
        d = plan(c)
        assert d.agents_to_invoke == []

    def test_personal_scope_sets_load_record(self):
        c = make_classification([("records", 0.9)], scope="personal", scope_confidence=0.9)
        d = plan(c)
        assert d.load_record

    def test_generic_scope_does_not_load_record(self):
        c = make_classification([("evidence", 0.9)], scope="generic")
        d = plan(c)
        assert not d.load_record


class TestPlannerDepth:
    def test_single_high_confidence_routes_to_one(self):
        c = make_classification([("records", 0.9)], scope="generic")
        d = plan(c)
        assert d.depth == RoutingDepth.one
        assert d.agents_to_invoke == [AgentName.records]

    def test_multiple_intents_routes_to_many(self):
        c = make_classification([("records", 0.8), ("diet", 0.7)], scope="generic")
        d = plan(c)
        assert d.depth == RoutingDepth.many
        assert AgentName.records in d.agents_to_invoke
        assert AgentName.diet in d.agents_to_invoke

    def test_medication_intent_adds_evidence(self):
        c = make_classification([("medication", 0.85)], scope="generic")
        d = plan(c)
        assert d.depth == RoutingDepth.many
        assert AgentName.evidence in d.agents_to_invoke

    def test_low_confidence_routes_to_all(self):
        c = make_classification([("records", 0.5)], scope="generic")
        d = plan(c)
        assert d.depth == RoutingDepth.all
        assert set(d.agents_to_invoke) == set(AgentName)

    def test_urgent_safety_routes_to_all(self):
        c = make_classification([("evidence", 0.9)], safety="urgent")
        d = plan(c)
        assert d.depth == RoutingDepth.all

    def test_no_intents_routes_to_all(self):
        c = make_classification([], scope="generic")
        d = plan(c)
        assert d.depth == RoutingDepth.all


class TestPlannerRegression:
    """Generic-scope searches must never load the record."""
    def test_generic_evidence_query_no_record(self):
        c = make_classification([("evidence", 0.9)], scope="generic", scope_confidence=0.95)
        d = plan(c)
        assert not d.load_record

    def test_personal_records_loads_record(self):
        c = make_classification([("records", 0.9)], scope="personal", scope_confidence=0.95)
        d = plan(c)
        assert d.load_record
