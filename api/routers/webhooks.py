"""
Webhook Events API
Fetch webhook data by phone number
"""
from typing import Optional, List, Union
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from pydantic import BaseModel
from datetime import datetime
import uuid

from database import get_db
from models.phone_user import PhoneUser
from models.user import User
from auth import get_current_user_unified

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


# Response Models
class WebhookEvent(BaseModel):
    id: str
    event_type: Optional[str]
    source: Optional[str]
    timestamp: datetime
    payload: dict
    headers: Optional[dict]
    processed: bool
    processed_at: Optional[datetime]
    error_message: Optional[str]
    patient_id: Optional[str]
    created_at: datetime


class WebhookListResponse(BaseModel):
    total: int
    webhooks: List[WebhookEvent]
    phone_number: str


@router.get("/by-phone/{phone_number}")
async def get_webhooks_by_phone(
    phone_number: str,
    current_user: Union[PhoneUser, User] = Depends(get_current_user_unified),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    event_type: Optional[str] = None,
    processed: Optional[bool] = None
):
    """
    Get webhook events by phone number.
    Matches webhooks where payload contains the phone number or patient name.
    """
    # Clean phone number (remove +91 if present)
    clean_phone = phone_number.replace('+', '').replace(' ', '').replace('-', '')
    if clean_phone.startswith('91') and len(clean_phone) == 12:
        clean_phone = clean_phone[2:]

    # Build query conditions
    conditions = []
    params = {"phone": clean_phone}

    # Search in payload for phone number or patient records
    # Use JSONB operators to search for phone number
    query_text = """
        SELECT
            id,
            event_type,
            source,
            timestamp,
            payload,
            headers,
            processed,
            processed_at,
            error_message,
            patient_id,
            created_at,
            updated_at
        FROM webhook_events
        WHERE (
            -- Search in payload for phone number
            payload::text LIKE '%' || :phone || '%'
            OR
            -- Search via linked patient
            patient_id IN (
                SELECT id FROM patients WHERE phone = :phone
            )
        )
    """

    # Add event_type filter
    if event_type:
        query_text += " AND event_type = :event_type"
        params["event_type"] = event_type

    # Add processed filter
    if processed is not None:
        query_text += " AND processed = :processed"
        params["processed"] = processed

    # Add ordering and pagination
    query_text += " ORDER BY timestamp DESC LIMIT :limit OFFSET :offset"
    params["limit"] = limit
    params["offset"] = offset

    # Execute query
    result = await db.execute(text(query_text), params)
    rows = result.fetchall()

    # Convert to response model
    webhooks = []
    for row in rows:
        webhooks.append(WebhookEvent(
            id=str(row.id),
            event_type=row.event_type,
            source=row.source,
            timestamp=row.timestamp,
            payload=row.payload,
            headers=row.headers,
            processed=row.processed,
            processed_at=row.processed_at,
            error_message=row.error_message,
            patient_id=str(row.patient_id) if row.patient_id else None,
            created_at=row.created_at
        ))

    return WebhookListResponse(
        total=len(webhooks),
        webhooks=webhooks,
        phone_number=clean_phone
    )


@router.get("/my-webhooks")
async def get_my_webhooks(
    current_user: Union[PhoneUser, User] = Depends(get_current_user_unified),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    event_type: Optional[str] = None
):
    """
    Get webhook events for the authenticated user.
    Uses the user's phone number to find relevant webhooks.
    """
    # Get phone number from authenticated user
    if isinstance(current_user, PhoneUser):
        phone_number = current_user.phone_number
    elif hasattr(current_user, 'phone'):
        phone_number = current_user.phone
    else:
        raise HTTPException(
            status_code=400,
            detail="User does not have a phone number associated"
        )

    # Clean phone number
    clean_phone = phone_number.replace('+', '').replace(' ', '').replace('-', '')
    if clean_phone.startswith('91') and len(clean_phone) == 12:
        clean_phone = clean_phone[2:]

    # Build query
    query_text = """
        SELECT
            id,
            event_type,
            source,
            timestamp,
            payload,
            headers,
            processed,
            processed_at,
            error_message,
            patient_id,
            created_at,
            updated_at
        FROM webhook_events
        WHERE payload::text LIKE '%' || :phone || '%'
    """

    params = {"phone": clean_phone}

    if event_type:
        query_text += " AND event_type = :event_type"
        params["event_type"] = event_type

    query_text += " ORDER BY timestamp DESC LIMIT :limit OFFSET :offset"
    params["limit"] = limit
    params["offset"] = offset

    result = await db.execute(text(query_text), params)
    rows = result.fetchall()

    webhooks = []
    for row in rows:
        webhooks.append(WebhookEvent(
            id=str(row.id),
            event_type=row.event_type,
            source=row.source,
            timestamp=row.timestamp,
            payload=row.payload,
            headers=row.headers,
            processed=row.processed,
            processed_at=row.processed_at,
            error_message=row.error_message,
            patient_id=str(row.patient_id) if row.patient_id else None,
            created_at=row.created_at
        ))

    return WebhookListResponse(
        total=len(webhooks),
        webhooks=webhooks,
        phone_number=clean_phone
    )


@router.get("/{webhook_id}")
async def get_webhook_by_id(
    webhook_id: str,
    current_user: Union[PhoneUser, User] = Depends(get_current_user_unified),
    db: AsyncSession = Depends(get_db)
):
    """
    Get a specific webhook by ID.
    """
    query = text("""
        SELECT
            id,
            event_type,
            source,
            timestamp,
            payload,
            headers,
            processed,
            processed_at,
            error_message,
            patient_id,
            created_at,
            updated_at
        FROM webhook_events
        WHERE id = :webhook_id
    """)

    result = await db.execute(query, {"webhook_id": webhook_id})
    row = result.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Webhook not found")

    return WebhookEvent(
        id=str(row.id),
        event_type=row.event_type,
        source=row.source,
        timestamp=row.timestamp,
        payload=row.payload,
        headers=row.headers,
        processed=row.processed,
        processed_at=row.processed_at,
        error_message=row.error_message,
        patient_id=str(row.patient_id) if row.patient_id else None,
        created_at=row.created_at
    )


@router.get("/medical-reports/by-phone/{phone_number}")
async def get_medical_reports_by_phone(
    phone_number: str,
    current_user: Union[PhoneUser, User] = Depends(get_current_user_unified),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(10, ge=1, le=50)
):
    """
    Get medical report webhooks by phone number.
    Returns only medical_report event types with lab reports.
    """
    # Clean phone number
    clean_phone = phone_number.replace('+', '').replace(' ', '').replace('-', '')
    if clean_phone.startswith('91') and len(clean_phone) == 12:
        clean_phone = clean_phone[2:]

    query = text("""
        SELECT
            id,
            event_type,
            timestamp,
            payload,
            processed,
            patient_id,
            created_at
        FROM webhook_events
        WHERE event_type = 'medical_report'
          AND payload::text LIKE '%' || :phone || '%'
        ORDER BY timestamp DESC
        LIMIT :limit
    """)

    result = await db.execute(query, {"phone": clean_phone, "limit": limit})
    rows = result.fetchall()

    medical_reports = []
    for row in rows:
        payload = row.payload
        medical_reports.append({
            "id": str(row.id),
            "timestamp": row.timestamp,
            "patient_name": payload.get("patient_name"),
            "patient_age": payload.get("patient_age"),
            "patient_gender": payload.get("patient_gender"),
            "service_provider": payload.get("service_provider"),
            "lab_reports": payload.get("lab_reports", []),
            "processed": row.processed,
            "created_at": row.created_at
        })

    return {
        "total": len(medical_reports),
        "phone_number": clean_phone,
        "medical_reports": medical_reports
    }


@router.post("/{webhook_id}/link-patient")
async def link_webhook_to_patient(
    webhook_id: str,
    patient_id: str,
    current_user: Union[PhoneUser, User] = Depends(get_current_user_unified),
    db: AsyncSession = Depends(get_db)
):
    """
    Link a webhook to a patient and mark as processed.
    """
    query = text("""
        UPDATE webhook_events
        SET patient_id = :patient_id,
            processed = true,
            processed_at = NOW(),
            updated_at = NOW()
        WHERE id = :webhook_id
        RETURNING id, patient_id, processed
    """)

    result = await db.execute(
        query,
        {"webhook_id": webhook_id, "patient_id": patient_id}
    )
    await db.commit()

    row = result.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Webhook not found")

    return {
        "success": True,
        "webhook_id": str(row.id),
        "patient_id": str(row.patient_id),
        "processed": row.processed
    }


@router.get("/stats/by-phone/{phone_number}")
async def get_webhook_stats_by_phone(
    phone_number: str,
    current_user: Union[PhoneUser, User] = Depends(get_current_user_unified),
    db: AsyncSession = Depends(get_db)
):
    """
    Get webhook statistics for a phone number.
    """
    # Clean phone number
    clean_phone = phone_number.replace('+', '').replace(' ', '').replace('-', '')
    if clean_phone.startswith('91') and len(clean_phone) == 12:
        clean_phone = clean_phone[2:]

    query = text("""
        SELECT
            event_type,
            COUNT(*) as count,
            SUM(CASE WHEN processed THEN 1 ELSE 0 END) as processed_count,
            MAX(timestamp) as latest_timestamp
        FROM webhook_events
        WHERE payload::text LIKE '%' || :phone || '%'
        GROUP BY event_type
        ORDER BY count DESC
    """)

    result = await db.execute(query, {"phone": clean_phone})
    rows = result.fetchall()

    stats = []
    for row in rows:
        stats.append({
            "event_type": row.event_type,
            "total_count": row.count,
            "processed_count": row.processed_count,
            "unprocessed_count": row.count - row.processed_count,
            "latest_timestamp": row.latest_timestamp
        })

    return {
        "phone_number": clean_phone,
        "statistics": stats,
        "total_webhooks": sum(s["total_count"] for s in stats)
    }
