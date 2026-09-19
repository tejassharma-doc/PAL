"""
Tests for safety triage: keyword-deterministic emergency/crisis detection.
Must short-circuit before any agent fan-out.

Imports from services.hermes.safety_triage rather than the orchestrator, so
these run without SQLAlchemy or a database. The orchestrator now delegates to
the same functions, and the delegate is covered below.
"""
import pytest

from services.hermes.safety_triage import (
    keyword_safety_check,
    detect_prescribing_intent,
    merge_safety,
    is_short_circuit,
    normalise_query,
)


class TestKeywordSafety:
    def test_chest_pain_is_emergency(self):
        assert keyword_safety_check("I have chest pain since morning") == "emergency"

    def test_stroke_symptoms_are_emergency(self):
        # REGRESSION. This previously asserted "routine" — a patient
        # describing a stroke in the words patients actually use was routed
        # to the normal pipeline, and the test locked that behaviour in.
        # Naming the condition is not the only way to report it.
        assert keyword_safety_check("my face is drooping and I can't speak") == "emergency"
        assert keyword_safety_check("stroke signs what should I do") == "emergency"
        assert keyword_safety_check("sudden weakness on one side") == "emergency"
        assert keyword_safety_check("his speech is slurred since an hour") == "emergency"

    def test_curly_apostrophe_from_a_phone_keyboard(self):
        # iOS and Android substitute U+2019 as you type. A substring test for
        # "can't breathe" silently missed every phone-typed emergency.
        assert keyword_safety_check("I can’t breathe") == "emergency"
        assert keyword_safety_check("I can’t stop thinking about suicide") == "crisis"

    def test_self_harm_is_crisis(self):
        assert keyword_safety_check("I want to hurt myself") == "crisis"

    def test_suicide_is_crisis(self):
        assert keyword_safety_check("I'm thinking about suicide") == "crisis"

    def test_routine_query_not_flagged(self):
        assert keyword_safety_check("what is type 2 diabetes?") == "routine"
        assert keyword_safety_check("how does metformin work?") == "routine"

    def test_over_referral_guard(self):
        # A triage tuned only for recall refers every patient and the product
        # stops being worth opening. These must stay routine.
        assert keyword_safety_check("I get severe period pain every month") == "routine"
        assert keyword_safety_check("severe back pain for two days") == "routine"

    def test_emergency_takes_priority_over_crisis(self):
        result = keyword_safety_check("chest pain and want to hurt myself")
        assert result == "emergency"


class TestUrgent:
    def test_urgent_is_not_a_short_circuit(self):
        # urgent widens fan-out; it must never end the turn.
        assert keyword_safety_check("high fever since yesterday") == "urgent"
        assert is_short_circuit("urgent") is False
        assert is_short_circuit("emergency") is True
        assert is_short_circuit("crisis") is True
        assert is_short_circuit("routine") is False

    @pytest.mark.parametrize(
        "query",
        [
            "fever 104 since morning",
            "104 fever since morning",
            "his temperature 103 what to do",
            "baby has fever 40 degrees",
        ],
    )
    def test_fever_both_word_orders_and_both_scales(self, query):
        # The original regex matched only "fever 10[0-9]" in Fahrenheit.
        # Both scales are in everyday use in India.
        assert keyword_safety_check(query) == "urgent"


class TestPrescribingIntent:
    @pytest.mark.parametrize(
        "query",
        [
            "what should i take for my sugar",
            "which medicine is better for acidity",
            "is Glycomet better than Glucophage?",
            "can i stop my BP tablet",
            "how much metformin should i take",
            "best medicine for acidity",
        ],
    )
    def test_prescribing_is_detected(self, query):
        assert detect_prescribing_intent(query) is True

    @pytest.mark.parametrize(
        "query",
        [
            "what is Glycomet",
            "what are the side effects of metformin",
            "how does metformin work",
        ],
    )
    def test_describing_a_medicine_is_not_prescribing(self, query):
        assert detect_prescribing_intent(query) is False


class TestMergeSafety:
    def test_keyword_hit_beats_a_relaxed_model(self):
        assert merge_safety("emergency", "routine") == "emergency"
        assert merge_safety("crisis", "routine") == "crisis"

    def test_model_may_escalate_when_keywords_found_nothing(self):
        assert merge_safety("routine", "urgent") == "urgent"
        assert merge_safety("routine", "emergency") == "emergency"

    def test_both_routine_stays_routine(self):
        assert merge_safety("routine", "routine") == "routine"


class TestNormalisation:
    def test_curly_quotes_and_dashes_folded(self):
        assert "'" in normalise_query("can’t")
        assert "-" in normalise_query("self—harm")


class TestOrchestratorDelegate:
    """The orchestrator must not keep a second implementation."""

    def test_delegate_matches(self):
        sqlalchemy = pytest.importorskip("sqlalchemy")  # noqa: F841
        from services.hermes.orchestrator import _keyword_safety_check

        for q in [
            "I have chest pain since morning",
            "my face is drooping and I can't speak",
            "what is type 2 diabetes?",
            "high fever since yesterday",
        ]:
            assert _keyword_safety_check(q) == keyword_safety_check(q)
