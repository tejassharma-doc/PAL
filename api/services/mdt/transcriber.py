"""Gemini Flash handwriting transcriber.

Used as a FALLBACK pre-processor when MDT discards a document as handwritten
(see services/mdt/pipeline.py). Gemini is asked to do two things on the original
image/PDF:

  1. Produce a faithful, verbatim transcription of the document as clean printed
     text (so it can be rendered to a PDF and re-fed to MDT).
  2. Extract a structured medication list, so that even if MDT still cannot
     structure the prescription, the user is given editable fields.

Hard rules baked into the prompt: never invent drug names or doses; mark anything
illegible as "[?]" and list it under `warnings`; report an honest confidence.

No Gemini SDK dependency — this calls the Generative Language REST API directly
with httpx (already a project dependency).
"""
from __future__ import annotations

import base64
import json
import logging
from dataclasses import dataclass, field
from typing import Optional

import httpx

logger = logging.getLogger("mdt.transcriber")


@dataclass
class TranscribedMedication:
    name: str
    strength: Optional[str] = None      # e.g. "0.5 mg"
    dose: Optional[str] = None          # e.g. "1 tablet"
    frequency: Optional[str] = None     # e.g. "twice daily"
    duration: Optional[str] = None      # e.g. "10 days"
    instructions: Optional[str] = None  # e.g. "after food"
    legible: bool = True
    # Normalized schedule for the reminder system.
    times: list = field(default_factory=list)          # ["08:00", "20:00"]
    days_of_week: list = field(default_factory=list)    # [0..6] Mon=0; [] = every day
    duration_days: Optional[int] = None                 # e.g. 28 for "4 weeks"


@dataclass
class TranscribedObservation:
    name: str                           # e.g. "Hemoglobin"
    value: Optional[str] = None         # e.g. "14.5"
    unit: Optional[str] = None          # e.g. "g/dL"
    reference_range: Optional[str] = None  # e.g. "13.0–16.5 g/dL"
    abnormal: bool = False
    legible: bool = True


@dataclass
class TranscriptionResult:
    text: str
    medications: list[TranscribedMedication] = field(default_factory=list)
    observations: list[TranscribedObservation] = field(default_factory=list)
    confidence: float = 0.0
    warnings: list[str] = field(default_factory=list)
    model: str = ""
    doc_kind: Optional[str] = None      # "prescription" | "lab_report" | "other"
    clinic_name: Optional[str] = None
    doctor_name: Optional[str] = None
    patient_name: Optional[str] = None
    report_date: Optional[str] = None   # ISO date string if present


_PROMPT = (
    "You are a careful medical transcriptionist reading a scanned or photographed "
    "medical document (often a handwritten prescription).\n\n"
    "The document may be a PRESCRIPTION (medicines) or a LAB REPORT (test results) "
    "or both. Extract whichever is present.\n\n"
    "Return a SINGLE JSON object and nothing else, with exactly this shape:\n"
    "{\n"
    '  "verbatim_text": string,            // faithful printed-text transcription of the whole document\n'
    '  "doc_kind": "prescription" | "lab_report" | "other",\n'
    '  "clinic_name": string | null,\n'
    '  "doctor_name": string | null,\n'
    '  "patient_name": string | null,\n'
    '  "report_date": string | null,       // ISO yyyy-mm-dd if present\n'
    '  "overall_confidence": number,        // your honest 0..1 confidence\n'
    '  "warnings": string[],                // notes about illegible/uncertain content\n'
    '  "medications": [                      // [] if not a prescription\n'
    "    {\n"
    '      "name": string,                  // drug name exactly as written\n'
    '      "strength": string | null,       // e.g. "0.5 mg"\n'
    '      "dose": string | null,           // e.g. "1 tablet"\n'
    '      "frequency": string | null,      // e.g. "twice daily"\n'
    '      "duration": string | null,       // e.g. "10 days"\n'
    '      "instructions": string | null,   // e.g. "after food"\n'
    '      "times": string[],               // clock times "HH:MM" for each daily dose, inferred from frequency\n'
    '      "days_of_week": number[],        // 0=Mon..6=Sun; [] means every day\n'
    '      "duration_days": number | null,  // total days, e.g. 28 for "4 weeks"\n'
    '      "legible": boolean\n'
    "    }\n"
    "  ],\n"
    '  "lab_values": [                       // [] if not a lab report\n'
    "    {\n"
    '      "name": string,                  // test name, e.g. "Hemoglobin"\n'
    '      "value": string | null,          // e.g. "14.5"\n'
    '      "unit": string | null,           // e.g. "g/dL"\n'
    '      "reference_range": string | null,// e.g. "13.0-16.5 g/dL"\n'
    '      "abnormal": boolean,             // true if out of range\n'
    '      "legible": boolean\n'
    "    }\n"
    "  ]\n"
    "}\n\n"
    "In `verbatim_text`, preserve the document layout: clinic/doctor header, "
    "patient, date, then one line per medicine or test result, then any signature.\n\n"
    "STRICT RULES:\n"
    "- NEVER invent or 'correct' a drug name, test name, value, or dose. Transcribe "
    "exactly what is written.\n"
    "- If a token is illegible, write '[?]' in its place in `verbatim_text`, set "
    "`legible=false` on that item, and add a short note to `warnings`.\n"
    "- Use null (not empty string) for fields that are not present.\n"
    "\nSCHEDULE MAPPING (for medications) — infer a concrete reminder schedule.\n"
    "ALWAYS list every applicable day explicitly in days_of_week (0=Mon..6=Sun). "
    "For a daily medicine use the FULL week [0,1,2,3,4,5,6] — never an empty list.\n"
    "- 'once daily'/'OD' → times ['09:00'] (HS → ['21:00']), days_of_week [0,1,2,3,4,5,6].\n"
    "- 'twice daily'/'BD' → ['09:00','21:00']; 'thrice daily'/'TDS' → "
    "['08:00','14:00','20:00']; 'four times'/'QID' → ['08:00','12:00','16:00','20:00']; "
    "days_of_week [0,1,2,3,4,5,6].\n"
    "- 'once weekly'/'weekly' → times ['09:00'], days_of_week [0] (Monday).\n"
    "- 'twice weekly' → times ['09:00'], days_of_week [0,3] (Mon & Thu).\n"
    "- Convert duration to duration_days: '4 weeks'→28, '10 days'→10, '1 month'→30.\n"
    "- If frequency is unclear, use times ['09:00'], days_of_week [0,1,2,3,4,5,6], and note it in warnings.\n"
)


def _gemini_mime(mime: str) -> str:
    """Gemini accepts image/* and application/pdf. image/jpg → image/jpeg."""
    if mime == "image/jpg":
        return "image/jpeg"
    return mime


async def transcribe_handwritten(
    content: bytes,
    mime: str,
    *,
    api_key: str,
    model: str,
    api_base: str,
    timeout: float = 90.0,
) -> TranscriptionResult:
    """Transcribe a handwritten document via Gemini Flash.

    Raises on transport/HTTP errors or an unparseable response — the caller
    (pipeline) decides how to degrade.
    """
    if not api_key:
        raise RuntimeError("Gemini API key is not configured (gemini_api_key).")

    url = f"{api_base.rstrip('/')}/models/{model}:generateContent"
    body = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": _PROMPT},
                    {
                        "inline_data": {
                            "mime_type": _gemini_mime(mime),
                            "data": base64.b64encode(content).decode("ascii"),
                        }
                    },
                ],
            }
        ],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json",
        },
    }

    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(
            url,
            headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
            json=body,
        )
        resp.raise_for_status()
        data = resp.json()

    # Pull the JSON text out of the first candidate.
    try:
        parts = data["candidates"][0]["content"]["parts"]
        raw_text = "".join(p.get("text", "") for p in parts)
        parsed = json.loads(raw_text)
    except (KeyError, IndexError, json.JSONDecodeError) as exc:
        logger.warning("[transcriber] Could not parse Gemini response: %s", exc)
        raise RuntimeError("Gemini returned an unreadable transcription") from exc

    meds = []
    for m in parsed.get("medications", []) or []:
        name = (m.get("name") or "").strip()
        if not name:
            continue
        times = [str(t) for t in (m.get("times") or []) if t]
        try:
            dow = [int(d) for d in (m.get("days_of_week") or []) if 0 <= int(d) <= 6]
        except (TypeError, ValueError):
            dow = []
        try:
            dur_days = int(m["duration_days"]) if m.get("duration_days") is not None else None
        except (TypeError, ValueError):
            dur_days = None
        meds.append(
            TranscribedMedication(
                name=name,
                strength=m.get("strength"),
                dose=m.get("dose"),
                frequency=m.get("frequency"),
                duration=m.get("duration"),
                instructions=m.get("instructions"),
                legible=bool(m.get("legible", True)),
                times=times,
                days_of_week=dow,
                duration_days=dur_days,
            )
        )

    labs = []
    for o in parsed.get("lab_values", []) or []:
        name = (o.get("name") or "").strip()
        if not name:
            continue
        labs.append(
            TranscribedObservation(
                name=name,
                value=o.get("value"),
                unit=o.get("unit"),
                reference_range=o.get("reference_range"),
                abnormal=bool(o.get("abnormal", False)),
                legible=bool(o.get("legible", True)),
            )
        )

    try:
        confidence = float(parsed.get("overall_confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0

    return TranscriptionResult(
        text=parsed.get("verbatim_text") or "",
        medications=meds,
        observations=labs,
        confidence=max(0.0, min(1.0, confidence)),
        warnings=[str(w) for w in (parsed.get("warnings") or [])],
        model=model,
        doc_kind=parsed.get("doc_kind"),
        clinic_name=parsed.get("clinic_name"),
        doctor_name=parsed.get("doctor_name"),
        patient_name=parsed.get("patient_name"),
        report_date=parsed.get("report_date"),
    )
