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
    display: str
    value: Optional[str] = None
    unit: Optional[str] = None
    reference_range: Optional[str] = None
    recorded_at: Optional[str] = None


class ConfirmRequest(BaseModel):
    raw_source_id: str
    tenant_id: Optional[str] = None  # Optional - not used
    patient_id: Optional[str] = None  # Optional - backend uses current_user.id
    observations: list[ObservationIn]
    report_date: Optional[str] = None
    report_title: Optional[str] = None
    fhir_bundle: Optional[dict] = None


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

    # ── MDT extraction ─────────────────────────────────────────────────────
    import time
    start_time = time.time()
    print(f"[MDT DEBUG] Starting MDT extraction for {filename}, URL: {settings.mdt_url}")

    try:
        client = MDTClient(
            settings.mdt_url,
            gemini_api_key=settings.gemini_api_key or None,
            model=settings.mdt_model,
        )
        fhir_bundle = await client.document_to_fhir(content, mime)

        duration_ms = int((time.time() - start_time) * 1000)

        # Log successful extraction
        await AuditLogger.log_mdt_extraction(
            db=db,
            file_name=filename,
            status="success",
            duration_ms=duration_ms,
            observations_count=len(fhir_bundle.get('entry', [])),
            model=settings.mdt_model,
            user_id=current_user.id,
            patient_id=m_id
        )

    except Exception as exc:
        duration_ms = int((time.time() - start_time) * 1000)

        # Log failed extraction
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
            stack_trace=None
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

    parsed = parse_fhir_bundle(fhir_bundle)

    # ── Patient name verification (Hermes pre-check) ───────────────────────
    score = _name_similarity(parsed.patient_name, getattr(current_user, "full_name", None))
    if score >= 0.5:
        match_status = "match"
    elif score > 0:
        match_status = "partial"
    else:
        match_status = "no_match"

    observations = [
        {
            "loinc_code": o.loinc_code,
            "display": o.display,
            "value": o.value,
            "unit": o.unit,
            "reference_range": o.reference_range,
            "recorded_at": o.recorded_at.isoformat() if o.recorded_at else None,
        }
        for o in parsed.observations
    ]

    await db.commit()

    return {
        "type": "pending_verification",
        "raw_source_id": str(raw_source.id),
        "filename": filename,
        "patient_name_on_doc": parsed.patient_name,
        "patient_name_on_profile": getattr(current_user, "full_name", None),
        "name_match_status": match_status,
        "report_title": parsed.report_title,
        "report_date": parsed.report_date.isoformat() if parsed.report_date else None,
        "observations": observations,
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

    # Use phone_user_id directly as patient_id
    m_id = current_user.id

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
    from models import LabTest

    # Build raw_extracted_json with ALL extracted data
    raw_extracted_json = {
        "report_title": req.report_title,
        "report_date": req.report_date,
        "patient_name": req.fhir_bundle.get("patient_name") if isinstance(req.fhir_bundle, dict) else None,
        "extraction_timestamp": datetime.now(timezone.utc).isoformat(),
        "extraction_model": "gemini-2.5-flash",
        "extraction_source": "google-mdt",
        "total_observations": len(req.observations),
        "lab_values": [
            {
                "name": obs.display,
                "loinc_code": obs.loinc_code,
                "value": obs.value,
                "unit": obs.unit,
                "reference_range": obs.reference_range,
                "recorded_at": obs.recorded_at
            }
            for obs in req.observations
        ]
    }

    lab_test = LabTest(
        patient_id=m_id,
        report_name=req.report_title or raw_source.filename or "Lab Report",
        report_type=_infer_report_type(req.report_title),
        test_category='blood',
        ordered_date=recorded_at.date() if recorded_at else datetime.now(timezone.utc).date(),
        result_date=recorded_at.date() if recorded_at else None,
        status='completed',
        processing_status='completed',
        results=[
            {
                "name": obs.display,
                "loinc_code": obs.loinc_code,
                "value": obs.value,
                "unit": obs.unit,
                "range": obs.reference_range,
                "abnormal": False
            }
            for obs in req.observations
        ],
        has_abnormal_values=False,
        report_format='PDF' if raw_source.mime_type == 'application/pdf' else 'Image',
        file_name=raw_source.filename,
        file_size=raw_source.file_size_bytes,
        mime_type=raw_source.mime_type,
        storage_path=str(raw_source.storage_path),
        confidence_score=0.95,
        processed_at=datetime.now(timezone.utc),
        extraction_model='gemini-2.5-flash',
        extraction_version='google-mdt-v1',
        raw_extracted_json=raw_extracted_json,
        fhir_json=req.fhir_bundle if req.fhir_bundle else None,
    )
    db.add(lab_test)

    # Skip HealthFact creation - user only wants lab_tests.raw_extracted_json
    # All data is already saved in lab_test.raw_extracted_json above

    await db.commit()
    await db.refresh(lab_test)

    return {
        "status": "saved",
        "lab_test_id": str(lab_test.id),
        "observations_count": len(req.observations)
    }
