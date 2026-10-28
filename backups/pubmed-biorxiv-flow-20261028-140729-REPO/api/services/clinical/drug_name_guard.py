"""
The name-provenance guard.

The drug route runs one way: the patient supplies a name, the system explains
what it is. It never runs from a condition to a brand.

Three enforcement points, each failing closed:

  1. The lookup takes only names — no indication, condition or "for" field —
     so the model has nowhere to put the wrong question.
  2. `guard_names` matches every argument against the patient's raw words. A
     name the patient never typed is not looked up.
  3. `detect_prescribing_intent` short-circuits in the orchestrator before any
     agent runs, so on a "what should I take" turn the lookup never happens.

Point 2 is the one that matters. A schema constrains what the model can ASK;
this checks where the answer CAME FROM.

Dependency-free: stdlib only.
"""
from __future__ import annotations

import re
import unicodedata

__all__ = ["guard_names", "normalise_name"]

# Keep Devanagari (Hindi/Marathi) and Gujarati alongside ASCII, so a name typed
# in the patient's own script is matched rather than silently stripped to
# nothing and rejected.
_KEEP = re.compile(r"[^a-z0-9ऀ-ॿ઀-૿]+")


def normalise_name(value: str) -> str:
    """
    Fold to a comparable form, keeping Indic scripts.

    Digits are folded to ASCII as well. Python's `\d` is Unicode-aware, so a
    patient typing "Glycomet ५००" produced the digit run "५००", which shares
    nothing with the listing's "500" and scored zero — no card, for a
    correctly named medicine, in exactly the languages this is meant to serve.
    """
    text = unicodedata.normalize("NFKC", value).lower()
    text = "".join(
        str(unicodedata.digit(c)) if c.isdigit() and not c.isascii() else c
        for c in text
    )
    text = _KEEP.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()


def guard_names(names: list[str], turn_text: str) -> tuple[list[str], list[str]]:
    """
    Returns (allowed, rejected).

    A name survives only if it appears in the patient's own words. Compared on
    a normalised form so casing, punctuation and spacing do not matter — but
    nothing is inferred, expanded or spell-corrected, because that would
    reopen the path this guard exists to close.

    `turn_text` must be the patient's raw message. Never pass anything
    model-generated into it.
    """
    haystack = normalise_name(turn_text)
    allowed: list[str] = []
    rejected: list[str] = []

    for name in names:
        needle = normalise_name(name)
        if len(needle) >= 3 and needle in haystack:
            allowed.append(name.strip())
        else:
            rejected.append(name.strip())

    return allowed, rejected
