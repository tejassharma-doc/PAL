"""Medication schedules + reminder responses + push device tokens (REST).

Gated by MEDICATION_REMINDER_ENABLED (see main.py). All patient-scoped routes go
through verify_patient_ownership to prevent IDOR. The Celery worker reads the
tables these endpoints write; the only task this router enqueues directly is the
re-prompt for a "snooze_10" response.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Optional, Union

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user_unified
from database import get_db
from dependencies.authz import verify_patient_ownership
from models.medication import MedicationSchedule, MedicationDoseEvent, DeviceToken
from models.phone_user import PhoneUser
from models.user import User

router = APIRouter(prefix="/medications", tags=["medications"])

_RESPONSE_STATUS = {
    "yes": "taken",
    "take_now": "taken",
    "no": "skipped",
    "snooze_10": "snoozed",
}


# ── schemas ──────────────────────────────────────────────────────────────────

class ScheduleIn(BaseModel):
    patient_id: str
    medicine_name: str = Field(min_length=1, max_length=300)
    dosage: Optional[str] = Field(default=None, max_length=200)
    times: list[str] = Field(default_factory=list)          # ["09:00", "21:00"]
    days_of_week: list[int] = Field(default_factory=list)   # [] => daily; Mon=0
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    timezone: str = "Asia/Kolkata"
    notes: Optional[str] = None


class ScheduleUpdate(BaseModel):
    medicine_name: Optional[str] = Field(default=None, max_length=300)
    dosage: Optional[str] = Field(default=None, max_length=200)
    times: Optional[list[str]] = None
    days_of_week: Optional[list[int]] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    timezone: Optional[str] = None
    active: Optional[bool] = None
    notes: Optional[str] = None


class RespondIn(BaseModel):
    response: str  # yes | no | take_now | snooze_10


class DeviceTokenIn(BaseModel):
    platform: str  # ios | android | web
    token: str


def _schedule_out(s: MedicationSchedule) -> dict:
    return {
        "id": str(s.id),
        "patient_id": str(s.patient_id),
        "medicine_name": s.medicine_name,
        "dosage": s.dosage,
        "times": s.times or [],
        "days_of_week": s.days_of_week or [],
        "start_date": s.start_date.isoformat() if s.start_date else None,
        "end_date": s.end_date.isoformat() if s.end_date else None,
        "timezone": s.timezone,
        "active": s.active,
        "notes": s.notes,
    }


def _dose_out(d: MedicationDoseEvent) -> dict:
    return {
        "id": str(d.id),
        "schedule_id": str(d.schedule_id),
        "patient_id": str(d.patient_id),
        "scheduled_date": d.scheduled_date.isoformat(),
        "scheduled_time": d.scheduled_time.strftime("%H:%M"),
        "status": d.status,
        "response": d.response,
    }


# ── schedules ────────────────────────────────────────────────────────────────

@router.post("/schedules")
async def create_schedule(
    body: ScheduleIn,
    user: Union[PhoneUser, User] = Depends(get_current_user_unified),
    db: AsyncSession = Depends(get_db),
):
    patient = await verify_patient_ownership(body.patient_id, user, db)
    sched = MedicationSchedule(
        patient_id=patient.id,
        phone_user_id=patient.phone_user_id,
        medicine_name=body.medicine_name,
        dosage=body.dosage,
        times=body.times,
        days_of_week=body.days_of_week,
        start_date=body.start_date,
        end_date=body.end_date,
        timezone=body.timezone,
        notes=body.notes,
    )
    db.add(sched)
    await db.commit()
    await db.refresh(sched)
    return _schedule_out(sched)


@router.get("/schedules")
async def list_schedules(
    patient_id: str = Query(...),
    user: Union[PhoneUser, User] = Depends(get_current_user_unified),
    db: AsyncSession = Depends(get_db),
):
    await verify_patient_ownership(patient_id, user, db)
    rows = (
        await db.execute(
            select(MedicationSchedule)
            .where(MedicationSchedule.patient_id == uuid.UUID(patient_id))
            .order_by(MedicationSchedule.created_at.desc())
        )
    ).scalars().all()
    return {"schedules": [_schedule_out(s) for s in rows]}


async def _load_owned_schedule(
    schedule_id: str, user: Union[PhoneUser, User], db: AsyncSession
) -> MedicationSchedule:
    sched = await db.get(MedicationSchedule, uuid.UUID(schedule_id))
    if sched is None:
        raise HTTPException(status_code=404, detail="Schedule not found")
    await verify_patient_ownership(str(sched.patient_id), user, db)
    return sched


@router.patch("/schedules/{schedule_id}")
async def update_schedule(
    schedule_id: str,
    body: ScheduleUpdate,
    user: Union[PhoneUser, User] = Depends(get_current_user_unified),
    db: AsyncSession = Depends(get_db),
):
    sched = await _load_owned_schedule(schedule_id, user, db)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(sched, field, value)
    await db.commit()
    await db.refresh(sched)
    return _schedule_out(sched)


@router.delete("/schedules/{schedule_id}")
async def delete_schedule(
    schedule_id: str,
    user: Union[PhoneUser, User] = Depends(get_current_user_unified),
    db: AsyncSession = Depends(get_db),
):
    sched = await _load_owned_schedule(schedule_id, user, db)
    await db.delete(sched)
    await db.commit()
    return {"deleted": True, "id": schedule_id}


# ── doses ────────────────────────────────────────────────────────────────────

@router.get("/doses/pending")
async def pending_doses(
    patient_id: str = Query(...),
    user: Union[PhoneUser, User] = Depends(get_current_user_unified),
    db: AsyncSession = Depends(get_db),
):
    """Unanswered dose events so the UI can re-surface a missed live prompt."""
    await verify_patient_ownership(patient_id, user, db)
    rows = (
        await db.execute(
            select(MedicationDoseEvent)
            .where(
                MedicationDoseEvent.patient_id == uuid.UUID(patient_id),
                MedicationDoseEvent.status.in_(("reminded", "awaiting_ack", "snoozed")),
            )
            .order_by(MedicationDoseEvent.created_at.desc())
            .limit(50)
        )
    ).scalars().all()
    return {"doses": [_dose_out(d) for d in rows]}


@router.post("/doses/{dose_id}/respond")
async def respond_dose(
    dose_id: str,
    body: RespondIn,
    user: Union[PhoneUser, User] = Depends(get_current_user_unified),
    db: AsyncSession = Depends(get_db),
):
    if body.response not in _RESPONSE_STATUS:
        raise HTTPException(status_code=400, detail="Invalid response")

    dose = await db.get(MedicationDoseEvent, uuid.UUID(dose_id))
    if dose is None:
        raise HTTPException(status_code=404, detail="Dose not found")
    await verify_patient_ownership(str(dose.patient_id), user, db)

    new_status = _RESPONSE_STATUS[body.response]
    dose.response = body.response
    dose.responded_at = datetime.now(timezone.utc)
    dose.status = new_status
    if body.response == "snooze_10":
        dose.snooze_count = (dose.snooze_count or 0) + 1
    await db.commit()

    if body.response == "snooze_10":
        # Ask again after the configured delay. Imported lazily so the router
        # loads even if Celery/broker is momentarily unavailable.
        from config import get_settings
        from tasks.medication_tasks import send_acknowledgement_prompt
        send_acknowledgement_prompt.apply_async(
            args=[str(dose.id)], countdown=get_settings().medication_ack_delay_seconds
        )

    return {"id": dose_id, "status": new_status, "response": body.response}


# ── device tokens (push registration) ────────────────────────────────────────

@router.post("/device-tokens")
async def register_device_token(
    body: DeviceTokenIn,
    user: Union[PhoneUser, User] = Depends(get_current_user_unified),
    db: AsyncSession = Depends(get_db),
):
    if not isinstance(user, PhoneUser):
        raise HTTPException(status_code=403, detail="Phone authentication required")
    if body.platform not in ("ios", "android", "web"):
        raise HTTPException(status_code=400, detail="Invalid platform")

    existing = (
        await db.execute(select(DeviceToken).where(DeviceToken.token == body.token))
    ).scalar_one_or_none()
    if existing:
        existing.phone_user_id = user.id
        existing.platform = body.platform
        existing.active = True
        existing.last_seen_at = datetime.now(timezone.utc)
    else:
        db.add(DeviceToken(phone_user_id=user.id, platform=body.platform, token=body.token))
    await db.commit()
    return {"registered": True}


@router.delete("/device-tokens/{token}")
async def unregister_device_token(
    token: str,
    user: Union[PhoneUser, User] = Depends(get_current_user_unified),
    db: AsyncSession = Depends(get_db),
):
    if not isinstance(user, PhoneUser):
        raise HTTPException(status_code=403, detail="Phone authentication required")
    await db.execute(
        update(DeviceToken)
        .where(DeviceToken.token == token, DeviceToken.phone_user_id == user.id)
        .values(active=False)
    )
    await db.commit()
    return {"unregistered": True}
