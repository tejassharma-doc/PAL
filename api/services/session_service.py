"""Session management service with encrypted JWT storage"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from models.session import UserSession
from models import User
from services.encryption import token_encryption


class SessionService:
    """Manages user sessions with encrypted JWT tokens"""

    @staticmethod
    async def create_session(
        db: AsyncSession,
        user: User,
        access_token: str,
        session_name: Optional[str] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        expires_delta: timedelta = timedelta(days=7),
    ) -> UserSession:
        """Create a new session with encrypted token"""
        now = datetime.now(timezone.utc)
        expires_at = now + expires_delta

        # Encrypt the JWT token
        encrypted_token = token_encryption.encrypt_token(access_token)

        session = UserSession(
            user_id=user.id,
            encrypted_token=encrypted_token,
            session_name=session_name,
            ip_address=ip_address,
            user_agent=user_agent,
            is_active=True,
            last_activity=now,
            expires_at=expires_at,
            created_at=now,
        )

        db.add(session)
        await db.commit()
        await db.refresh(session)

        return session

    @staticmethod
    async def get_active_session(
        db: AsyncSession,
        user_id: uuid.UUID,
        token: str
    ) -> Optional[UserSession]:
        """Get an active session by user ID and token"""
        encrypted_token = token_encryption.encrypt_token(token)
        now = datetime.now(timezone.utc)

        stmt = select(UserSession).where(
            and_(
                UserSession.user_id == user_id,
                UserSession.encrypted_token == encrypted_token,
                UserSession.is_active == True,
                UserSession.expires_at > now,
            )
        )

        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    @staticmethod
    async def validate_and_update_session(
        db: AsyncSession,
        session: UserSession
    ) -> bool:
        """Update last activity timestamp for a session"""
        now = datetime.now(timezone.utc)

        # Check if expired
        if session.expires_at <= now or not session.is_active:
            return False

        # Update last activity
        session.last_activity = now
        await db.commit()

        return True

    @staticmethod
    async def revoke_session(
        db: AsyncSession,
        session_id: uuid.UUID
    ) -> bool:
        """Revoke a specific session"""
        stmt = select(UserSession).where(UserSession.id == session_id)
        result = await db.execute(stmt)
        session = result.scalar_one_or_none()

        if not session:
            return False

        session.is_active = False
        session.revoked_at = datetime.now(timezone.utc)
        await db.commit()

        return True

    @staticmethod
    async def revoke_all_user_sessions(
        db: AsyncSession,
        user_id: uuid.UUID
    ) -> int:
        """Revoke all active sessions for a user (e.g., on password change)"""
        now = datetime.now(timezone.utc)

        stmt = select(UserSession).where(
            and_(
                UserSession.user_id == user_id,
                UserSession.is_active == True,
            )
        )

        result = await db.execute(stmt)
        sessions = result.scalars().all()

        count = 0
        for session in sessions:
            session.is_active = False
            session.revoked_at = now
            count += 1

        await db.commit()
        return count

    @staticmethod
    async def get_user_sessions(
        db: AsyncSession,
        user_id: uuid.UUID,
        active_only: bool = True
    ) -> list[UserSession]:
        """Get all sessions for a user"""
        conditions = [UserSession.user_id == user_id]

        if active_only:
            conditions.append(UserSession.is_active == True)
            conditions.append(UserSession.expires_at > datetime.now(timezone.utc))

        stmt = select(UserSession).where(and_(*conditions)).order_by(UserSession.last_activity.desc())

        result = await db.execute(stmt)
        return list(result.scalars().all())

    @staticmethod
    async def cleanup_expired_sessions(db: AsyncSession) -> int:
        """Remove expired sessions (can be run as a scheduled task)"""
        now = datetime.now(timezone.utc)

        stmt = select(UserSession).where(
            and_(
                UserSession.is_active == True,
                UserSession.expires_at <= now,
            )
        )

        result = await db.execute(stmt)
        sessions = result.scalars().all()

        count = 0
        for session in sessions:
            session.is_active = False
            session.revoked_at = now
            count += 1

        await db.commit()
        return count
