"""Follow-up appointment orchestration endpoints.

Two execution paths:

  1. In-app LLM path (preferred — no PHI leaves device):
       POST /follow-up/preflight  → backend checks only
       [browser runs SmolLM2-1.7B conversation]
       POST /follow-up/complete   → backend writes EHR

  2. Cloud LLM fallback (low-end devices without on-device model):
       POST /follow-up/dispatch   → backend pre-flight + Claude Sonnet + EHR write
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from database import get_db
from models import User
from services.hermes.follow_up_orchestrator import FollowUpOrchestrator, PreflightError

router = APIRouter(prefix="/follow-up", tags=["follow-up"])

_PREFLIGHT_409 = lambda e: HTTPException(
    status_code=409,
    detail={"preflight_failed": True, "reason": e.reason, "message": e.detail},
)


# ── Shared schemas ─────────────────────────────────────────────────────────────

class CallResult(BaseModel):
    """Structured output from the voice simulation (on-device or cloud)."""
    call_status: str
    appointment_datetime: Optional[str] = None
    lab_report_status: str = "N/A"
    extracted_lab_entities: list[str] = []
    transcript: str = ""


# ── Path 1a: Pre-flight check (in-app LLM path) ───────────────────────────────

class PreflightRequest(BaseModel):
    patient_age: int
    mic_available: bool = True


@router.post("/preflight")
async def preflight(
    req: PreflightRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Run Hermes pre-flight checks without dispatching any LLM call.

    On success (200): browser proceeds to run the conversation via
    the on-device SmolLM2-1.7B worker, then posts to /follow-up/complete.

    On failure (409): returns {reason, message} so the UI can explain
    why the call cannot happen yet (existing booking / mic busy / wrong time).
    """
    orch = FollowUpOrchestrator(db)
    try:
        await orch.run_preflight(
            member_id=user.id,
            patient_age=req.patient_age,
            mic_available=req.mic_available,
        )
        return {
            "ok": True,
            "patient_language": user.preferred_language or "en",
            "patient_name": user.full_name or "",
        }
    except PreflightError as e:
        raise _PREFLIGHT_409(e)


# ── Path 1b: Complete (in-app LLM path) ───────────────────────────────────────

class CompleteRequest(BaseModel):
    doctor_name: str
    lab_test_details: Optional[str] = None
    result: CallResult


@router.post("/complete")
async def complete_follow_up(
    req: CompleteRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Persist the on-device call result to the EHR.

    Called after the browser finishes the SmolLM2 conversation.
    Only the structured extraction (call_status, appointment_datetime, etc.)
    and transcript snippet are written to the database — not raw PHI.
    """
    orch = FollowUpOrchestrator(db)
    call_id = await orch.complete_call(
        member_id=user.id,
        requesting_user_id=user.id,
        session_id=str(uuid.uuid4()),
        doctor_name=req.doctor_name,
        lab_test_details=req.lab_test_details,
        call_result=req.result.model_dump(),
    )
    await db.commit()
    return {"status": "saved", "call_id": str(call_id)}


# ── Path 2: Cloud fallback (dispatch via Claude Sonnet) ───────────────────────

class DispatchRequest(BaseModel):
    patient_age: int
    doctor_name: str
    requires_lab_test: bool = False
    lab_test_details: Optional[str] = None
    available_slots: list[str] = []
    mic_available: bool = True


@router.post("/dispatch")
async def dispatch_follow_up(
    req: DispatchRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Cloud LLM fallback: run pre-flight + Voice Worker Agent (Claude Sonnet) + EHR write.

    Use this when the device is low-tier and the on-device model is unavailable
    (runFollowUpCall() returned null in the browser). Pre-flight gates apply here too.

    Language and patient name are read from the authenticated user's profile —
    no need to send them in the request body.
    """
    orch = FollowUpOrchestrator(db)
    try:
        result = await orch.dispatch(
            member_id=user.id,
            requesting_user_id=user.id,
            session_id=str(uuid.uuid4()),
            patient_name=user.full_name or "",
            patient_age=req.patient_age,
            patient_language=user.preferred_language or "en",
            doctor_name=req.doctor_name,
            requires_lab_test=req.requires_lab_test,
            lab_test_details=req.lab_test_details,
            available_slots=req.available_slots,
            mic_available=req.mic_available,
        )
        await db.commit()
        return result
    except PreflightError as e:
        raise _PREFLIGHT_409(e)
