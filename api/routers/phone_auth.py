"""
Phone OTP Authentication Endpoints
Auto-creates users on first login
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from database import get_db
from models.phone_user import PhoneUser
from models.user import OTPSession
from models.patient import Patient
from services.otp import generate_otp, hash_otp, verify_otp_hash, otp_expiry
from auth_unified import create_phone_token
from pydantic import BaseModel
from datetime import datetime, timedelta, timezone
import secrets

router = APIRouter(prefix="/phone/auth", tags=["phone-auth"])


def clean_phone_number(phone: str) -> str:
    """
    Clean and normalize phone number to exactly 10 digits.
    Removes country code (+91) if present.

    Examples:
        +917506584004 -> 7506584004
        917506584004 -> 7506584004
        7506584004 -> 7506584004
    """
    # Remove all non-digit characters
    phone = ''.join(filter(str.isdigit, phone))

    # If starts with 91 and is 12 digits, remove country code
    if phone.startswith('91') and len(phone) == 12:
        phone = phone[2:]

    # Validate exactly 10 digits
    if len(phone) != 10:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid phone number: must be 10 digits, got {len(phone)}"
        )

    return phone


class OTPRequest(BaseModel):
    phone: str
    delivery_channel: str = "sms"
    email: str | None = None

class OTPVerify(BaseModel):
    phone: str
    otp_code: str

@router.post("/request")
async def request_phone_otp(
    req: OTPRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Request OTP for phone login.
    Auto-creates user if doesn't exist.
    Dev mode: prints OTP to console.
    """
    # Clean phone number to exactly 10 digits
    phone = clean_phone_number(req.phone)

    # Find or create phone user
    result = await db.execute(
        select(PhoneUser).where(PhoneUser.phone_number == phone)
    )
    phone_user = result.scalar_one_or_none()

    if not phone_user:
        # Auto-create new user
        phone_user = PhoneUser(
            phone_number=phone,
            country_code="+91",
            is_verified=False,
            is_active=True
        )
        db.add(phone_user)
        await db.flush()
        print(f"[PHONE AUTH] Created new user: {phone_user.id} for phone {phone}")

    # Generate OTP
    otp_code = generate_otp()
    otp_hash = hash_otp(otp_code)
    expires_at = otp_expiry()

    # Delete old OTP sessions for this phone
    await db.execute(
        delete(OTPSession).where(
            OTPSession.phone == phone,
            OTPSession.verified == False
        )
    )

    # Create new OTP session
    otp_session = OTPSession(
        phone=phone,
        delivery_channel=req.delivery_channel,
        delivery_address=phone,
        otp_hash=otp_hash,
        expires_at=expires_at,
        verified=False,
        attempts=0,
        purpose="login"
    )
    db.add(otp_session)
    await db.commit()

    # DEV MODE: Print OTP to console
    print(f"\n{'='*50}")
    print(f"[OTP] Phone: {phone}")
    print(f"[OTP] Code: {otp_code}")
    print(f"[OTP] Expires: {expires_at}")
    print(f"{'='*50}\n")

    return {
        "message": "OTP sent successfully",
        "dev_otp": otp_code,
        "expires_in": {}
    }

@router.post("/verify")
async def verify_phone_otp(
    req: OTPVerify,
    db: AsyncSession = Depends(get_db)
):
    """
    Verify OTP and login user.
    Returns JWT token and user info.
    """
    # Clean phone number to exactly 10 digits
    phone = clean_phone_number(req.phone)

    # Find OTP session
    result = await db.execute(
        select(OTPSession).where(
            OTPSession.phone == phone,
            OTPSession.verified == False
        ).order_by(OTPSession.created_at.desc())
    )
    otp_session = result.scalar_one_or_none()

    if not otp_session:
        raise HTTPException(status_code=400, detail="No OTP request found")

    # Check expiry
    if datetime.now(timezone.utc) > otp_session.expires_at:
        raise HTTPException(status_code=400, detail="OTP expired. Please request a new one.")

    # Check attempts
    if otp_session.attempts >= 3:
        raise HTTPException(status_code=400, detail="Too many attempts. Please request a new OTP.")

    # Verify OTP
    if not verify_otp_hash(req.otp_code, otp_session.otp_hash):
        otp_session.attempts += 1
        await db.commit()
        remaining = 3 - otp_session.attempts
        raise HTTPException(
            status_code=400,
            detail=f"Incorrect OTP. {remaining} attempt(s) remaining."
        )

    # Mark OTP as verified
    otp_session.verified = True
    await db.commit()

    # Get/update phone user
    result = await db.execute(
        select(PhoneUser).where(PhoneUser.phone_number == phone)
    )
    phone_user = result.scalar_one_or_none()

    if not phone_user:
        raise HTTPException(status_code=404, detail="User not found")

    # Mark as verified
    phone_user.is_verified = True
    await db.commit()

    # Get patient linked to this phone_user
    patient_result = await db.execute(
        select(Patient).where(Patient.phone_user_id == phone_user.id)
    )
    patient = patient_result.scalar_one_or_none()

    # Generate proper JWT token for phone auth
    token = create_phone_token(
        user_id=str(phone_user.id),
        phone_number=phone_user.phone_number
    )

    # Check if patient profile exists
    has_patient_profile = patient is not None
    requires_onboarding = not has_patient_profile

    print(f"[PHONE AUTH] ========================================")
    print(f"[PHONE AUTH] Phone: {phone}")
    print(f"[PHONE AUTH] PhoneUser ID: {phone_user.id}")
    print(f"[PHONE AUTH] Patient ID: {patient.id if patient else 'NONE'}")
    print(f"[PHONE AUTH] Patient Name: {patient.full_name if patient else 'NONE'}")
    print(f"[PHONE AUTH] Has patient profile: {has_patient_profile}")
    print(f"[PHONE AUTH] Requires onboarding: {requires_onboarding}")
    print(f"[PHONE AUTH] ========================================")

    response_data = {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": str(phone_user.id),
            "phone_number": phone_user.phone_number,
            "preferred_language": "en"
        },
        "session_id": str(phone_user.id),
        "patient_id": str(patient.id) if patient else None,
        "requires_onboarding": requires_onboarding,
        "has_patient_profile": has_patient_profile
    }

    # If patient exists, include basic patient info
    if patient:
        response_data["patient"] = {
            "id": str(patient.id),
            "full_name": patient.full_name,
            "phone": patient.phone,
            "email": patient.email,
            "date_of_birth": str(patient.date_of_birth) if patient.date_of_birth else None,
            "gender": patient.gender,
            "blood_group": patient.blood_group
        }

    return response_data
