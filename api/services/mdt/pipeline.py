"""Resilient document → structured-data pipeline.

Order of attempts:

  1. MDT directly (unchanged behaviour for printed docs — the common, cheap path).
  2. If MDT returns nothing usable AND handwriting transcription is enabled:
       a. Gemini Flash transcribes the original into clean text + a structured
          medication list.
       b. The text is rendered to a printed PDF and re-fed to MDT for structuring
          (MDT stays the authority when it can structure the content).
       c. If MDT *still* returns nothing (e.g. it does not structure prescriptions),
          Gemini's own structured medication list is used so the user always gets
          editable fields.

Handwritten results always carry needs_review=True. Nothing here writes to the
database; the caller persists after the user verifies/edits.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Optional

from services.mdt.client import MDTClient, is_empty_bundle
from services.mdt.fhir_parser import parse_fhir_bundle
from services.mdt.render import render_text_to_pdf
from services.mdt.transcriber import TranscriptionResult, transcribe_handwritten

logger = logging.getLogger("mdt.pipeline")

# extraction_method values
METHOD_DIRECT = "mdt_direct"
METHOD_FLASH_THEN_MDT = "flash_then_mdt"
METHOD_FLASH_ONLY = "flash_only"


@dataclass
class ExtractionOutcome:
    observations: list[dict] = field(default_factory=list)
    patient_name: Optional[str] = None
    doctor_name: Optional[str] = None
    clinic_name: Optional[str] = None
    report_title: Optional[str] = None
    report_date: Optional[str] = None       # ISO string
    fhir_bundle: dict = field(default_factory=dict)
    method: str = METHOD_DIRECT
    modality: str = "printed"               # printed | handwritten
    needs_review: bool = False
    mdt_discarded: bool = False
    confidence: Optional[float] = None
    transcription: Optional[TranscriptionResult] = None
    rendered_pdf: Optional[bytes] = None
    warnings: list[str] = field(default_factory=list)


def _obs_from_parsed(parsed) -> list[dict]:
    """FHIR observations → normalized, UI-ready dicts (with audit `original_display`)."""
    return [
        {
            "loinc_code": o.loinc_code,
            "display": o.display,
            "original_display": o.display,
            "edited": False,
            "value": o.value,
            "unit": o.unit,
            "reference_range": o.reference_range,
            "recorded_at": o.recorded_at.isoformat() if o.recorded_at else None,
            "dosage": None,
            "frequency": None,
            "duration": None,
            "instructions": None,
            "legible": True,
        }
        for o in parsed.observations
    ]


def _title_for(tx: TranscriptionResult) -> str:
    """Build a record title that carries the lab name (lab reports) or doctor
    name (prescriptions), as requested for the Records section."""
    if tx.doc_kind == "lab_report":
        return f"Lab Report · {tx.clinic_name}" if tx.clinic_name else "Lab Report"
    if tx.doc_kind == "prescription" or tx.medications:
        if tx.doctor_name:
            return f"Prescription · {tx.doctor_name}"
        if tx.clinic_name:
            return f"Prescription · {tx.clinic_name}"
        return "Prescription"
    return "Document"


def _obs_from_transcription(tx: TranscriptionResult) -> list[dict]:
    """Gemini medication + lab-value lists → normalized, UI-ready dicts."""
    out = []
    for m in tx.medications:
        out.append(
            {
                "loinc_code": None,
                "display": m.name,
                "original_display": m.name,
                "edited": False,
                "value": m.strength or m.dose,
                "unit": None,
                "reference_range": None,
                "recorded_at": None,
                "dosage": m.dose,
                "frequency": m.frequency,
                "duration": m.duration,
                "instructions": m.instructions,
                "legible": m.legible,
                # Normalized schedule for the reminder table.
                "times": m.times,
                "days_of_week": m.days_of_week,
                "duration_days": m.duration_days,
                "is_medication": True,
            }
        )
    for o in tx.observations:
        out.append(
            {
                "loinc_code": None,
                "display": o.name,
                "original_display": o.name,
                "edited": False,
                "value": o.value,
                "unit": o.unit,
                "reference_range": o.reference_range,
                "recorded_at": None,
                "dosage": None,
                "frequency": None,
                "duration": None,
                "instructions": None,
                "legible": o.legible,
            }
        )
    return out


async def extract_document(content: bytes, mime: str, settings) -> ExtractionOutcome:
    """Run the resilient extraction pipeline. Raises only on a hard MDT transport
    failure in the direct call (kept consistent with the previous behaviour, where
    the router catches MDT errors)."""
    client = MDTClient(
        settings.mdt_url,
        gemini_api_key=settings.gemini_api_key or None,
        model=settings.mdt_model,
    )

    # 1. Direct MDT (printed docs, and lets MDT errors propagate as before).
    bundle = await client.document_to_fhir(content, mime)
    if not is_empty_bundle(bundle):
        parsed = parse_fhir_bundle(bundle)
        return ExtractionOutcome(
            observations=_obs_from_parsed(parsed),
            patient_name=parsed.patient_name,
            report_title=parsed.report_title,
            report_date=parsed.report_date.isoformat() if parsed.report_date else None,
            fhir_bundle=bundle,
            method=METHOD_DIRECT,
            modality="printed",
            needs_review=False,
        )

    # MDT discarded the document (likely handwritten).
    if not settings.handwriting_transcription_enabled:
        return ExtractionOutcome(
            fhir_bundle=bundle or {},
            method=METHOD_DIRECT,
            modality="handwritten",
            needs_review=True,
            mdt_discarded=True,
            warnings=["MDT could not read this document and transcription is disabled."],
        )

    # 2a. Gemini Flash transcription.
    try:
        tx = await transcribe_handwritten(
            content,
            mime,
            api_key=settings.gemini_api_key,
            model=settings.handwriting_transcription_model,
            api_base=settings.gemini_api_base,
        )
    except Exception as exc:  # degrade gracefully — never crash the upload
        logger.warning("[pipeline] Transcription failed: %s", exc)
        return ExtractionOutcome(
            fhir_bundle={},
            method=METHOD_DIRECT,
            modality="handwritten",
            needs_review=True,
            mdt_discarded=True,
            warnings=[f"Automatic transcription failed: {exc}"],
        )

    low_conf = tx.confidence < settings.handwriting_min_confidence

    # Prescriptions use Gemini's structured medications directly — they carry the
    # dose schedule (times/days/duration) the reminder system needs, which MDT's
    # output would strip. Only lab reports benefit from the render → MDT round-trip
    # (MDT adds LOINC coding etc.).
    is_prescription = tx.doc_kind == "prescription" or (tx.medications and not tx.observations)

    # 2b. Render → re-feed MDT for lab reports (skip for prescriptions / low conf).
    rendered_pdf: Optional[bytes] = None
    if not low_conf and not is_prescription:
        try:
            rendered_pdf = render_text_to_pdf(tx)
            bundle2 = await client.document_to_fhir(rendered_pdf, "application/pdf")
            if not is_empty_bundle(bundle2):
                parsed2 = parse_fhir_bundle(bundle2)
                obs = _obs_from_parsed(parsed2)
                # Attach Gemini's medication detail where names line up, so the
                # user still sees dose/frequency even though MDT provided structure.
                # Prefer a title that names the lab/clinic, keeping MDT's panel name.
                _lab_title = " · ".join(
                    b for b in (tx.clinic_name, parsed2.report_title) if b
                ) or _title_for(tx)
                return ExtractionOutcome(
                    observations=obs,
                    patient_name=parsed2.patient_name or tx.patient_name,
                    doctor_name=tx.doctor_name,
                    clinic_name=tx.clinic_name,
                    report_title=_lab_title,
                    report_date=(
                        parsed2.report_date.isoformat() if parsed2.report_date else tx.report_date
                    ),
                    fhir_bundle=bundle2,
                    method=METHOD_FLASH_THEN_MDT,
                    modality="handwritten",
                    needs_review=True,
                    confidence=tx.confidence,
                    transcription=tx,
                    rendered_pdf=rendered_pdf,
                    warnings=tx.warnings,
                )
        except Exception as exc:
            logger.warning("[pipeline] Render/re-feed failed, using Flash structure: %s", exc)

    # 2c. Flash-only structured fallback (MDT still returned nothing, or low conf).
    # Always surface what Gemini extracted so the user can review/edit it; low
    # confidence is flagged, not blanked (the review + editable names handle it).
    observations = _obs_from_transcription(tx)
    warnings = list(tx.warnings)
    if low_conf:
        warnings.insert(
            0,
            "Low transcription confidence — please check every value carefully "
            "against the original document before saving.",
        )
    return ExtractionOutcome(
        observations=observations,
        patient_name=tx.patient_name,
        doctor_name=tx.doctor_name,
        clinic_name=tx.clinic_name,
        report_title=_title_for(tx),
        report_date=tx.report_date,
        fhir_bundle={},
        method=METHOD_FLASH_ONLY,
        modality="handwritten",
        needs_review=True,
        mdt_discarded=True,
        confidence=tx.confidence,
        transcription=tx,
        rendered_pdf=rendered_pdf,
        warnings=warnings,
    )
