"""Visits API - Appointments with clinical outputs and lab results"""
from typing import Union, Optional, List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from pydantic import BaseModel
from datetime import datetime
import uuid

from database import get_db
from models import Patient, Appointment, LabTest, Consultation, Prescription
from models.clinical_output import ClinicalOutput
from auth import get_current_user_unified as get_current_user
from services.user_service import get_patient_by_auth_user
from models.user import User
from models.phone_user import PhoneUser
from dependencies.authz import verify_patient_ownership

router = APIRouter(prefix="/visits", tags=["visits"])


# Response Models
class LabTestSummary(BaseModel):
    id: str
    test_name: str
    result_date: Optional[str]
    abnormal_flag: bool
    interpretation: Optional[str]


class VisitSummary(BaseModel):
    id: str
    doctor_id: Optional[str]
    date: str
    reason: str
    status: str
    soap_note: Optional[str]
    management_plan: Optional[str]
    patient_summary: Optional[str]
    lab_tests: List[LabTestSummary]


@router.get("/patient/{patient_id}")
async def get_patient_visits(
    patient_id: str,
    current_user: Union[PhoneUser, User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get all visits (appointments) for a patient with clinical outputs and lab tests"""

    # ✅ SECURITY FIX: Verify user owns or has permission for this patient record
    patient = await verify_patient_ownership(patient_id, current_user, db)

    # Get appointments
    appointments_result = await db.execute(
        select(Appointment)
        .where(Appointment.patient_id == patient_id)
        .order_by(desc(Appointment.slot_time))
    )
    appointments = appointments_result.scalars().all()

    from datetime import timezone as _tz
    now = datetime.now(_tz.utc)
    upcoming = []
    past = []

    for appt in appointments:
        # Clinical output (SOAP note / management plan) for this appointment.
        clinical_output = (await db.execute(
            select(ClinicalOutput).where(ClinicalOutput.appointment_id == appt.id)
        )).scalar_one_or_none()

        # Medications: appointment → consultation(s) → prescription(s) → items.
        consult_ids = (await db.execute(
            select(Consultation.id).where(Consultation.appointment_id == appt.id)
        )).scalars().all()
        medications: list = []
        if consult_ids:
            prescriptions = (await db.execute(
                select(Prescription).where(Prescription.consultation_id.in_(consult_ids))
            )).scalars().all()
            for p in prescriptions:
                for item in (p.items or []):
                    if isinstance(item, dict):
                        medications.append(item)

        # Lab tests attached to this appointment.
        lab_tests = (await db.execute(
            select(LabTest)
            .where(LabTest.appointment_id == appt.id)
            .order_by(desc(LabTest.result_date))
        )).scalars().all()
        lab_tests_summary = [
            {
                "id": str(test.id),
                "test_name": test.report_name,
                "result_date": test.result_date.strftime("%Y-%m-%d") if test.result_date else None,
                "abnormal_flag": bool(test.has_abnormal_values),
                "interpretation": test.interpretation,
            }
            for test in lab_tests
        ]

        has_prescription = bool(
            medications or (clinical_output and (clinical_output.management_plan or clinical_output.soap_note))
        )

        visit = {
            "id": str(appt.id),
            "doctor_id": str(appt.doctor_id) if appt.doctor_id else None,
            "doctor_name": appt.doctor_name,
            "clinic_name": appt.clinic_name,
            "date": appt.slot_time.strftime("%d %b %Y") if appt.slot_time else None,
            "time": appt.slot_time.strftime("%H:%M") if appt.slot_time else None,
            "reason": appt.reason_for_visit or "General Consultation",
            "status": appt.status,
            "has_prescription": has_prescription,
            "soap_note": clinical_output.soap_note if clinical_output else None,
            "management_plan": clinical_output.management_plan if clinical_output else None,
            "patient_summary": clinical_output.patient_summary if clinical_output else None,
            "medications": medications,
            "lab_tests": lab_tests_summary,
        }

        # Split by slot_time (datetime, not a re-parsed string); null-dated → past.
        if appt.slot_time is not None and appt.slot_time >= now:
            upcoming.append(visit)
        else:
            past.append(visit)

    return {"upcoming": upcoming, "past": past}
