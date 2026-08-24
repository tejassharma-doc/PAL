"""
Hermes Voice Agent — patient-facing AI caller.

Manages a multi-turn voice call with a patient to schedule appointments.

Latency tiers (fastest first):
  1. Haiku fast-path with prefetched DocEHR result
     → used when call_orchestrator pre-ran the DocEHR query in the background
     → 1 × Haiku call (~0.8 s) instead of 2 × Sonnet calls (~7 s)

  2. Haiku conversational
     → greeting and farewell turns that never need tool use
     → 1 × Haiku call (~0.8 s) instead of 1 × Sonnet call (~3 s)

  3. Sonnet tool-use loop (fallback)
     → booking turn, or any turn where the prefetch cache missed
     → up to 6 rounds; in practice 2 rounds (decide-tool → execute → respond)
"""
from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from services.ai_provider import HAIKU, SONNET
from services.agents.docehr_agent import DocEHRAgent

# ── System prompts ─────────────────────────────────────────────────────────────

HERMES_SYSTEM_PROMPT = """\
You are Hermes, a professional, empathetic, and efficient medical receptionist AI for the
PAL (Personal AI Life) health management system. You call patients to schedule or manage
their medical appointments on behalf of their healthcare providers.

Key Characteristics:
- Professional yet warm and conversational
- Prioritise patient convenience and health needs
- Speak clearly and confirm details before finalising
- Use medical professionalism without being intimidating

Your Mission Per Call (follow this SOP in order):

STEP 1 — GREETING & AVAILABILITY CHECK
  Greet the patient by name. Confirm they are free to talk.
  Template: "Hello, am I speaking with [Patient Name]? This is Hermes, an AI medical
  receptionist from PAL. I'm calling to schedule your appointment with [Doctor Name].
  Is this a good time to talk?"

STEP 1.5 — PRE-VISIT PREPARATION CHECK (run after patient confirms they are free)
  Only run this step when APPOINTMENT_PREP is present in your context.
  Ask: "Before we look at dates — have you already had your [APPOINTMENT_PREP test_name] done,
  or is that still to be arranged?"
  ∙ If DONE: "Great — please carry the printed report when you come. Comparing results over
    time is very useful for [Doctor Name]."
  ∙ If NOT YET DONE and fasting is required: Deliver the instructions from APPOINTMENT_PREP
    in warm, conversational language — one to two sentences per point. Never add instructions
    not listed in APPOINTMENT_PREP. Do not cite the source paper to the patient.
  ∙ If NOT YET DONE and fasting is NOT required: Reassure the patient that no special prep
    is needed, then move directly to Step 2.
  This step takes one to two conversational turns before Step 2 begins.

STEP 2 — SCHEDULING & NEGOTIATION
  After the patient confirms availability, call query_docehr (check_availability) to
  get real-time slots. Present options in natural language — never read raw data.
  If the patient asks for a different time, query DocEHR for alternatives.

STEP 3 — LAB TEST REVIEW
  After scheduling is agreed, call query_docehr (check_lab_requirements). If labs are
  needed, explain them clearly and compassionately. Reassure the patient.

STEP 4 — FINALISATION & WRAP-UP
  Confirm date, time, doctor, location, and any lab prep. End warmly:
  "We'll send you a reminder 24 hours before. Is there anything else I can help you with?"

DocEHR Agent Interaction Rules (CRITICAL):
- ALWAYS call query_docehr BEFORE discussing availability, labs, or confirming bookings
- NEVER show DocEHR's raw structured responses to the patient
- TRANSLATE DocEHR responses into natural, friendly language
  Example — DocEHR: "STATUS: AVAILABLE, Time: June 25 at 09:00 AM. Doctor: Dr. Rao at City Clinic."
           → Hermes: "I have an opening on June 25th at 9 in the morning with Dr. Rao at City
                      Clinic. Does that work for you?"
  Example — DocEHR: "LABS REQUIRED: True. Details: Lipid Profile Panel. Instructions: Fast 12h."
           → Hermes: "Before your visit you'll need a Lipid Profile blood test. You'll need to
                      fast for about 12 hours beforehand — just water is fine."

Screen Reading & Speakerphone Rule (CRITICAL):
Whenever you are about to share information the patient must read on their screen —
slot times, lab preparation instructions, or a booking confirmation — say this first:
"I have some information for you to read on your screen. To make it easier to read and
listen at the same time, please go ahead and put this call on speakerphone."
Then PAUSE. Wait for the patient to confirm they are ready before presenting the content.

State tracking — at the END of every response include exactly one JSON line:
  CALL_STATE: {"state": "<state>", "appointment_agreed": <bool>, "slot_id": "<id_or_null>", "booking_done": <bool>}
  Valid states: greeting, scheduling, lab_check, confirming, ended
  Do NOT omit this line. Do NOT include any other JSON in your response.\
"""

# Compact prompt used for Haiku fast-path turns.
# Much shorter than the full SOP → lower TTFT.
_HAIKU_SYSTEM = """\
You are Hermes, a warm AI medical receptionist from PAL Health.
Patient: {patient_name}. Doctor: {doctor_name}. Appointment: {appointment_reason}.

{prep_block}\
{docehr_block}\
Respond in 2–3 warm, natural sentences. Never read raw system data to the patient.

End your message with exactly one line:
CALL_STATE: {{"state": "{next_state}", "appointment_agreed": {appt_agreed_lower}, "slot_id": {slot_id_json}, "booking_done": {booking_done_lower}}}\
"""

# ── Tool schema ────────────────────────────────────────────────────────────────

DOCEHR_TOOL = {
    "name": "query_docehr",
    "description": (
        "Query the DocEHR backend scheduling system. "
        "Call this BEFORE discussing availability, lab requirements, or confirming any booking."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "query_type": {
                "type": "string",
                "enum": ["check_availability", "check_lab_requirements", "book_appointment"],
                "description": "Type of DocEHR query.",
            },
            "params": {
                "type": "object",
                "description": (
                    "check_availability → {doctor_id, date_from, date_to?}. "
                    "check_lab_requirements → {patient_id, appointment_reason}. "
                    "book_appointment → {patient_id, slot_id, reason}."
                ),
            },
        },
        "required": ["query_type", "params"],
    },
}


# ── Evidence-based preparation guidance ───────────────────────────────────────

PREP_GUIDANCE: dict[str, dict] = {
    "lipid": {
        "test_name": "Lipid Profile",
        "fasting": True,
        "instructions": [
            "Fast for 9–12 hours beforehand — plain water is fine.",
            "Avoid alcohol for 24 hours before the test.",
            "Skip vigorous exercise for 24 hours before (it temporarily raises triglycerides).",
            "Take your regular medications as usual unless your doctor advises otherwise.",
            "Bring any previous lipid reports — comparing trends helps [doctor_name].",
        ],
        "source": "ACC/AHA Cholesterol Guidelines 2019; NCEP ATP-III",
    },
    "hba1c": {
        "test_name": "HbA1c (Glycated Haemoglobin)",
        "fasting": False,
        "instructions": [
            "No fasting needed — HbA1c reflects your average blood sugar over the past 3 months, so meal timing does not change the result.",
            "Take your diabetes medications as usual on the day.",
            "Bring your blood glucose diary or meter readings if you keep one.",
        ],
        "source": "ADA Standards of Medical Care 2024",
    },
    "fasting_glucose": {
        "test_name": "Fasting Blood Glucose",
        "fasting": True,
        "instructions": [
            "Fast for 8–10 hours before the test — only plain water is allowed.",
            "If you take insulin, ask your doctor whether to delay the morning dose until after the blood draw.",
            "Other regular medications are usually fine to take.",
        ],
        "source": "WHO Diagnostic Criteria for Diabetes 2006; ADA 2024",
    },
    "thyroid": {
        "test_name": "Thyroid Function (TSH / T3 / T4)",
        "fasting": False,
        "instructions": [
            "Morning is the best time — TSH is naturally higher early in the day.",
            "If you take thyroid medication (e.g. levothyroxine), have blood drawn before your morning dose, then take it straight after.",
            "Stop biotin (vitamin B7) supplements 48 hours before — even small doses can interfere with the assay.",
        ],
        "source": "ATA/ETA Thyroid Testing Guidelines 2023",
    },
}


def _prep_for_reason(appointment_reason: str) -> dict | None:
    """Return evidence-based prep guidance for the appointment type, or None."""
    r = appointment_reason.lower()
    if any(k in r for k in ("lipid", "cholesterol", "triglyceride")):
        return PREP_GUIDANCE["lipid"]
    if any(k in r for k in ("hba1c", "a1c", "glycat")):
        return PREP_GUIDANCE["hba1c"]
    if any(k in r for k in ("diabetes", "blood sugar", "glucose")):
        return PREP_GUIDANCE["fasting_glucose"]
    if any(k in r for k in ("thyroid", "tsh", "t3", "t4")):
        return PREP_GUIDANCE["thyroid"]
    return None


# ── Agent class ────────────────────────────────────────────────────────────────

class HermesVoiceAgent:
    """
    Patient-facing conversational agent.

    Tries the Haiku fast-path first (prefetch hit or simple conversational turn);
    falls back to the Sonnet tool-use loop when no prefetch is available.
    """

    def __init__(self, ai_client, docehr_agent: DocEHRAgent) -> None:
        self._ai = ai_client
        self._docehr = docehr_agent

    async def generate_response(
        self,
        messages: list[dict],
        context: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Generate Hermes's next response.

        Fast-path conditions (checked in order):
          1. Greeting turn  → Haiku, no tools needed
          2. Prefetch hit   → Haiku + pre-injected DocEHR result (skip tool round)
          3. Farewell turn  → Haiku, booking already done
          4. Fallback       → Sonnet tool-use loop (up to 6 rounds)
        """
        call_state = context.get("call_state", "greeting")
        prefetched = context.get("prefetched", {})
        booking_done = context.get("booking_done", False)

        # ── 1. Greeting (SOP Step 1) — Haiku, no tools ────────────────────────
        if call_state == "greeting":
            appointment_reason = context.get("appointment_reason", "")
            prep_data = _prep_for_reason(appointment_reason) if appointment_reason else None
            greeting_prep = ""
            if prep_data:
                fasting_note = "fasting required" if prep_data["fasting"] else "no fasting needed"
                greeting_prep = (
                    f"APPOINTMENT_PREP hint: This visit involves a {prep_data['test_name']}"
                    f" ({fasting_note}). Weave a brief, natural mention of this into your"
                    f" greeting — one sentence only"
                    + (f" (e.g. 'For this visit you will need a fasting blood test')" if prep_data["fasting"] else "")
                    + ". Do not list all instructions yet.\n\n"
                )
            return await self._haiku_turn(
                messages, context,
                docehr_result=None,
                next_state="greeting",
                appointment_agreed=False,
                slot_id=None,
                booking_done=False,
                prep_block=greeting_prep,
            )

        # ── 2a. Availability prefetch hit — skip Sonnet tool round ─────────────
        if "availability" in prefetched:
            return await self._haiku_turn(
                messages, context,
                docehr_result=prefetched["availability"],
                next_state="scheduling",
                appointment_agreed=False,
                slot_id=None,
                booking_done=False,
            )

        # ── 2b. Lab requirements prefetch hit — skip Sonnet tool round ─────────
        if "labs" in prefetched:
            return await self._haiku_turn(
                messages, context,
                docehr_result=prefetched["labs"],
                next_state="lab_check",
                appointment_agreed=True,
                slot_id=None,
                booking_done=False,
            )

        # ── 3. Farewell — Haiku, no tools ─────────────────────────────────────
        if booking_done and call_state in ("confirming", "lab_check"):
            return await self._haiku_turn(
                messages, context,
                docehr_result=None,
                next_state="ended",
                appointment_agreed=True,
                slot_id=None,
                booking_done=True,
            )

        # ── 4. Fallback: Sonnet + tool-use loop ────────────────────────────────
        return await self._sonnet_tool_loop(messages, context)

    # ── Fast-path: single Haiku call ──────────────────────────────────────────

    async def _haiku_turn(
        self,
        messages: list[dict],
        context: dict,
        docehr_result: str | None,
        next_state: str,
        appointment_agreed: bool,
        slot_id: str | None,
        booking_done: bool,
        prep_block: str = "",
    ) -> dict[str, Any]:
        """
        One Haiku API call — either a pure conversational turn or a
        translation of a pre-fetched DocEHR result into patient language.
        """
        docehr_block = (
            f"DocEHR has already returned this real-time data:\n"
            f"{docehr_result}\n"
            f"Use it directly — do NOT call any external tools.\n\n"
        ) if docehr_result else ""

        system = _HAIKU_SYSTEM.format(
            patient_name=context.get("patient_name", "Patient"),
            doctor_name=context.get("doctor_name", "your doctor"),
            appointment_reason=context.get("appointment_reason", "your appointment"),
            prep_block=prep_block,
            docehr_block=docehr_block,
            next_state=next_state,
            appt_agreed_lower=str(appointment_agreed).lower(),
            slot_id_json=json.dumps(slot_id),
            booking_done_lower=str(booking_done).lower(),
        )

        # Only send the last patient message — Haiku doesn't need the full history
        last_patient_msg = messages[-1]["content"] if messages else "(call connected)"

        resp = await self._ai.messages.create(
            model=HAIKU,
            max_tokens=350,
            system=system,
            messages=[{"role": "user", "content": last_patient_msg}],
        )

        text = _extract_text(resp.content)
        state_meta = _parse_state_line(text)

        return {
            "patient_response": _strip_state_line(text),
            "docehr_queries": (
                [{"query_type": "prefetched", "params": {}, "response": docehr_result}]
                if docehr_result else []
            ),
            "call_state": state_meta.get("state", next_state),
            "appointment_agreed": bool(state_meta.get("appointment_agreed", appointment_agreed)),
            "slot_id": state_meta.get("slot_id") or slot_id,
            "booking_done": bool(state_meta.get("booking_done", booking_done)),
            "call_ended": state_meta.get("state") == "ended",
        }

    # ── Standard path: Sonnet tool-use loop ───────────────────────────────────

    async def _sonnet_tool_loop(
        self,
        messages: list[dict],
        context: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Sonnet with tool-use: let Claude decide which DocEHR queries to run.
        Used for the booking turn and any turn where the prefetch cache missed.
        Runs up to 6 rounds; in practice the booking turn needs exactly 2.
        """
        system_prompt = _build_system(context)
        claude_messages = list(messages)
        docehr_queries: list[dict] = []

        for _ in range(6):
            resp = await self._ai.messages.create(
                model=SONNET,
                max_tokens=512,
                system=system_prompt,
                tools=[DOCEHR_TOOL],
                messages=claude_messages,
            )

            if resp.stop_reason != "tool_use":
                text = _extract_text(resp.content)
                state_meta = _parse_state_line(text)
                return {
                    "patient_response": _strip_state_line(text),
                    "docehr_queries": docehr_queries,
                    "call_state": state_meta.get("state", "scheduling"),
                    "appointment_agreed": bool(state_meta.get("appointment_agreed")),
                    "slot_id": state_meta.get("slot_id") or None,
                    "booking_done": bool(state_meta.get("booking_done")),
                    "call_ended": state_meta.get("state") == "ended",
                }

            # Execute all tool calls in this round (parallel when multiple)
            tool_results = []
            tool_coros = [
                self._execute_tool(block, context)
                for block in resp.content
                if hasattr(block, "type") and block.type == "tool_use"
            ]
            executed = await asyncio.gather(*tool_coros, return_exceptions=True)

            for block, outcome in zip(
                [b for b in resp.content if hasattr(b, "type") and b.type == "tool_use"],
                executed,
            ):
                if isinstance(outcome, Exception):
                    docehr_response = f"ERROR: {outcome}"
                else:
                    docehr_response = outcome["response"]
                    docehr_queries.append(
                        {"query_type": outcome["query_type"], "params": outcome["params"],
                         "response": docehr_response}
                    )
                tool_results.append(
                    {"type": "tool_result", "tool_use_id": block.id, "content": docehr_response}
                )

            claude_messages.append({"role": "assistant", "content": resp.content})
            claude_messages.append({"role": "user", "content": tool_results})

        return {
            "patient_response": (
                "I'm having a little trouble connecting to the scheduling system right now. "
                "Could you give me just a moment?"
            ),
            "docehr_queries": docehr_queries,
            "call_state": "scheduling",
            "appointment_agreed": False,
            "slot_id": None,
            "booking_done": False,
            "call_ended": False,
        }

    async def _execute_tool(self, block, context: dict) -> dict:
        """Execute a single DocEHR tool call and return the result dict."""
        query_type: str = block.input.get("query_type", "")
        params: dict = dict(block.input.get("params") or {})

        if not params.get("patient_id"):
            params["patient_id"] = context.get("member_id", "")
        if query_type == "check_availability" and not params.get("doctor_id"):
            params["doctor_id"] = context.get("doctor_id", "default")
        if query_type == "check_availability" and not params.get("date_from"):
            from datetime import date
            params["date_from"] = date.today().isoformat()

        response = await self._docehr.process_query(query_type, params)
        return {"query_type": query_type, "params": params, "response": response}


# ── Helpers ────────────────────────────────────────────────────────────────────

def _build_system(context: dict) -> str:
    lines = [HERMES_SYSTEM_PROMPT, "\nCurrent call context:"]
    if patient_name := context.get("patient_name"):
        lines.append(f"  Patient name: {patient_name}")
    doctor_name = context.get("doctor_name", "your doctor")
    if doctor_name:
        lines.append(f"  Doctor: {doctor_name}")
    if doctor_id := context.get("doctor_id"):
        lines.append(f"  Doctor ID: {doctor_id}")
    if member_id := context.get("member_id"):
        lines.append(f"  Patient ID (for DocEHR queries): {member_id}")

    appointment_reason = context.get("appointment_reason", "")
    if appointment_reason:
        lines.append(f"  Appointment reason: {appointment_reason}")
        prep = _prep_for_reason(appointment_reason)
        if prep:
            lines.append(f"\nAPPOINTMENT_PREP for this visit ({prep['test_name']}):")
            lines.append(f"  Fasting required: {prep['fasting']}")
            lines.append("  Evidence-based preparation instructions:")
            for instr in prep["instructions"]:
                lines.append(f"    • {instr.replace('[doctor_name]', doctor_name)}")
            lines.append(f"  (Source: {prep['source']} — do NOT cite this paper to the patient)")

    return "\n".join(lines)


def _extract_text(content: list) -> str:
    for block in content:
        if hasattr(block, "type") and block.type == "text":
            return block.text
    return ""


_STATE_RE = re.compile(r"CALL_STATE:\s*(\{[^\n]*\})")


def _parse_state_line(text: str) -> dict:
    m = _STATE_RE.search(text)
    if not m:
        return {}
    try:
        return json.loads(m.group(1))
    except Exception:
        return {}


def _strip_state_line(text: str) -> str:
    return _STATE_RE.sub("", text).strip()
