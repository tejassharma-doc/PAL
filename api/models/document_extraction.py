"""DocumentExtraction — audit/provenance for the document extraction pipeline.

One row per extraction attempt (services/mdt/pipeline.py). It keeps the immutable
machine output (fhir_bundle, transcription_text) separate from the human's
corrections (user_edits), so you can always tell what the AI said vs. what a
person approved. The confirmed clinical data still lives in `lab_tests`; this
table is the trail behind it.

No foreign keys: patient_id holds the phone_user id (matching the upload flow),
and raw_source_id / lab_test_id are soft references.
"""
from datetime import datetime
from typing import Optional
import uuid

from sqlalchemy import String, Text, Boolean, Float, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base, UUIDMixin, TimestampMixin


class DocumentExtraction(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "document_extractions"

    patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    raw_source_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), index=True)
    lab_test_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), index=True)

    source_mime: Mapped[Optional[str]] = mapped_column(String(100))
    source_modality: Mapped[Optional[str]] = mapped_column(String(16))      # printed | handwritten
    extraction_method: Mapped[Optional[str]] = mapped_column(String(32))    # mdt_direct | flash_then_mdt | flash_only
    mdt_discarded: Mapped[bool] = mapped_column(Boolean, default=False)

    transcription_text: Mapped[Optional[str]] = mapped_column(Text)
    transcription_model: Mapped[Optional[str]] = mapped_column(String(64))
    transcription_conf: Mapped[Optional[float]] = mapped_column(Float)
    rendered_pdf_path: Mapped[Optional[str]] = mapped_column(String(512))

    fhir_bundle: Mapped[Optional[dict]] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(24), default="extracted")    # extracted | needs_review | confirmed | failed
    warnings: Mapped[Optional[dict]] = mapped_column(JSONB)                 # list stored as JSON
    error_message: Mapped[Optional[str]] = mapped_column(Text)

    # Human corrections at verification time.
    user_edits: Mapped[Optional[dict]] = mapped_column(JSONB)              # [{field, from, to}, ...]
    edited_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True))
    edited_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True))

    def __repr__(self) -> str:
        return (
            f"<DocumentExtraction(id={self.id}, method={self.extraction_method}, "
            f"modality={self.source_modality}, status={self.status})>"
        )
