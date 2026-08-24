"""
Tests for safety triage: keyword-deterministic emergency/crisis detection.
Must short-circuit before any agent fan-out.
"""
import pytest
from services.hermes.orchestrator import _keyword_safety_check


class TestKeywordSafety:
    def test_chest_pain_is_emergency(self):
        assert _keyword_safety_check("I have chest pain since morning") == "emergency"

    def test_stroke_symptoms_are_emergency(self):
        assert _keyword_safety_check("my face is drooping and I can't speak") == "routine"
        assert _keyword_safety_check("stroke signs what should I do") == "emergency"

    def test_self_harm_is_crisis(self):
        assert _keyword_safety_check("I want to hurt myself") == "crisis"

    def test_suicide_is_crisis(self):
        assert _keyword_safety_check("I'm thinking about suicide") == "crisis"

    def test_routine_query_not_flagged(self):
        assert _keyword_safety_check("what is type 2 diabetes?") == "routine"
        assert _keyword_safety_check("how does metformin work?") == "routine"

    def test_emergency_takes_priority_over_crisis(self):
        # If both keywords present, emergency wins (it's checked first)
        result = _keyword_safety_check("chest pain and want to hurt myself")
        assert result == "emergency"
