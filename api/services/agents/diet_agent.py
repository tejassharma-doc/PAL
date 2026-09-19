"""
Diet/Recipe Agent — integrates iNutriMon MCP. "Integrate, not rebuild."
"""
import json
from typing import Optional

from services.ai_provider import model_for_agent, multilingual_suffix


DIET_SYSTEM = """You are a dietary and nutrition assistant in PAL, powered by iNutriMon.
Provide evidence-based dietary guidance tailored to the patient's health context.

Rules:
- Base recommendations on current evidence; classify each fact (source_backed | statistical | inferred | unknown).
- When personal health data is available, personalize recommendations accordingly.
- Never diagnose. Never prescribe. Dietary guidance only.
- Cite evidence where possible; say "no good evidence" when absent.
- Format: JSON response."""


class DietAgent:
    name = "diet"

    def __init__(self, ai_client):
        self.ai_client = ai_client

    async def run(
        self, query: str, record_context: Optional[dict] = None,
        conversation_history:str = "", is_second_opinion: bool = False, multilingual_lang: Optional[str] = None,
    ) -> dict:
        context_section = ""
        if record_context:
            labs = [f for f in record_context.get("facts", []) if f.get("type") in ("lab", "vitals")]
            if labs:
                context_section = f"\nRelevant labs/vitals:\n{json.dumps(labs, indent=2)}"

        history_section = ""
        if conversation_history:
            history_section = f"\n**Previous conversation:**\n{conversation_history}\n\nUse this context to understand what dietary advice the patient is asking about or confirming.\n"

        system = DIET_SYSTEM + multilingual_suffix(multilingual_lang)
        response = await self.ai_client.messages.create(
            model=model_for_agent("diet", is_second_opinion),  # Haiku unless second opinion
            max_tokens=768,
            system=system,
            messages=[{
                "role": "user",
                "content": f"{history_section}Query: {query}{context_section}\n\nRespond with JSON: {{\"recommendations\": \"...\", \"recipes\": [], \"evidence_class\": \"...\", \"citations\": []}}",
            }],
        )
        raw = response.content[0].text if response.content else "{}"
        try:
            start = raw.find("{")
            end = raw.rfind("}") + 1
            parsed = json.loads(raw[start:end])
        except Exception:
            parsed = {"recommendations": raw, "recipes": [], "evidence_class": "unknown", "citations": []}

        return {"agent": self.name, "output": parsed}
