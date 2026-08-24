"""Prescriptions API Router"""
from typing import Union, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from pydantic import BaseModel

from database import get_db
from models import Patient, User
from models.phone_user import PhoneUser
from models.prescription import Prescription
from models.clinical_output import ClinicalOutput
from auth import get_current_user_unified as get_current_user
from services.user_service import get_patient_by_auth_user

router = APIRouter(prefix="/prescriptions", tags=["prescriptions"])


class PrescriptionResponse(BaseModel):
    id: str
    created_at: str
    items: list
    refillable: bool
    refills_remaining: int


class ClinicalOutputResponse(BaseModel):
    id: str
    soap_note: Optional[str]
    management_plan: Optional[str]
    patient_summary: Optional[str]
    created_at: str


@router.get("/patient/{patient_id}/latest")
async def get_latest_prescription(
    patient_id: str,
    current_user: Union[PhoneUser, User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get the latest prescription for a patient with clinical output (SOAP notes)"""

    # Verify patient exists
    patient_result = await db.execute(
        select(Patient).where(Patient.id == patient_id)
    )
    patient = patient_result.scalar_one_or_none()

    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    # Get latest prescription
    prescription_result = await db.execute(
        select(Prescription)
        .where(Prescription.patient_id == patient_id)
        .order_by(desc(Prescription.created_at))
        .limit(1)
    )
    prescription = prescription_result.scalar_one_or_none()

    if not prescription:
        return {"prescription": None, "clinical_output": None}

    # Get clinical output if prescription is linked to a consultation
    clinical_output = None
    if prescription.consultation_id:
        clinical_output_result = await db.execute(
            select(ClinicalOutput)
            .where(ClinicalOutput.id == prescription.consultation_id)
        )
        clinical_output = clinical_output_result.scalar_one_or_none()

    # Format response
    prescription_data = {
        "id": str(prescription.id),
        "created_at": prescription.created_at.isoformat() if prescription.created_at else None,
        "items": prescription.items or [],
        "refillable": prescription.refillable or False,
        "refills_remaining": prescription.refills_remaining or 0
    }

    clinical_output_data = None
    if clinical_output:
        clinical_output_data = {
            "id": str(clinical_output.id),
            "soap_note": clinical_output.soap_note,
            "management_plan": clinical_output.management_plan,
            "patient_summary": clinical_output.patient_summary,
            "created_at": clinical_output.processed_at.isoformat() if clinical_output.processed_at else None
        }

    return {
        "prescription": prescription_data,
        "clinical_output": clinical_output_data
    }


@router.get("/patient/{patient_id}")
async def get_all_prescriptions(
    patient_id: str,
    current_user: Union[PhoneUser, User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get all prescriptions for a patient"""

    # Verify patient exists
    patient_result = await db.execute(
        select(Patient).where(Patient.id == patient_id)
    )
    patient = patient_result.scalar_one_or_none()

    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    # Get all prescriptions
    prescriptions_result = await db.execute(
        select(Prescription)
        .where(Prescription.patient_id == patient_id)
        .order_by(desc(Prescription.created_at))
    )
    prescriptions = prescriptions_result.scalars().all()

    prescriptions_list = []
    for prescription in prescriptions:
        prescriptions_list.append({
            "id": str(prescription.id),
            "created_at": prescription.created_at.isoformat() if prescription.created_at else None,
            "items": prescription.items or [],
            "refillable": prescription.refillable or False,
            "refills_remaining": prescription.refills_remaining or 0
        })

    return {"prescriptions": prescriptions_list}
