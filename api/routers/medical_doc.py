"""POST /medical/upload + POST /medical/confirm — MDT FHIR extraction pipeline.

Flow:
  1. Accept PDF / JPEG / PNG
  2. Store raw bytes (content-addressed, immutable)
  3. POST to MDT → FHIR R4 Bundle
  4. Parse bundle → patient name + observations
  5. Compare patient name against logged-in user's profile
  6. Return extracted data + name_match_status  (user must confirm before save)

POST /medical/confirm  — called after user approves VerificationCard in the UI.
  Persists HealthFact rows from the verified observations.

All PHI stays inside the PAL tenant boundary; MDT URL is internal/local by default.
"""
import hashlib
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Union, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user_unified as get_current_user
from services.user_service import get_patient_by_auth_user
from config import get_settings
from database import get_db
from models import EvidenceClass, HealthFact, RawSource, SourceType, User
from models.phone_user import PhoneUser
from services.mdt.client import MDTClient
from services.mdt.fhir_parser import parse_fhir_bundle
from services.audit_logger import AuditLogger

router = APIRouter(prefix="/medical", tags=["medical"])

_MDT_ACCEPT_MIMES = {
    "application/pdf",
    "image/jpeg",
    "image/jpg",
    "image/png",
}
_MAX_BYTES = 20 * 1024 * 1024  # 20 MB


# ── Pydantic models ────────────────────────────────────────────────────────────

class ObservationIn(BaseModel):
    loinc_code: Optional[str] = None
    display: str                                   # user-approved (possibly edited) name
    original_display: Optional[str] = None         # AI-extracted name, for audit
    edited: Optional[bool] = False
    value: Optional[str] = None
    unit: Optional[str] = None
    reference_range: Optional[str] = None
    recorded_at: Optional[str] = None
    # Medication extras (prescriptions)
    dosage: Optional[str] = None
    frequency: Optional[str] = None
    duration: Optional[str] = None
    instructions: Optional[str] = None
    legible: Optional[bool] = True


class ConfirmRequest(BaseModel):
    raw_source_id: str
    tenant_id: Optional[str] = None  # Optional - not used
    patient_id: Optional[str] = None  # Optional - backend uses current_user.id
    observations: list[ObservationIn]
    report_date: Optional[str] = None
    report_title: Optional[str] = None
    fhir_bundle: Optional[dict] = None
    # Provenance threaded back from /upload (all optional / additive)
    extraction_id: Optional[str] = None
    source_modality: Optional[str] = None          # printed | handwritten
    extraction_method: Optional[str] = None         # mdt_direct | flash_then_mdt | flash_only
    transcription_text: Optional[str] = None
    transcription_model: Optional[str] = None
    needs_review: Optional[bool] = False


# ── Helpers ────────────────────────────────────────────────────────────────────

def _name_similarity(a: Optional[str], b: Optional[str]) -> float:
    """Token-overlap similarity (0..1) for loose patient name matching."""
    if not a or not b:
        return 0.0
    a_parts = set(a.lower().split())
    b_parts = set(b.lower().split())
    if not a_parts or not b_parts:
        return 0.0
    return len(a_parts & b_parts) / max(len(a_parts), len(b_parts))


def _infer_report_type(title: Optional[str]) -> Optional[str]:
    """Map report title to standardized type codes."""
    if not title:
        return None
    title_lower = title.lower()

    mappings = {
        'CBC': ['complete blood count', 'cbc', 'hemogram'],
        'LIPID': ['lipid profile', 'cholesterol', 'lipid panel'],
        'LFT': ['liver function', 'lft', 'hepatic panel'],
        'KFT': ['kidney function', 'kft', 'renal panel'],
        'THYROID': ['thyroid', 'tsh', 't3', 't4'],
        'GLUCOSE': ['blood sugar', 'glucose', 'hba1c'],
    }

    for type_code, keywords in mappings.items():
        if any(kw in title_lower for kw in keywords):
            return type_code
    return None


async def _get_patient_from_user(user: User, db: AsyncSession):
    """Lookup patient_id from authenticated user."""
    from models import Patient
    from sqlalchemy import select

    result = await db.execute(
        select(Patient).where(Patient.email == user.email)
    )
    return result.scalar_one_or_none()


async def _resolve_patient_id(user: Union[PhoneUser, User], db: AsyncSession):
    """Resolve the real ``patients.id`` for the authenticated identity.

    ``lab_tests.patient_id`` references ``patients.id`` — a different table/UUID
    from the phone_user id. Phone users link to their patient row via
    ``patients.phone_user_id`` (same rule phone_auth / visits / medications use);
    legacy email users match by ``patients.email``. Returns the patient UUID, or
    ``None`` if the account has no patient profile yet.
    """
    from models import Patient
    from sqlalchemy import select

    if isinstance(user, PhoneUser):
        result = await db.execute(
            select(Patient.id).where(Patient.phone_user_id == user.id).limit(1)
        )
        return result.scalar_one_or_none()

    email = getattr(user, "email", None)
    if email:
        result = await db.execute(
            select(Patient.id).where(Patient.email == email).limit(1)
        )
        return result.scalar_one_or_none()
    return None


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_medical_document(
    file: UploadFile = File(...),
    tenant_id: str = Form(None),  # Optional - not used
    patient_id: str = Form(...),  # Mandatory from frontend, but ignored - uses current_user.id for security
    db: AsyncSession = Depends(get_db),
    current_user: Union[PhoneUser, User] = Depends(get_current_user),
):
    """Accept a medical document, run it through MDT, and return extracted data
    for user verification before any health facts are persisted."""
    settings = get_settings()

    content = await file.read()
    if len(content) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail="File too large — maximum is 20 MB.")

    mime = file.content_type or "application/octet-stream"
    filename = file.filename or "upload"

    if mime not in _MDT_ACCEPT_MIMES:
        return {
            "type": "unsupported_format",
            "message": (
                "Please upload a PDF, JPEG, or PNG document. "
                "DICOM imaging files cannot be processed here — share them with your care team."
            ),
        }

    # tenant_id is optional (None for now)
    t_id = None
    # Store phone_user_id directly
    m_id = current_user.id

    # Content-addressed raw storage — SHA-256 filename, immutable, deduped
    content_hash = hashlib.sha256(content).hexdigest()
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    ext = Path(filename).suffix or ".bin"
    storage_path = upload_dir / f"{content_hash}{ext}"
    if not storage_path.exists():
        storage_path.write_bytes(content)

    raw_source = RawSource(
        tenant_id=t_id,
        member_id=m_id,
        source_type=SourceType.upload,
        filename=filename,
        mime_type=mime,
        storage_path=str(storage_path),
        content_hash=content_hash,
        file_size_bytes=len(content),
        is_document=True,
    )
    db.add(raw_source)
    await db.flush()

    # Log file upload
    await AuditLogger.log_file_operation(
        db=db,
        operation="upload",
        file_name=filename,
        file_size=len(content),
        user_id=current_user.id,
        patient_id=m_id,
        success=True
    )

    # ── MDT disabled — save file, skip extraction ──────────────────────────
    if not settings.mdt_enabled:
        await db.commit()
        return {
            "type": "document_accepted",
            "raw_source_id": str(raw_source.id),
            "filename": filename,
            "mdt_enabled": False,
            "message": (
                "Document saved to your record. "
                "Medical Data Toolkit is not configured — FHIR extraction skipped."
            ),
        }

    # ── Extraction (resilient: printed → MDT; handwritten → Flash → MDT) ─────
    import time
    from services.mdt.pipeline import extract_document
    from models import DocumentExtraction

    start_time = time.time()
    print(f"[MDT DEBUG] Starting extraction for {filename}, URL: {settings.mdt_url}")

    try:
        outcome = await extract_document(content, mime, settings)

        duration_ms = int((time.time() - start_time) * 1000)
        await AuditLogger.log_mdt_extraction(
            db=db,
            file_name=filename,
            status="success",
            duration_ms=duration_ms,
            observations_count=len(outcome.observations),
            model=settings.mdt_model,
            user_id=current_user.id,
            patient_id=m_id,
        )

    except Exception as exc:
        duration_ms = int((time.time() - start_time) * 1000)
        await AuditLogger.log_mdt_extraction(
            db=db,
            file_name=filename,
            status="failed",
            duration_ms=duration_ms,
            observations_count=0,
            model=settings.mdt_model,
            user_id=current_user.id,
            patient_id=m_id,
            error_message=str(exc),
            stack_trace=None,
        )

        await db.commit()
        return {
            "type": "document_accepted",
            "raw_source_id": str(raw_source.id),
            "filename": filename,
            "mdt_enabled": True,
            "mdt_error": str(exc),
            "message": (
                "Document saved. Lab extraction is temporarily unavailable — "
                "a clinician should review the original document."
            ),
        }

    # Persist the rendered transcription PDF (if any) for provenance/debugging.
    rendered_pdf_path = None
    if outcome.rendered_pdf:
        rp_hash = hashlib.sha256(outcome.rendered_pdf).hexdigest()
        rp_path = upload_dir / f"{rp_hash}.pdf"
        if not rp_path.exists():
            rp_path.write_bytes(outcome.rendered_pdf)
        rendered_pdf_path = str(rp_path)

    # Record the extraction attempt (immutable machine output + provenance).
    extraction = DocumentExtraction(
        patient_id=current_user.id,  # phone_user id, matching the upload convention
        raw_source_id=raw_source.id,
        source_mime=mime,
        source_modality=outcome.modality,
        extraction_method=outcome.method,
        mdt_discarded=outcome.mdt_discarded,
        transcription_text=outcome.transcription.text if outcome.transcription else None,
        transcription_model=outcome.transcription.model if outcome.transcription else None,
        transcription_conf=outcome.confidence,
        rendered_pdf_path=rendered_pdf_path,
        fhir_bundle=outcome.fhir_bundle or None,
        status="needs_review" if outcome.needs_review else "extracted",
        warnings=outcome.warnings or None,
    )
    db.add(extraction)
    await db.flush()

    # ── Patient name verification (Hermes pre-check) ───────────────────────
    score = _name_similarity(outcome.patient_name, getattr(current_user, "full_name", None))
    if score >= 0.5:
        match_status = "match"
    elif score > 0:
        match_status = "partial"
    else:
        match_status = "no_match"

    await db.commit()

    return {
        "type": "pending_verification",
        "raw_source_id": str(raw_source.id),
        "extraction_id": str(extraction.id),
        "filename": filename,
        "patient_name_on_doc": outcome.patient_name,
        "patient_name_on_profile": getattr(current_user, "full_name", None),
        "name_match_status": match_status,
        "report_title": outcome.report_title,
        "report_date": outcome.report_date,
        "observations": outcome.observations,
        # Provenance for the UI (editable-name highlighting) and /confirm.
        "source_modality": outcome.modality,
        "extraction_method": outcome.method,
        "needs_review": outcome.needs_review,
        "transcription_model": outcome.transcription.model if outcome.transcription else None,
        "transcription_text": outcome.transcription.text if outcome.transcription else None,
        "warnings": outcome.warnings,
        "confidence": outcome.confidence,
    }


@router.post("/confirm")
async def confirm_medical_document(
    req: ConfirmRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Union[PhoneUser, User] = Depends(get_current_user),
):
    """Persist verified data to lab_tests AND health_facts tables."""
    try:
        rs_id = uuid.UUID(req.raw_source_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid raw_source_id.")

    # Resolve the real patients.id for this identity. lab_tests.patient_id is an
    # FK to patients.id — the phone_user id is a different table/UUID and using it
    # directly violates lab_tests_patient_id_fkey.
    m_id = await _resolve_patient_id(current_user, db)
    if not m_id:
        raise HTTPException(
            status_code=404,
            detail="No patient profile found for your account. Please complete your profile before saving documents.",
        )

    # Get raw_source for file metadata
    raw_source = await db.get(RawSource, rs_id)
    if not raw_source:
        raise HTTPException(404, "Raw source not found")

    recorded_at: Optional[datetime] = None
    if req.report_date:
        try:
            recorded_at = datetime.fromisoformat(req.report_date)
            # Ensure timezone-aware
            if recorded_at.tzinfo is None:
                recorded_at = recorded_at.replace(tzinfo=timezone.utc)
        except ValueError:
            recorded_at = datetime.now(timezone.utc)

    # Create LabTest entry
    from models import LabTest, DocumentExtraction

    def _extracted_name(obs: ObservationIn) -> str:
        return obs.original_display if obs.original_display is not None else obs.display

    # Capture the human's name corrections (AI value vs. final) for audit.
    user_edits = [
        {"field": "display", "from": _extracted_name(obs), "to": obs.display}
        for obs in req.observations
        if obs.display != _extracted_name(obs)
    ]

    def _result_item(obs: ObservationIn) -> dict:
        extracted = _extracted_name(obs)
        return {
            "name": obs.display,                 # final, user-approved
            "name_extracted": extracted,         # what the pipeline produced
            "name_edited": obs.display != extracted,
            "loinc_code": obs.loinc_code,
            "value": obs.value,
            "unit": obs.unit,
            "range": obs.reference_range,
            "dosage": obs.dosage,
            "frequency": obs.frequency,
            "duration": obs.duration,
            "instructions": obs.instructions,
            "abnormal": False,
        }

    now = datetime.now(timezone.utc)
    modality = req.source_modality or "printed"
    method = req.extraction_method or "mdt_direct"

    # Build raw_extracted_json with ALL extracted data (keeps the AI-extracted name)
    raw_extracted_json = {
        "report_title": req.report_title,
        "report_date": req.report_date,
        "patient_name": req.fhir_bundle.get("patient_name") if isinstance(req.fhir_bundle, dict) else None,
        "extraction_timestamp": now.isoformat(),
        "extraction_model": req.transcription_model or "gemini-2.5-flash",
        "extraction_method": method,
        "source_modality": modality,
        "extraction_source": "google-mdt",
        "total_observations": len(req.observations),
        "user_edits": user_edits,
        "lab_values": [_result_item(obs) for obs in req.observations],
    }

    lab_test = LabTest(
        patient_id=m_id,
        report_name=req.report_title or raw_source.filename or "Lab Report",
        report_type=_infer_report_type(req.report_title),
        test_category='blood',
        ordered_date=recorded_at.date() if recorded_at else now.date(),
        result_date=recorded_at.date() if recorded_at else None,
        status='completed',
        processing_status='completed',
        results=[_result_item(obs) for obs in req.observations],
        has_abnormal_values=False,
        report_format='PDF' if raw_source.mime_type == 'application/pdf' else 'Image',
        file_name=raw_source.filename,
        file_size=raw_source.file_size_bytes,
        mime_type=raw_source.mime_type,
        storage_path=str(raw_source.storage_path),
        confidence_score=0.95,
        processed_at=now,
        extraction_model=req.transcription_model or 'gemini-2.5-flash',
        extraction_version='google-mdt-v1',
        raw_extracted_json=raw_extracted_json,
        fhir_json=req.fhir_bundle if req.fhir_bundle else None,
        # ── Extraction provenance ──
        extraction_method=method,
        source_modality=modality,
        transcription_text=req.transcription_text,
        transcription_model=req.transcription_model,
        needs_review=False,          # the user just reviewed/edited it
        reviewed_at=now,
        raw_source_id=raw_source.id,
    )
    db.add(lab_test)
    await db.flush()

    # Link + close out the extraction audit row (what AI said vs. what the human kept).
    if req.extraction_id:
        try:
            ext = await db.get(DocumentExtraction, uuid.UUID(req.extraction_id))
        except ValueError:
            ext = None
        if ext is not None:
            ext.lab_test_id = lab_test.id
            ext.status = "confirmed"
            ext.user_edits = user_edits or None
            ext.edited_by = current_user.id
            ext.edited_at = now

    # Skip HealthFact creation - user only wants lab_tests.raw_extracted_json

    await db.commit()
    await db.refresh(lab_test)

    return {
        "status": "saved",
        "lab_test_id": str(lab_test.id),
        "observations_count": len(req.observations),
        "edits_applied": len(user_edits),
    }
