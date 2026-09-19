"""
Clinical provenance classes.

Distinct from PAL's existing `evidence_class` (source_backed | user_canonical |
inferred | statistical | unknown), which describes how well a claim is
supported. This describes WHAT KIND OF SOURCE it came from, and therefore what
kind of sentence that source is allowed to support.

Both are needed and they are not substitutes: a pharmacy listing can be
perfectly `source_backed` for a price and still must never support a dosing
statement.

Dependency-free by design — stdlib only, so it can be imported and tested
without SQLAlchemy, a database or a network.
"""
from __future__ import annotations

from enum import Enum

__all__ = [
    "ProvenanceClass",
    "CLINICAL_CLAIM_CLASSES",
    "may_support_clinical_claim",
    "context_contains_phi",
]


class ProvenanceClass(str, Enum):
    #: Care directives from DocEHR. The only class that may carry instruction.
    clinician_canonical = "clinician-canonical"
    #: PubMed results that passed the humans[MeSH Terms] filter.
    peer_reviewed_human = "peer-reviewed-human"
    #: Journal or preprint pages whose study type could not be established.
    peer_reviewed_other = "peer-reviewed-other"
    #: Medscape, BMJ Best Practice, guideline bodies. Background only.
    editorial_clinical = "editorial-clinical"
    #: Pharmacy listings. Brand, pack, schedule, price. Never pharmacology.
    commercial = "commercial"
    #: The patient's own record. Never cited outward, never leaves the host.
    patient_record = "patient-record"


#: The only classes a sentence carrying a clinical claim may cite.
CLINICAL_CLAIM_CLASSES: frozenset[str] = frozenset({
    ProvenanceClass.clinician_canonical.value,
    ProvenanceClass.peer_reviewed_human.value,
})


def may_support_clinical_claim(provenance_class: str | ProvenanceClass) -> bool:
    value = (
        provenance_class.value
        if isinstance(provenance_class, ProvenanceClass)
        else str(provenance_class)
    )
    return value in CLINICAL_CLAIM_CLASSES


def context_contains_phi(chunks: list[dict]) -> bool:
    """
    True when any source in the turn's context is patient-identifiable.

    Once the read path is a single pipeline rather than two subsystems, this
    is what the synthesis step keys on to decide which model may see the
    context: a self-hosted model when it returns True, the cloud model when it
    does not. Topology stops enforcing the boundary; this starts.
    """
    return any(
        c.get("phi") is True
        or c.get("provenance_class") == ProvenanceClass.patient_record.value
        for c in chunks
    )
