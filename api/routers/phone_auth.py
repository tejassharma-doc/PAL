"""
Phone OTP Authentication Endpoints
Auto-creates users on first login
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from slowapi import Limiter
from slowapi.util import get_remote_address
from database import get_db
from models.phone_user import PhoneUser
from models.user import OTPSession
from models.patient import Patient
from services.otp import generate_otp, hash_otp, verify_otp_hash, otp_expiry
from services.sms import exotel
from auth_unified import create_phone_token
from pydantic import BaseModel
from datetime import datetime, timedelta, timezone
from config import get_settings
import secrets
import logging

router = APIRouter(prefix="/phone/auth", tags=["phone-auth"])
logger = logging.getLogger(__name__)

# ✅ SECURITY FIX (HIGH-004): Rate limiter instance
limiter = Limiter(key_func=get_remote_address)


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
@limiter.limit("3/hour")  # ✅ SECURITY FIX (HIGH-004): Max 3 OTP requests per hour per IP
async def request_phone_otp(
    request: Request,
    req: OTPRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Request OTP for phone login.
    Auto-creates user if doesn't exist.
    Rate limited to 3 requests per hour per IP to prevent abuse.
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
        # Redact PHI - show only last 4 digits
        settings = get_settings()
        if settings.environment == "development" and settings.debug:
            redacted_phone = f"***{phone[-4:]}" if len(phone) >= 4 else "***"
            logger.debug(f"Created new user for phone ending in {redacted_phone}")

    # Generate OTP — fixed test code for dev / whitelisted dummy numbers, else random.
    settings = get_settings()
    _test_numbers = {n.strip() for n in (settings.otp_test_numbers or "").split(",") if n.strip()}
    use_test_code = settings.otp_test_mode or (phone in _test_numbers)
    otp_code = settings.otp_test_code if use_test_code else generate_otp()
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

    # Prepare response
    settings = get_settings()
    response = {
        "message": "OTP sent successfully",
        "expires_in": int((expires_at - datetime.now(timezone.utc)).total_seconds())
    }

    # Test/dummy numbers (and dev test mode) use the fixed code and skip SMS.
    # Otherwise deliver over SMS via Exotel whenever enabled and configured.
    sms_sent = False
    if not use_test_code and settings.exotel_enabled and exotel.configured():
        try:
            await exotel.send_otp_sms(phone, otp_code)
            sms_sent = True
        except Exception as exc:
            logger.error("OTP SMS delivery failed: %s", exc)
            raise HTTPException(status_code=502, detail="Could not send OTP. Please try again.")

    # Expose the code only when no real SMS went out: test/dummy numbers, or local
    # dev. Never leak it once real SMS delivery is active for a real number.
    if use_test_code or (not sms_sent and settings.environment == "development" and settings.debug):
        response["dev_otp"] = otp_code
        redacted_phone = f"***{phone[-4:]}" if len(phone) >= 4 else "***"
        logger.debug("OTP (test=%s) for phone ending in %s", use_test_code, redacted_phone)

    return response

@router.post("/verify")
@limiter.limit("10/hour")  # ✅ SECURITY FIX (HIGH-004): Max 10 verification attempts per hour per IP
async def verify_phone_otp(
    request: Request,
    req: OTPVerify,
    db: AsyncSession = Depends(get_db)
):
    """
    Verify OTP and login user.
    Returns JWT token and user info.
    Rate limited to 10 attempts per hour per IP to prevent brute force.
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

    # Get patient linked to this phone_user. Use the most recent and tolerate
    # duplicates — a phone_user can end up with more than one patients row (e.g.
    # repeated onboarding), and scalar_one_or_none() would 500 on that.
    patient_result = await db.execute(
        select(Patient)
        .where(Patient.phone_user_id == phone_user.id)
        .order_by(Patient.created_at.desc())
    )
    patient = patient_result.scalars().first()

    # Generate proper JWT token for phone auth
    token = create_phone_token(
        user_id=str(phone_user.id),
        phone_number=phone_user.phone_number
    )

    # Check if patient profile exists
    has_patient_profile = patient is not None
    requires_onboarding = not has_patient_profile

    # Subscription gate: unsubscribed users are redirected to /pricing by the client.
    from services.billing.subscription_service import user_has_active_subscription
    has_subscription = await user_has_active_subscription(phone_user.id, db)

    # Audit logging (no PHI in console logs)
    settings = get_settings()
    if settings.environment == "development" and settings.debug:
        # Redact PHI - show only last 4 digits of phone
        redacted_phone = f"***{phone[-4:]}" if len(phone) >= 4 else "***"
        logger.debug(f"Phone login success: ending in {redacted_phone}, has_profile={has_patient_profile}")

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
        "has_patient_profile": has_patient_profile,
        "has_subscription": has_subscription,
        "pricing_url": get_settings().pricing_url,
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
