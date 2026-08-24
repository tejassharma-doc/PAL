"""
AI Provider key resolution + model tier selection.
Operator key (institutional) → fallback → BYO key (self_hosted).
Key never logged, never returned, never echoed.
"""
from config import Settings

# Model IDs — update here when a new version ships
HAIKU = "claude-haiku-4-5-20251001"
SONNET = "claude-sonnet-4-6"

# Agents whose work involves clinical reasoning or evidence synthesis → always Sonnet.
# All others use Haiku by default (fast + cheap for routine routing turns).
_SONNET_AGENTS = {"medication", "evidence", "synthesizer"}

# BCP-47 → human-readable language name (used in multilingual system prompts)
LANG_NAMES: dict[str, str] = {
    "hi": "Hindi", "ta": "Tamil", "te": "Telugu", "kn": "Kannada",
    "ml": "Malayalam", "bn": "Bengali", "mr": "Marathi", "gu": "Gujarati",
    "pa": "Punjabi", "ur": "Urdu", "or": "Odia", "as": "Assamese",
    "ne": "Nepali", "si": "Sinhala",
}


def model_for_agent(agent: str, is_second_opinion: bool = False) -> str:
    """
    Return the appropriate Claude model ID for an agent.

    Tier rules (from spec):
    - Haiku: diet, appointment, records summarisation — fast, low-cost, not clinical.
    - Sonnet: medication interactions, evidence synthesis, synthesizer — clinical reasoning.
    - Second-opinion escalation always bumps to Sonnet regardless of agent.
    """
    if is_second_opinion or agent in _SONNET_AGENTS:
        return SONNET
    return HAIKU


def multilingual_suffix(lang: str | None) -> str:
    """
    Returns a system-prompt suffix instructing Claude to respond in the patient's language.
    Empty string when lang is None or 'en' (English — default, no instruction needed).
    """
    if not lang or lang == "en":
        return ""
    name = LANG_NAMES.get(lang, lang.upper())
    return f"\n\nIMPORTANT: The patient's query is in {name}. Respond entirely in {name}."


def get_ai_client(settings: Settings):
    """
    Returns an Anthropic async client configured with the correct key.
    Key resolution order:
      1. Operator key (if AI_KEY_MODE=operator and key is configured)
      2. BYO key (AI_KEY_MODE=byo or operator key missing)
    Never log the resolved key.
    """
    import anthropic

    if settings.ai_key_mode == "operator" and settings.operator_anthropic_api_key:
        api_key = settings.operator_anthropic_api_key
    elif settings.anthropic_api_key:
        api_key = settings.anthropic_api_key
    else:
        raise RuntimeError(
            "No AI API key configured. Set ANTHROPIC_API_KEY (BYO mode) "
            "or OPERATOR_ANTHROPIC_API_KEY (institutional mode)."
        )

    return anthropic.AsyncAnthropic(api_key=api_key)
