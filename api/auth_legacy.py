"""JWT auth utilities."""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional
import bcrypt

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from config import get_settings
from database import get_db
from models import User, TenantMembership, TenantRole

settings = get_settings()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/token")


def verify_password(plain: str, hashed: str) -> bool:
    """Verify a password against a bcrypt hash"""
    # bcrypt has a 72-byte limit
    password_bytes = plain.encode('utf-8')[:72]
    hashed_bytes = hashed.encode('utf-8') if isinstance(hashed, str) else hashed
    return bcrypt.checkpw(password_bytes, hashed_bytes)


def hash_password(plain: str) -> str:
    """Hash a password using bcrypt"""
    # bcrypt has a 72-byte limit
    password_bytes = plain.encode('utf-8')[:72]
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password_bytes, salt)
    return hashed.decode('utf-8')


def create_access_token(username: str, roles: list[str] = None, expires_delta: Optional[timedelta] = None) -> str:
    """Create JWT token with username and roles only"""
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=settings.access_token_expire_minutes))
    payload = {
        "sub": username,  # subject = username
        "roles": roles or ["patient"],
        "exp": expire
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Get current user from JWT token (username-based)"""
    creds_exception = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Could not validate credentials")
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        username: str = payload.get("sub")  # sub contains username now
        if not username:
            raise creds_exception
    except JWTError:
        raise creds_exception

    result = await db.execute(select(User).where(User.username == username))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise creds_exception
    return user


class CurrentMembership:
    """Dependency: current user + their active membership in a tenant."""
    def __init__(self, required_role: Optional[TenantRole] = None):
        self.required_role = required_role

    async def __call__(
        self,
        tenant_id: uuid.UUID,
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> TenantMembership:
        stmt = select(TenantMembership).where(
            TenantMembership.user_id == user.id,
            TenantMembership.tenant_id == tenant_id,
            TenantMembership.active == True,
        )
        result = await db.execute(stmt)
        membership = result.scalar_one_or_none()
        if not membership:
            raise HTTPException(status_code=403, detail="Not a member of this tenant.")
        if self.required_role and membership.role != self.required_role:
            raise HTTPException(status_code=403, detail="Insufficient role.")
        return membership
