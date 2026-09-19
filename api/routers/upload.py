"""POST /records/upload — ingest a patient document into the raw source store."""
import hashlib
import uuid
from pathlib import Path
from typing import Union, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user_unified as get_current_user
from services.user_service import get_patient_by_auth_user
from config import get_settings
from database import get_db
from models import RawSource, SourceType, User
from models.phone_user import PhoneUser

router = APIRouter(prefix="/records", tags=["records"])

# MIME types the intake accepts as documents (no AI extraction yet — just intake)
_DOCUMENT_MIMES = {
    "application/pdf",
    "text/plain",
    "text/csv",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/rtf",
    "text/rtf",
}

# Anything we classify as medical imaging → decline with explanation
_IMAGING_MIMES = {"application/dicom"}
_IMAGING_EXTENSIONS = {".dcm", ".dicom"}

_MAX_BYTES = 20 * 1024 * 1024  # 20 MB


def _classify(mime: Optional[str], filename: str) -> str:
    """Return 'imaging', 'document', or 'unknown'."""
    ext = Path(filename).suffix.lower()
    if ext in _IMAGING_EXTENSIONS or mime in _IMAGING_MIMES:
        return "imaging"
    if mime in _DOCUMENT_MIMES or ext in {".pdf", ".txt", ".csv", ".doc", ".docx", ".rtf"}:
        return "document"
    return "unknown"


@router.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    tenant_id: str = Form(...),
    member_id: str = Form(...),
    db: AsyncSession = Depends(get_db),
    current_user: Union[PhoneUser, User] = Depends(get_current_user),
):
    content = await file.read()
    if len(content) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail="File too large — maximum is 20 MB.")

    mime = file.content_type or "application/octet-stream"
    filename = file.filename or "upload"
    kind = _classify(mime, filename)

    if kind in ("imaging", "unknown"):
        return {
            "type": "imaging_declined",
            "message": (
                "I don't interpret this file type — a radiologist or your doctor needs to review it. "
                "You can share it directly with your care team."
            ),
        }

    try:
        t_id = uuid.UUID(tenant_id)
        m_id = uuid.UUID(member_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid tenant_id or member_id.")

    # Content-addressed storage — SHA-256 hash as filename (immutable, deduped)
    content_hash = hashlib.sha256(content).hexdigest()
    settings = get_settings()
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
    )
    db.add(raw_source)
    await db.commit()
    await db.refresh(raw_source)

    return {
        "type": "document_accepted",
        "raw_source_id": str(raw_source.id),
        "filename": filename,
        "message": "Document saved to your record.",
    }
