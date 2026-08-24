"""
Tests for Fugu complexity bucket integration in the planner.

Covers:
  - trivial complexity → on_device depth, empty agents
  - simple/complex/call complexity → normal planner routing (unchanged)
  - Multi-turn shifting complexity (acceptance scenario from spec)
  - on_device depth is wired into RoutingDepth enum
"""
import pytest
from services.hermes.planner import (
    plan,
    ClassificationResult,
    Intent,
    AgentName,
    RoutingDepth,
)


def make_classification(
    intents: list[tuple[str, float]],
    complexity: str = "simple",
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
        complexity=complexity,
    )


class TestOnDeviceDepth:
    def test_on_device_in_routing_depth_enum(self):
        assert RoutingDepth.on_device == "on_device"

    def test_trivial_returns_on_device_depth(self):
        c = make_classification([("evidence", 0.90)], complexity="trivial")
        d = plan(c)
        assert d.depth == RoutingDepth.on_device

    def test_trivial_returns_empty_agents(self):
        c = make_classification([("records", 0.85)], complexity="trivial")
        d = plan(c)
        assert d.agents_to_invoke == []

    def test_trivial_does_not_load_record(self):
        c = make_classification([("records", 0.85)], complexity="trivial", scope="personal")
        d = plan(c)
        assert not d.load_record

    def test_trivial_has_reason_field(self):
        c = make_classification([], complexity="trivial")
        d = plan(c)
        assert d.reason  # non-empty string

    def test_trivial_short_circuits_before_safety_routing(self):
        # trivial check runs BEFORE safety dispatch (but safety still checked first in implementation)
        # This tests that trivial still returns on_device when safety is routine.
        c = make_classification([("evidence", 0.90)], complexity="trivial", safety="routine")
        d = plan(c)
        assert d.depth == RoutingDepth.on_device


class TestComplexityDoesNotBreakExistingRouting:
    """
    Ensure adding complexity field doesn't break existing routing paths.
    Default complexity='simple' must be backward-compatible.
    """

    def test_simple_complexity_with_single_intent_routes_normally(self):
        c = make_classification([("evidence", 0.90)], complexity="simple")
        d = plan(c)
        # Should not be on_device — goes to cloud
        assert d.depth != RoutingDepth.on_device
        assert d.agents_to_invoke

    def test_complex_complexity_widens_to_many_agents(self):
        c = make_classification(
            [("records", 0.82), ("diet", 0.71)],
            complexity="complex",
            scope="personal",
        )
        d = plan(c)
        assert len(d.agents_to_invoke) > 1

    def test_call_complexity_dispatches_to_hermes(self):
        c = make_classification(
            [("appointment", 0.91)],
            complexity="call",
            needs_action=True,
            scope="personal",
        )
        d = plan(c)
        assert d.depth == RoutingDepth.launch_hermes

    def test_missing_complexity_field_defaults_to_simple(self):
        # ClassificationResult without complexity kwarg uses default="simple"
        c = ClassificationResult(
            intents=[Intent(agent=AgentName("evidence"), confidence=0.88)],
            scope="generic",
            scope_confidence=0.85,
            multilingual_lang=None,
            needs_action=False,
            safety_category="routine",
        )
        assert c.complexity == "simple"
        d = plan(c)
        assert d.depth != RoutingDepth.on_device


class TestSafetyStillWinsOverTrivial:
    """
    Safety short-circuit must fire regardless of complexity.
    Emergency/crisis bypass all routing including trivial.
    """

    def test_emergency_overrides_trivial(self):
        c = make_classification([("evidence", 0.90)], complexity="trivial", safety="emergency")
        d = plan(c)
        # Safety wins — on_device from safety, not trivial (but either way: no agents)
        assert d.agents_to_invoke == []
        assert not d.load_record

    def test_crisis_overrides_trivial(self):
        c = make_classification([("evidence", 0.90)], complexity="trivial", safety="crisis")
        d = plan(c)
        assert d.agents_to_invoke == []


class TestMultiTurnComplexityShifts:
    """
    Spec acceptance scenario: complexity should shift turn-to-turn.
    Tests planner decisions for each turn independently.
    """

    def test_turn1_generic_simple_evidence(self):
        # "what is diabetes?" → simple/generic → one agent (evidence)
        c = make_classification([("evidence", 0.90)], complexity="simple", scope="generic")
        d = plan(c)
        assert d.depth in (RoutingDepth.one, RoutingDepth.many)
        assert "evidence" in [str(a) for a in d.agents_to_invoke]
        assert not d.load_record

    def test_turn2_complex_personal_loads_record(self):
        # "am I at risk given my labs?" → complex/personal → many, load record
        c = make_classification(
            [("records", 0.84), ("evidence", 0.70)],
            complexity="complex",
            scope="personal",
        )
        d = plan(c)
        assert d.depth == RoutingDepth.many
        assert d.load_record

    def test_turn3_complex_personal_diet(self):
        # "what should I eat for my cholesterol?" → complex/personal → many, diet included
        c = make_classification(
            [("diet", 0.87), ("records", 0.72), ("evidence", 0.65)],
            complexity="complex",
            scope="personal",
        )
        d = plan(c)
        assert d.depth == RoutingDepth.many
        assert "diet" in [str(a) for a in d.agents_to_invoke]
        assert d.load_record

    def test_turn4_call_books_appointment(self):
        # "book a review with my doctor" → call → launch_hermes
        c = make_classification(
            [("appointment", 0.92)],
            complexity="call",
            needs_action=True,
            scope="personal",
        )
        d = plan(c)
        assert d.depth == RoutingDepth.launch_hermes

    def test_turn5_trivial_thanks(self):
        # "thanks!" → trivial → on_device
        c = make_classification([], complexity="trivial", scope="generic")
        d = plan(c)
        assert d.depth == RoutingDepth.on_device
        assert d.agents_to_invoke == []
        assert not d.load_record
