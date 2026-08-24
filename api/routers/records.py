"""Patient Records API - Documents, Prescriptions, Appointments, Lab Tests"""
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from pydantic import BaseModel
from datetime import datetime
import uuid

from database import get_db
from models import Patient, Appointment, Prescription, LabTest
from models.patient_document import PatientDocument
from models.clinical_output import ClinicalOutput
from auth import get_current_user
from models.user import User

router = APIRouter(prefix="/records", tags=["records"])


# Response Models
class AppointmentRecord(BaseModel):
    id: str
    date: str
    chief_complaint: Optional[str]
    doctor_name: Optional[str]
    clinic_name: Optional[str]
    diagnosis: Optional[str]
    notes: Optional[str]
    status: str


@router.get("/patient/{patient_id}")
async def get_patient_records(
    patient_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get all records for a patient"""

    # Verify patient exists
    patient_result = await db.execute(
        select(Patient).where(Patient.id == patient_id)
    )
    patient = patient_result.scalar_one_or_none()

    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    # Get Appointments
    appointments_result = await db.execute(
        select(Appointment)
        .where(Appointment.patient_id == patient_id)
        .order_by(desc(Appointment.slot_time))
    )
    appointments = appointments_result.scalars().all()

    # Get Prescriptions
    prescriptions_result = await db.execute(
        select(Prescription)
        .where(Prescription.patient_id == patient_id)
        .order_by(desc(Prescription.created_at))
    )
    prescriptions = prescriptions_result.scalars().all()

    # Get Lab Tests
    lab_tests_result = await db.execute(
        select(LabTest)
        .where(LabTest.patient_id == patient_id)
        .order_by(desc(LabTest.ordered_date))
    )
    lab_tests = lab_tests_result.scalars().all()

    # Get Documents
    documents_result = await db.execute(
        select(PatientDocument)
        .where(PatientDocument.patient_id == patient_id)
        .order_by(desc(PatientDocument.created_at))
    )
    documents = documents_result.scalars().all()

    # Get Clinical Outputs (SOAP notes) for all appointments
    clinical_outputs = {}
    for appt in appointments:
        co_result = await db.execute(
            select(ClinicalOutput).where(ClinicalOutput.appointment_id == appt.id)
        )
        co = co_result.scalar_one_or_none()
        if co:
            clinical_outputs[str(appt.id)] = co

    # Format response
    return {
        "appointments": [
            {
                "id": str(appt.id),
                "date": appt.slot_time.strftime("%Y-%m-%d") if appt.slot_time else None,
                "chief_complaint": appt.reason_for_visit or "General Consultation",
                "doctor_name": None,
                "clinic_name": None,
                "diagnosis": None,
                "notes": appt.notes,
                "status": appt.status,
                "soap_note": clinical_outputs[str(appt.id)].soap_note if str(appt.id) in clinical_outputs else None,
                "management_plan": clinical_outputs[str(appt.id)].management_plan if str(appt.id) in clinical_outputs else None,
                "patient_summary": clinical_outputs[str(appt.id)].patient_summary if str(appt.id) in clinical_outputs else None
            }
            for appt in appointments
        ],
        "prescriptions": [
            {
                "id": str(rx.id),
                "date": rx.created_at.strftime("%Y-%m-%d") if rx.created_at else None,
                "medications": rx.items if rx.items else [],
                "pdf_url": rx.pdf_url,
                "refillable": rx.refillable,
                "refills_remaining": rx.refills_remaining
            }
            for rx in prescriptions
        ],
        "lab_tests": [
            {
                "id": str(test.id),
                "test_name": test.report_name,
                "test_category": test.test_category,
                "ordered_date": test.ordered_date.strftime("%Y-%m-%d") if test.ordered_date else None,
                "result_date": test.result_date.strftime("%Y-%m-%d") if test.result_date else None,
                "status": test.status,
                "results": test.results,
                "abnormal_flag": test.has_abnormal_values,
                "interpretation": test.interpretation,
                "ordered_by": test.ordered_by,
                "lab_name": test.lab_name
            }
            for test in lab_tests
        ],
        "documents": [
            {
                "id": str(doc.id),
                "title": doc.title,
                "kind": doc.kind,
                "date": doc.created_at.strftime("%Y-%m-%d") if doc.created_at else None,
                "file_name": doc.file_name,
                "mime_type": doc.mime_type,
                "data_url": doc.data_url,
                "size_bytes": doc.size_bytes
            }
            for doc in documents
        ]
    }
