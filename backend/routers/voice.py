"""
Voice routes for PAL.

Mount in api/main.py:

    from routers import voice
    app.include_router(voice.router)

Endpoints
    GET  /api/voice/languages          language picker payload (24 languages)
    POST /api/voice/sessions           create a call session + fire the VoIP push
    GET  /api/voice/sessions/{id}      session status (polled by the clinic console)
    POST /api/voice/preview            short TTS sample, for the language picker
    WS   /api/voice/ws/{id}?token=...  the live audio socket
"""
from __future__ import annotations

import contextlib
import base64
import logging
import secrets
import time
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from services.sarvam import client as sarvam
from services.sarvam import push
from services.sarvam.languages import get as get_language, picker_payload
from services.sarvam.orchestrator import VoiceSession

log = logging.getLogger("pal.voice")
router = APIRouter(prefix="/api/voice", tags=["voice"])

SESSION_TTL = 900  # a call token is good for 15 minutes


class CallRequest(BaseModel):
    patient_id: str
    language: str = "auto"
    gender: str = "female"
    device_token: str | None = Field(
        None, description="APNs VoIP token or FCM registration token"
    )
    platform: str | None = Field(None, description="ios | android | web")
    caller_name: str = "PAL Assistant"
    context: dict[str, Any] = Field(default_factory=dict)


class PreviewRequest(BaseModel):
    language: str
    gender: str = "female"
    text: str | None = None


# In-process store. Swap for Redis when you run more than one API replica —
# the WS handler must land on the box that holds the session.
_SESSIONS: dict[str, dict[str, Any]] = {}


def _reap() -> None:
    cutoff = time.time() - SESSION_TTL
    for sid in [s for s, v in _SESSIONS.items() if v["created"] < cutoff]:
        _SESSIONS.pop(sid, None)


@router.get("/languages")
async def languages() -> dict[str, Any]:
    return {"languages": picker_payload(), "default": "auto"}


@router.post("/sessions", status_code=201)
async def create_session(req: CallRequest) -> dict[str, Any]:
    _reap()
    sid = uuid.uuid4().hex
    token = secrets.token_urlsafe(24)
    _SESSIONS[sid] = {
        "created": time.time(),
        "token": token,
        "patient_id": req.patient_id,
        "language": get_language(req.language).code,
        "gender": req.gender,
        "context": req.context,
        "status": "ringing",
        "summary": None,
    }

    delivered = False
    if req.device_token and req.platform in {"ios", "android"}:
        try:
            delivered = await push.ring_device(
                platform=req.platform,
                device_token=req.device_token,
                session_id=sid,
                caller_name=req.caller_name,
                handle=req.context.get("clinic", "PAL"),
                language=_SESSIONS[sid]["language"],
            )
        except Exception as exc:
            log.warning("VoIP push failed for %s: %s", sid, exc)

    return {
        "session_id": sid,
        "call_token": token,
        "ws_path": f"/api/voice/ws/{sid}?token={token}",
        "language": _SESSIONS[sid]["language"],
        "push_delivered": delivered,
    }


@router.get("/sessions/{session_id}")
async def session_status(session_id: str) -> dict[str, Any]:
    sess = _SESSIONS.get(session_id)
    if not sess:
        raise HTTPException(404, "unknown session")
    return {
        "session_id": session_id,
        "status": sess["status"],
        "language": sess["language"],
        "summary": sess["summary"],
    }


@router.post("/preview")
async def preview(req: PreviewRequest) -> dict[str, Any]:
    """A one-line sample so users can hear a voice before picking a language."""
    lang = get_language(req.language)
    text = req.text or _SAMPLE.get(lang.code) or _SAMPLE["en-IN"]
    spoken = await sarvam.voice_text_for_tts(text, lang)
    audio = await sarvam.tts_once(spoken, lang=lang, gender=req.gender)
    return {
        "language": lang.code,
        "voice": lang.speaker(req.gender),
        "nativeVoice": lang.tts_native,
        "text": text,
        "audio_wav_base64": base64.b64encode(audio).decode(),
    }


@router.websocket("/ws/{session_id}")
async def voice_ws(websocket: WebSocket, session_id: str, token: str = Query(...)):
    sess = _SESSIONS.get(session_id)
    if not sess or not secrets.compare_digest(token, sess["token"]):
        await websocket.close(code=4401)
        return
    if time.time() - sess["created"] > SESSION_TTL:
        await websocket.close(code=4408)
        return

    await websocket.accept()
    sess["status"] = "connected"
    session = VoiceSession(_FastApiTransport(websocket), session_id=session_id, tools=TOOLS)
    try:
        await session.run()
    except WebSocketDisconnect:
        pass
    finally:
        sess["status"] = "ended"
        # The orchestrator builds the post-call summary during shutdown; publish it
        # so the clinic console can poll for the outcome after the socket closes.
        sess["summary"] = session.summary or None
        sess["language"] = session.lang.code
        state = getattr(websocket, "client_state", None)
        if state is not None and state.name == "CONNECTED":
            with contextlib.suppress(RuntimeError):
                await websocket.close()


class _FastApiTransport:
    """Adapts FastAPI's WebSocket to the duck type VoiceSession expects."""

    def __init__(self, ws: WebSocket):
        self.ws = ws

    async def receive(self):
        msg = await self.ws.receive()
        kind = msg.get("type")
        if kind == "websocket.disconnect":
            return None
        if (data := msg.get("bytes")) is not None:
            return data
        return msg.get("text")

    async def send_json(self, payload: dict) -> None:
        await self.ws.send_json(payload)

    async def send_bytes(self, data: bytes) -> None:
        await self.ws.send_bytes(data)


# ── Tool wiring ───────────────────────────────────────────────────────────────
# Replace these stubs with calls into PAL's existing appointment layer
# (api/services/agents/appointment_agent.py + api/routers/appointment.py).

async def _get_available_slots(args: dict[str, Any]) -> dict[str, Any]:
    from datetime import date, timedelta

    base = date.today() + timedelta(days=1)
    return {
        "slots": [
            {"slot_id": "s1", "date": str(base), "time": "10:00", "period": "morning"},
            {"slot_id": "s2", "date": str(base), "time": "16:30", "period": "evening"},
            {"slot_id": "s3", "date": str(base + timedelta(days=1)), "time": "11:15",
             "period": "morning"},
        ]
    }


async def _book_appointment(args: dict[str, Any]) -> dict[str, Any]:
    return {"booked": True, "slot_id": args.get("slot_id"), "confirmation": "PAL-" +
            secrets.token_hex(3).upper()}


async def _cancel_appointment(args: dict[str, Any]) -> dict[str, Any]:
    return {"cancelled": True, "appointment_id": args.get("appointment_id")}


async def _flag_for_human(args: dict[str, Any]) -> dict[str, Any]:
    log.warning("handoff requested: %s", args)
    return {"acknowledged": True, "callback_promised": True}


TOOLS = {
    "get_available_slots": _get_available_slots,
    "book_appointment": _book_appointment,
    "cancel_appointment": _cancel_appointment,
    "flag_for_human": _flag_for_human,
}

_SAMPLE = {
    "en-IN": "Hello, this is PAL calling about your appointment tomorrow.",
    "hi-IN": "नमस्ते, मैं PAL बोल रहा हूँ, कल के अपॉइंटमेंट के बारे में।",
    "hi-Latn": "Namaste, main PAL bol raha hoon, kal ke appointment ke baare mein.",
    "bn-IN": "নমস্কার, আমি PAL, আপনার আগামীকালের অ্যাপয়েন্টমেন্ট নিয়ে ফোন করছি।",
    "gu-IN": "નમસ્તે, હું PAL બોલું છું, તમારી કાલની અપોઇન્ટમેન્ટ વિશે.",
    "kn-IN": "ನಮಸ್ಕಾರ, ನಾನು PAL, ನಾಳೆಯ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬಗ್ಗೆ ಕರೆ ಮಾಡಿದ್ದೇನೆ.",
    "ml-IN": "നമസ്കാരം, ഞാൻ PAL ആണ്, നാളത്തെ അപ്പോയിന്റ്മെന്റിനെക്കുറിച്ച് വിളിക്കുന്നു.",
    "mr-IN": "नमस्कार, मी PAL बोलत आहे, उद्याच्या अपॉइंटमेंटबद्दल.",
    "od-IN": "ନମସ୍କାର, ମୁଁ PAL କହୁଛି, ଆସନ୍ତାକାଲିର ଅପଏଣ୍ଟମେଣ୍ଟ ବିଷୟରେ।",
    "pa-IN": "ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਮੈਂ PAL ਬੋਲ ਰਿਹਾ ਹਾਂ, ਕੱਲ੍ਹ ਦੀ ਅਪਾਇੰਟਮੈਂਟ ਬਾਰੇ।",
    "ta-IN": "வணக்கம், நான் PAL பேசுகிறேன், நாளைய அப்பாயின்ட்மென்ட் பற்றி.",
    "te-IN": "నమస్కారం, నేను PAL మాట్లాడుతున్నాను, రేపటి అపాయింట్‌మెంట్ గురించి.",
    "ur-IN": "السلام علیکم، میں PAL بول رہا ہوں، کل کی اپائنٹمنٹ کے بارے میں۔",
    "as-IN": "নমস্কাৰ, মই PAL, কাইলৈৰ এপয়েণ্টমেণ্ট সম্পৰ্কে ফোন কৰিছোঁ।",
}
