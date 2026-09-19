"""
Conversation flow: does a multi-turn conversation actually keep its context?

This is the end-to-end check on the thing the banked retention was built for.
It exercises the real VectorizeHindsight code against a fake Hindsight client,
so it needs no server, no database and no network.

Two properties under test, and they are separate:

  RETAIN  — a turn's content reaches the conversation bank, gated so that
            refusals and flagged answers do not persist their content.
  RECALL  — the thread comes back out on the next turn.

Both must hold. `get_summary()` previously returned "" unconditionally, so
retention worked and recall did not: every turn was written and none was read,
which is exactly the isolated-context problem the grouping was meant to fix.
"""
import asyncio
import uuid

import pytest

from services.hindsight import vectorize_hindsight as vh
from services.clinical.retention import RetentionClass, gate_turn


class FakeHindsightClient:
    """Minimal stand-in: banks are lists, recall returns them in order."""

    def __init__(self):
        self.banks: dict[str, list[str]] = {}

    def retain(self, bank_id: str, content: str):
        self.banks.setdefault(bank_id, []).append(content)

    def recall(self, bank_id: str, query: str):
        return [{"content": c, "score": 1.0} for c in self.banks.get(bank_id, [])]

    def clear(self, bank_id: str):
        self.banks.pop(bank_id, None)


@pytest.fixture
def client(monkeypatch):
    fake = FakeHindsightClient()
    monkeypatch.setattr(vh, "_client", fake)
    return fake


@pytest.fixture
def memory():
    return vh.VectorizeHindsight(tenant_id=uuid.uuid4(), member_id=uuid.uuid4())


def run(coro):
    return asyncio.run(coro)


class TestMultiTurnContext:
    def test_a_three_turn_conversation_accumulates_its_thread(self, client, memory):
        conv = uuid.uuid4()

        run(memory.update_summary(
            query="what is type 2 diabetes",
            answer="A condition where blood sugar stays high.",
            conversation_id=conv,
        ))
        run(memory.update_summary(
            query="what causes it",
            answer="Insulin resistance, among other things.",
            conversation_id=conv,
        ))
        run(memory.update_summary(
            query="and how is it usually managed",
            answer="Diet, exercise and sometimes medicine.",
            conversation_id=conv,
        ))

        thread = run(memory.get_summary(conv))

        # All three turns present, in the order they happened. Without this the
        # model reads "and how is it usually managed" with no referent for "it".
        assert "type 2 diabetes" in thread
        assert "what causes it" in thread
        assert "usually managed" in thread
        assert thread.index("type 2 diabetes") < thread.index("usually managed")

    def test_the_thread_is_scoped_to_its_conversation(self, client, memory):
        a, b = uuid.uuid4(), uuid.uuid4()
        run(memory.update_summary(query="about my knee", answer="...", conversation_id=a))
        run(memory.update_summary(query="about my eyes", answer="...", conversation_id=b))

        assert "knee" in run(memory.get_summary(a))
        assert "knee" not in run(memory.get_summary(b))

    def test_an_empty_conversation_returns_empty_not_an_error(self, client, memory):
        assert run(memory.get_summary(uuid.uuid4())) == ""
        assert run(memory.get_summary(None)) == ""

    def test_the_thread_is_budget_capped(self, client, memory):
        conv = uuid.uuid4()
        for i in range(60):
            run(memory.update_summary(
                query=f"question number {i} " + "padding " * 20,
                answer="answer " * 30,
                conversation_id=conv,
            ))
        thread = run(memory.get_summary(conv))
        # Capped, but the most recent turns survive — truncating the newest
        # end would defeat the purpose.
        assert len(thread) <= memory.SUMMARY_CHAR_BUDGET + 4
        assert "question number 59" in thread


class TestContinuityAcrossRefusals:
    """
    A refused turn must not leave a hole. The next turn's follow-up is often
    unintelligible without knowing a turn happened.
    """

    def test_prescribing_refusal_keeps_the_thread_readable(self, client, memory):
        conv = uuid.uuid4()

        run(memory.update_summary(
            query="what is Glycomet", answer="A brand of metformin.",
            conversation_id=conv,
        ))
        run(memory.update_summary(
            query="should I take it instead of my current tablet", answer="",
            conversation_id=conv, prescribing_intent=True,
        ))
        run(memory.update_summary(
            query="ok, then what are its side effects",
            answer="Nausea is common.", conversation_id=conv,
        ))

        thread = run(memory.get_summary(conv))
        assert "Glycomet" in thread
        assert "should I take it instead" in thread          # question kept
        assert "No clinical answer was given" in thread      # but no answer
        assert "side effects" in thread

    def test_a_crisis_turn_leaves_a_marker_but_no_content(self, client, memory):
        conv = uuid.uuid4()
        run(memory.update_summary(query="I am fine, just asking", answer="Sure.",
                                  conversation_id=conv))
        run(memory.update_summary(
            query="honestly I want to end my life", answer="crisis helpline copy",
            conversation_id=conv, safety_category="crisis",
        ))
        run(memory.update_summary(query="anyway, what is metformin", answer="A medicine.",
                                  conversation_id=conv))

        thread = run(memory.get_summary(conv))
        # Thread stays continuous...
        assert "what is metformin" in thread
        assert "safety concern was raised" in thread
        # ...without the disclosure or the crisis copy resurfacing later.
        assert "end my life" not in thread
        assert "helpline" not in thread

    def test_a_flagged_answer_does_not_pollute_the_thread(self, client, memory):
        conv = uuid.uuid4()
        run(memory.update_summary(
            query="does it cure diabetes",
            answer="Yes, metformin cures diabetes completely.",
            conversation_id=conv, citation_guard_flagged=True,
        ))
        thread = run(memory.get_summary(conv))
        assert "does it cure diabetes" in thread
        assert "cures diabetes completely" not in thread


class TestNoRegressionOnTheBanks:
    def test_the_patient_bank_is_never_written_from_the_answer_path(self, client, memory):
        run(memory.update_summary(query="q", answer="a", conversation_id=uuid.uuid4()))
        run(memory.update_summary(query="q2", answer="a2", conversation_id=None))

        patient_banks = [b for b in client.banks if b.startswith("patient-")]
        assert patient_banks == []

    def test_purge_still_clears_a_thread(self, client, memory):
        conv = uuid.uuid4()
        run(memory.update_summary(query="q", answer="a", conversation_id=conv))
        assert run(memory.get_summary(conv)) != ""
        run(memory.purge_thread(conv))
        assert run(memory.get_summary(conv)) == ""

    def test_retrieval_still_works_when_hindsight_is_down(self, monkeypatch, memory):
        monkeypatch.setattr(vh, "_client", None)
        assert run(memory.get_summary(uuid.uuid4())) == ""
        run(memory.update_summary(query="q", answer="a", conversation_id=uuid.uuid4()))

    def test_recall_failure_degrades_to_empty_not_an_exception(self, monkeypatch, memory):
        class Broken(FakeHindsightClient):
            def recall(self, bank_id, query):
                raise ConnectionError("hindsight down")

        monkeypatch.setattr(vh, "_client", Broken())
        assert run(memory.get_summary(uuid.uuid4())) == ""


class TestGateIsWiredNotJustDefined:
    """The gate must be what decides, not a parallel unused code path."""

    def test_retained_content_matches_the_gate_decision(self, client, memory):
        conv = uuid.uuid4()
        run(memory.update_summary(query="hello there", answer="Hi.", conversation_id=conv))

        decision = gate_turn(query="hello there", answer_text="Hi.", conversation_id=conv)
        assert decision.retention_class == RetentionClass.assistant_generated

        stored = client.banks[f"conversation-{conv}"][0]
        assert "assistant-generated" in stored
        assert "NOT an established fact about the patient" in stored
