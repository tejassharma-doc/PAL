"""Patients router - CRUD operations for patient records"""
from typing import Optional, Union
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, EmailStr
from datetime import date, datetime
import uuid

from database import get_db
from models import Patient
from models.user import User
from models.phone_user import PhoneUser
from auth_unified import get_current_user_unified

router = APIRouter(prefix="/patients", tags=["patients"])


class CreatePatientRequest(BaseModel):
    """Create patient profile"""
    # Personal Information - MANDATORY
    full_name: str
    phone: str
    date_of_birth: str  # YYYY-MM-DD - MANDATORY
    gender: str
    blood_group: str
    address: str

    # Healthcare IDs - OPTIONAL
    mrn: Optional[str] = None
    abha_id: Optional[str] = None
    abha_address: Optional[str] = None

    # Medical Information - MANDATORY (can be "NA")
    allergies: str
    chronic_conditions: str
    current_medications: str

    # Emergency Contact - MANDATORY (dict with name, relationship, phone)
    emergency_contact: dict

    # System fields - OPTIONAL
    email: Optional[str] = None  # Not collected in form, auto-filled from user email
    photo_url: Optional[str] = None
    is_active: bool = True


@router.post("")
async def create_patient(
    req: CreatePatientRequest,
    user: Union[PhoneUser, User] = Depends(get_current_user_unified),
    db: AsyncSession = Depends(get_db)
):
    """Create a new patient record"""

    # Parse date of birth (optional)
    dob = None
    if req.date_of_birth:
        try:
            dob = datetime.strptime(req.date_of_birth, '%Y-%m-%d').date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

    # Get email based on user type
    email = req.email
    if not email:
        if isinstance(user, PhoneUser):
            # Phone users don't have email, use phone as fallback or leave empty
            email = None
        else:
            # Email users have email
            email = user.email

    # Create patient and link to phone_user if applicable
    patient = Patient(
        full_name=req.full_name,
        phone=req.phone,
        email=email,
        date_of_birth=dob,
        gender=req.gender,
        blood_group=req.blood_group,
        address=req.address,
        mrn=req.mrn,
        abha_id=req.abha_id,
        abha_address=req.abha_address,
        allergies=req.allergies,
        chronic_conditions=req.chronic_conditions,
        current_medications=req.current_medications,
        emergency_contact=req.emergency_contact,
        is_active=req.is_active,
        phone_user_id=user.id if isinstance(user, PhoneUser) else None
    )

    db.add(patient)
    await db.commit()
    await db.refresh(patient)

    return {
        "id": str(patient.id),
        "full_name": patient.full_name,
        "phone": patient.phone,
        "email": patient.email,
        "date_of_birth": str(patient.date_of_birth) if patient.date_of_birth else None,
        "gender": patient.gender,
        "blood_group": patient.blood_group,
        "created_at": patient.created_at.isoformat() if patient.created_at else None
    }


@router.put("/{patient_id}")
async def update_patient(
    patient_id: str,
    req: CreatePatientRequest,
    user: Union[PhoneUser, User] = Depends(get_current_user_unified),
    db: AsyncSession = Depends(get_db)
):
    """Update existing patient record or create if not found"""

    import logging
    logger = logging.getLogger(__name__)
    logger.info(f"Updating patient {patient_id} with data: {req.dict()}")

    # Get existing patient
    result = await db.execute(select(Patient).where(Patient.id == patient_id))
    patient = result.scalar_one_or_none()

    # If patient doesn't exist, create a new one
    if not patient:
        logger.info(f"Patient {patient_id} not found, creating new patient")

        # Parse date of birth
        try:
            dob = datetime.strptime(req.date_of_birth, '%Y-%m-%d').date() if req.date_of_birth else None
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

        # Create new patient with phone_user_id
        patient = Patient(
            id=uuid.UUID(patient_id),
            full_name=req.full_name,
            phone=req.phone,
            email=req.email,
            date_of_birth=dob,
            gender=req.gender,
            blood_group=req.blood_group,
            address=req.address,
            mrn=req.mrn,
            abha_id=req.abha_id,
            abha_address=req.abha_address,
            allergies=req.allergies,
            chronic_conditions=req.chronic_conditions,
            current_medications=req.current_medications,
            emergency_contact=req.emergency_contact,
            is_active=req.is_active if req.is_active is not None else True,
            phone_user_id=user.id if isinstance(user, PhoneUser) else None
        )
        db.add(patient)
        await db.commit()
        await db.refresh(patient)

        return {
            "id": str(patient.id),
            "full_name": patient.full_name,
            "phone": patient.phone,
            "email": patient.email,
            "date_of_birth": patient.date_of_birth.isoformat() if patient.date_of_birth else None,
            "gender": patient.gender,
            "blood_group": patient.blood_group,
            "created": True
        }

    # Parse date of birth
    try:
        dob = datetime.strptime(req.date_of_birth, '%Y-%m-%d').date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

    # Update fields
    patient.full_name = req.full_name
    patient.phone = req.phone
    patient.email = req.email if req.email else patient.email  # Keep existing email if not provided
    patient.date_of_birth = dob
    patient.gender = req.gender
    patient.blood_group = req.blood_group
    patient.address = req.address
    patient.mrn = req.mrn
    patient.abha_id = req.abha_id
    patient.abha_address = req.abha_address
    patient.allergies = req.allergies
    patient.chronic_conditions = req.chronic_conditions
    patient.current_medications = req.current_medications
    patient.emergency_contact = req.emergency_contact
    patient.is_active = req.is_active

    await db.commit()
    await db.refresh(patient)

    return {
        "id": str(patient.id),
        "full_name": patient.full_name,
        "phone": patient.phone,
        "email": patient.email,
        "date_of_birth": str(patient.date_of_birth) if patient.date_of_birth else None,
        "gender": patient.gender,
        "blood_group": patient.blood_group,
        "mrn": patient.mrn,
        "abha_id": patient.abha_id,
        "abha_address": patient.abha_address,
        "allergies": patient.allergies,
        "chronic_conditions": patient.chronic_conditions,
        "current_medications": patient.current_medications,
        "emergency_contact": patient.emergency_contact,
        "created_at": patient.created_at.isoformat() if patient.created_at else None,
        "updated_at": patient.updated_at.isoformat() if patient.updated_at else None
    }


@router.get("/{patient_id}")
async def get_patient(
    patient_id: str,
    user: Union[PhoneUser, User] = Depends(get_current_user_unified),
    db: AsyncSession = Depends(get_db)
):
    """Get patient by ID"""

    result = await db.execute(select(Patient).where(Patient.id == patient_id))
    patient = result.scalar_one_or_none()

    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    return {
        "id": str(patient.id),
        "full_name": patient.full_name,
        "phone": patient.phone,
        "email": patient.email,
        "date_of_birth": str(patient.date_of_birth) if patient.date_of_birth else None,
        "gender": patient.gender,
        "blood_group": patient.blood_group,
        "address": patient.address,
        "mrn": patient.mrn,
        "abha_id": patient.abha_id,
        "abha_address": patient.abha_address,
        "allergies": patient.allergies,
        "chronic_conditions": patient.chronic_conditions,
        "current_medications": patient.current_medications,
        "emergency_contact": patient.emergency_contact,
        "photo_url": patient.photo_url,
        "is_active": patient.is_active,
        "created_at": patient.created_at.isoformat() if patient.created_at else None,
        "updated_at": patient.updated_at.isoformat() if patient.updated_at else None
    }


@router.get("/by-email/{email}")
async def get_patient_by_email(
    email: str,
    user: Union[PhoneUser, User] = Depends(get_current_user_unified),
    db: AsyncSession = Depends(get_db)
):
    """Get patient by email"""
    
    result = await db.execute(
        select(Patient).where(Patient.email == email, Patient.is_active == True)
    )
    patient = result.scalar_one_or_none()
    
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    
    return {
        "id": str(patient.id),
        "full_name": patient.full_name,
        "email": patient.email,
        "phone": patient.phone,
        "date_of_birth": patient.date_of_birth.isoformat() if patient.date_of_birth else None,
        "gender": patient.gender,
        "blood_group": patient.blood_group
    }
