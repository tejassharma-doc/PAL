"""
Clinical layer for PAL.

Retrieval and provenance rules that sit between the agents and the answer:

    provenance.py       what kind of source a chunk came from, and therefore
                        what kind of sentence it may support
    sources.py          the journal/guideline/pharmacy allowlist
    pubmed.py           E-utilities with humans[MeSH Terms] and abstracts
    drug_name_guard.py  a medicine name must come from the patient's own words
    pharmacy_search.py  finding the product page for a brand the patient named
    drug_route.py       the drug route end to end: words in, label card out
    citation_guard.py   post-generation check that the citation rule held

Everything except pubmed.py is stdlib-only and importable without SQLAlchemy,
a database or a network — the same property safety_triage.py relies on, and
for the same reason: rules that are awkward to test stop being tested.
"""
from .provenance import (
    ProvenanceClass,
    CLINICAL_CLAIM_CLASSES,
    may_support_clinical_claim,
    context_contains_phi,
)
from .drug_name_guard import guard_names
from .pubmed import configure as configure_pubmed, get_config as pubmed_config
from .drug_route import lookup_drug_cards
from .citation_guard import validate_citations, build_repair_instruction, Violation

__all__ = [
    "ProvenanceClass",
    "CLINICAL_CLAIM_CLASSES",
    "may_support_clinical_claim",
    "context_contains_phi",
    "guard_names",
    "configure_pubmed",
    "pubmed_config",
    "lookup_drug_cards",
    "validate_citations",
    "build_repair_instruction",
    "Violation",
]
