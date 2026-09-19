"""
Hermes Follow-Up Orchestrator.

Pre-flight checks → Voice Worker Agent dispatch → post-call EHR integration.
Completely separate from HermesOrchestrator (query pipeline) — no shared state.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from config import get_settings
from models import (
    AppointmentRequest, AppointmentRequestStatus,
    HealthFact, EvidenceClass,
)
from ..ai_provider import get_ai_client
from ..agents.follow_up_voice_agent import FollowUpVoiceAgent

# Shared default tenant for single-tenant deployments
_DEFAULT_TENANT_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")


class PreflightError(Exception):
    """Raised when a pre-flight condition blocks dispatch."""

    def __init__(self, reason: str, detail: str):
        self.reason = reason
        self.detail = detail
        super().__init__(detail)


class FollowUpOrchestrator:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.settings = get_settings()

    # ── Public entry point ────────────────────────────────────────────────────

    async def dispatch(
        self,
        *,
        member_id: uuid.UUID,
        requesting_user_id: uuid.UUID,
        session_id: str,
        patient_name: str,
        patient_age: int,
        patient_language: str,
        doctor_name: str,
        requires_lab_test: bool,
        lab_test_details: Optional[str],
        available_slots: list[str],
        mic_available: bool = True,
    ) -> dict:
        """
        Run pre-flight checks, dispatch the Voice Worker Agent, write results to EHR.
        Returns the call result dict. Caller must commit the session.
        """
        await self._preflight_existing_booking(member_id)
        self._preflight_mic(mic_available)
        self._preflight_time_of_day(patient_age)

        # Cloud LLM fallback path — used when device is low-tier
        ai_client = get_ai_client(self.settings)
        agent = FollowUpVoiceAgent(ai_client)

        call_result = await agent.run(
            patient_name=patient_name,
            patient_age=patient_age,
            patient_language=patient_language,
            doctor_name=doctor_name,
            requires_lab_test=requires_lab_test,
            lab_test_details=lab_test_details,
            available_slots=available_slots,
        )

        call_id = await self._push_to_ehr(
            member_id=member_id,
            requesting_user_id=requesting_user_id,
            session_id=session_id,
            doctor_name=doctor_name,
            lab_test_details=lab_test_details,
            call_result=call_result,
        )

        return {
            "status": "dispatched",
            "call_id": str(call_id),
            "call_status": call_result.get("call_status"),
            "appointment_datetime": call_result.get("appointment_datetime"),
            "lab_report_status": call_result.get("lab_report_status"),
            "extracted_lab_entities": call_result.get("extracted_lab_entities", []),
            "transcript": call_result.get("transcript", ""),
        }

    async def run_preflight(
        self,
        *,
        member_id: uuid.UUID,
        patient_age: int,
        mic_available: bool = True,
    ) -> None:
        """
        Run only the pre-flight checks.
        Raises PreflightError if any check fails; returns None when all pass.
        Called by POST /follow-up/preflight — the in-app LLM path runs the
        actual conversation in the browser after this returns 200.
        """
        await self._preflight_existing_booking(member_id)
        self._preflight_mic(mic_available)
        self._preflight_time_of_day(patient_age)

    async def complete_call(
        self,
        *,
        member_id: uuid.UUID,
        requesting_user_id: uuid.UUID,
        session_id: str,
        doctor_name: str,
        lab_test_details: Optional[str],
        call_result: dict,
    ) -> uuid.UUID:
        """
        Persist the on-device call result to the EHR.
        Called by POST /follow-up/complete after the browser finishes the
        SmolLM2-generated conversation. Caller must commit the session.
        """
        return await self._push_to_ehr(
            member_id=member_id,
            requesting_user_id=requesting_user_id,
            session_id=session_id,
            doctor_name=doctor_name,
            lab_test_details=lab_test_details,
            call_result=call_result,
        )

    # ── Pre-flight checks ─────────────────────────────────────────────────────

    async def _preflight_existing_booking(self, member_id: uuid.UUID) -> None:
        """Abort if a follow-up appointment is already booked and active."""
        result = await self.db.execute(
            select(AppointmentRequest).where(
                AppointmentRequest.member_id == member_id,
                AppointmentRequest.action_type == "follow_up_booking",
                AppointmentRequest.status.in_([
                    AppointmentRequestStatus.confirmed,
                    AppointmentRequestStatus.dispatched,
                ]),
            ).limit(1)
        )
        if result.scalar_one_or_none():
            raise PreflightError(
                reason="existing_booking",
                detail="A follow-up appointment is already booked for this patient.",
            )

    @staticmethod
    def _preflight_mic(mic_available: bool) -> None:
        """Abort (queue) if microphone is busy."""
        if not mic_available:
            raise PreflightError(
                reason="mic_busy",
                detail="Microphone is in use by another application. Queued for retry.",
            )

    @staticmethod
    def _preflight_time_of_day(patient_age: int) -> None:
        """
        Time-of-day routing (UTC):
          age ≤ 60 → before 10:00 or after 18:00
          age > 60 → morning only (before 12:00)
        """
        hour = datetime.now(timezone.utc).hour
        if patient_age <= 60:
            if 10 <= hour < 18:
                raise PreflightError(
                    reason="wrong_time",
                    detail=(
                        f"Patients aged ≤60 should be called before 10:00 AM or after 6:00 PM UTC. "
                        f"Current UTC hour: {hour}."
                    ),
                )
        else:
            if hour >= 12:
                raise PreflightError(
                    reason="wrong_time",
                    detail=(
                        f"Patients aged >60 should be called in the morning only (before 12:00 UTC). "
                        f"Current UTC hour: {hour}."
                    ),
                )

    # ── Post-call EHR integration ─────────────────────────────────────────────

    async def _push_to_ehr(
        self,
        *,
        member_id: uuid.UUID,
        requesting_user_id: uuid.UUID,
        session_id: str,
        doctor_name: str,
        lab_test_details: Optional[str],
        call_result: dict,
    ) -> uuid.UUID:
        call_status = call_result.get("call_status", "Unreachable")
        appt_dt = call_result.get("appointment_datetime")
        lab_entities = call_result.get("extracted_lab_entities") or []
        now = datetime.now(timezone.utc)

        appt = AppointmentRequest(
            tenant_id=_DEFAULT_TENANT_ID,
            member_id=member_id,
            requesting_user_id=requesting_user_id,
            session_id=session_id,
            action_type="follow_up_booking",
            action_payload={
                "call_status": call_status,
                "appointment_datetime": appt_dt,
                "lab_report_status": call_result.get("lab_report_status", "N/A"),
                "extracted_lab_entities": lab_entities,
                "doctor_name": doctor_name,
                "lab_test_details": lab_test_details,
                # Store first 500 chars of transcript for quick audit
                "transcript_snippet": call_result.get("transcript", "")[:500],
            },
            status=(
                AppointmentRequestStatus.confirmed
                if call_status == "Booked"
                else AppointmentRequestStatus.pending
            ),
            confirmed_at=now if call_status == "Booked" else None,
        )
        self.db.add(appt)

        # Surface extracted lab mentions as inferred HealthFacts
        for entity in lab_entities:
            if isinstance(entity, str) and entity.strip():
                self.db.add(HealthFact(
                    tenant_id=_DEFAULT_TENANT_ID,
                    member_id=member_id,
                    fact_type="lab",
                    fact_key="follow_up_lab_mention",
                    fact_value=entity.strip(),
                    evidence_class=EvidenceClass.inferred,
                    recorded_at=now,
                ))

        await self.db.flush()
        return appt.id
