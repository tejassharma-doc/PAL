"""
DocEHR MCP client — stub implementation.

When DOCEHR_ENABLED=false (default) this returns realistic mock data so the
entire appointment booking flow can be developed and tested without a live DocEHR
server. When DOCEHR_ENABLED=true it makes real HTTP calls to DOCEHR_URL.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx

from config import get_settings


class DocEHRClient:
    """Thin async client for DocEHR appointment + messaging endpoints."""

    def __init__(self) -> None:
        self._settings = get_settings()
        self._enabled = self._settings.docehr_enabled
        self._base = self._settings.docehr_url.rstrip("/") if self._settings.docehr_url else ""

    # ── Slot availability ──────────────────────────────────────────────────────

    async def get_available_slots(
        self,
        doctor_id: str,
        date_from: str,
        date_to: str,
    ) -> list[dict]:
        if not self._enabled:
            return _stub_slots(doctor_id, date_from)
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                f"{self._base}/api/slots",
                params={"doctor_id": doctor_id, "date_from": date_from, "date_to": date_to},
            )
            r.raise_for_status()
            return r.json().get("slots", [])

    # ── Booking ────────────────────────────────────────────────────────────────

    async def book_appointment(
        self,
        patient_id: str,
        slot_id: str,
        reason: str,
    ) -> dict:
        if not self._enabled:
            return _stub_booking(slot_id, reason)
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                f"{self._base}/api/appointments",
                json={"patient_id": patient_id, "slot_id": slot_id, "reason": reason},
            )
            r.raise_for_status()
            return r.json()

    # ── Clinic messaging ───────────────────────────────────────────────────────

    async def send_clinic_message(
        self,
        patient_id: str,
        doctor_id: str,
        message: str,
    ) -> dict:
        if not self._enabled:
            return {"message_id": str(uuid.uuid4()), "status": "queued"}
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                f"{self._base}/api/messages",
                json={"patient_id": patient_id, "doctor_id": doctor_id, "message": message},
            )
            r.raise_for_status()
            return r.json()

    # ── Patient context ────────────────────────────────────────────────────────

    async def get_patient_context(self, patient_id: str) -> dict:
        if not self._enabled:
            return _stub_patient_context(patient_id)
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{self._base}/api/patient/{patient_id}/context")
            r.raise_for_status()
            return r.json()


# ── Stub helpers ───────────────────────────────────────────────────────────────

def _stub_slots(doctor_id: str, date_from: str) -> list[dict]:
    try:
        base = datetime.fromisoformat(date_from).replace(tzinfo=timezone.utc)
    except ValueError:
        base = datetime.now(timezone.utc) + timedelta(days=1)

    slots = []
    offsets = [(0, 9, 0), (0, 14, 30), (2, 10, 0)]
    for day_off, hour, minute in offsets:
        dt = (base + timedelta(days=day_off)).replace(hour=hour, minute=minute, second=0, microsecond=0)
        slots.append({
            "slot_id": str(uuid.uuid4()),
            "doctor_id": doctor_id,
            "doctor_name": "Dr. Rao",
            "clinic": "City Clinic OPD",
            "datetime": dt.isoformat(),
            "duration_minutes": 15,
            "available": True,
        })
    return slots


def _stub_booking(slot_id: str, reason: str) -> dict:
    dt = (datetime.now(timezone.utc) + timedelta(days=2)).replace(hour=9, minute=0, second=0, microsecond=0)
    return {
        "booking_ref": f"BK-{uuid.uuid4().hex[:8].upper()}",
        "slot_id": slot_id,
        "datetime": dt.isoformat(),
        "doctor_name": "Dr. Rao",
        "clinic": "City Clinic OPD",
        "reason": reason,
        "status": "confirmed",
        "instructions": "Please arrive 10 minutes early. Bring your previous lab reports.",
    }


def _stub_patient_context(patient_id: str) -> dict:
    return {
        "patient_id": patient_id,
        "upcoming_appointments": [
            {
                "appointment_id": str(uuid.uuid4()),
                "doctor_name": "Dr. Rao",
                "clinic": "City Clinic OPD",
                "datetime": (datetime.now(timezone.utc) + timedelta(days=3)).isoformat(),
                "reason": "Lipid review",
            }
        ],
        "care_team": [
            {"name": "Dr. Rao", "role": "Physician", "clinic": "City Clinic OPD"},
            {"name": "Sneha", "role": "Nutritionist", "clinic": "iNutriMon"},
        ],
    }
