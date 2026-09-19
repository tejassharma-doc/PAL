"""
Appointment router — voice booking, slot lookup, confirm, clinic messaging.

All booking actions are HMAC-gated: the AppointmentAgent generates a
confirm_token when it proposes a booking; the patient must echo that token back
before the action is written to DocEHR or the DB.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from config import get_settings
from database import get_db
from models import AppointmentRequest, AppointmentRequestStatus, User
from services.action_token import validate_confirm_token
from services.agents.appointment_agent import AppointmentAgent
from services.ai_provider import get_ai_client
from services.docehr import DocEHRClient

router = APIRouter(prefix="/appointment", tags=["appointment"])


# ── Request / response schemas ─────────────────────────────────────────────────

class SlotsRequest(BaseModel):
    doctor_id: str = "default"
    date_from: str
    date_to: str


class BookRequest(BaseModel):
    slot_id: str
    reason: str
    confirm_token: str
    session_id: str
    tenant_id: uuid.UUID
    member_id: uuid.UUID


class MessageRequest(BaseModel):
    doctor_id: str
    message_text: str
    confirm_token: str
    session_id: str
    tenant_id: uuid.UUID
    member_id: uuid.UUID


class VoiceRequest(BaseModel):
    transcript: str
    session_id: str
    tenant_id: uuid.UUID
    preferred_lang: Optional[str] = None


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/slots")
async def get_slots(
    req: SlotsRequest,
    user: User = Depends(get_current_user),
):
    """Return available appointment slots from DocEHR (or stub)."""
    client = DocEHRClient()
    slots = await client.get_available_slots(
        doctor_id=req.doctor_id,
        date_from=req.date_from,
        date_to=req.date_to,
    )
    return {"slots": slots}


@router.post("/book")
async def book_appointment(
    req: BookRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Validate HMAC token, book via DocEHR, write AppointmentRequest row."""
    settings = get_settings()
    payload = {"slot_id": req.slot_id, "reason": req.reason}
    if not validate_confirm_token(
        token=req.confirm_token,
        secret=settings.secret_key,
        session_id=req.session_id,
        action_type="booking",
        payload=payload,
    ):
        raise HTTPException(status_code=400, detail="Invalid or expired confirm token.")

    docehr = DocEHRClient()
    booking = await docehr.book_appointment(
        patient_id=str(req.member_id),
        slot_id=req.slot_id,
        reason=req.reason,
    )

    appt = AppointmentRequest(
        tenant_id=req.tenant_id,
        member_id=req.member_id,
        requesting_user_id=user.id,
        session_id=req.session_id,
        action_type="booking",
        action_payload={"slot_id": req.slot_id, "reason": req.reason, "booking": booking},
        status=AppointmentRequestStatus.dispatched,
        confirmed_at=datetime.now(timezone.utc),
        dispatched_at=datetime.now(timezone.utc),
    )
    db.add(appt)
    await db.commit()
    await db.refresh(appt)

    return {
        "appointment_request_id": str(appt.id),
        "booking": booking,
        "message": "Appointment requested — the clinic will confirm shortly.",
    }


@router.post("/message")
async def send_message(
    req: MessageRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Validate HMAC token, send message via DocEHR, write AppointmentRequest row."""
    settings = get_settings()
    payload = {"doctor_id": req.doctor_id, "message_text": req.message_text}
    if not validate_confirm_token(
        token=req.confirm_token,
        secret=settings.secret_key,
        session_id=req.session_id,
        action_type="messaging",
        payload=payload,
    ):
        raise HTTPException(status_code=400, detail="Invalid or expired confirm token.")

    docehr = DocEHRClient()
    result = await docehr.send_clinic_message(
        patient_id=str(req.member_id),
        doctor_id=req.doctor_id,
        message=req.message_text,
    )

    appt = AppointmentRequest(
        tenant_id=req.tenant_id,
        member_id=req.member_id,
        requesting_user_id=user.id,
        session_id=req.session_id,
        action_type="messaging",
        action_payload={"doctor_id": req.doctor_id, "message_text": req.message_text, "result": result},
        status=AppointmentRequestStatus.dispatched,
        confirmed_at=datetime.now(timezone.utc),
        dispatched_at=datetime.now(timezone.utc),
    )
    db.add(appt)
    await db.commit()
    await db.refresh(appt)

    return {
        "appointment_request_id": str(appt.id),
        "message_result": result,
        "message": "Message queued — your clinic will receive it shortly.",
    }


@router.post("/voice")
async def voice_booking(
    req: VoiceRequest,
    user: User = Depends(get_current_user),
):
    """
    Voice → appointment proposal.

    Passes the patient's voice transcript through the AppointmentAgent to extract
    booking intent and slots. Also fetches available DocEHR slots when the agent
    identifies a specific doctor/date so the patient can pick a real slot.
    """
    settings = get_settings()
    ai_client = get_ai_client(settings)
    agent = AppointmentAgent(ai_client)

    agent_result = await agent.run(
        query=req.transcript,
        record_context=None,
        is_second_opinion=False,
        multilingual_lang=req.preferred_lang,
        session_id=req.session_id,
        secret_key=settings.secret_key,
    )

    # If agent extracted a complete slot, fetch real availability from DocEHR
    available_slots: list[dict] = []
    proposed = agent_result.get("proposed_actions", [])
    if proposed:
        action = proposed[0]
        ap = action.get("action_payload", {})
        doctor_id = ap.get("doctor_id", "default")
        date_from = ap.get("preferred_date", "")
        if date_from:
            from datetime import timedelta
            try:
                from datetime import date
                dt = datetime.fromisoformat(date_from)
                date_to = (dt + timedelta(days=7)).date().isoformat()
                docehr = DocEHRClient()
                available_slots = await docehr.get_available_slots(
                    doctor_id=doctor_id,
                    date_from=date_from,
                    date_to=date_to,
                )
            except Exception:
                pass

    return {
        "proposed_actions": proposed,
        "available_slots": available_slots,
        "agent_output": agent_result.get("output"),
    }
