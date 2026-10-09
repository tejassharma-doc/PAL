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


@dataclass
class TranscriptionResult:
    text: str
    medications: list[TranscribedMedication] = field(default_factory=list)
    confidence: float = 0.0
    warnings: list[str] = field(default_factory=list)
    model: str = ""
    clinic_name: Optional[str] = None
    doctor_name: Optional[str] = None
    patient_name: Optional[str] = None
    report_date: Optional[str] = None   # ISO date string if present


_PROMPT = (
    "You are a careful medical transcriptionist reading a scanned or photographed "
    "medical document (often a handwritten prescription).\n\n"
    "Return a SINGLE JSON object and nothing else, with exactly this shape:\n"
    "{\n"
    '  "verbatim_text": string,            // faithful printed-text transcription of the whole document\n'
    '  "clinic_name": string | null,\n'
    '  "doctor_name": string | null,\n'
    '  "patient_name": string | null,\n'
    '  "report_date": string | null,       // ISO yyyy-mm-dd if present\n'
    '  "overall_confidence": number,        // your honest 0..1 confidence\n'
    '  "warnings": string[],                // notes about illegible/uncertain content\n'
    '  "medications": [\n'
    "    {\n"
    '      "name": string,                  // drug name exactly as written\n'
    '      "strength": string | null,       // e.g. "0.5 mg"\n'
    '      "dose": string | null,           // e.g. "1 tablet"\n'
    '      "frequency": string | null,      // e.g. "twice daily"\n'
    '      "duration": string | null,       // e.g. "10 days"\n'
    '      "instructions": string | null,   // e.g. "after food"\n'
    '      "legible": boolean\n'
    "    }\n"
    "  ]\n"
    "}\n\n"
    "In `verbatim_text`, preserve the prescription layout: clinic/doctor header, "
    "patient, date, then one line per medicine, then any signature line.\n\n"
    "STRICT RULES:\n"
    "- NEVER invent or 'correct' a drug name, strength, or dose. Transcribe exactly "
    "what is written.\n"
    "- If a token is illegible, write '[?]' in its place in `verbatim_text`, set "
    "`legible=false` on that medication, and add a short note to `warnings`.\n"
    "- Use null (not empty string) for fields that are not present.\n"
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
        meds.append(
            TranscribedMedication(
                name=name,
                strength=m.get("strength"),
                dose=m.get("dose"),
                frequency=m.get("frequency"),
                duration=m.get("duration"),
                instructions=m.get("instructions"),
                legible=bool(m.get("legible", True)),
            )
        )

    try:
        confidence = float(parsed.get("overall_confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0

    return TranscriptionResult(
        text=parsed.get("verbatim_text") or "",
        medications=meds,
        confidence=max(0.0, min(1.0, confidence)),
        warnings=[str(w) for w in (parsed.get("warnings") or [])],
        model=model,
        clinic_name=parsed.get("clinic_name"),
        doctor_name=parsed.get("doctor_name"),
        patient_name=parsed.get("patient_name"),
        report_date=parsed.get("report_date"),
    )
