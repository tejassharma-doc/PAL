"""Enhanced authentication router with session management and dual login modes"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete
from pydantic import BaseModel, EmailStr, field_validator, Field
from datetime import datetime, timezone, timedelta, date as date_type
import re

from database import get_db
from models import User, OTPSession, HealthFact, TenantMembership, OPERATOR_PERMISSIONS
from auth import verify_password, hash_password, create_access_token, get_current_user
from services.otp import generate_otp, hash_otp, verify_otp_hash, send_otp, otp_expiry
from services.session_service import SessionService
from models.session import UserSession

router = APIRouter(prefix="/auth", tags=["auth"])

MAX_OTP_ATTEMPTS = 3


# ──────────────────────────────────────────────────────────────────────────────
# Request/Response Models
# ──────────────────────────────────────────────────────────────────────────────

# REMOVED: RegisterUserRequest model - signup functionality disabled


class LoginPasswordRequest(BaseModel):
    """Login using email/phone and password"""
    username: str  # Can be email or phone
    password: str


class LoginOTPRequest(BaseModel):
    """Request OTP for login"""
    phone: str
    delivery_channel: str = 'sms'
    email: Optional[str] = None


class VerifyOTPRequest(BaseModel):
    """Verify OTP code"""
    phone: str
    otp_code: str


class UpdateProfileRequest(BaseModel):
    """Update user profile information"""
    full_name: Optional[str] = None
    preferred_language: Optional[str] = None


# REMOVED: CheckUserRequest model - check-user endpoint disabled


class SessionResponse(BaseModel):
    """Session information"""
    id: str
    session_name: Optional[str]
    ip_address: Optional[str]
    last_activity: datetime
    created_at: datetime
    expires_at: datetime
    is_active: bool


class AuthResponse(BaseModel):
    """Standard authentication response"""
    access_token: str
    token_type: str = "bearer"
    expires_in: int  # Seconds until expiration
    user: dict
    session_id: str
    is_new_user: bool = False
    requires_onboarding: bool = False


# ──────────────────────────────────────────────────────────────────────────────
# Helper Functions
# ──────────────────────────────────────────────────────────────────────────────

def get_client_ip(request: Request) -> Optional[str]:
    """Extract client IP from request"""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


def get_user_agent(request: Request) -> Optional[str]:
    """Extract user agent from request"""
    return request.headers.get("User-Agent", "")[:500]


async def create_auth_response(
    db: AsyncSession,
    user: User,
    request: Request,
    is_new_user: bool = False
) -> dict:
    """Create standardized authentication response with session"""

    # Create JWT token with 7-day expiration (username + roles only)
    token_expiry = timedelta(days=7)
    access_token = create_access_token(
        username=user.username,
        roles=user.roles or ["patient"],
        expires_delta=token_expiry
    )

    # Create session in database with encrypted token
    session = await SessionService.create_session(
        db=db,
        user=user,
        access_token=access_token,
        session_name=get_user_agent(request)[:100],
        ip_address=get_client_ip(request),
        user_agent=get_user_agent(request),
        expires_delta=token_expiry,
    )

    # Check if patient profile exists
    from models import Patient
    patient_result = await db.execute(
        select(Patient).where(
            (Patient.email == user.email) | (Patient.email == user.username) | (Patient.phone == user.phone),
            Patient.is_active == True
        )
    )
    patient = patient_result.scalar_one_or_none()

    # User needs onboarding if no patient profile exists
    requires_onboarding = patient is None
    patient_id = str(patient.id) if patient else None

    # Check for existing health records
    ehr_count = await db.scalar(
        select(func.count()).select_from(HealthFact).where(HealthFact.member_id == user.id)
    )
    has_ehr = (ehr_count or 0) > 0

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "expires_in": int(token_expiry.total_seconds()),
        "session_id": str(session.id),
        "is_new_user": is_new_user,
        "requires_onboarding": requires_onboarding,
        "patient_id": patient_id,
        "user": {
            "id": str(user.id),
            "email": user.email,
            "phone": user.phone,
            "full_name": user.full_name,
            "phone_verified": user.phone_verified,
            "email_verified": user.email_verified,
            "preferred_language": user.preferred_language or 'en',
            "date_of_birth": str(user.date_of_birth) if user.date_of_birth else None,
            "has_ehr": has_ehr,
        }
    }


# ──────────────────────────────────────────────────────────────────────────────
# Registration Endpoints
# ──────────────────────────────────────────────────────────────────────────────

# REMOVED: User registration endpoint
# Users must be created through external means (admin panel, database, etc.)


# REMOVED: Check user endpoint (was used for signup flow)


# ──────────────────────────────────────────────────────────────────────────────
# Password-based Login
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/login/password", response_model=AuthResponse)
async def login_with_password(
    req: LoginPasswordRequest,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Login using email/phone and password.
    Creates JWT token and encrypted session in database.
    """
    username = req.username.strip().lower()

    # Find user by email or phone
    if '@' in username:
        result = await db.execute(select(User).where(User.email == username))
    else:
        phone = username.lstrip('+').replace(' ', '')
        result = await db.execute(select(User).where(User.phone == phone))

    user = result.scalar_one_or_none()

    # Verify user and password
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials."
        )

    if not user.hashed_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No password set. Please use OTP login or reset your password."
        )

    if not verify_password(req.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials."
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is inactive. Please contact support."
        )

    # Create auth response with session
    return await create_auth_response(db, user, request)


# ──────────────────────────────────────────────────────────────────────────────
# OTP-based Login
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/login/otp/request")
async def request_login_otp(
    req: LoginOTPRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Request OTP for phone-based login.
    Sends OTP via SMS or email. User must exist in the system.
    """
    phone = req.phone.strip().lstrip('+').replace(' ', '')

    if not phone:
        raise HTTPException(status_code=400, detail="Phone number is required.")

    # Check if user exists
    result = await db.execute(select(User).where(User.phone == phone))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=404,
            detail="No account found with this phone number. Please register first."
        )

    # Determine delivery address
    if req.delivery_channel == 'email':
        if not req.email and not user.email:
            raise HTTPException(
                status_code=400,
                detail="Email required for email delivery."
            )
        delivery_address = (req.email or user.email).strip().lower()
    else:
        delivery_address = phone

    # Delete previous unexpired OTP sessions
    await db.execute(
        delete(OTPSession).where(
            OTPSession.phone == phone,
            OTPSession.verified == False,
        )
    )

    # Generate and store OTP
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
    await db.commit()

    # Send OTP (mock in dev)
    dev_otp = send_otp(req.delivery_channel, delivery_address, code)

    return {
        "message": f"OTP sent via {req.delivery_channel} to {delivery_address}",
        "dev_otp": dev_otp,  # Remove in production
        "expires_in": 300,  # 5 minutes
    }


@router.post("/login/otp/verify", response_model=AuthResponse)
async def verify_login_otp(
    req: VerifyOTPRequest,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Verify OTP and create session.
    If user doesn't exist, creates a new user account (phone-only registration).
    """
    phone = req.phone.strip().lstrip('+').replace(' ', '')

    # Find latest unexpired OTP session
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
        raise HTTPException(
            status_code=400,
            detail="No active OTP found. Please request a new one."
        )

    if session.attempts >= MAX_OTP_ATTEMPTS:
        raise HTTPException(
            status_code=400,
            detail="Too many attempts. Please request a new OTP."
        )

    # Increment attempts
    session.attempts += 1

    # Verify OTP code
    if not verify_otp_hash(req.otp_code, session.otp_hash):
        remaining = MAX_OTP_ATTEMPTS - session.attempts
        await db.flush()
        await db.commit()
        raise HTTPException(
            status_code=400,
            detail=f"Incorrect code. {remaining} attempt(s) remaining."
        )

    # Mark OTP as verified
    session.verified = True

    # Find or create user
    user_result = await db.execute(select(User).where(User.phone == phone))
    user = user_result.scalar_one_or_none()
    is_new_user = user is None

    if is_new_user:
        # Create new user with phone only
        user = User(
            phone=phone,
            phone_verified=True,
            email_verified=False,
        )
        db.add(user)
        await db.flush()
    else:
        # Mark phone as verified
        user.phone_verified = True

    await db.commit()

    # Create auth response with session
    return await create_auth_response(db, user, request, is_new_user=is_new_user)


# ──────────────────────────────────────────────────────────────────────────────
# User Profile & Session Management
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/me")
async def get_current_user_profile(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get current authenticated user's profile"""
    # Check for health records
    ehr_count = await db.scalar(
        select(func.count()).select_from(HealthFact).where(HealthFact.member_id == user.id)
    )

    return {
        "id": str(user.id),
        "email": user.email,
        "phone": user.phone,
        "full_name": user.full_name,
        "phone_verified": user.phone_verified,
        "email_verified": user.email_verified,
        "preferred_language": user.preferred_language or 'en',
        "date_of_birth": str(user.date_of_birth) if user.date_of_birth else None,
        "has_ehr": (ehr_count or 0) > 0,
        "requires_onboarding": not user.full_name or not user.date_of_birth,
    }


@router.patch("/profile")
async def update_user_profile(
    req: UpdateProfileRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Update user profile information"""
    if req.full_name:
        user.full_name = req.full_name.strip()

    if req.preferred_language:
        user.preferred_language = req.preferred_language

    await db.flush()
    await db.commit()

    return {
        "id": str(user.id),
        "full_name": user.full_name,
        "preferred_language": user.preferred_language,
    }


@router.get("/sessions")
async def list_user_sessions(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """List all active sessions for the current user"""
    sessions = await SessionService.get_user_sessions(db, user.id, active_only=True)

    return {
        "sessions": [
            {
                "id": str(s.id),
                "session_name": s.session_name,
                "ip_address": s.ip_address,
                "last_activity": s.last_activity,
                "created_at": s.created_at,
                "expires_at": s.expires_at,
                "is_active": s.is_active,
            }
            for s in sessions
        ]
    }


@router.delete("/sessions/{session_id}")
async def revoke_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Revoke a specific session"""
    import uuid as uuid_module

    try:
        session_uuid = uuid_module.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session ID")

    # Verify session belongs to current user
    stmt = select(UserSession).where(UserSession.id == session_uuid)
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()

    if not session or session.user_id != user.id:
        raise HTTPException(status_code=404, detail="Session not found")

    success = await SessionService.revoke_session(db, session_uuid)

    if not success:
        raise HTTPException(status_code=404, detail="Session not found")

    return {"message": "Session revoked successfully"}


@router.post("/logout")
async def logout(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Logout from all sessions"""
    count = await SessionService.revoke_all_user_sessions(db, user.id)

    return {
        "message": "Logged out successfully",
        "revoked_sessions": count
    }


@router.get("/permissions")
async def get_user_permissions(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get user's permissions based on tenant membership"""
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


# ──────────────────────────────────────────────────────────────────────────────
# Legacy Compatibility Endpoints (Keep for backward compatibility)
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/request-otp")
async def legacy_request_otp(
    req: LoginOTPRequest,
    db: AsyncSession = Depends(get_db)
):
    """Legacy OTP request endpoint - redirects to new endpoint"""
    return await request_login_otp(req, db)


@router.post("/verify-otp")
async def legacy_verify_otp(
    req: VerifyOTPRequest,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """Legacy OTP verify endpoint - redirects to new endpoint"""
    return await verify_login_otp(req, request, db)


@router.post("/token")
async def legacy_token_login(
    request: Request,
    form: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db)
):
    """Legacy token login endpoint - redirects to new password login"""
    req = LoginPasswordRequest(username=form.username, password=form.password)
    return await login_with_password(req, request, db)
