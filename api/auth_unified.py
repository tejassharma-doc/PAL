"""
Unified Authentication System
Supports both phone OTP (primary) and email/password (legacy)
"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional, Union
import bcrypt
import secrets

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from config import get_settings
from database import get_db
from models.user import User
from models.phone_user import PhoneUser

settings = get_settings()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/token", auto_error=False)


def verify_password(plain: str, hashed: str) -> bool:
    """Verify a password against a bcrypt hash"""
    password_bytes = plain.encode('utf-8')[:72]
    hashed_bytes = hashed.encode('utf-8') if isinstance(hashed, str) else hashed
    return bcrypt.checkpw(password_bytes, hashed_bytes)


def hash_password(plain: str) -> str:
    """Hash a password using bcrypt"""
    password_bytes = plain.encode('utf-8')[:72]
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password_bytes, salt)
    return hashed.decode('utf-8')


def create_phone_token(user_id: str, phone_number: str, expires_delta: Optional[timedelta] = None) -> str:
    """Create JWT token for phone-authenticated user"""
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(days=30))
    payload = {
        "sub": user_id,  # Phone user UUID
        "phone": phone_number,
        "auth_type": "phone",
        "exp": expire
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def create_access_token(username: str, user_id: str = None, roles: list[str] = None, expires_delta: Optional[timedelta] = None) -> str:
    """Create JWT token for email/password user (legacy)"""
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=settings.access_token_expire_minutes))
    payload = {
        "sub": user_id or username,
        "username": username,
        "auth_type": "email",
        "roles": roles or ["patient"],
        "exp": expire
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


async def get_current_user_unified(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> Union[PhoneUser, User]:
    """
    Get current user from JWT token.
    Supports both phone OTP tokens and email/password tokens.
    Returns PhoneUser for phone auth, User for email auth.
    """
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    creds_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        user_id: str = payload.get("sub")
        auth_type: str = payload.get("auth_type", "email")  # Default to email for backward compatibility

        if not user_id:
            raise creds_exception

        # Phone authentication (PRIMARY)
        if auth_type == "phone":
            phone_number = payload.get("phone")
            result = await db.execute(
                select(PhoneUser).where(
                    PhoneUser.id == uuid.UUID(user_id),
                    PhoneUser.is_active == True
                )
            )
            phone_user = result.scalar_one_or_none()

            if not phone_user:
                raise creds_exception

            return phone_user

        # Email/password authentication (LEGACY)
        else:
            # Try by user_id first (if it's a UUID)
            try:
                user_uuid = uuid.UUID(user_id)
                result = await db.execute(
                    select(User).where(User.id == user_uuid, User.is_active == True)
                )
                user = result.scalar_one_or_none()
                if user:
                    return user
            except (ValueError, AttributeError):
                pass

            # Fallback to username
            result = await db.execute(
                select(User).where(User.username == user_id, User.is_active == True)
            )
            user = result.scalar_one_or_none()

            if not user:
                raise creds_exception

            return user

    except JWTError as e:
        print(f"JWT Error: {e}")
        raise creds_exception


async def get_current_phone_user(
    current_user: Union[PhoneUser, User] = Depends(get_current_user_unified)
) -> PhoneUser:
    """
    Ensure the current user is a phone-authenticated user.
    Use this for endpoints that require phone authentication.
    """
    if not isinstance(current_user, PhoneUser):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Phone authentication required"
        )
    return current_user


async def get_user_id(
    current_user: Union[PhoneUser, User] = Depends(get_current_user_unified)
) -> uuid.UUID:
    """
    Get the user ID regardless of authentication type.
    This is the main dependency to use in endpoints.
    """
    return current_user.id


def get_phone_number(current_user: Union[PhoneUser, User]) -> Optional[str]:
    """Extract phone number from user object"""
    if isinstance(current_user, PhoneUser):
        return current_user.phone_number
    elif hasattr(current_user, 'phone'):
        return current_user.phone
    return None
