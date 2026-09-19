#!/usr/bin/env python3
"""
Replay a patient conversation through the real code and print what happens.

    python scripts/walkthrough.py            # recorded pharmacy pages, no network
    python scripts/walkthrough.py --live     # real 1mg / PharmEasy / PubMed

Why this exists: the pipeline's safety argument is an ORDER — which stage runs
before which — and an order is much easier to check by watching it than by
reading about it. Every stage below is the shipped function, not a stand-in.
The only thing swapped out by default is the network, and `--live` swaps it
back.

Read the RESULT lines. A turn that ends in EXIT never reached a model.
"""
import argparse
import asyncio
import json
import sys
import textwrap
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.clinical import pubmed                                  # noqa: E402
from services.clinical.citation_guard import validate_citations       # noqa: E402
from services.clinical.drug_name_guard import guard_names             # noqa: E402
from services.clinical.drug_route import (                            # noqa: E402
    extract_brand_candidates,
    httpx_fetch,
    looks_like_a_medicine_question,
    lookup_drug_cards,
)
from services.clinical.retention import gate_turn                     # noqa: E402
from services.hermes.safety_triage import (                           # noqa: E402
    detect_prescribing_intent,
    is_short_circuit,
    keyword_safety_check,
)

# --- the conversation -------------------------------------------------------
# A patient in the Gujarat cohort: newly diagnosed, given two medicines, asking
# the things people actually ask — including the three the system must refuse.

CONVERSATION = [
    "Namaste. My sugar has been high for a few months and my doctor says I have "
    "type 2 diabetes. What does that mean?",
    "What is Glycomet 500 that he gave me?",
    "Is Glycomet better than Glucophage?",
    "Can I switch from Glycomet to Glucophage?",
    "What should I take for my sugar?",
    "What is the medicine for the treatment of hypertension?",
    "side effects of Pan 40 tablet",
    "Hello sir, kindly tell me about Shelcal 500",
    "मुझे Glycomet के बारे में बताइए",
    "Does metformin help prediabetes?",
    "My chest is hurting and I can't breathe",
]

# --- recorded pages ---------------------------------------------------------
# Transcribed from the live sites. --live replaces this with the real network.

_PE_PRODUCTS = {
    "glycomet": {
        "name": "Glycomet 500Mg Strip Of 10 Tablets", "consumerBrandName": "GLYCOMET",
        "manufacturer": "USV PVT LTD", "drugStrengthValue": "500.0",
        "drugStrengthUnit": "mg", "dosageForm": "TABLET", "isRxRequired": True,
        "compositions": [{"name": "Metformin Hydrochloride(500.0 Mg)"}],
    },
    "pan": {
        "name": "Pan 40Mg Strip Of 15 Tablets", "consumerBrandName": "PAN",
        "manufacturer": "ALKEM LABORATORIES LTD", "drugStrengthValue": "40.0",
        "drugStrengthUnit": "mg", "dosageForm": "TABLET", "isRxRequired": True,
        "compositions": [{"name": "Pantoprazole(40.0 Mg)"}],
    },
    "shelcal": {
        "name": "Shelcal 500 Strip Of 15 Tablets", "consumerBrandName": "SHELCAL",
        "manufacturer": "TORRENT PHARMACEUTICALS LTD", "drugStrengthValue": "500.0",
        "drugStrengthUnit": "mg", "dosageForm": "TABLET", "isRxRequired": False,
        "compositions": [{"name": "Calcium Carbonate(500.0 Mg) + Vitamin D3(250.0 Iu)"}],
    },
}

_USES = {
    "glycomet": ("Treatment of type 2 diabetes mellitus; Lowering high blood glucose levels",
                 "Common side effects include nausea, vomiting, diarrhoea, and stomach pain."),
    "pan": ("Treatment of gastroesophageal reflux disease; Treatment of peptic ulcer disease",
            "Common side effects include diarrhoea, stomach pain, flatulence, and headache."),
    "shelcal": ("Treatment of calcium deficiency; Treatment of osteoporosis",
                "Common side effects include constipation, nausea, and stomach upset."),
}

#: Deliberately includes the substitutes both engines really return. If the
#: brand-match rule ever loosens, this walkthrough shows it immediately.
_PE_SEARCH = {
    "glycomet": ["glidum-mf-1mg-strip-of-10-tablets-4029494",
                 "glycomet-gp-1mg-strip-of-15-tablets-49203",
                 "glycomet-500mg-strip-of-10-tablets-49207"],
    "pan": ["pan-d-capsule-strip-of-15-capsules-30181",
            "pan-40mg-strip-of-15-tablets-28551"],
    "shelcal": ["shelcal-hd-strip-of-15-tablets-80122",
                "shelcal-500-strip-of-15-tablets-49118"],
}


def _fixture_fetch(url, headers=None):
    async def _run():
        key = next((k for k in _PE_PRODUCTS if k in url.lower()), None)
        if "/search/all" in url:
            if not key:
                return "<html></html>"
            links = "".join(
                f'<a href="/online-medicine-order/{s}">x</a>' for s in _PE_SEARCH[key]
            )
            return f"<html><body>{links}</body></html>"
        if "/online-medicine-order/" in url and key:
            uses, side = _USES[key]
            payload = {"props": {"pageProps": {"productDetails": _PE_PRODUCTS[key]}}}
            return (
                f"<html><body><h1>{_PE_PRODUCTS[key]['consumerBrandName']}</h1>"
                f"<h2>What are the uses of this tablet?</h2><p>{uses}</p>"
                f"<h2>Side effects of this tablet</h2><p>{side}</p>"
                '<script id="__NEXT_DATA__" type="application/json">'
                + json.dumps(payload) + "</script></body></html>"
            )
        raise LookupError("not in the recorded set")
    return _run()


# --- presentation -----------------------------------------------------------

W = 78


def rule(char="─"):
    print(char * W)


def patient(n, text):
    print()
    rule("═")
    print(f"PATIENT  turn {n}")
    for line in textwrap.wrap(text, W - 2):
        print(f"  {line}")
    rule()


def stage(name, detail=""):
    print(f"  [{name:<22}] {detail}")


def result(kind, detail):
    print(f"  {'>>> ' + kind:<26} {detail}")


def body(text, indent="      "):
    for line in textwrap.wrap(text, W - len(indent)):
        print(indent + line)


def card_view(card):
    print()
    print("      ┌" + "─" * (W - 8) + "┐")
    title = f"{card['brand']}  —  {card['source_name'] if 'source_name' in card else ''}".strip(" —")
    print(f"      │ {title[:W-10]:<{W-10}} │")
    print("      ├" + "─" * (W - 8) + "┤")
    for label, value in (
        ("Composition", card.get("composition")),
        ("Strength", card.get("strength")),
        ("Form", card.get("form")),
        ("Manufacturer", card.get("manufacturer")),
    ):
        if value:
            print(f"      │ {label:<13}{str(value)[:W-23]:<{W-23}} │")
    if card.get("badge"):
        print(f"      │ {'[' + card['badge'] + ']':<{W-10}} │")
    for label, items in (("Used for", card.get("uses")), ("Side effects", card.get("side_effects"))):
        if items:
            joined = ", ".join(items)
            first = True
            for line in textwrap.wrap(joined, W - 23):
                print(f"      │ {(label if first else ''):<13}{line:<{W-23}} │")
                first = False
    print("      ├" + "─" * (W - 8) + "┤")
    for line in textwrap.wrap(card["disclaimer"], W - 12):
        print(f"      │ {line:<{W-10}} │")
    for line in textwrap.wrap(card["attribution"], W - 10):
        print(f"      │ {line:<{W-10}} │")
    print("      └" + "─" * (W - 8) + "┘")
    print(f"      provenance: {card['provenance_class']}  —  displayable, never citable")
    print(f"      searched as {card['searched_as']!r}, matched listing {card['listed_as']!r}")


# --- one turn ---------------------------------------------------------------

async def run_turn(n, text, live):
    patient(n, text)

    # Stage 1 — deterministic safety triage, before any model
    safety = keyword_safety_check(text)
    stage("1  safety triage", safety)
    if is_short_circuit(safety):
        result("EXIT — " + safety.upper(), "urgent care / crisis response, no model consulted")
        body("Emergency and crisis are separated on purpose: sending someone in "
             "crisis to a booking calendar is its own kind of failure.")
        decision = gate_turn(query=text, answer_text="", conversation_id=None,
                             safety_category=safety)
        stage("retention", f"{decision.retention_class.value} — {decision.reason}")
        return

    # Stage 1b — prescribing intent
    prescribing = detect_prescribing_intent(text)
    stage("1b prescribing intent", str(prescribing))
    if prescribing:
        result("EXIT — REFERRAL", "answered by the doctor, not by PAL")
        body("That is a decision for your doctor, so I am not going to answer it. "
             "Which medicine is right for you depends on things I cannot see. "
             "I have kept this question so it comes up at your next appointment.")
        decision = gate_turn(query=text, answer_text="", conversation_id=None,
                             prescribing_intent=True)
        stage("retention", f"{decision.retention_class.value} — {decision.reason}")
        body(f"marker kept: {decision.marker_text!r}", "      ")
        return

    # Stage 4c — the drug route
    is_medicine = looks_like_a_medicine_question(text)
    stage("4c medicine question?", str(is_medicine))
    if is_medicine:
        candidates = extract_brand_candidates(text)
        stage("   candidates", candidates or "none — nothing is sent to a pharmacy")
        if candidates:
            allowed, rejected = guard_names(candidates, text)
            stage("   name guard", f"allowed={allowed} rejected={rejected}")
            cards = await lookup_drug_cards(
                text, fetch=httpx_fetch if live else _fixture_fetch
            )
            if cards:
                result("DRUG CARD", f"{len(cards)} card(s)")
                for card in cards:
                    card_view(card)
                return
            stage("   lookup", "no matching listing — answered without a card")

    # Stage 5/6 — evidence route
    stage("5  evidence route", "PubMed")
    term = pubmed.build_term(text, "humans")
    window = pubmed.date_window()
    stage("   term", term[:W - 30])
    stage("   window", f"{window['mindate']} → {window['maxdate']} (datetype={window['datetype']})")

    if live:
        articles = await pubmed.search_pubmed(text, max_results=4)
        stage("   retrieved", f"{len(articles)} article(s)")
        for a in articles:
            print(f"      {a.year}  {a.journal[:26]:26}  {a.title[:34]}")
            print(f"            human study: {a.is_human_study}   "
                  f"provenance: {a.to_citation()['provenance_class']}")
        if articles:
            oldest = min(x.year_int for x in articles if x.year_int)
            stage("   oldest year", f"{oldest} (floor {pubmed.get_config().min_year})")
    else:
        stage("   retrieved", "skipped — run with --live to query NCBI")

    result("ANSWER", "written by the synthesiser, then checked")
    decision = gate_turn(query=text, answer_text="an answer", conversation_id=None)
    stage("retention", f"{decision.retention_class.value} — {decision.reason}")


# --- the guard demonstration ------------------------------------------------

def citation_demo():
    print()
    rule("═")
    print("THE RULE THAT SEPARATES THE TWO ROUTES")
    rule()
    print("  The same card, used two ways. Only one is allowed.")

    card = {
        "title": "Glycomet — PharmEasy", "url": "https://pharmeasy.in/x",
        "provenance_class": "commercial", "phi": False,
    }
    study = {
        "title": "Metformin in prediabetes: a randomised trial",
        "url": "https://pubmed.ncbi.nlm.nih.gov/32995892/",
        "provenance_class": "peer-reviewed-human", "phi": False, "year_int": 2021,
    }

    for label, answer, sources in (
        ("DISPLAY  — what the label says",
         "Glycomet 500 contains metformin hydrochloride 500mg[1].", [card]),
        ("CITE     — a clinical claim, pharmacy only",
         "Metformin reduces HbA1c by about 1%[1].", [card]),
        ("CITE     — the same claim, human study",
         "Metformin reduces HbA1c by about 1%[1].", [study]),
    ):
        outcome = validate_citations(answer, sources)
        print()
        print(f"  {label}")
        print(f"    {answer}")
        if outcome.ok:
            print("    -> allowed")
        else:
            violation = outcome.violations[0]
            print(f"    -> REFUSED ({violation.kind})")
            print("       the synthesiser gets one repair pass; if the claim still")
            print("       has no human study behind it, the claim is cut.")


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true",
                        help="use the real pharmacies and the real PubMed")
    args = parser.parse_args()

    print()
    rule("═")
    print("PAL — walkthrough of one conversation, through the shipped code")
    rule("═")
    print(f"  network : {'LIVE' if args.live else 'recorded pages (use --live for the real thing)'}")
    print(f"  pubmed  : {pubmed.get_config().describe()}")
    print(f"  window  : {pubmed.date_window()['mindate']} onwards")

    for n, text in enumerate(CONVERSATION, 1):
        await run_turn(n, text, args.live)

    citation_demo()
    print()
    rule("═")
    print("  Turns that ended at EXIT never reached a model. That is the point of")
    print("  the ordering: a refusal that depends on a model choosing to refuse is")
    print("  not a refusal.")
    rule("═")
    print()


if __name__ == "__main__":
    asyncio.run(main())
