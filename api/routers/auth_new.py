"""New authentication with users/patients separation"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, EmailStr, Field
from datetime import datetime
import re

from database import get_db
from models import User, Patient
from auth import hash_password, verify_password, create_access_token, get_current_user
from services.session_service import SessionService

router = APIRouter(prefix="/auth", tags=["auth"])


# ──────────────────────────────────────────────────────────────────────────────
# Request Models
# ──────────────────────────────────────────────────────────────────────────────

class SignupRequest(BaseModel):
    """Signup creates User (auth only). Patient profile filled separately."""
    username: str = Field(..., min_length=3, max_length=100)
    email: EmailStr
    password: str = Field(..., min_length=8)


class LoginRequest(BaseModel):
    """Login with username or email"""
    username: str  # Can be username or email
    password: str


class ForgotPasswordRequest(BaseModel):
    """Request to reset password via email"""
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    """Reset password with OTP"""
    email: EmailStr
    otp_code: str = Field(..., min_length=6, max_length=6)
    new_password: str = Field(..., min_length=8)


# ──────────────────────────────────────────────────────────────────────────────
# Signup Endpoint
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/signup")
async def signup(
    req: SignupRequest,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Sign up creates User (authentication) + Patient (personal data).
    Returns JWT token and user/patient info.
    """

    # Check username already exists
    result = await db.execute(select(User).where(User.username == req.username))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Username already taken")

    # Check email already exists
    result = await db.execute(select(User).where(User.email == req.email.lower()))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    # Validate password strength
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if not re.search(r'[A-Z]', req.password):
        raise HTTPException(status_code=400, detail="Password must contain at least one uppercase letter")
    if not re.search(r'[a-z]', req.password):
        raise HTTPException(status_code=400, detail="Password must contain at least one lowercase letter")
    if not re.search(r'[0-9]', req.password):
        raise HTTPException(status_code=400, detail="Password must contain at least one number")

    # Create User (authentication only)
    user = User(
        username=req.username,
        email=req.email.lower(),
        hashed_password=hash_password(req.password),
        password_updated_at=datetime.now(),
        password_updated_count=0,
        is_active=True
    )
    db.add(user)
    await db.flush()

    # Commit user
    await db.commit()
    await db.refresh(user)

    # Create JWT token (no session for signup - just return success)
    # User will login after signup to create session

    return {
        "success": True,
        "user": {
            "id": str(user.id),
            "username": user.username,
            "email": user.email,
            "is_active": user.is_active
        },
        "message": "Account created successfully. Please login."
    }


# ──────────────────────────────────────────────────────────────────────────────
# Login Endpoint
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/login")
async def login(
    req: LoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Login with username/email and password.
    Returns JWT token and user/patient info.
    """

    # Find user by username or email
    if '@' in req.username:
        # Login with email
        result = await db.execute(select(User).where(User.email == req.username.lower()))
    else:
        # Login with username
        result = await db.execute(select(User).where(User.username == req.username))

    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Verify password
    if not verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled")

    # Get patient record by matching email (since patients are now independent)
    # Order by created_at to get the first/original patient record
    from sqlalchemy import asc
    result = await db.execute(
        select(Patient)
        .where(Patient.email == user.email, Patient.is_active == True)
        .order_by(asc(Patient.created_at))
        .limit(1)
    )
    patient = result.scalar_one_or_none()

    # Create JWT token
    token = create_access_token(username=user.username, roles=user.roles or ["patient"])

    # Create session
    ip_address = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent", "")

    session = await SessionService.create_session(
        db=db,
        user=user,
        access_token=token,
        session_name=f"{user.username}'s session",
        ip_address=ip_address,
        user_agent=user_agent
    )

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": str(user.id),
            "username": user.username,
            "email": user.email,
            "is_active": user.is_active
        },
        "patient": {
            "id": str(patient.id),
            "full_name": patient.full_name,
            "phone": patient.phone,
            "email": patient.email
        } if patient else None,
        "session_id": str(session.id)
    }


# ──────────────────────────────────────────────────────────────────────────────
# Get Current User + Patient
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/me")
async def get_me(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get current authenticated user and their primary patient record"""

    # Get patient record by matching email
    result = await db.execute(
        select(Patient).where(Patient.email == user.email, Patient.is_active == True).limit(1)
    )
    patient = result.scalar_one_or_none()

    return {
        "user": {
            "id": str(user.id),
            "username": user.username,
            "email": user.email,
            "is_active": user.is_active,
            "created_at": user.created_at.isoformat() if user.created_at else None
        },
        "patient": {
            "id": str(patient.id),
            "full_name": patient.full_name,
            "phone": patient.phone,
            "email": patient.email,
            "date_of_birth": str(patient.date_of_birth) if patient.date_of_birth else None,
            "gender": patient.gender,
            "blood_group": patient.blood_group,
            "address": patient.address,
            "photo_url": patient.photo_url
        } if patient else None
    }


# ──────────────────────────────────────────────────────────────────────────────
# Forgot Password Endpoints
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/forgot-password")
async def forgot_password(
    req: ForgotPasswordRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Request password reset - sends OTP to email.
    Returns success even if email doesn't exist (security best practice).
    """
    import secrets
    from models import OTPSession
    from datetime import timedelta

    # Check if user exists
    result = await db.execute(
        select(User).where(User.email == req.email.lower())
    )
    user = result.scalar_one_or_none()

    if user:
        # Generate 6-digit OTP
        otp_code = ''.join([str(secrets.randbelow(10)) for _ in range(6)])

        # Store OTP in database (expires in 10 minutes)
        expires_at = datetime.utcnow() + timedelta(minutes=10)

        otp_session = OTPSession(
            phone=user.email,  # Using email field to store email
            otp_code=otp_code,
            expires_at=expires_at,
            verified=False
        )

        db.add(otp_session)
        await db.commit()

        # TODO: Send email with OTP
        # For now, return OTP in development mode (REMOVE IN PRODUCTION!)
        import logging
        logger = logging.getLogger(__name__)
        logger.info(f"Password reset OTP for {req.email}: {otp_code}")

        return {
            "success": True,
            "message": "If this email exists, an OTP has been sent.",
            "dev_otp": otp_code  # REMOVE IN PRODUCTION!
        }

    # Return success even if user doesn't exist (security best practice)
    return {
        "success": True,
        "message": "If this email exists, an OTP has been sent."
    }


@router.post("/reset-password")
async def reset_password(
    req: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Reset password using OTP code.
    """
    from models import OTPSession

    # Find user
    result = await db.execute(
        select(User).where(User.email == req.email.lower())
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Verify OTP
    otp_result = await db.execute(
        select(OTPSession)
        .where(
            OTPSession.phone == req.email.lower(),
            OTPSession.otp_code == req.otp_code,
            OTPSession.verified == False,
            OTPSession.expires_at > datetime.utcnow()
        )
        .order_by(OTPSession.created_at.desc())
        .limit(1)
    )
    otp_session = otp_result.scalar_one_or_none()

    if not otp_session:
        raise HTTPException(status_code=400, detail="Invalid or expired OTP")

    # Update password
    user.hashed_password = hash_password(req.new_password)
    user.password_updated_at = datetime.utcnow()
    user.password_updated_count = (user.password_updated_count or 0) + 1

    # Mark OTP as verified
    otp_session.verified = True

    await db.commit()

    return {
        "success": True,
        "message": "Password has been reset successfully. Please login with your new password."
    }
