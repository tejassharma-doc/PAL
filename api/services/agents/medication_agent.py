"""
Medication & Adherence Agent — clinical reasoning in cloud (Claude only).
Proposes follow-ups; scheduling requires a confirm token.
"""
import json
from typing import Optional

from services.ai_provider import model_for_agent, multilingual_suffix


MEDICATION_SYSTEM = """You are a medication and adherence specialist assistant in PAL.
You review medication lists and answer questions about medications, interactions, and adherence.

Rules:
- Clinical reasoning only via cloud (this is correct by design).
- Never prescribe or change medications. Explain and inform only.
- For drug interactions: state known interactions factually with evidence class.
- If adherence follow-up scheduling is needed, propose it — but never auto-book.
- Evidence contract: classify every claim (source_backed | inferred | statistical | unknown).
- "No good evidence found" when evidence is absent; never confabulate.
- Format: JSON response."""


async def _call_claude(
    ai_client, query: str, record_context: Optional[dict],
    conversation_history:str = "",is_second_opinion: bool = False, multilingual_lang: Optional[str] = None,
) -> str:
    context_section = ""
    if record_context:
        meds = [f for f in record_context.get("facts", []) if f.get("type") == "medication"]
        if meds:
            context_section = f"\nPatient's current medications (retrieved slice):\n{json.dumps(meds, indent=2)}"

    history_section = ""
    if conversation_history:
        history_section = f"\n**Previous conversation:**\n{conversation_history}\n\nUse this context to understand what the patient is asking about or confirming.\n"

    system = MEDICATION_SYSTEM + multilingual_suffix(multilingual_lang)
    response = await ai_client.messages.create(
        model=model_for_agent("medication", is_second_opinion),
        max_tokens=1024,
        system=system,
        messages=[{
            "role": "user",
            "content": f"{history_section}Query: {query}{context_section}\n\nRespond with JSON: {{\"analysis\": \"...\", \"evidence_class\": \"...\", \"citations\": [], \"proposed_actions\": [], \"warnings\": []}}",
        }],
    )
    return response.content[0].text if response.content else "{}"


class MedicationAgent:
    name = "medication"

    def __init__(self, ai_client):
        self.ai_client = ai_client

    async def run(
        self, query: str, record_context: Optional[dict] = None,
        conversation_history:str = "",is_second_opinion: bool = False, multilingual_lang: Optional[str] = None,
    ) -> dict:
        raw = await _call_claude(self.ai_client, query, record_context, conversation_history, is_second_opinion, multilingual_lang)
        try:
            start = raw.find("{")
            end = raw.rfind("}") + 1
            parsed = json.loads(raw[start:end])
        except Exception:
            parsed = {"analysis": raw, "evidence_class": "unknown", "citations": [], "proposed_actions": [], "warnings": []}

        return {"agent": self.name, "output": parsed}
