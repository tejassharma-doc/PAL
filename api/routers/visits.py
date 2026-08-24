"""Visits API - Appointments with clinical outputs and lab results"""
from typing import Union, Optional, List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from pydantic import BaseModel
from datetime import datetime
import uuid

from database import get_db
from models import Patient, Appointment, LabTest
from models.clinical_output import ClinicalOutput
from auth import get_current_user_unified as get_current_user
from services.user_service import get_patient_by_auth_user
from models.user import User
from models.phone_user import PhoneUser

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

    # Verify patient exists
    patient_result = await db.execute(
        select(Patient).where(Patient.id == patient_id)
    )
    patient = patient_result.scalar_one_or_none()

    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    # Get appointments
    appointments_result = await db.execute(
        select(Appointment)
        .where(Appointment.patient_id == patient_id)
        .order_by(desc(Appointment.slot_time))
    )
    appointments = appointments_result.scalars().all()

    visits = []

    for appt in appointments:
        # Get clinical output for this appointment
        clinical_output_result = await db.execute(
            select(ClinicalOutput)
            .where(ClinicalOutput.appointment_id == appt.id)
        )
        clinical_output = clinical_output_result.scalar_one_or_none()

        # Get lab tests for this appointment
        lab_tests_result = await db.execute(
            select(LabTest)
            .where(LabTest.appointment_id == appt.id)
            .order_by(desc(LabTest.result_date))
        )
        lab_tests = lab_tests_result.scalars().all()

        # Format lab tests
        lab_tests_summary = [
            {
                "id": str(test.id),
                "test_name": test.test_name,
                "result_date": test.result_date.strftime("%Y-%m-%d") if test.result_date else None,
                "abnormal_flag": test.abnormal_flag,
                "interpretation": test.interpretation
            }
            for test in lab_tests
        ]

        # Build visit summary - use only database data
        visit = {
            "id": str(appt.id),
            "doctor_id": str(appt.doctor_id) if appt.doctor_id else None,
            "date": appt.slot_time.strftime("%d %b %Y") if appt.slot_time else None,
            "reason": appt.reason_for_visit or "General Consultation",
            "status": appt.status,
            "soap_note": clinical_output.soap_note if clinical_output else None,
            "management_plan": clinical_output.management_plan if clinical_output else None,
            "patient_summary": clinical_output.patient_summary if clinical_output else None,
            "lab_tests": lab_tests_summary
        }

        visits.append(visit)

    # Separate upcoming and past visits
    now = datetime.now()
    upcoming = [v for v in visits if datetime.strptime(v["date"], "%d %b %Y") >= now.replace(hour=0, minute=0, second=0, microsecond=0)]
    past = [v for v in visits if datetime.strptime(v["date"], "%d %b %Y") < now.replace(hour=0, minute=0, second=0, microsecond=0)]

    return {
        "upcoming": upcoming,
        "past": past
    }
