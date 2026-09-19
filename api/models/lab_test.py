"""Lab Tests model - Report-based structure for lab results"""
from sqlalchemy import Column, String, Date, Boolean, Integer, BigInteger, Float, Text, ForeignKey, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship, Mapped, mapped_column
from typing import Optional
from datetime import date, datetime
import uuid

from models.base import Base, UUIDMixin, TimestampMixin


class LabTest(Base, UUIDMixin, TimestampMixin):
    """
    Lab test reports with OCR/extraction support

    Supports:
    - PDF reports, scanned images
    - OCR extraction tracking
    - FHIR compliance
    - Report-level metadata (not just individual observations)
    """
    __tablename__ = "lab_tests"

    # Foreign Keys
    patient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patients.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    appointment_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("appointments.id", ondelete="SET NULL"),
        index=True
    )
    document_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patient_documents.id", ondelete="SET NULL")
    )

    # Report Information (CHANGED: test_name → report_name)
    report_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
        comment="E.g., Complete Blood Count, Lipid Profile"
    )
    report_type: Mapped[Optional[str]] = mapped_column(
        String(100),
        index=True,
        comment="CBC, LFT, KFT, Lipid Profile, etc."
    )
    test_category: Mapped[Optional[str]] = mapped_column(
        String(100),
        comment="blood, urine, imaging, etc."
    )
    test_type: Mapped[Optional[str]] = mapped_column(
        String(100),
        comment="Legacy field, use report_type instead"
    )

    # Dates
    ordered_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    sample_collected_date: Mapped[Optional[date]] = mapped_column(Date)
    result_date: Mapped[Optional[date]] = mapped_column(Date)
    verified_date: Mapped[Optional[date]] = mapped_column(
        Date,
        comment="If different from result_date (when clinician verified)"
    )

    # Status (legacy + new processing_status)
    status: Mapped[str] = mapped_column(
        String(50),
        default='ordered',
        index=True,
        comment="ordered, collected, processing, completed, cancelled"
    )
    processing_status: Mapped[str] = mapped_column(
        String(50),
        default='pending',
        index=True,
        comment="pending, processing, completed, failed (for OCR/extraction)"
    )

    # Results - structured observations
    results: Mapped[Optional[dict]] = mapped_column(
        JSONB,
        comment="Array of observations with value, unit, range, abnormal flag per observation"
    )
    # Example structure:
    # [
    #   {"name": "Cholesterol Total", "value": 200, "unit": "mg/dL", "range": "125-200", "abnormal": false},
    #   {"name": "LDL", "value": 162, "unit": "mg/dL", "range": "<100", "abnormal": true},
    #   {"name": "HDL", "value": 45, "unit": "mg/dL", "range": ">40", "abnormal": false}
    # ]

    # Report-level flags (CHANGED: abnormal_flag → has_abnormal_values)
    has_abnormal_values: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        index=True,
        comment="True if ANY observation in results is abnormal"
    )

    # Interpretation
    interpretation: Mapped[Optional[str]] = mapped_column(
        Text,
        comment="Doctor's interpretation or AI-generated summary"
    )

    # File Metadata (NEW)
    report_format: Mapped[Optional[str]] = mapped_column(
        String(50),
        index=True,
        comment="PDF, Image, Scanned PDF, HL7, FHIR, etc."
    )
    file_name: Mapped[Optional[str]] = mapped_column(
        String(512),
        comment="Original filename when uploaded"
    )
    file_size: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        comment="File size in bytes"
    )
    mime_type: Mapped[Optional[str]] = mapped_column(
        String(128),
        comment="E.g., application/pdf, image/jpeg"
    )
    storage_path: Mapped[Optional[str]] = mapped_column(
        String(512),
        comment="Path in object storage (S3, local, etc.)"
    )

    # OCR/Extraction Metadata (NEW)
    confidence_score: Mapped[Optional[float]] = mapped_column(
        Float,
        comment="OCR confidence score (0.0 - 1.0)"
    )
    processed_at: Mapped[Optional[datetime]] = mapped_column(
        TIMESTAMP(timezone=True),
        comment="When OCR/extraction completed"
    )
    extraction_model: Mapped[Optional[str]] = mapped_column(
        String(100),
        comment="E.g., claude-3-sonnet, gpt-4-vision, tesseract"
    )
    extraction_version: Mapped[Optional[str]] = mapped_column(
        String(50),
        comment="Version of extraction model/pipeline"
    )

    # Structured Extraction Results (NEW)
    raw_extracted_json: Mapped[Optional[dict]] = mapped_column(
        JSONB,
        comment="Raw OCR output before normalization"
    )
    fhir_json: Mapped[Optional[dict]] = mapped_column(
        JSONB,
        comment="FHIR DiagnosticReport JSON representation"
    )

    # Provider Information
    ordered_by: Mapped[Optional[str]] = mapped_column(String(255))
    lab_name: Mapped[Optional[str]] = mapped_column(String(255))
    lab_location: Mapped[Optional[str]] = mapped_column(String(255))

    # Notes
    notes: Mapped[Optional[str]] = mapped_column(Text)

    # Relationships
    patient: Mapped["Patient"] = relationship("Patient", back_populates="lab_tests")

    def __repr__(self):
        return f"<LabTest(id={self.id}, patient_id={self.patient_id}, report_name='{self.report_name}', status='{self.status}')>"
