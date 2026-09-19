"""Voice Worker Agent — simulates a clinic receptionist follow-up call via Claude Sonnet."""
import json
from typing import Optional

from ..ai_provider import SONNET, multilingual_suffix

VOICE_WORKER_SYSTEM = """You are a Voice Worker Agent acting as a Clinic Receptionist. \
You have been dispatched by Hermes AI to conduct a follow-up call.

Tone: Professional, empathetic, polite, patient, and highly efficient.

Simulate a realistic phone conversation following this 5-step protocol:

Step 1 — Availability Check (MANDATORY FIRST STEP)
- Greet the patient warmly by name.
- Ask if it is a good time to talk, or if they prefer a callback.
- If busy: acknowledge politely, ask for preferred callback time, end the call.
- If available: proceed to Step 2.

Step 2 — Introduction & Purpose
- State clearly that this is a follow-up call regarding their appointment with the doctor.

Step 3 — Scheduling Negotiation
- Ask when they would like to book the appointment.
- Cross-reference their preference against the available_slots provided.
- If requested slot is available: confirm and book it.
- If unavailable: suggest the nearest alternative and negotiate.

Step 4 — Lab Test Review (only if requires_lab_test is True)
- Inform the patient of the required tests.
- Instruct them to bring the physical report OR photograph it and upload it to the \
Records section of their app.

Step 5 — Wrap Up
- Summarise the agreed appointment date and time.
- Thank the patient, end the call politely.

After simulating the complete conversation, output ONLY a valid JSON object with this schema \
(no prose, no markdown fences):
{
  "transcript": "<full simulated dialogue as a string>",
  "call_status": "<one of: Booked | Call Back Requested | Unreachable | Refused>",
  "appointment_datetime": "<ISO 8601 datetime if Booked, else null>",
  "lab_report_status": "<one of: Acknowledged | Already Done | Questions Asked | N/A>",
  "extracted_lab_entities": ["<any lab results or details the patient mentioned>"]
}"""


class FollowUpVoiceAgent:
    def __init__(self, ai_client):
        self.ai_client = ai_client

    async def run(
        self,
        patient_name: str,
        patient_age: int,
        patient_language: str,
        doctor_name: str,
        requires_lab_test: bool,
        lab_test_details: Optional[str],
        available_slots: list[str],
    ) -> dict:
        lang_suffix = multilingual_suffix(patient_language)
        system = VOICE_WORKER_SYSTEM + lang_suffix

        context = (
            f"Patient Name: {patient_name}\n"
            f"Patient Age: {patient_age}\n"
            f"Language: {patient_language}\n"
            f"Doctor: {doctor_name}\n"
            f"Requires Lab Test: {requires_lab_test}\n"
            f"Lab Test Details: {lab_test_details or 'N/A'}\n"
            f"Available Slots: {json.dumps(available_slots)}\n\n"
            "Simulate the complete follow-up call and return the JSON result as instructed."
        )

        response = await self.ai_client.messages.create(
            model=SONNET,
            max_tokens=2048,
            system=system,
            messages=[{"role": "user", "content": context}],
        )

        raw = response.content[0].text.strip()

        # Strip markdown fences if model added them despite instructions
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.rsplit("```", 1)[0].strip()

        try:
            return json.loads(raw)
        except Exception:
            return {
                "transcript": raw,
                "call_status": "Unreachable",
                "appointment_datetime": None,
                "lab_report_status": "N/A",
                "extracted_lab_entities": [],
            }
