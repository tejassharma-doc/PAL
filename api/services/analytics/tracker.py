"""
Fire-and-forget analytics event tracker.

Events are written directly to PostgreSQL (async, non-blocking).
On DB failure the event is silently dropped — analytics must never
break user-facing flows.
"""
import uuid
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from models.analytics import AnalyticsEvent


async def track(
    db: AsyncSession,
    event_type: str,
    *,
    user_id: Optional[uuid.UUID] = None,
    source: Optional[str] = None,
    ref_code: Optional[str] = None,
    doctor_id: Optional[str] = None,
    clinic_id: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> None:
    """
    Append one analytics event row. Never raises.

    event_type values:
        app_install | hermes_notification_sent | notification_opened
        search_turn | call_started
    """
    try:
        event = AnalyticsEvent(
            user_id=user_id,
            event_type=event_type,
            source=source,
            ref_code=ref_code,
            doctor_id=doctor_id,
            clinic_id=clinic_id,
            metadata_=metadata,
        )
        db.add(event)
        # Flush but don't commit — the enclosing request handler commits
        await db.flush()
    except Exception:
        # Analytics failure must not surface to the user
        pass
