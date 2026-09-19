"""
Hermes Safety Triage — DETERMINISTIC, dependency-free.

Extracted from orchestrator.py so it can be imported and tested without
dragging in SQLAlchemy, the AI client, the cache or the PHI layer. Safety
triage is the one module that must be trivially testable; if running its
tests needs a database, they stop being run.

Nothing in this file imports anything outside the standard library. Keep it
that way.

Four categories, and they are not interchangeable:
    emergency → urgent-care guidance now. No booking card.
    crisis    → crisis resources. Never a booking card.
    urgent    → does NOT short-circuit; raises routing depth so the turn is
                answered with more evidence rather than less.
    routine   → normal pipeline.
"""
from __future__ import annotations

import re
import unicodedata

__all__ = [
    "keyword_safety_check",
    "detect_prescribing_intent",
    "merge_safety",
    "is_short_circuit",
    "normalise_query",
    "EMERGENCY_PATTERNS",
    "CRISIS_PATTERNS",
    "URGENT_PATTERNS",
    "PRESCRIBING_PATTERNS",
]


def normalise_query(query: str) -> str:
    """
    Lowercase and fold the punctuation that mobile keyboards produce.

    iOS and Android substitute a curly apostrophe (U+2019) as you type, so a
    patient typing "I can't breathe" on a phone produces "can’t breathe",
    which a plain "can't breathe" substring test does not match. Dashes are
    folded for the same reason ("self-harm" vs "self—harm").
    """
    text = unicodedata.normalize("NFKC", query).lower()
    text = text.replace("’", "'").replace("‘", "'")
    text = re.sub(r"[‐-―]", "-", text)
    text = re.sub(r"\s+", " ", text)
    return text


def _compile(patterns: list[str]) -> list[re.Pattern]:
    return [re.compile(p, re.IGNORECASE) for p in patterns]


# Life-threatening. Word-bounded so "stroke" does not fire on "heatstroke
# prevention" and contraction variants are all covered.
EMERGENCY_PATTERNS = _compile([
    # Cardiac
    r"\bchest (pain|tightness|pressure|heaviness)\b",
    r"\bheart attack\b",
    r"\bcardiac arrest\b",
    r"\bseene me dard\b",                      # hi (romanised)
    # Respiratory
    r"\b(can'?t|cannot|can not|unable to|couldn'?t) breathe\b",
    r"\b(difficulty|trouble|problem) (in )?breathing\b",
    r"\bbreathing (difficulty|problem|trouble)\b",
    r"\bgasping\b|\bchoking\b|\bsuffocat\w*",
    r"\bsaans (nahi|nai)\b",                   # hi (romanised)
    # Neurological — stroke signs in the words a patient actually uses.
    # The previous keyword set had only the literal word "stroke", so a
    # patient describing a stroke rather than naming it was routed as routine.
    r"\bstroke\b",
    r"\bseizure\b|\bconvulsion\w*|\bfit\s+(aa|pad)\w*",
    r"\bunconscious\b|\blost consciousness\b|\bpassed out\b|\bfainted\b",
    r"\b(face|mouth|lip|eye|arm|leg|one side)\w*\b[^.]{0,25}\bdroop\w*",
    r"\bdroop\w*\b[^.]{0,25}\b(face|mouth|lip|eye|arm|side)\b",
    # Both word orders. "his speech is slurred" is at least as common as
    # "slurred speech", and the one-directional pattern missed it — the same
    # class of bug as the fever rule that only matched "fever 104".
    r"\b(slurred|slurring)\b[^.]{0,15}\b(speech|words|speaking)\b",
    r"\b(speech|words|speaking)\b[^.]{0,15}\b(slurred|slurring)\b",
    r"\b(can'?t|cannot|can not|unable to|couldn'?t) (speak|talk)\b",
    r"\bsudden(ly)? (weak|weakness|numb|numbness|blind|blurred)\b",
    r"\b(weakness|numbness) (on |in )?one side\b",
    r"\bfacial (droop|weakness|palsy)\b",
    # Bleeding and trauma
    r"\b(severe|heavy|profuse|uncontrolled) bleeding\b",
    r"\bbleeding (heavily|a lot|non-?stop|uncontrollably)\b",
    r"\bcoughing (up )?blood\b|\bvomiting blood\b|\bblood in vomit\b",
    r"\bhead injury\b|\bskull fracture\b",
    r"\bsevere burn\w*",
    # Toxicological
    r"\boverdose\b|\bpoisoning\b|\bpoisoned\b",
    # Allergic
    r"\banaphyla\w*",
    r"\bthroat (closing|swelling|swollen)\b",
    r"\b(tongue|lips?) swell\w*",
    # Obstetric
    r"\bwater broke\b|\bwaters broke\b",
    # Paediatric
    r"\bhigh fever convulsion\b|\bfebrile (fit|convulsion|seizure)\b",
    r"\bbaby\b[^.]{0,20}\b(not breathing|blue|limp|unresponsive)\b",
])

CRISIS_PATTERNS = _compile([
    r"\bsuicid(e|al)\b",
    r"\bkill (myself|my self)\b",
    r"\bend (my life|it all)\b",
    r"\bself[\s-]?harm\w*",
    r"\bhurt myself\b",
    r"\bcut(ting)? myself\b",
    r"\bwant to die\b",
    r"\bdon'?t want to (live|be alive)\b",
    r"\bno reason to live\b|\bbetter off dead\b",
    r"\bkhudkushi\b|\batmahatya\b",            # hi (romanised)
])

# Raises depth. Never short-circuits.
#
# "severe pain" is deliberately absent from both this list and the emergency
# list: it fires on "severe period pain" and "severe back pain". A triage
# tuned only for recall refers every patient and stops being worth opening.
URGENT_PATTERNS = _compile([
    # Both word orders, both scales, and a bare number near a fever word.
    r"\b(fever|temperature|bukhar|taav)\b[^.]{0,15}\b(10[0-6](\.\d)?|4[01](\.\d)?)\b",
    r"\b(10[0-6](\.\d)?|4[01](\.\d)?)\s*(°|deg|degrees?)?\s*[fc]?\b[^.]{0,15}\b(fever|temperature)\b",
    r"\bhigh fever\b|\btez bukhar\b",
    r"\b(worst|severe|sudden) headache\b",
    r"\bpersistent vomiting\b|\bcan'?t keep (food|water|anything) down\b",
    r"\bsevere abdominal pain\b|\bsevere stomach pain\b",
    r"\bdehydrat\w*",
    r"\bnot passed urine\b|\bno urine\b",
])

# Not a safety category — a separate exit with its own destination. Naming a
# medicine is a question; asking which one to take is a prescription.
PRESCRIBING_PATTERNS = _compile([
    r"\bwhat (should|shall|can|do) i take\b",
    r"\bwhich (medicine|drug|tablet|brand|one) (is|should|would)\b",
    r"\bbest (medicine|drug|tablet|treatment) for\b",
    r"\b(is|are)\b[^.]{1,40}\bbetter than\b",
    r"\bshould i (take|start|stop|switch|increase|decrease|double|halve)\b",
    r"\bcan i stop\b|\bstop taking\b",
    # Substitution. Found by the drug route: "can I switch from Glycomet to
    # Glucophage" passed every pattern above and would have been answered with
    # two label cards side by side — a brand comparison in all but name.
    r"\b(can|may|could|shall) i (take|start|stop|switch|change|swap|replace|substitute)\b",
    r"\b(switch|swap|change|replace|substitute)\b[^.]{0,40}\b(from|with|to|instead of|for)\b[^.]{0,40}\b(tablet|medicine|drug|brand|it)?\b",
    r"\b(is|are)\b[^.]{1,40}\b(the same as|equivalent to|a substitute for|an alternative to|interchangeable with)\b",
    r"\bprescribe me\b|\bmujhe kya lena\b",
    r"\bhow (much|many)\b[^.]{0,20}\bshould i (take|have)\b",
])


def _matches(text: str, patterns: list[re.Pattern]) -> str | None:
    for p in patterns:
        if p.search(text):
            return p.pattern
    return None


def keyword_safety_check(query: str) -> str:
    """
    Fast deterministic safety triage. Runs before any model.

    Priority order matters: emergency beats crisis beats urgent. Returns one
    of "emergency" | "crisis" | "urgent" | "routine".
    """
    text = normalise_query(query)

    if _matches(text, EMERGENCY_PATTERNS):
        return "emergency"
    if _matches(text, CRISIS_PATTERNS):
        return "crisis"
    if _matches(text, URGENT_PATTERNS):
        return "urgent"
    return "routine"


def detect_prescribing_intent(query: str) -> bool:
    """True when the user is asking which medicine to take, or to change one."""
    return _matches(normalise_query(query), PRESCRIBING_PATTERNS) is not None


_SEVERITY = {"routine": 0, "urgent": 1, "crisis": 2, "emergency": 3}


def merge_safety(keyword_category: str, model_category: str) -> str:
    """
    The keyword scan always wins when it fired.

    A model confidence score must never be able to talk the system down from
    a keyword hit — that is the whole reason the keyword layer exists. The
    model may only escalate, by returning a more serious category when the
    keyword scan found nothing.
    """
    if keyword_category != "routine":
        return keyword_category
    if _SEVERITY.get(model_category, 0) > 0:
        return model_category
    return "routine"


def is_short_circuit(category: str) -> bool:
    """Emergency and crisis end the turn. Urgent does not."""
    return category in ("emergency", "crisis")
