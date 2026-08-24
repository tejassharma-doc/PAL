"""User profile and credits endpoints"""
from typing import Union
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_db
from models import User, UserLLMCredits
from models.phone_user import PhoneUser
from auth_unified import get_current_user_unified

router = APIRouter(prefix="/user", tags=["user"])


@router.get("/profile")
async def get_user_profile(
    user: Union[PhoneUser, User] = Depends(get_current_user_unified),
    db: AsyncSession = Depends(get_db)
):
    """Get complete user profile with credits"""

    # Get patient record by phone or email
    from models import Patient

    # Build query based on user type
    if isinstance(user, PhoneUser):
        # Phone user: search by phone number
        patient_result = await db.execute(
            select(Patient).where(
                Patient.phone == user.phone_number,
                Patient.is_active == True
            ).limit(1)
        )
    else:
        # Email user: search by email or username
        patient_result = await db.execute(
            select(Patient).where(
                ((Patient.email == user.email) | (Patient.email == user.username)),
                Patient.is_active == True
            ).limit(1)
        )
    patient = patient_result.scalar_one_or_none()

    # Get user's LLM credits
    credits_result = await db.execute(
        select(UserLLMCredits).where(UserLLMCredits.user_id == user.id)
    )
    credits = credits_result.scalar_one_or_none()

    # If no credits record exists, create one with default values
    if not credits:
        credits = UserLLMCredits(
            user_id=user.id,
            balance=20,  # Default starting balance
            total_purchased=0,
            total_used=0
        )
        db.add(credits)
        await db.commit()
        await db.refresh(credits)

    # Build user info based on type
    if isinstance(user, PhoneUser):
        user_info = {
            "id": str(user.id),
            "phone_number": user.phone_number,
            "is_active": user.is_active,
            "is_verified": user.is_verified,
            "auth_type": "phone",
            "created_at": user.created_at.isoformat() if user.created_at else None,
        }
    else:
        user_info = {
            "id": str(user.id),
            "username": user.username,
            "email": user.email,
            "is_active": user.is_active,
            "auth_type": "email",
            "created_at": user.created_at.isoformat() if user.created_at else None,
        }

    return {
        "user": user_info,
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


@router.get("/credits")
async def get_user_credits(
    user: Union[PhoneUser, User] = Depends(get_current_user_unified),
    db: AsyncSession = Depends(get_db)
):
    """Get user's LLM credits"""

    credits_result = await db.execute(
        select(UserLLMCredits).where(UserLLMCredits.user_id == user.id)
    )
    credits = credits_result.scalar_one_or_none()

    # If no credits record exists, create one with default values
    if not credits:
        credits = UserLLMCredits(
            user_id=user.id,
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
