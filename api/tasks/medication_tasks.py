"""Celery tasks for the medication-reminder system.

Flow:
  scan_due_medication_reminders (beat, every 60s)
      └─ for each schedule time due in the last ~2 min, create a dose_event
         (idempotent via the unique slot constraint) and enqueue →
  send_medication_reminder(dose_event_id)
      └─ deliver "take your medicine" (realtime + push), then schedule +10 min →
  send_acknowledgement_prompt(dose_event_id)
      └─ if still unanswered, deliver "did you take it?" with 4 options.

The patient's response arrives via the REST endpoint (routers/medications.py),
which for "snooze_10" re-enqueues send_acknowledgement_prompt.

Tasks are synchronous Celery entrypoints that run their async body via
asyncio.run — each gets a fresh event loop and its own AsyncSessionLocal.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, time as dtime
from zoneinfo import ZoneInfo

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from celery_app import celery_app
from config import get_settings
from database import AsyncSessionLocal
from models.medication import MedicationSchedule, MedicationDoseEvent
from services.medications import delivery

log = logging.getLogger("pal.tasks.medication")
settings = get_settings()

# A dose is "due" if its scheduled moment fell within this many seconds before
# now — wide enough to absorb beat jitter, the unique constraint prevents dupes.
_DUE_WINDOW_SECONDS = 120


def _run(coro):
    return asyncio.run(coro)


def _parse_hhmm(value: str) -> dtime | None:
    try:
        hh, mm = str(value).split(":")
        return dtime(hour=int(hh), minute=int(mm))
    except Exception:  # noqa: BLE001
        return None


# ── scan (beat) ────────────────────────────────────────────────────────────────

@celery_app.task(name="tasks.medication_tasks.scan_due_medication_reminders")
def scan_due_medication_reminders() -> int:
    return _run(_scan())


async def _scan() -> int:
    enqueued = 0
    async with AsyncSessionLocal() as db:
        schedules = (
            await db.execute(
                select(MedicationSchedule).where(MedicationSchedule.active.is_(True))
            )
        ).scalars().all()

        for sched in schedules:
            try:
                tz = ZoneInfo(sched.timezone or "Asia/Kolkata")
            except Exception:  # noqa: BLE001
                tz = ZoneInfo("Asia/Kolkata")
            now_local = datetime.now(tz)
            today = now_local.date()

            if sched.start_date and today < sched.start_date:
                continue
            if sched.end_date and today > sched.end_date:
                continue
            dow = sched.days_of_week or []
            if dow and now_local.weekday() not in dow:
                continue

            for t_str in (sched.times or []):
                t = _parse_hhmm(t_str)
                if t is None:
                    continue
                scheduled_dt = datetime.combine(today, t, tzinfo=tz)
                delta = (now_local - scheduled_dt).total_seconds()
                if not (0 <= delta < _DUE_WINDOW_SECONDS):
                    continue

                # Idempotent create: a second scan for the same slot is a no-op.
                stmt = (
                    pg_insert(MedicationDoseEvent)
                    .values(
                        id=uuid.uuid4(),
                        schedule_id=sched.id,
                        patient_id=sched.patient_id,
                        phone_user_id=sched.phone_user_id,
                        scheduled_date=today,
                        scheduled_time=t,
                        status="reminded",
                    )
                    .on_conflict_do_nothing(constraint="uq_dose_event_slot")
                    .returning(MedicationDoseEvent.id)
                )
                new_id = (await db.execute(stmt)).scalar_one_or_none()
                await db.commit()
                if new_id:
                    send_medication_reminder.delay(str(new_id))
                    enqueued += 1
                    log.info("medication: enqueued reminder dose=%s schedule=%s", new_id, sched.id)
    return enqueued


# ── reminder ─────────────────────────────────────────────────────────────────

@celery_app.task(name="tasks.medication_tasks.send_medication_reminder")
def send_medication_reminder(dose_event_id: str) -> bool:
    return _run(_send_reminder(dose_event_id))


async def _send_reminder(dose_event_id: str) -> bool:
    async with AsyncSessionLocal() as db:
        dose = await db.get(MedicationDoseEvent, uuid.UUID(dose_event_id))
        if dose is None:
            return False
        sched = await db.get(MedicationSchedule, dose.schedule_id)
        medicine = sched.medicine_name if sched else "your medicine"
        dosage = (sched.dosage if sched else None) or ""

        body = f"Time to take {medicine}" + (f" ({dosage})" if dosage else "")
        frame = {
            "type": "medication_reminder",
            "dose_event_id": str(dose.id),
            "title": "Medication reminder",
            "body": body,
            "medicine_name": medicine,
        }
        await delivery.deliver_realtime(dose.phone_user_id or dose.patient_id, frame)
        await delivery.send_push(dose.phone_user_id, "Medication reminder", body,
                                 data={"dose_event_id": str(dose.id), "kind": "reminder"})

        dose.status = "reminded"
        dose.reminder_sent_at = datetime.now(ZoneInfo("UTC"))
        await db.commit()

    send_acknowledgement_prompt.apply_async(
        args=[dose_event_id], countdown=settings.medication_ack_delay_seconds
    )
    return True


# ── acknowledgement prompt (+10 min) ────────────────────────────────────────────

@celery_app.task(name="tasks.medication_tasks.send_acknowledgement_prompt")
def send_acknowledgement_prompt(dose_event_id: str) -> bool:
    return _run(_send_ack_prompt(dose_event_id))


async def _send_ack_prompt(dose_event_id: str) -> bool:
    async with AsyncSessionLocal() as db:
        dose = await db.get(MedicationDoseEvent, uuid.UUID(dose_event_id))
        if dose is None:
            return False
        # Already answered (or snoozed into a fresh prompt cycle) → nothing to ask.
        if dose.status not in ("reminded", "snoozed"):
            return False
        sched = await db.get(MedicationSchedule, dose.schedule_id)
        medicine = sched.medicine_name if sched else "your medicine"

        frame = {
            "type": "medication_ack_prompt",
            "dose_event_id": str(dose.id),
            "title": "Did you take your medicine?",
            "body": f"Did you take {medicine}?",
            "medicine_name": medicine,
            "options": [
                {"value": "yes", "label": "Yes"},
                {"value": "no", "label": "No"},
                {"value": "take_now", "label": "Will take now"},
                {"value": "snooze_10", "label": "Will take in 10 mins"},
            ],
        }
        await delivery.deliver_realtime(dose.phone_user_id or dose.patient_id, frame)
        await delivery.send_push(dose.phone_user_id, "Did you take your medicine?",
                                 f"Did you take {medicine}?",
                                 data={"dose_event_id": str(dose.id), "kind": "ack_prompt"})

        await db.execute(
            update(MedicationDoseEvent)
            .where(MedicationDoseEvent.id == dose.id)
            .values(status="awaiting_ack", ack_prompt_sent_at=datetime.now(ZoneInfo("UTC")))
        )
        await db.commit()
    return True
