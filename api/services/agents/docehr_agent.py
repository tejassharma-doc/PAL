"""
DocEHR Agent — backend scheduling AI.

Three operating modes (priority order):
  1. MCP mode  — DOCEHR_MCP_URL set
                 DocEHR Agent becomes a Claude Haiku agent with the DocEHR MCP
                 server wired in natively via Anthropic's MCP client beta.
                 True A2A: Hermes (Sonnet/Haiku) → DocEHR Agent (Haiku+MCP)
                           → DocEHR MCP Server → real clinic EHR.

  2. REST mode — DOCEHR_ENABLED=true, DOCEHR_URL set
                 DocEHRClient makes HTTP calls to the DocEHR REST API.

  3. Stub mode — default (no env vars set)
                 Returns realistic in-memory mock data for development.

Called by HermesVoiceAgent during patient calls; never communicates with
patients directly — all responses are structured data consumed by Hermes.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from config import get_settings
from services.ai_provider import HAIKU
from services.docehr.docehr_client import DocEHRClient

DOCEHR_SYSTEM_PROMPT = """\
You are the DocEHR Agent, a backend medical scheduling AI embedded in the DocEHR
clinic management system. You manage doctor clinic calendars and patient records.

You communicate EXCLUSIVELY with the Hermes Voice Agent — another AI system.
You never interact with human patients.

Response formats (do not deviate):

Appointment availability:
  STATUS: AVAILABLE, Time: [datetime]. Doctor: [name] at [clinic]. Slot ID: [id].
  or
  STATUS: UNAVAILABLE. Nearest alternatives: [time1], [time2].

Lab test requirements:
  LABS REQUIRED: True/False. Details: [lab test name]. Instructions: [patient instructions].

Booking confirmation:
  ACTION COMPLETE: Appointment successfully booked for [datetime]. Reference: [ref]. EHR updated.

Always be fast, factual, and structured.\
"""


class DocEHRAgent:
    """
    Deterministic scheduling agent with optional Claude Haiku brain (MCP mode).

    In MCP mode the agent uses the Anthropic native MCP client to call the real
    DocEHR MCP server directly — no stub, no REST mapping needed.
    In REST / stub mode it falls back to DocEHRClient as before.
    """

    def __init__(
        self,
        docehr_client: DocEHRClient | None = None,
        ai_client=None,
    ) -> None:
        self._client = docehr_client or DocEHRClient()
        self._ai = ai_client
        settings = get_settings()
        self._mcp_url: str = settings.docehr_mcp_url

    # ── Public interface (called by HermesVoiceAgent tool-use loop) ────────────

    async def process_query(self, query_type: str, params: dict[str, Any]) -> str:
        """Route the query to the appropriate backend."""
        if self._mcp_url and self._ai:
            return await self._process_via_mcp(query_type, params)
        return await self._process_via_client(query_type, params)

    async def check_availability(
        self, doctor_id: str, date_from: str, date_to: str | None = None
    ) -> str:
        return await self.process_query(
            "check_availability",
            {"doctor_id": doctor_id, "date_from": date_from, "date_to": date_to},
        )

    async def check_lab_requirements(
        self, patient_id: str, appointment_reason: str = ""
    ) -> str:
        return await self.process_query(
            "check_lab_requirements",
            {"patient_id": patient_id, "appointment_reason": appointment_reason},
        )

    async def book_appointment(
        self, patient_id: str, slot_id: str, reason: str
    ) -> str:
        return await self.process_query(
            "book_appointment",
            {"patient_id": patient_id, "slot_id": slot_id, "reason": reason},
        )

    async def get_slots_json(self, doctor_id: str, date_from: str) -> list[dict]:
        """Return raw slot list for the frontend slot-picker."""
        try:
            date_to = (
                datetime.fromisoformat(date_from) + timedelta(days=7)
            ).date().isoformat()
        except ValueError:
            now = datetime.now(timezone.utc)
            date_from = now.date().isoformat()
            date_to = (now + timedelta(days=7)).date().isoformat()
        return await self._client.get_available_slots(
            doctor_id=doctor_id, date_from=date_from, date_to=date_to
        )

    # ── MCP path: Haiku agent with native DocEHR MCP tools ────────────────────

    async def _process_via_mcp(self, query_type: str, params: dict) -> str:
        """
        A2A via MCP: Claude Haiku receives the query from Hermes, calls the
        DocEHR MCP server's tools directly, and returns a structured response.

        Anthropic's native MCP client (betas=["mcp-client-2025-04-04"]) handles
        the MCP protocol — tool discovery, SSE transport, result extraction.
        No mcp Python package required.
        """
        user_msg = (
            f"Execute a DocEHR query.\n"
            f"Query type: {query_type}\n"
            f"Parameters: {json.dumps(params, default=str)}\n\n"
            f"Use the DocEHR MCP tools to fulfil this request, then respond in "
            f"the structured DocEHR format defined in your system prompt."
        )
        try:
            resp = await self._ai.beta.messages.create(
                model=HAIKU,
                max_tokens=300,
                betas=["mcp-client-2025-04-04"],
                mcp_servers=[
                    {
                        "type": "url",
                        "url": self._mcp_url,
                        "name": "docehr",
                    }
                ],
                system=DOCEHR_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_msg}],
            )
            text = _extract_text(resp.content)
            if text:
                return text
        except Exception as exc:
            # MCP server unreachable — fall through to REST/stub
            pass

        return await self._process_via_client(query_type, params)

    # ── REST / stub path (unchanged from before) ───────────────────────────────

    async def _process_via_client(self, query_type: str, params: dict) -> str:
        if query_type == "check_availability":
            return await self._check_availability_rest(
                doctor_id=params.get("doctor_id", "default"),
                date_from=params.get(
                    "date_from", datetime.now(timezone.utc).date().isoformat()
                ),
                date_to=params.get("date_to"),
            )
        if query_type == "check_lab_requirements":
            return await self._check_labs_rest(
                patient_id=params.get("patient_id", ""),
                appointment_reason=params.get("appointment_reason", ""),
            )
        if query_type == "book_appointment":
            return await self._book_rest(
                patient_id=params.get("patient_id", ""),
                slot_id=params.get("slot_id", ""),
                reason=params.get("reason", ""),
            )
        return f"ERROR: Unknown query type '{query_type}'."

    async def _check_availability_rest(
        self, doctor_id: str, date_from: str, date_to: str | None = None
    ) -> str:
        if not date_to:
            try:
                dt = datetime.fromisoformat(date_from)
                date_to = (dt + timedelta(days=7)).date().isoformat()
            except ValueError:
                now = datetime.now(timezone.utc)
                date_from = now.date().isoformat()
                date_to = (now + timedelta(days=7)).date().isoformat()

        slots = await self._client.get_available_slots(
            doctor_id=doctor_id, date_from=date_from, date_to=date_to
        )
        available = [s for s in slots if s.get("available")]

        if not available:
            return f"STATUS: UNAVAILABLE. No slots found between {date_from} and {date_to}."

        first = available[0]
        dt_str = _fmt_dt(first["datetime"])
        doctor = first.get("doctor_name", "the doctor")
        clinic = first.get("clinic", "the clinic")
        slot_id = first.get("slot_id", "")

        if len(available) > 1:
            alts = ", ".join(_fmt_dt(s["datetime"]) for s in available[1:3])
            return (
                f"STATUS: AVAILABLE, Time: {dt_str}. Doctor: {doctor} at {clinic}. "
                f"Slot ID: {slot_id}. Nearest alternatives: {alts}."
            )
        return (
            f"STATUS: AVAILABLE, Time: {dt_str}. Doctor: {doctor} at {clinic}. "
            f"Slot ID: {slot_id}."
        )

    async def _check_labs_rest(self, patient_id: str, appointment_reason: str) -> str:
        context = await self._client.get_patient_context(patient_id)
        upcoming = context.get("upcoming_appointments", [])
        labs = _infer_labs(appointment_reason, upcoming)

        if not labs:
            return (
                "LABS REQUIRED: False. Details: None. "
                "Instructions: No lab tests required for this appointment."
            )
        return (
            f"LABS REQUIRED: True. Details: {labs['name']}. "
            f"Instructions: {labs['instructions']}"
        )

    async def _book_rest(self, patient_id: str, slot_id: str, reason: str) -> str:
        booking = await self._client.book_appointment(
            patient_id=patient_id, slot_id=slot_id, reason=reason
        )
        dt_str = _fmt_dt(booking.get("datetime", ""))
        doctor = booking.get("doctor_name", "the doctor")
        clinic = booking.get("clinic", "the clinic")
        ref = booking.get("booking_ref", "")
        return (
            f"ACTION COMPLETE: Appointment successfully booked for {dt_str} "
            f"with {doctor} at {clinic}. Reference: {ref}. EHR updated."
        )


# ── Helpers ────────────────────────────────────────────────────────────────────

def _extract_text(content: list) -> str:
    for block in content:
        if hasattr(block, "type") and block.type == "text":
            return block.text
    return ""


def _fmt_dt(dt_str: str) -> str:
    try:
        dt = datetime.fromisoformat(dt_str)
        return dt.strftime("%B %d at %I:%M %p")
    except (ValueError, TypeError):
        return dt_str or "TBD"


def _infer_labs(reason: str, upcoming: list[dict]) -> dict | None:
    r = reason.lower()
    if any(kw in r for kw in ("lipid", "cholesterol", "cardio", "heart")):
        return {
            "name": "Lipid Profile Panel",
            "instructions": "Fast for 12 hours before the test. Avoid fatty foods the night before. Water is fine.",
        }
    if any(kw in r for kw in ("diabetes", "sugar", "glucose", "hba1c")):
        return {
            "name": "HbA1c + Fasting Blood Glucose",
            "instructions": "Fast for 8 hours before your appointment. You may take regular medications with water.",
        }
    if any(kw in r for kw in ("thyroid", "tsh")):
        return {
            "name": "Thyroid Function Panel (TSH, T3, T4)",
            "instructions": "No special preparation needed. Best done in the morning.",
        }
    if any(kw in r for kw in ("checkup", "check-up", "annual", "general", "routine")):
        return {
            "name": "Complete Blood Count (CBC) + Basic Metabolic Panel",
            "instructions": "Fast for 10–12 hours. Bring your current medication list.",
        }
    return None
