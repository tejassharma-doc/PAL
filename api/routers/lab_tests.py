"""Lab Tests API Router - SECURITY FIXED: Only return user's own data"""
from typing import Union, List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from pydantic import BaseModel
from datetime import date, datetime
import uuid

from database import get_db
from models import LabTest, Patient, User
from models.phone_user import PhoneUser
from auth import get_current_user_unified as get_current_user
from services.user_service import get_patient_by_auth_user

router = APIRouter(prefix="/lab-tests", tags=["lab-tests"])


class LabTestResponse(BaseModel):
    id: str
    report_name: str
    report_type: Optional[str]
    test_category: Optional[str]
    ordered_date: str
    result_date: Optional[str]
    status: str
    processing_status: str
    results: Optional[dict]
    has_abnormal_values: bool
    interpretation: Optional[str]
    ordered_by: Optional[str]
    lab_name: Optional[str]
    report_format: Optional[str]
    file_name: Optional[str]
    confidence_score: Optional[float]


class LabTestCreate(BaseModel):
    report_name: str
    report_type: Optional[str] = None
    test_category: Optional[str] = None
    ordered_date: date
    result_date: Optional[date] = None
    status: str = "pending"
    processing_status: str = "pending"
    results: Optional[dict] = None
    has_abnormal_values: bool = False
    interpretation: Optional[str] = None
    ordered_by: Optional[str] = None
    lab_name: Optional[str] = None
    report_format: Optional[str] = None
    file_name: Optional[str] = None
    confidence_score: Optional[float] = None


async def _get_user_patient(user: User, db: AsyncSession) -> Patient:
    """Get patient record for authenticated user - SECURITY: ensures user can only access their own data"""
    # Look up patient by user's email or username
    patient_result = await db.execute(
        select(Patient).where(
            (Patient.email == user.email) | (Patient.email == user.username)
        ).where(Patient.is_active == True)
    )
    patient = patient_result.scalar_one_or_none()

    if not patient:
        raise HTTPException(
            status_code=404,
            detail="Patient profile not found. Please create your profile first."
        )

    return patient


@router.get("/patient/{patient_id}")
async def get_patient_lab_tests(
    patient_id: str,
    current_user: Union[PhoneUser, User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get all lab tests for a patient - SECURITY: Only returns logged-in user's own tests"""

    # SECURITY: Ignore patient_id from URL, always use current_user.id (phone_user_id)
    # This ensures users can only access their own records
    user_id = current_user.id

    # Get all lab tests for this user (patient_id = phone_user_id)
    lab_tests_result = await db.execute(
        select(LabTest)
        .where(LabTest.patient_id == patient.id)  # Use verified patient.id
        .order_by(desc(LabTest.ordered_date))
    )
    lab_tests = lab_tests_result.scalars().all()

    # Format response
    tests_list = []
    for test in lab_tests:
        tests_list.append({
            "id": str(test.id),
            "report_name": test.report_name,
            "report_type": test.report_type,
            "test_category": test.test_category,
            "ordered_date": test.ordered_date.strftime("%Y-%m-%d") if test.ordered_date else None,
            "result_date": test.result_date.strftime("%Y-%m-%d") if test.result_date else None,
            "status": test.status,
            "processing_status": test.processing_status,
            "results": test.results,
            "has_abnormal_values": test.has_abnormal_values,
            "interpretation": test.interpretation,
            "ordered_by": test.ordered_by,
            "lab_name": test.lab_name,
            "report_format": test.report_format,
            "file_name": test.file_name,
            "confidence_score": test.confidence_score
        })

    return {"lab_tests": tests_list}


@router.get("/{test_id}")
async def get_lab_test_details(
    test_id: str,
    current_user: Union[PhoneUser, User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get detailed results for a specific lab test - SECURITY: Only returns if user owns it"""

    # SECURITY FIX: Get authenticated user's patient record
    patient = await _get_user_patient(user, db)

    # Get the lab test
    test_result = await db.execute(
        select(LabTest).where(LabTest.id == test_id)
    )
    test = test_result.scalar_one_or_none()

    if not test:
        raise HTTPException(status_code=404, detail="Lab test not found")

    # SECURITY FIX: Verify the test belongs to the authenticated user
    if test.patient_id != patient.id:
        raise HTTPException(
            status_code=403,
            detail="Forbidden: You can only access your own medical records"
        )

    return {
        "id": str(test.id),
        "report_name": test.report_name,
        "report_type": test.report_type,
        "test_category": test.test_category,
        "test_type": test.test_type,
        "ordered_date": test.ordered_date.strftime("%Y-%m-%d") if test.ordered_date else None,
        "sample_collected_date": test.sample_collected_date.strftime("%Y-%m-%d") if test.sample_collected_date else None,
        "result_date": test.result_date.strftime("%Y-%m-%d") if test.result_date else None,
        "verified_date": test.verified_date.strftime("%Y-%m-%d") if test.verified_date else None,
        "status": test.status,
        "processing_status": test.processing_status,
        "results": test.results,
        "has_abnormal_values": test.has_abnormal_values,
        "interpretation": test.interpretation,
        "ordered_by": test.ordered_by,
        "lab_name": test.lab_name,
        "lab_location": test.lab_location,
        "notes": test.notes,
        "report_format": test.report_format,
        "file_name": test.file_name,
        "file_size": test.file_size,
        "mime_type": test.mime_type,
        "storage_path": test.storage_path,
        "confidence_score": test.confidence_score,
        "processed_at": test.processed_at.isoformat() if test.processed_at else None,
        "extraction_model": test.extraction_model,
        "extraction_version": test.extraction_version,
        "raw_extracted_json": test.raw_extracted_json,
        "fhir_json": test.fhir_json
    }


@router.post("/patient/{patient_id}")
async def create_lab_test(
    patient_id: str,
    lab_test: LabTestCreate,
    current_user: Union[PhoneUser, User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Create a new lab test for a patient - SECURITY: Only allows creating for own patient"""

    # SECURITY FIX: Get authenticated user's patient record
    patient = await _get_user_patient(user, db)

    # SECURITY FIX: Verify the requested patient_id matches the authenticated user
    if str(patient.id) != patient_id:
        raise HTTPException(
            status_code=403,
            detail="Forbidden: You can only create records for yourself"
        )

    # Create lab test using verified patient.id
    new_test = LabTest(
        patient_id=patient.id,  # Use verified patient.id, not from URL
        report_name=lab_test.report_name,
        report_type=lab_test.report_type,
        test_category=lab_test.test_category,
        ordered_date=lab_test.ordered_date,
        result_date=lab_test.result_date,
        status=lab_test.status,
        processing_status=lab_test.processing_status,
        results=lab_test.results,
        has_abnormal_values=lab_test.has_abnormal_values,
        interpretation=lab_test.interpretation,
        ordered_by=lab_test.ordered_by,
        lab_name=lab_test.lab_name,
        report_format=lab_test.report_format,
        file_name=lab_test.file_name,
        confidence_score=lab_test.confidence_score
    )

    db.add(new_test)
    await db.commit()
    await db.refresh(new_test)

    return {
        "id": str(new_test.id),
        "report_name": new_test.report_name,
        "status": new_test.status,
        "message": "Lab test created successfully"
    }
