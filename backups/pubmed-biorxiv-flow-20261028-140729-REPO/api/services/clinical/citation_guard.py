"""
Post-generation citation validation.

The rule: a sentence carrying a clinical claim may cite only
`clinician-canonical` or `peer-reviewed-human`. A pharmacy listing can support
a price, a pack size or a brand name, and nothing else.

This runs AFTER the synthesizer, because a prompt instruction is not an
enforcement mechanism. SYNTHESIZER_SYSTEM already says "never confabulate" and
"say no good evidence found" — this checks whether that held.

Claim detection is a heuristic over cue words and is deliberately biased
toward false positives: a flagged sentence costs one regeneration, a missed
one ships a pharmacy page as clinical evidence. The cue lists are the part to
review with a clinician; the code around them is not the interesting bit.

Dependency-free: stdlib only.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .provenance import may_support_clinical_claim

__all__ = [
    "Cue",
    "CLAIM_CUE_TABLE",
    "LABEL_STATEMENT_CUE_TABLE",
    "is_label_statement",
    "RANKING_CUE_TABLE",
    "Violation",
    "GuardResult",
    "validate_citations",
    "build_repair_instruction",
    "CLAIM_CUES",
    "RANKING_CUES",
]

@dataclass(frozen=True)
class Cue:
    """
    A cue, its plain-English meaning, and an example that trips it.

    Structured this way so the list can be printed for clinical review without
    anyone reading Python: `python scripts/review_claim_cues.py`. The cues are
    the reviewable artefact — the matching code around them is not the
    interesting part, and a clinician's judgement about which sentences are
    clinical claims is worth more than any amount of regex tuning.
    """
    pattern: str
    gloss: str
    example: str

    def compiled(self) -> re.Pattern:
        return re.compile(self.pattern, re.IGNORECASE)


#: Sentences that assert something clinical. Must cite a human study or a
#: clinician-authored record. Biased toward false positives on purpose: a
#: flagged sentence costs one regeneration, a missed one ships a pharmacy page
#: as clinical evidence.
CLAIM_CUE_TABLE = [
    Cue(r"\b\d+\s?(mg|mcg|µg|g|ml|iu|units?)\b",
        "A dose or quantity with units",
        "Take 500 mg twice daily."),
    Cue(r"\b(dose|dosage|dosing|titrat|regimen)\w*",
        "Anything about how much or how often",
        "The usual dosage is increased weekly."),
    Cue(r"\b(treats?|treatment|therapy|manages?|management)\b",
        "A claim that something treats or manages a condition",
        "Metformin treats type 2 diabetes."),
    Cue(r"\b(indicated|contraindicat|prescrib)\w*",
        "Indication, contraindication or prescribing statement",
        "It is contraindicated in renal impairment."),
    Cue(r"\b(efficacy|effective(ness)?|works for|reduces?|lowers?|improves?|prevents?|cures?)\b",
        "A claim that something works, or by how much",
        "It lowers HbA1c by around 1%."),
    Cue(r"\b(side[- ]effects?|adverse|interactions?|toxicit)\w*",
        "Harms, adverse effects or interactions",
        "Common side effects include nausea."),
    Cue(r"\bshould (take|use|start|stop|avoid)\b",
        "An instruction to the patient",
        "You should avoid alcohol with this."),
    Cue(r"\b(risk of|increases? the risk|associated with)\b",
        "A risk or association claim",
        "It is associated with vitamin B12 deficiency."),
    Cue(r"\b(safe|unsafe|safety) (in|for|during)\b",
        "A safety claim about a group or situation",
        "It is safe in pregnancy."),
]

#: Sentences that rank or recommend. Refused regardless of citation quality —
#: choosing between medicines is a prescription however it is phrased.
RANKING_CUE_TABLE = [
    Cue(r"\b(better|best|worse|worst|superior|preferable|more effective) than\b",
        "One option ranked above another",
        "Glycomet is better than Glucophage."),
    # "I would recommend" slipped past the original pattern, which required
    # the verb to sit immediately after the pronoun. Found by
    # scripts/review_claim_cues.py --measure, which is the point of having it.
    Cue(r"\b(i|we|you)\b[^.]{0,12}\b(recommend|suggest|prefer|advise|would go with)\b",
        "A direct recommendation",
        "I would recommend the cheaper one."),
    Cue(r"\bthe best (option|choice|medicine|drug|brand)\b",
        "A superlative choice",
        "That is the best option for you."),
]

#: The narrow exemption, and the reason it has to exist.
#:
#: Found by role-playing a patient conversation through the shipped code. The
#: drug route's whole purpose is to state what a label says — and the guard
#: refused it:
#:
#:     "Glycomet 500 contains metformin hydrochloride 500mg[1]."  -> REFUSED
#:
#: The units cue fired on "500mg" and there is no human study behind a
#: composition, because a composition is not a finding — it is what is printed
#: on the strip. Left alone, the synthesiser could never state the contents of
#: the card sitting next to it, and the display-versus-cite distinction the
#: whole design rests on would collapse in production.
#:
#: The exemption is deliberately hard to reach. A sentence qualifies only if
#: it says one of these things AND the units cue is the ONLY claim cue it
#: triggers. "Take 500mg twice daily" triggers the dose cue as well and is
#: refused; so is anything touching efficacy, risk, harms or indication.
LABEL_STATEMENT_CUE_TABLE = [
    Cue(r"\bcontains?\b", "States what is in the product",
        "Glycomet 500 contains metformin hydrochloride 500mg."),
    Cue(r"\bcomposition\b", "Names the composition field",
        "Its composition is pantoprazole 40mg."),
    Cue(r"\beach\s+(tablet|capsule|sachet|strip|ml|dose)\b", "Per-unit content",
        "Each tablet contains 500mg."),
    Cue(r"\b(manufactured|marketed)\s+by\b", "Who makes it",
        "It is marketed by USV Private Limited."),
    Cue(r"\b(available|supplied|sold)\s+(as|in)\b", "Pack or form",
        "It is available as a strip of 10 tablets."),
    Cue(r"\bpack\s+of\b", "Pack size", "A pack of 15 tablets."),
    Cue(r"\bprescription[- ]only\b", "Prescription status",
        "It is a prescription-only medicine."),
]

#: Instruction language. Its presence cancels the exemption outright, because
#: this is the difference between "contains 500mg" and "take 500mg".
_DOSE_INSTRUCTION = re.compile(
    r"\b(take|takes|taking|give|gives|giving|swallow|administer|use)\b"
    r"|\b(daily|twice|thrice|once a day|per day|times a day|every \d+ hours|"
    r"morning|night|bedtime|before|after) (a )?(day|meal|food)?\b"
    r"|\b(dose|dosage|dosing|regimen|titrat)\w*",
    re.IGNORECASE,
)

#: The one cue the exemption may cancel. Everything else in the table stands.
_UNITS_CUE_PATTERN = CLAIM_CUE_TABLE[0].pattern

CLAIM_CUES = [c.compiled() for c in CLAIM_CUE_TABLE]
LABEL_STATEMENT_CUES = [c.compiled() for c in LABEL_STATEMENT_CUE_TABLE]
RANKING_CUES = [c.compiled() for c in RANKING_CUE_TABLE]

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])(?:\[\d+\])*\s+(?=[A-Z0-9\"'(])")
_CITATION = re.compile(r"\[(\d+)\]")


@dataclass
class Violation:
    kind: str  # "unsupported_clinical_claim" | "ranking"
    sentence: str
    cited_classes: list[str] = field(default_factory=list)


@dataclass
class GuardResult:
    ok: bool
    violations: list[Violation] = field(default_factory=list)


def _classes_for(sentence: str, citations: list[dict]) -> list[str]:
    classes: list[str] = []
    for marker in _CITATION.findall(sentence):
        index = int(marker) - 1
        if 0 <= index < len(citations):
            value = citations[index].get("provenance_class")
            if value:
                classes.append(value)
    return classes


def is_label_statement(sentence: str, fired: list) -> bool:
    """
    True when the sentence only states what is printed on the pack.

    Three conditions, all required:
      - the units cue is the ONLY claim cue that fired,
      - the sentence says one of the label things (contains, composition,
        each tablet, marketed by, pack of, prescription-only),
      - and it carries no instruction language.

    Anything about whether it works, who it is for, what it does to you, or
    how much to take fails at the first condition and never reaches the rest.
    """
    if len(fired) != 1 or fired[0].pattern != _UNITS_CUE_PATTERN:
        return False
    if _DOSE_INSTRUCTION.search(sentence):
        return False
    return any(cue.search(sentence) for cue in LABEL_STATEMENT_CUES)


def validate_citations(answer_text: str, citations: list[dict]) -> GuardResult:
    """
    `citations` must be in the order the synthesizer was given them, because
    the [n] markers index into that list.
    """
    violations: list[Violation] = []

    for sentence in (s.strip() for s in _SENTENCE_SPLIT.split(answer_text or "")):
        if not sentence:
            continue

        classes = _classes_for(sentence, citations)

        if any(cue.search(sentence) for cue in RANKING_CUES):
            violations.append(Violation("ranking", sentence, classes))
            continue

        fired = [cue for cue in CLAIM_CUES if cue.search(sentence)]
        if not fired:
            continue

        if classes and is_label_statement(sentence, fired):
            # What the strip says, not what the literature found. A pharmacy
            # listing is the right source for this and the only one there is.
            #
            # `classes` must be non-empty: the exemption relaxes WHICH source
            # may support a label statement, never whether one is needed. An
            # uncited composition is still an unattributed claim, and every
            # card carries its attribution as a required display field.
            continue

        # A claim with no citation at all is as unsupported as one citing a
        # pharmacy page.
        if not any(may_support_clinical_claim(c) for c in classes):
            violations.append(
                Violation("unsupported_clinical_claim", sentence, classes)
            )

    return GuardResult(ok=not violations, violations=violations)


def build_repair_instruction(result: GuardResult) -> str:
    """
    Fed back for one regeneration. Naming the offending sentences works far
    better than restating a rule the synthesizer already had.
    """
    claims = [v for v in result.violations if v.kind == "unsupported_clinical_claim"]
    rankings = [v for v in result.violations if v.kind == "ranking"]
    parts: list[str] = []

    if claims:
        listed = "\n".join(f'- "{v.sentence}"' for v in claims)
        parts.append(
            "These sentences make a clinical claim without citing a human study "
            "or a clinician-authored record. Either cite a source of class "
            "peer-reviewed-human or clinician-canonical, or remove the claim:\n"
            f"{listed}"
        )

    if rankings:
        listed = "\n".join(f'- "{v.sentence}"' for v in rankings)
        parts.append(
            "These sentences rank or recommend one option over another. Describe "
            "each option without ranking them, and direct the reader to their "
            f"doctor for the choice:\n{listed}"
        )

    return "\n\n".join(parts)
