"""Extract structured health facts from MDT's FHIR R4 Bundle output.

MDT returns an ABDM-compliant FHIR R4 Bundle containing:
  - Patient resource (name, DOB)
  - DiagnosticReport resource (report title, effective date)
  - Observation resources (LOINC-coded lab values with reference ranges)

parse_fhir_bundle() returns a FhirParseResult with everything we need for
patient verification and HealthFact persistence.
"""
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class ExtractedObservation:
    loinc_code: Optional[str]
    display: str
    value: Optional[str]
    unit: Optional[str]
    reference_range: Optional[str]
    recorded_at: Optional[datetime]


@dataclass
class FhirParseResult:
    patient_name: Optional[str]
    report_date: Optional[datetime]
    report_title: Optional[str]
    observations: list[ExtractedObservation] = field(default_factory=list)
    raw_bundle: dict = field(default_factory=dict)


def parse_fhir_bundle(bundle: dict) -> FhirParseResult:
    result = FhirParseResult(
        patient_name=None,
        report_date=None,
        report_title=None,
        raw_bundle=bundle,
    )

    for entry in bundle.get("entry", []):
        resource = entry.get("resource", {})
        rtype = resource.get("resourceType", "")

        if rtype == "Patient":
            names = resource.get("name", [])
            if names:
                n = names[0]
                given = " ".join(n.get("given", []))
                family = n.get("family", "")
                result.patient_name = f"{given} {family}".strip() or None

        elif rtype == "DiagnosticReport":
            codings = resource.get("code", {}).get("coding", [])
            result.report_title = (
                resource.get("code", {}).get("text")
                or (codings[0].get("display") if codings else None)
            )
            effective = resource.get("effectiveDateTime") or (
                resource.get("effectivePeriod", {}).get("start")
            )
            if effective:
                result.report_date = _parse_dt(effective)

        elif rtype == "Observation":
            result.observations.append(_parse_observation(resource))

    return result


def _parse_observation(resource: dict) -> ExtractedObservation:
    loinc_code = None
    display = resource.get("code", {}).get("text", "Unknown")

    for coding in resource.get("code", {}).get("coding", []):
        if coding.get("system") == "http://loinc.org":
            loinc_code = coding.get("code")
            display = coding.get("display") or display
            break

    value: Optional[str] = None
    unit: Optional[str] = None
    if "valueQuantity" in resource:
        qty = resource["valueQuantity"]
        value = str(qty.get("value", "")) if qty.get("value") is not None else None
        unit = qty.get("unit") or qty.get("code")
    elif "valueString" in resource:
        value = resource["valueString"]
    elif "valueCodeableConcept" in resource:
        value = resource["valueCodeableConcept"].get("text")

    ref_range: Optional[str] = None
    rr_list = resource.get("referenceRange", [])
    if rr_list:
        rr = rr_list[0]
        low = rr.get("low", {}).get("value")
        high = rr.get("high", {}).get("value")
        rr_unit = rr.get("low", {}).get("unit") or rr.get("high", {}).get("unit", "")
        if low is not None and high is not None:
            ref_range = f"{low}–{high} {rr_unit}".strip()
        elif rr.get("text"):
            ref_range = rr["text"]

    obs_date = _parse_dt(resource.get("effectiveDateTime", ""))

    return ExtractedObservation(
        loinc_code=loinc_code,
        display=display,
        value=value,
        unit=unit,
        reference_range=ref_range,
        recorded_at=obs_date,
    )


def _parse_dt(s: str) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
