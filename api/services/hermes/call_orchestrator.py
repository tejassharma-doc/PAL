"""
Call orchestrator — manages the full Hermes↔patient call session.

Lifecycle:
  1. start_call()   → creates CallSession, generates Hermes greeting
  2. process_turn() → patient speaks → Hermes responds
  3. end_call()     → marks session ended

Latency strategy — speculative pre-fetching
------------------------------------------
The SOP is a deterministic state machine, so the *next* DocEHR query is
predictable before the patient replies:

  After greeting         → availability query is next
  After scheduling agreed → lab-requirements query is next

We fire these as asyncio background tasks immediately after each turn returns.
The patient spends 5–15 s reading + typing, so the prefetch typically completes
in <50 ms (stub) or a few hundred ms (real DocEHR). When their reply arrives,
HermesVoiceAgent finds the result in _PREFETCH_CACHE and uses a single Haiku
call instead of two Sonnet calls, cutting per-turn latency from ~7 s to ~0.8 s.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from models import CallSession
from services.agents.docehr_agent import DocEHRAgent
from services.agents.hermes_voice_agent import HermesVoiceAgent
from services.docehr import DocEHRClient

# Process-scoped prefetch store.  Key: "{session_id}:{kind}" → result string.
# No Redis dependency — DocEHR results are cheap to recompute on a cache miss.
_PREFETCH_CACHE: dict[str, str] = {}


class CallOrchestrator:

    def __init__(
        self,
        db: AsyncSession,
        ai_client,
        docehr_client: DocEHRClient | None = None,
    ) -> None:
        self._db = db
        _client = docehr_client or DocEHRClient()
        # Pass ai_client so DocEHRAgent can use Haiku+MCP when DOCEHR_MCP_URL is set
        self._docehr_agent = DocEHRAgent(_client, ai_client=ai_client)
        self._hermes = HermesVoiceAgent(ai_client, self._docehr_agent)

    # ── Public API ─────────────────────────────────────────────────────────────

    async def start_call(self, session: CallSession) -> dict[str, Any]:
        """Generate opening greeting and activate the session."""
        # Fire availability prefetch now — patient will need it right after greeting
        asyncio.create_task(
            _bg_prefetch(
                f"{session.id}:availability",
                self._docehr_agent.check_availability(
                    doctor_id=session.doctor_id or "default",
                    date_from=datetime.now(timezone.utc).date().isoformat(),
                ),
            )
        )

        seed_messages = [
            {
                "role": "user",
                "content": "[Call connected. Begin the call according to SOP Step 1 — greeting.]",
            }
        ]
        context = self._build_context(session)

        result = await self._hermes.generate_response(seed_messages, context)

        session.status = "active"
        session.call_state = result["call_state"]
        session.started_at = datetime.now(timezone.utc)
        session.transcript = [
            {
                "role": "hermes",
                "content": result["patient_response"],
                "docehr_queries": result["docehr_queries"],
            }
        ]
        self._db.add(session)
        await self._db.commit()
        await self._db.refresh(session)

        return {
            "session_id": str(session.id),
            "status": session.status,
            "hermes_response": result["patient_response"],
            "call_state": result["call_state"],
            "call_ended": result["call_ended"],
            "available_slots": [],
        }

    async def process_turn(
        self, session: CallSession, patient_input: str
    ) -> dict[str, Any]:
        """Patient speaks → run Hermes → persist → return response."""
        transcript: list[dict] = list(session.transcript or [])

        # Drain any ready prefetch results — inject into context for Haiku fast-path
        prefetched = _drain_prefetch(str(session.id))
        context = self._build_context(session, prefetched=prefetched)

        claude_messages = _transcript_to_messages(transcript)
        claude_messages.append({"role": "user", "content": patient_input})

        result = await self._hermes.generate_response(claude_messages, context)

        transcript.append({"role": "patient", "content": patient_input})
        transcript.append(
            {
                "role": "hermes",
                "content": result["patient_response"],
                "docehr_queries": result["docehr_queries"],
            }
        )

        session.call_state = result["call_state"]
        session.transcript = transcript

        if result["booking_done"]:
            session.appointment_booked = True

        if result["call_ended"]:
            session.status = "ended"
            session.ended_at = datetime.now(timezone.utc)

        self._db.add(session)
        await self._db.commit()
        await self._db.refresh(session)

        # Speculative prefetch: fire next expected DocEHR query in the background
        _schedule_next_prefetch(session, result, self._docehr_agent)

        available_slots: list[dict] = []
        if result["call_state"] in ("scheduling", "confirming") and not result["booking_done"]:
            try:
                from datetime import date
                available_slots = await self._docehr_agent.get_slots_json(
                    doctor_id=session.doctor_id or "default",
                    date_from=date.today().isoformat(),
                )
            except Exception:
                pass

        return {
            "session_id": str(session.id),
            "hermes_response": result["patient_response"],
            "call_state": result["call_state"],
            "appointment_agreed": result["appointment_agreed"],
            "slot_id": result["slot_id"],
            "booking_done": result["booking_done"],
            "call_ended": result["call_ended"],
            "available_slots": available_slots,
            "docehr_queries": result["docehr_queries"],
        }

    async def end_call(self, session: CallSession) -> dict[str, Any]:
        """Mark session ended (patient hung up early)."""
        session.status = "ended"
        if not session.ended_at:
            session.ended_at = datetime.now(timezone.utc)
        # Clean up any unused prefetch entries for this session
        _PREFETCH_CACHE.pop(f"{session.id}:availability", None)
        _PREFETCH_CACHE.pop(f"{session.id}:labs", None)
        self._db.add(session)
        await self._db.commit()
        return {
            "session_id": str(session.id),
            "status": "ended",
            "appointment_booked": session.appointment_booked,
        }

    # ── Private ────────────────────────────────────────────────────────────────

    @staticmethod
    def _build_context(
        session: CallSession,
        prefetched: dict[str, str] | None = None,
    ) -> dict:
        return {
            "patient_name": session.patient_name or "Patient",
            "doctor_name": session.doctor_name or "your doctor",
            "doctor_id": session.doctor_id or "default",
            "member_id": str(session.member_id) if session.member_id else "",
            "call_state": session.call_state or "greeting",
            "booking_done": bool(session.appointment_booked),
            "appointment_reason": session.appointment_reason or "",
            "prefetched": prefetched or {},
        }


# ── Module helpers ─────────────────────────────────────────────────────────────

async def _bg_prefetch(cache_key: str, coro) -> None:
    """Await a coroutine in the background and cache its result."""
    try:
        _PREFETCH_CACHE[cache_key] = await coro
    except Exception:
        pass


def _drain_prefetch(session_id: str) -> dict[str, str]:
    """Pop all ready prefetch results for this session (consume-once)."""
    out: dict[str, str] = {}
    for kind in ("availability", "labs"):
        key = f"{session_id}:{kind}"
        if key in _PREFETCH_CACHE:
            out[kind] = _PREFETCH_CACHE.pop(key)
    return out


def _schedule_next_prefetch(
    session: CallSession,
    result: dict,
    docehr_agent: DocEHRAgent,
) -> None:
    """
    Fire the next expected DocEHR query as a fire-and-forget background task.

    SOP transitions:
      scheduling + appointment_agreed → lab requirements are next
    (availability was already prefetched at start_call time)
    """
    state = result.get("call_state", "")

    if state == "scheduling" and result.get("appointment_agreed"):
        asyncio.create_task(
            _bg_prefetch(
                f"{session.id}:labs",
                docehr_agent.check_lab_requirements(
                    patient_id=str(session.member_id),
                    appointment_reason=session.appointment_reason or "your appointment",
                ),
            )
        )


def _transcript_to_messages(transcript: list[dict]) -> list[dict]:
    """Rebuild Claude message history from the stored JSONB transcript."""
    messages: list[dict] = []
    for turn in transcript:
        role = turn.get("role", "")
        content = turn.get("content", "")
        if role == "patient":
            messages.append({"role": "user", "content": content})
        elif role == "hermes":
            messages.append({"role": "assistant", "content": content})
    return messages
