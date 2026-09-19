#!/usr/bin/env python3
"""
Print the citation guard's cue list for clinical review, and measure it.

The cue list decides which sentences the system treats as clinical claims, and
therefore which sentences must cite a human study. It is a judgement about
clinical language, not about code — so it should be reviewed by someone who
knows clinical language, without reading any Python.

    python scripts/review_claim_cues.py            # the table, as markdown
    python scripts/review_claim_cues.py --measure  # against the labelled set

The labelled set below is a starting point, not a corpus. Replace it with real
sentences from your own transcripts before trusting the numbers.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.clinical.citation_guard import (  # noqa: E402
    CLAIM_CUE_TABLE,
    RANKING_CUE_TABLE,
    validate_citations,
)

HUMAN_STUDY = [{"provenance_class": "peer-reviewed-human"}]
PHARMACY = [{"provenance_class": "commercial"}]

# (sentence, citations, should_be_flagged)
# Written to make the boundary visible: the pairs that differ only in what
# they cite, and the near-misses that must NOT trip.
LABELLED = [
    # Clinical claims, cited badly — must flag
    ("Metformin lowers HbA1c by about 1%[1].", PHARMACY, True),
    ("The usual starting dose is 500 mg twice daily[1].", PHARMACY, True),
    ("It is contraindicated in severe renal impairment[1].", PHARMACY, True),
    ("Common side effects include nausea and diarrhoea[1].", PHARMACY, True),
    ("Metformin lowers blood sugar.", PHARMACY, True),  # uncited
    # Same claims, cited well — must not flag
    ("Metformin lowers HbA1c by about 1%[1].", HUMAN_STUDY, False),
    ("The usual starting dose is 500 mg twice daily[1].", HUMAN_STUDY, False),
    ("Common side effects include nausea and diarrhoea[1].", HUMAN_STUDY, False),
    # Not clinical claims — must not flag even citing a pharmacy
    ("A strip of ten tablets costs about 25 rupees[1].", PHARMACY, False),
    ("Glycomet is manufactured by USV[1].", PHARMACY, False),
    ("It comes as a film-coated tablet[1].", PHARMACY, False),
    ("Your next appointment is on Tuesday[1].", PHARMACY, False),
    # Rankings — must flag whatever they cite
    ("Glycomet is better than Glucophage for most people[1].", HUMAN_STUDY, True),
    ("I would recommend the cheaper one[1].", HUMAN_STUDY, True),
    ("That is the best option for you[1].", HUMAN_STUDY, True),
]


def print_table() -> None:
    print("# Citation guard — cue list for clinical review\n")
    print("A sentence matching any CLAIM cue must cite a human study "
          "(`peer-reviewed-human`) or a clinician-authored record "
          "(`clinician-canonical`). Anything else is rewritten.\n")
    print("A sentence matching any RANKING cue is rewritten regardless of what "
          "it cites — choosing between medicines is a prescription however it "
          "is phrased.\n")
    print("For each row, the question for review is: **is this the right thing "
          "to treat as a clinical claim, and what is missing?**\n")

    for title, table in (("Clinical claim cues", CLAIM_CUE_TABLE),
                         ("Ranking cues", RANKING_CUE_TABLE)):
        print(f"\n## {title}\n")
        print("| What it catches | Example sentence that trips it |")
        print("| --- | --- |")
        for cue in table:
            print(f"| {cue.gloss} | {cue.example} |")

    print("\n## Known gaps\n")
    print("- English only. Nothing here fires on Hindi, Gujarati or any of the")
    print("  other five languages the router already handles.")
    print("- Numbers without units (\"HbA1c fell to 6.2\") are not caught.")
    print("- Hedged claims (\"may help with\") are not caught.")


def measure() -> int:
    tp = fp = tn = fn = 0
    mistakes = []

    for sentence, citations, should_flag in LABELLED:
        flagged = not validate_citations(sentence, citations).ok
        if flagged and should_flag:
            tp += 1
        elif flagged and not should_flag:
            fp += 1
            mistakes.append(("FALSE POSITIVE (costs a regeneration)", sentence))
        elif not flagged and should_flag:
            fn += 1
            mistakes.append(("FALSE NEGATIVE (ships unsupported)", sentence))
        else:
            tn += 1

    precision = tp / (tp + fp) if (tp + fp) else 1.0
    recall = tp / (tp + fn) if (tp + fn) else 1.0

    print(f"\nLabelled examples: {len(LABELLED)}")
    print(f"  caught correctly      {tp}")
    print(f"  correctly left alone  {tn}")
    print(f"  false positives       {fp}   (acceptable — one regeneration)")
    print(f"  false negatives       {fn}   (NOT acceptable — unsupported claim ships)")
    print(f"\n  precision {precision:.2f}   recall {recall:.2f}")

    if mistakes:
        print("\nMistakes:")
        for kind, sentence in mistakes:
            print(f"  {kind}\n    {sentence}")

    # Recall is the one that must hold. A false positive costs a regeneration;
    # a false negative ships a pharmacy page as clinical evidence.
    return 1 if fn else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--measure", action="store_true")
    args = parser.parse_args()
    if args.measure:
        raise SystemExit(measure())
    print_table()
