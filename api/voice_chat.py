"""
Voice Chat - STT/TTS wrapper around Hermes Gemma endpoint

This endpoint mediates voice conversations:
- User speaks (audio) → STT → text → Hermes endpoint → response text → TTS → audio
- Handles turn-taking, interruptions, and conversation state
"""
from __future__ import annotations

import asyncio
import base64
import logging
import secrets
import time
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import User, PhoneUser
from routers.auth import get_current_user
from services.sarvam import client as sarvam
from services.sarvam.languages import get as get_language
import httpx

log = logging.getLogger("pal.voice_chat")
router = APIRouter(prefix="/voice-chat", tags=["voice-chat"])

SESSION_TTL = 900  # 15 minutes


class VoiceChatRequest(BaseModel):
    patient_id: str
    language: str = "auto"
    gender: str = "female"


class VoiceChatSession:
    """Manages a single voice chat session with STT/TTS and Hermes integration"""

    def __init__(
        self,
        websocket: WebSocket,
        session_id: str,
        patient_id: str,
        language: str,
        gender: str,
        user: User | PhoneUser
    ):
        self.ws = websocket
        self.session_id = session_id
        self.patient_id = patient_id
        self.user = user
        self.lang = get_language(language)
        self.gender = gender
        self.state = "idle"  # idle, listening, thinking, speaking
        self.conversation_id: str | None = None
        self.stt_stream: sarvam.SttStream | None = None
        self.tts_stream: sarvam.TtsStream | None = None
        self._tasks: list[asyncio.Task] = []
        self._closing = False

    async def run(self):
        """Main session loop"""
        try:
            # Initialize STT and TTS streams
            self.stt_stream = sarvam.SttStream(self.lang)
            await self.stt_stream.__aenter__()

            self.tts_stream = sarvam.TtsStream(self.lang, gender=self.gender)
            await self.tts_stream.connect()

            # Send ready signal
            await self.send_json({
                "type": "ready",
                "language": self.lang.code,
                "voice": self.lang.speaker(self.gender),
                "session_id": self.session_id
            })

            # Start greeting
            await self.speak_text("Hello! I'm your health assistant. How can I help you today?")

            # Start pumps
            self._tasks = [
                asyncio.create_task(self._pump_device(), name="device"),
                asyncio.create_task(self._pump_stt(), name="stt"),
                asyncio.create_task(self._pump_tts(), name="tts"),
            ]

            done, pending = await asyncio.wait(
                self._tasks, return_when=asyncio.FIRST_COMPLETED
            )

            for task in pending:
                task.cancel()

        except Exception as e:
            log.exception(f"Voice session {self.session_id} crashed: {e}")
            await self.send_json({"type": "error", "message": str(e)})
        finally:
            await self.shutdown()

    async def _pump_device(self):
        """Receive audio/control messages from client"""
        while not self._closing:
            try:
                msg = await self.ws.receive()
                msg_type = msg.get("type")

                if msg_type == "websocket.disconnect":
                    break

                # Binary audio data → STT (PCM 16-bit mono @ 16kHz)
                if (audio_data := msg.get("bytes")) is not None:
                    if self.stt_stream and self.state == "listening":
                        await self.stt_stream.send_pcm(audio_data)

                # Control messages
                elif (text_data := msg.get("text")) is not None:
                    try:
                        import json
                        control = json.loads(text_data) if isinstance(text_data, str) and text_data.startswith("{") else {}
                        cmd_type = control.get("type")

                        if cmd_type == "interrupt":
                            # User is interrupting - stop speaking
                            await self.handle_interrupt()
                        elif cmd_type == "hangup":
                            break

                    except:
                        pass

            except WebSocketDisconnect:
                break
            except Exception as e:
                log.error(f"Device pump error: {e}")
                break

    async def _pump_stt(self):
        """Process STT results and send to Hermes"""
        if not self.stt_stream:
            return

        try:
            async for event in self.stt_stream.events():
                if self._closing:
                    break

                kind = event.get("kind")

                if kind == "speech_start":
                    # User started speaking - might want to interrupt
                    if self.state == "speaking":
                        await self.handle_interrupt()

                elif kind == "speech_end":
                    # User stopped speaking - finalize transcript
                    await self.stt_stream.flush()

                elif kind == "transcript":
                    text = event.get("text", "").strip()

                    # Send transcript to client
                    await self.send_json({
                        "type": "transcript",
                        "text": text,
                        "final": True,
                        "confidence": event.get("confidence", 0.0)
                    })

                    # Process with Hermes
                    if text:
                        await self.process_user_query(text)

                elif kind == "error":
                    log.error(f"STT error: {event.get('message')}")

        except Exception as e:
            log.error(f"STT pump error: {e}")

    async def _pump_tts(self):
        """Stream TTS audio to client"""
        if not self.tts_stream:
            return

        try:
            async for event in self.tts_stream.audio():
                if self._closing:
                    break

                kind = event.get("kind")

                if kind == "audio":
                    # Send PCM audio chunk to client
                    pcm_data = event.get("pcm")
                    if pcm_data:
                        await self.ws.send_bytes(pcm_data)

                elif kind == "final":
                    # TTS finished this utterance
                    self.state = "listening"
                    await self.send_json({"type": "state", "value": "listening"})

                elif kind == "error":
                    log.error(f"TTS error: {event.get('message')}")

        except Exception as e:
            log.error(f"TTS pump error: {e}")

    async def process_user_query(self, query: str):
        """
        User query → Hermes endpoint → TTS
        This is the conversation mediator
        """
        try:
            # Update state
            self.state = "thinking"
            await self.send_json({"type": "state", "value": "thinking"})

            # Call Hermes chat endpoint
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    "http://localhost:8000/hermes/chat",
                    json={
                        "query": query,
                        "patient_id": self.patient_id,
                        "conversation_id": self.conversation_id
                    },
                    headers={
                        "Authorization": f"Bearer {self.user.id}"  # Simple token for internal call
                    }
                )

                if response.status_code == 200:
                    data = response.json()
                    answer = data.get("answer", "I'm sorry, I couldn't process that.")
                    self.conversation_id = data.get("conversation_id")

                    # Send answer text to client
                    await self.send_json({
                        "type": "agent",
                        "text": answer
                    })

                    # Speak the answer
                    await self.speak_text(answer)
                else:
                    await self.speak_text("I'm having trouble processing your request. Please try again.")

        except Exception as e:
            log.error(f"Error processing query: {e}")
            await self.speak_text("Sorry, there was an error. Please try again.")
        finally:
            self.state = "listening"
            await self.send_json({"type": "state", "value": "listening"})

    async def speak_text(self, text: str):
        """Convert text to speech and stream to client"""
        if not self.tts_stream:
            return

        try:
            self.state = "speaking"
            await self.send_json({"type": "state", "value": "speaking"})

            # Prepare text for TTS (language-specific processing)
            spoken_text = await sarvam.voice_text_for_tts(text, self.lang)

            # Send to TTS stream
            await self.tts_stream.say(spoken_text)

            # Flush to trigger immediate synthesis
            await self.tts_stream.flush()

        except Exception as e:
            log.error(f"TTS error: {e}")
            self.state = "listening"
            await self.send_json({"type": "state", "value": "listening"})

    async def handle_interrupt(self):
        """User interrupted - stop speaking (barge-in)"""
        if self.tts_stream and self.state == "speaking":
            # Cancel TTS - this tears down and reconnects the socket
            await self.tts_stream.cancel()
            await self.send_json({"type": "clear"})
        self.state = "listening"
        await self.send_json({"type": "state", "value": "listening"})

    async def send_json(self, data: dict):
        """Send JSON message to client"""
        try:
            await self.ws.send_json(data)
        except:
            pass

    async def shutdown(self):
        """Clean up resources"""
        if self._closing:
            return
        self._closing = True

        if self.stt_stream:
            with contextlib.suppress(Exception):
                await self.stt_stream.__aexit__(None, None, None)

        if self.tts_stream:
            with contextlib.suppress(Exception):
                await self.tts_stream.close()

        await self.send_json({
            "type": "ended",
            "conversation_id": self.conversation_id
        })


# In-memory session store (use Redis in production)
_SESSIONS: dict[str, dict[str, Any]] = {}


def _reap_sessions():
    """Remove expired sessions"""
    cutoff = time.time() - SESSION_TTL
    for sid in [s for s, v in _SESSIONS.items() if v["created"] < cutoff]:
        _SESSIONS.pop(sid, None)


@router.post("/sessions", status_code=201)
async def create_voice_chat_session(
    req: VoiceChatRequest,
    current_user: User | PhoneUser = Depends(get_current_user),
) -> dict[str, Any]:
    """Create a new voice chat session"""
    _reap_sessions()

    session_id = uuid.uuid4().hex
    token = secrets.token_urlsafe(24)

    _SESSIONS[session_id] = {
        "created": time.time(),
        "token": token,
        "patient_id": req.patient_id,
        "language": req.language,
        "gender": req.gender,
        "user_id": current_user.id,
        "status": "created"
    }

    return {
        "session_id": session_id,
        "token": token,
        "ws_url": f"/voice-chat/ws/{session_id}?token={token}",
        "language": req.language
    }


@router.websocket("/ws/{session_id}")
async def voice_chat_websocket(
    websocket: WebSocket,
    session_id: str,
    token: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """WebSocket endpoint for voice chat"""
    sess = _SESSIONS.get(session_id)
    if not sess or not secrets.compare_digest(token, sess["token"]):
        await websocket.close(code=4401)
        return

    if time.time() - sess["created"] > SESSION_TTL:
        await websocket.close(code=4408)
        return

    await websocket.accept()
    sess["status"] = "connected"

    # Get user from session
    from sqlalchemy import select
    from models import PhoneUser
    result = await db.execute(select(PhoneUser).where(PhoneUser.id == sess["user_id"]))
    user = result.scalar_one_or_none()

    if not user:
        await websocket.close(code=4403)
        return

    session = VoiceChatSession(
        websocket=websocket,
        session_id=session_id,
        patient_id=sess["patient_id"],
        language=sess["language"],
        gender=sess["gender"],
        user=user
    )

    try:
        await session.run()
    except WebSocketDisconnect:
        pass
    finally:
        sess["status"] = "ended"


import contextlib
