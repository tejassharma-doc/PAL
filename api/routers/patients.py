"""Patients router - CRUD operations for patient records"""
from typing import Optional, Union
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, EmailStr, Field, validator
from datetime import date, datetime
import uuid
import re

from database import get_db
from models import Patient
from models.user import User
from models.phone_user import PhoneUser
from auth_unified import get_current_user_unified
from dependencies.authz import verify_patient_ownership

router = APIRouter(prefix="/patients", tags=["patients"])


# ✅ SECURITY FIX (HIGH-006): Typed schema for emergency contact
class EmergencyContact(BaseModel):
    """Emergency contact information"""
    name: str = Field(..., max_length=100, min_length=1)
    relationship: str = Field(..., max_length=50)
    phone: str = Field(..., min_length=10, max_length=15)
    email: Optional[str] = None

    @validator('phone')
    def validate_phone(cls, v):
        # Remove spaces and special characters
        cleaned = re.sub(r'[^\d]', '', v)
        if len(cleaned) < 10 or len(cleaned) > 15:
            raise ValueError('Phone must be 10-15 digits')
        return v


class CreatePatientRequest(BaseModel):
    """Create patient profile with enhanced validation"""
    # Personal Information - MANDATORY
    full_name: str = Field(..., max_length=255, min_length=1)
    phone: str = Field(..., min_length=10, max_length=15)
    date_of_birth: str = Field(..., description="YYYY-MM-DD format")
    gender: str = Field(..., max_length=20)
    blood_group: str = Field(..., max_length=10)
    address: str = Field(..., max_length=1000)

    # Healthcare IDs - OPTIONAL
    mrn: Optional[str] = Field(None, max_length=100)
    abha_id: Optional[str] = Field(None, max_length=100)
    abha_address: Optional[str] = Field(None, max_length=255)

    # Medical Information - MANDATORY (can be "NA")
    allergies: str = Field(..., max_length=500)
    chronic_conditions: str = Field(..., max_length=1000)
    current_medications: str = Field(..., max_length=1000)

    # Emergency Contact - MANDATORY (typed schema)
    emergency_contact: EmergencyContact  # ✅ SECURITY FIX: Typed instead of dict

    # System fields - OPTIONAL
    email: Optional[EmailStr] = None
    photo_url: Optional[str] = Field(None, max_length=500)
    is_active: bool = True

    # ✅ SECURITY FIX (HIGH-006): Input validators
    @validator('phone')
    def validate_phone(cls, v):
        # Remove spaces and special characters
        cleaned = re.sub(r'[^\d]', '', v)
        if len(cleaned) < 10 or len(cleaned) > 15:
            raise ValueError('Phone must be 10-15 digits')
        return v

    @validator('gender')
    def validate_gender(cls, v):
        allowed = ['male', 'female', 'other', 'prefer_not_to_say']
        if v.lower() not in allowed:
            raise ValueError(f'Gender must be one of: {", ".join(allowed)}')
        return v.lower()

    @validator('blood_group')
    def validate_blood_group(cls, v):
        allowed = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown']
        if v not in allowed:
            raise ValueError(f'Blood group must be one of: {", ".join(allowed)}')
        return v


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
        emergency_contact=req.emergency_contact.dict(),  # ✅ Convert Pydantic model to dict
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
            emergency_contact=req.emergency_contact.dict(),  # ✅ Convert Pydantic model to dict
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

    # ✅ SECURITY FIX: Verify user owns this patient record before updating
    await verify_patient_ownership(patient_id, user, db)

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
    patient.emergency_contact = req.emergency_contact.dict()  # ✅ Convert Pydantic model to dict
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

    # ✅ SECURITY FIX: Verify user owns or has permission for this patient record
    patient = await verify_patient_ownership(patient_id, user, db)

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
