"""
User profile endpoints - Unified for both phone OTP and email/password auth
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional, Union
from datetime import date

from database import get_db
from models.phone_user import PhoneUser
from models.user import User
from models.patient import Patient
from models.credits import UserLLMCredits
from auth_unified import get_current_user_unified, get_user_id
from services.user_service import (
    get_patient_by_auth_user,
    create_patient_for_user,
    get_user_identifier
)

router = APIRouter(prefix="/user", tags=["user"])


class PatientProfileCreate(BaseModel):
    full_name: str
    date_of_birth: Optional[date] = None
    gender: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    blood_group: Optional[str] = None
    address: Optional[str] = None
    allergies: Optional[list[str]] = []
    chronic_conditions: Optional[list[str]] = []
    current_medications: Optional[list[str]] = []
    emergency_contact: Optional[str] = None


@router.get("/profile")
async def get_user_profile(
    current_user: Union[PhoneUser, User] = Depends(get_current_user_unified),
    db: AsyncSession = Depends(get_db)
):
    """
    Get complete user profile with patient data and credits.
    Works with both phone OTP and email/password authentication.
    """
    # Get patient profile
    patient = await get_patient_by_auth_user(current_user, db)

    # Get LLM credits (use user_id)
    user_id = current_user.id
    credits_result = await db.execute(
        select(UserLLMCredits).where(UserLLMCredits.user_id == user_id)
    )
    credits = credits_result.scalar_one_or_none()

    # Create default credits if not exists
    if not credits:
        credits = UserLLMCredits(
            user_id=user_id,
            balance=20,
            total_purchased=0,
            total_used=0
        )
        db.add(credits)
        await db.commit()
        await db.refresh(credits)

    # Build response based on auth type
    if isinstance(current_user, PhoneUser):
        user_data = {
            "id": str(current_user.id),
            "phone_number": current_user.phone_number,
            "auth_type": "phone",
            "is_verified": current_user.is_verified,
            "is_active": current_user.is_active,
            "created_at": current_user.created_at.isoformat() if current_user.created_at else None,
        }
    else:
        user_data = {
            "id": str(current_user.id),
            "username": current_user.username,
            "email": current_user.email,
            "auth_type": "email",
            "is_active": current_user.is_active,
            "created_at": current_user.created_at.isoformat() if current_user.created_at else None,
        }

    return {
        "user": user_data,
        "patient": {
            "id": str(patient.id),
            "mrn": patient.mrn,
            "abha_id": patient.abha_id,
            "abha_address": patient.abha_address,
            "full_name": patient.full_name,
            "date_of_birth": str(patient.date_of_birth) if patient.date_of_birth else None,
            "gender": patient.gender,
            "phone": patient.phone,
            "email": patient.email,
            "blood_group": patient.blood_group,
            "address": patient.address,
            "allergies": patient.allergies,
            "chronic_conditions": patient.chronic_conditions,
            "current_medications": patient.current_medications,
            "emergency_contact": patient.emergency_contact,
            "photo_url": patient.photo_url,
        } if patient else None,
        "credits": {
            "balance": credits.balance,
            "total_purchased": credits.total_purchased,
            "total_used": credits.total_used,
            "last_refill_date": str(credits.last_refill_date) if credits.last_refill_date else None,
        }
    }


@router.post("/profile/create")
async def create_user_profile(
    profile_data: PatientProfileCreate,
    current_user: Union[PhoneUser, User] = Depends(get_current_user_unified),
    db: AsyncSession = Depends(get_db)
):
    """
    Create patient profile for authenticated user.
    Links the profile to phone_user or user_id.
    """
    # Check if patient already exists
    existing_patient = await get_patient_by_auth_user(current_user, db)
    if existing_patient:
        raise HTTPException(status_code=400, detail="Patient profile already exists")

    # Prepare patient data
    patient_dict = profile_data.model_dump()

    # Auto-fill phone/email from auth user if not provided
    if isinstance(current_user, PhoneUser):
        if not patient_dict.get('phone'):
            patient_dict['phone'] = current_user.phone_number
    else:
        if not patient_dict.get('email'):
            patient_dict['email'] = current_user.email

    # Create patient
    patient = await create_patient_for_user(current_user, patient_dict, db)

    return {
        "message": "Profile created successfully",
        "patient_id": str(patient.id),
        "patient": {
            "id": str(patient.id),
            "full_name": patient.full_name,
            "phone": patient.phone,
            "email": patient.email,
        }
    }


@router.get("/credits")
async def get_user_credits(
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Get user's LLM credits (works with both auth types)"""

    credits_result = await db.execute(
        select(UserLLMCredits).where(UserLLMCredits.user_id == user_id)
    )
    credits = credits_result.scalar_one_or_none()

    # Create default credits if not exists
    if not credits:
        credits = UserLLMCredits(
            user_id=user_id,
            balance=20,
            total_purchased=0,
            total_used=0
        )
        db.add(credits)
        await db.commit()
        await db.refresh(credits)

    return {
        "balance": credits.balance,
        "total_purchased": credits.total_purchased,
        "total_used": credits.total_used,
        "last_refill_date": str(credits.last_refill_date) if credits.last_refill_date else None,
    }


@router.get("/me")
async def get_current_user_info(
    current_user: Union[PhoneUser, User] = Depends(get_current_user_unified)
):
    """Get current authenticated user info"""

    if isinstance(current_user, PhoneUser):
        return {
            "id": str(current_user.id),
            "auth_type": "phone",
            "phone_number": current_user.phone_number,
            "is_verified": current_user.is_verified,
            "is_active": current_user.is_active,
        }
    else:
        return {
            "id": str(current_user.id),
            "auth_type": "email",
            "username": current_user.username,
            "email": current_user.email,
            "is_active": current_user.is_active,
        }
