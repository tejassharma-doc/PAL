from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete
from pydantic import BaseModel, EmailStr
from datetime import datetime, timezone

from database import get_db
from models import User, OTPSession, HealthFact, TenantMembership, OPERATOR_PERMISSIONS
from auth import verify_password, hash_password, create_access_token, get_current_user
from services.otp import generate_otp, hash_otp, verify_otp_hash, send_otp, otp_expiry

router = APIRouter(prefix="/auth", tags=["auth"])

MAX_OTP_ATTEMPTS = 3


# ── Operator-plane: email + password ─────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    phone: Optional[str] = None
    preferred_language: str = 'en'


@router.post("/register")
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == req.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered.")
    user = User(
        email=req.email,
        hashed_password=hash_password(req.password),
        full_name=req.full_name,
        phone=req.phone,
        preferred_language=req.preferred_language,
    )
    db.add(user)
    await db.flush()
    return {"id": str(user.id), "email": user.email, "preferred_language": user.preferred_language}


@router.post("/token")
async def login(form: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == form.username))
    user = result.scalar_one_or_none()
    if not user or not user.hashed_password or not verify_password(form.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password.")
    token = create_access_token(username=user.username, roles=user.roles or ["patient"])
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me")
async def me(user: User = Depends(get_current_user)):
    return {
        "id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "phone": user.phone,
        "phone_verified": user.phone_verified,
        "preferred_language": user.preferred_language or 'en',
    }


# ── Patient-plane: phone OTP ──────────────────────────────────────────────────

class RequestOTPRequest(BaseModel):
    phone: str
    delivery_channel: str = 'sms'   # 'sms' | 'email'
    email: Optional[str] = None      # required when delivery_channel == 'email'


class VerifyOTPRequest(BaseModel):
    phone: str
    otp_code: str


class UpdateProfileRequest(BaseModel):
    full_name: str
    preferred_language: str = 'en'


@router.post("/request-otp")
async def request_otp(req: RequestOTPRequest, db: AsyncSession = Depends(get_db)):
    phone = req.phone.strip().lstrip('+').replace(' ', '')
    if not phone:
        raise HTTPException(status_code=400, detail="Phone number is required.")

    if req.delivery_channel == 'email':
        if not req.email or '@' not in req.email:
            raise HTTPException(status_code=400, detail="Valid email required for email OTP delivery.")
        delivery_address = req.email.strip().lower()
    else:
        delivery_address = phone  # send to the phone number

    # Delete any previous unexpired sessions for this phone (allow resend)
    await db.execute(
        delete(OTPSession).where(
            OTPSession.phone == phone,
            OTPSession.verified == False,
        )
    )

    code = generate_otp()
    session = OTPSession(
        phone=phone,
        delivery_channel=req.delivery_channel,
        delivery_address=delivery_address,
        otp_hash=hash_otp(code),
        expires_at=otp_expiry(),
        purpose='auth',
    )
    db.add(session)
    await db.flush()

    # Mock delivery — returns code for dev auto-fill
    dev_otp = send_otp(req.delivery_channel, delivery_address, code)

    return {
        "message": f"OTP sent via {req.delivery_channel}.",
        "dev_otp": dev_otp,  # strip this field in production via response_model filtering
    }


@router.post("/verify-otp")
async def verify_otp(req: VerifyOTPRequest, db: AsyncSession = Depends(get_db)):
    phone = req.phone.strip().lstrip('+').replace(' ', '')

    # Find latest unexpired, unverified session
    result = await db.execute(
        select(OTPSession)
        .where(
            OTPSession.phone == phone,
            OTPSession.verified == False,
            OTPSession.expires_at > datetime.now(timezone.utc),
        )
        .order_by(OTPSession.created_at.desc())
        .limit(1)
    )
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=400, detail="No active OTP found. Please request a new one.")

    if session.attempts >= MAX_OTP_ATTEMPTS:
        raise HTTPException(status_code=400, detail="Too many attempts. Please request a new OTP.")

    session.attempts += 1

    if not verify_otp_hash(req.otp_code, session.otp_hash):
        remaining = MAX_OTP_ATTEMPTS - session.attempts
        await db.flush()
        raise HTTPException(
            status_code=400,
            detail=f"Incorrect code. {remaining} attempt{'s' if remaining != 1 else ''} remaining.",
        )

    session.verified = True

    # Upsert user by phone
    user_result = await db.execute(select(User).where(User.phone == phone))
    user = user_result.scalar_one_or_none()
    is_new_user = user is None

    if is_new_user:
        user = User(phone=phone, phone_verified=True)
        db.add(user)
        await db.flush()
    else:
        user.phone_verified = True

    # Check for existing EHR data
    ehr_count = await db.scalar(
        select(func.count()).select_from(HealthFact).where(HealthFact.member_id == user.id)
    )
    has_ehr = (ehr_count or 0) > 0

    token = create_access_token(username=user.username, roles=user.roles or ["patient"])

    return {
        "access_token": token,
        "token_type": "bearer",
        "is_new_user": is_new_user,
        "has_ehr": has_ehr,
        "user": {
            "id": str(user.id),
            "phone": user.phone,
            "full_name": user.full_name,
            "preferred_language": user.preferred_language or 'en',
        },
    }


@router.get("/permissions")
async def get_permissions(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TenantMembership).where(
            TenantMembership.user_id == user.id,
            TenantMembership.active == True,
        ).limit(1)
    )
    membership = result.scalar_one_or_none()
    if not membership:
        return {"permissions": []}
    perms = OPERATOR_PERMISSIONS.get(membership.role, set())
    return {"permissions": sorted(perms)}


@router.patch("/profile")
async def update_profile(req: UpdateProfileRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    user.full_name = req.full_name.strip()
    user.preferred_language = req.preferred_language
    await db.flush()
    return {
        "id": str(user.id),
        "full_name": user.full_name,
        "preferred_language": user.preferred_language,
    }
