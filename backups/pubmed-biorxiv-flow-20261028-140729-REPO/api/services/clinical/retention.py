"""
Retention gate — what is allowed to become durable memory.

The problem this closes:

    VectorizeHindsight.update_summary() retained
        f"Patient asked: {query}\\nAssistant answered: {answer}"
    on every turn, unconditionally. Hindsight then consolidates retained
    content into Observations — derived knowledge it will later recall as
    fact. So an inference the model made this turn becomes a durable fact
    about the patient next turn.

    In a health product that is not an embarrassing bug, it is a clinical
    one. "My mother has diabetes" consolidating into a stored fact about the
    patient is the classic attribution error, and once it is in the bank it
    colours every later recall.

Two sharp edges in the original, both closed here:

  1. The bank fell back to `patient-{member_id}` — the long-lived bank —
     whenever conversation_id was None. Raw model output went straight into
     permanent patient memory. Nothing from the answer path may write there
     now; promotion to the patient bank is a separate, deliberate act.

  2. An answer the citation guard flagged was retained exactly like a clean
     one. Flagged answers are not retained at all.

What survives the gate:
    - the patient's own words                       (retained as stated)
    - clinician-canonical content from DocEHR       (retained as fact)
    - the assistant's answer, marked as assistant-generated and never as a
      fact about the patient, and only when it was not flagged

Rebuildability: every retained record carries the conversation turn it came
from, so a bank can be dropped and regenerated from Postgres. The moment you
cannot rebuild it, a bad extraction is permanent and there is no way back to
ground truth.

Dependency-free: stdlib only.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from enum import Enum

__all__ = [
    "RetentionClass",
    "RetentionDecision",
    "gate_turn",
    "format_retention_record",
]


class RetentionClass(str, Enum):
    #: The patient said it. Retained in their own words, attributed.
    patient_stated = "patient-stated"
    #: A content-free marker that a turn happened. Keeps the conversation
    #: grouped for the next turn's context without persisting what was said.
    turn_marker = "turn-marker"
    #: From DocEHR. The only class that may be retained as instruction.
    clinician_canonical = "clinician-canonical"
    #: The assistant said it. Retained as context, never as a patient fact.
    assistant_generated = "assistant-generated"
    #: Nothing may be retained from this turn.
    none = "none"


@dataclass
class RetentionDecision:
    retain: bool
    retention_class: RetentionClass
    #: Only ever a conversation bank from the answer path. Never a patient bank.
    bank_id: str | None
    reason: str
    #: For turn_marker decisions: the content-free line to retain instead of
    #: the Q&A, so the thread stays grouped without persisting what was said.
    marker_text: str | None = None
    #: Turn ids this record derives from, so the bank is rebuildable.
    source_turn_ids: list[str] = field(default_factory=list)


def gate_turn(
    *,
    query: str,
    answer_text: str,
    conversation_id: uuid.UUID | str | None,
    citation_guard_flagged: bool = False,
    safety_category: str = "routine",
    prescribing_intent: bool = False,
    source_turn_ids: list[str] | None = None,
) -> RetentionDecision:
    """
    Decide what, if anything, this turn may write to memory.

    Ordered so the refusals come first: a turn that ended in an escalation or
    a referral has no answer worth remembering, and retaining the query alone
    would put a crisis disclosure into a bank that recall reads back on every
    later turn.
    """
    turn_ids = source_turn_ids or []

    # An emergency or crisis turn produced a fixed safety screen, not an
    # answer. Retaining the patient's words here would surface a crisis
    # disclosure in unrelated later recalls. The audit trail already records
    # that the turn happened; memory does not need to.
    if safety_category in ("emergency", "crisis"):
        # A marker, not silence. Dropping the turn entirely would leave a hole
        # in the thread, and the next turn's context would not know a turn had
        # happened at all — which is the continuity problem the grouped
        # retention was built to solve. The marker carries no content: a crisis
        # disclosure must not resurface in an unrelated later recall.
        return RetentionDecision(
            retain=bool(conversation_id),
            retention_class=RetentionClass.turn_marker,
            bank_id=f"conversation-{conversation_id}" if conversation_id else None,
            marker_text="[A safety concern was raised and handled outside this "
                        "conversation. The content is deliberately not recorded here.]",
            reason=f"safety short-circuit ({safety_category}): marker only, content not retained",
            source_turn_ids=turn_ids,
        )

    # A referral produced a fixed refusal. Nothing generated here is worth
    # recalling, and the question is already carried to the visit agenda.
    if prescribing_intent:
        # The question itself is safe to keep and useful for continuity — a
        # follow-up like "ok, then what is metformin" is unintelligible without
        # it. What is NOT kept is any answer, because there wasn't one.
        return RetentionDecision(
            retain=bool(conversation_id),
            retention_class=RetentionClass.turn_marker,
            bank_id=f"conversation-{conversation_id}" if conversation_id else None,
            marker_text=f"[Patient asked: {query}. This was a question about which "
                        "medicine to take, so it was referred to their doctor and "
                        "carried to the visit agenda. No clinical answer was given.]",
            reason="prescribing intent refused: question kept for continuity, no answer retained",
            source_turn_ids=turn_ids,
        )

    # The citation guard found a clinical claim that no human study supported.
    # Retaining it would make the unsupported claim durable and let it ground
    # later answers — the failure compounding rather than staying in one turn.
    if citation_guard_flagged:
        # Keep the question, drop the answer. Retaining a claim no human study
        # supported would let it ground later answers — the failure compounding
        # instead of staying in one turn.
        return RetentionDecision(
            retain=bool(conversation_id),
            retention_class=RetentionClass.turn_marker,
            bank_id=f"conversation-{conversation_id}" if conversation_id else None,
            marker_text=f"[Patient asked: {query}. The answer given did not meet the "
                        "citation standard and is deliberately not recorded.]",
            reason="citation guard flagged: question kept for continuity, answer not retained",
            source_turn_ids=turn_ids,
        )

    if not conversation_id:
        # Previously this fell back to the patient bank. That is the edge that
        # put raw model output into permanent patient memory.
        return RetentionDecision(
            retain=False,
            retention_class=RetentionClass.none,
            bank_id=None,
            reason="no conversation id: the answer path never writes to the patient bank",
            source_turn_ids=turn_ids,
        )

    if not (answer_text or "").strip():
        return RetentionDecision(
            retain=False,
            retention_class=RetentionClass.none,
            bank_id=None,
            reason="empty answer: nothing to retain",
            source_turn_ids=turn_ids,
        )

    return RetentionDecision(
        retain=True,
        retention_class=RetentionClass.assistant_generated,
        bank_id=f"conversation-{conversation_id}",
        reason="conversation-scoped, unflagged: retained as assistant-generated context",
        source_turn_ids=turn_ids,
    )


def format_retention_record(
    *,
    query: str,
    answer_text: str,
    decision: RetentionDecision,
) -> str:
    """
    The retained text, labelled.

    The labels are the point. Hindsight consolidates retained content into
    Observations, and an Observation built from text that says "the patient
    asked X, the assistant answered Y" is far less likely to be recalled as
    "the patient has Y" than one built from bare prose. Cheap insurance
    against the attribution error, and it costs a few tokens.
    """
    if decision.retention_class is RetentionClass.turn_marker:
        return (
            f"[provenance: {decision.retention_class.value}]\n"
            f"[source_turns: {','.join(decision.source_turn_ids) or 'unrecorded'}]\n"
            f"{decision.marker_text or '[A turn occurred here.]'}"
        )

    return (
        f"[provenance: {decision.retention_class.value}]\n"
        f"[source_turns: {','.join(decision.source_turn_ids) or 'unrecorded'}]\n"
        f"[note: assistant output — context for this conversation only. "
        f"NOT an established fact about the patient.]\n"
        f"Patient asked: {query}\n"
        f"Assistant answered: {answer_text}"
    )
