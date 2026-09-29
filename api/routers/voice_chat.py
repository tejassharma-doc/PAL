"""
Voice Chat - STT/TTS wrapper around Hermes Gemma endpoint

This endpoint mediates voice conversations:
- User speaks (audio) → STT → text → Hermes endpoint → response text → TTS → audio
- Handles turn-taking, interruptions, and conversation state
"""
from __future__ import annotations

import asyncio
import base64
import json
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

log = logging.getLogger("pal.voice_chat")
# No prefix: the session POST lives at /voice-chat/sessions (reached via the
# nginx /api/ proxy), but the WebSocket must live under /ws/ — the nginx /api/
# location does NOT pass the Upgrade header, so a socket under /api would 404.
# /ws/voice-chat gets its own upgrade-enabled nginx block (like /ws/chat).
router = APIRouter(tags=["voice-chat"])

SESSION_TTL = 900  # 15 minutes

# This voice agent books appointments and nothing else, so it is handed only the
# DocEHR scheduling tools (surfaced by fastmcp_client). Patient-data and
# literature tools are deliberately withheld — that keeps it separate from the
# Hermes "ask" chat, which still gets the full tool set.
BOOKING_TOOL_NAMES = {"get_appointment_slots", "book_appointment"}
MAX_BOOKING_TOOL_ROUNDS = 6


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
        self.conversation_history: list[dict] = []  # Store conversation turns

        # Silence detection for turn-taking (3 seconds)
        self.current_transcript_buffer = ""  # Buffer partial transcripts
        self.last_speech_time = 0.0  # Timestamp of last speech activity
        self.silence_timeout = 3.0  # Wait 3 seconds of silence before processing
        self.silence_task: asyncio.Task | None = None  # Task monitoring silence
        self.detected_language: str | None = None  # Track conversation language

    async def run(self):
        """Main session loop"""
        try:
            log.info(f"[VoiceChat] Starting session {self.session_id}")

            # Initialize STT and TTS streams
            log.info(f"[VoiceChat] Initializing STT stream...")
            self.stt_stream = sarvam.SttStream(self.lang)
            await self.stt_stream.__aenter__()
            log.info(f"[VoiceChat] STT stream initialized: {self.stt_stream is not None}")

            log.info(f"[VoiceChat] Initializing TTS stream...")
            try:
                self.tts_stream = sarvam.TtsStream(self.lang, gender=self.gender)
                await self.tts_stream.connect()
                log.info(f"[VoiceChat] TTS stream initialized")
            except Exception as e:
                log.error(f"[VoiceChat] TTS initialization failed: {e} - Continuing without TTS")
                self.tts_stream = None

            # Send ready signal
            await self.send_json({
                "type": "ready",
                "language": self.lang.code,
                "voice": self.lang.speaker(self.gender),
                "session_id": self.session_id
            })
            log.info(f"[VoiceChat] Sent ready signal")

            # Skip greeting for now - TTS has issues
            # TODO: Fix TTS language detection
            log.info(f"[VoiceChat] Skipping greeting, going straight to listening")
            self.state = "listening"
            await self.send_json({"type": "state", "value": "listening"})

            # Start pumps
            log.info(f"[VoiceChat] Starting pumps...")
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
        log.info(f"[VoiceChat] Device pump started for session {self.session_id}")
        while not self._closing:
            try:
                msg = await self.ws.receive()
                msg_type = msg.get("type")

                if msg_type == "websocket.disconnect":
                    log.info(f"[VoiceChat] Client disconnected")
                    break

                # Binary audio data → STT (PCM 16-bit mono @ 16kHz)
                if (audio_data := msg.get("bytes")) is not None:
                    log.debug(f"[VoiceChat] Received audio chunk: {len(audio_data)} bytes, state={self.state}, stt_stream={self.stt_stream is not None}")
                    if self.stt_stream and self.state == "listening":
                        log.debug(f"[VoiceChat] Sending to STT...")
                        await self.stt_stream.send_pcm(audio_data)
                    else:
                        log.warning(f"[VoiceChat] NOT sending to STT: state={self.state}, stt_stream exists={self.stt_stream is not None}")

                # Control messages
                elif (text_data := msg.get("text")) is not None:
                    log.info(f"[VoiceChat] Received control message: {text_data}")
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
                log.info(f"[VoiceChat] WebSocket disconnected")
                break
            except Exception as e:
                log.error(f"Device pump error: {e}")
                break

    async def _pump_stt(self):
        """Process STT results and send to Hermes"""
        if not self.stt_stream:
            log.error(f"[VoiceChat] STT pump started but stt_stream is None!")
            return

        log.info(f"[VoiceChat] STT pump started for session {self.session_id}")
        try:
            async for event in self.stt_stream.events():
                if self._closing:
                    break

                kind = event.get("kind")
                log.info(f"[VoiceChat] STT event: {kind}")

                if kind == "speech_start":
                    log.info(f"[VoiceChat] User started speaking")
                    # User started speaking - might want to interrupt
                    if self.state == "speaking":
                        await self.handle_interrupt()

                elif kind == "speech_end":
                    log.info(f"[VoiceChat] User stopped speaking")
                    # User stopped speaking - finalize transcript
                    await self.stt_stream.flush()

                elif kind == "transcript":
                    text = event.get("text", "").strip()
                    is_final = event.get("is_final", True)
                    log.info(f"[VoiceChat] Transcript received: '{text}' (length={len(text)}, final={is_final})")

                    # Ignore empty or very short transcripts (noise)
                    if not text or len(text) < 3:
                        log.info(f"[VoiceChat] Ignoring empty/short transcript")
                        continue

                    # Send transcript to client (for display)
                    await self.send_json({
                        "type": "transcript",
                        "text": text,
                        "final": is_final,
                        "confidence": event.get("confidence", 0.0)
                    })

                    # Buffer transcripts and wait for silence
                    self.current_transcript_buffer = text
                    self.last_speech_time = time.time()

                    # Cancel existing silence timer
                    if self.silence_task and not self.silence_task.done():
                        self.silence_task.cancel()

                    # Start new silence timer (3 seconds)
                    self.silence_task = asyncio.create_task(self._wait_for_silence())

                    log.info(f"[VoiceChat] Buffered transcript, waiting for 3s silence")

                elif kind == "error":
                    log.error(f"STT error: {event.get('message')}")

        except Exception as e:
            log.exception(f"STT pump error: {e}")

    async def _pump_tts(self):
        """Stream TTS audio to client"""
        if not self.tts_stream:
            log.error(f"[VoiceChat] TTS pump started but tts_stream is None!")
            return

        log.info(f"[VoiceChat] TTS pump started for session {self.session_id}")
        try:
            async for event in self.tts_stream.audio():
                if self._closing:
                    break

                kind = event.get("kind")
                log.info(f"[VoiceChat] TTS event: {kind}")

                if kind == "audio":
                    # Send PCM audio chunk to client
                    pcm_data = event.get("pcm")
                    if pcm_data:
                        log.debug(f"[VoiceChat] Sending TTS audio chunk: {len(pcm_data)} bytes")
                        await self.ws.send_bytes(pcm_data)

                elif kind == "final":
                    # TTS finished this utterance
                    log.info(f"[VoiceChat] TTS finished, changing state to listening")
                    self.state = "listening"
                    await self.send_json({"type": "state", "value": "listening"})

                elif kind == "error":
                    log.error(f"TTS error: {event.get('message')}")

        except Exception as e:
            log.exception(f"TTS pump error: {e}")

    async def process_user_query(self, query: str):
        """
        User query → Hermes endpoint → TTS
        This is the conversation mediator
        """
        try:
            # Don't process if we're already thinking or speaking
            if self.state in ["thinking", "speaking"]:
                log.warning(f"[VoiceChat] Ignoring query while state={self.state}")
                return

            log.info(f"[VoiceChat] process_user_query called with: '{query}'")
            # Update state
            self.state = "thinking"
            await self.send_json({"type": "state", "value": "thinking"})

            # ── Appointment-booking agent (DocEHR MCP) ─────────────────────────
            # This is deliberately distinct from the Hermes "ask" chat: this voice
            # agent only books appointments and only sees the DocEHR scheduling
            # tools. It reuses the SAME DocEHR MCP wiring as fastmcp_client, so no
            # new integration is introduced and the "ask llm" flow is untouched.
            from services.llm_vertex import get_vertex_client
            from services.fastmcp_client import get_fastmcp_client
            from database import get_db
            from datetime import date as _date
            import uuid as uuid_lib

            # Keep the conversation in the user's spoken language.
            language_instruction = ""
            if self.detected_language:
                lang_names = {'en': 'English', 'hi': 'Hindi', 'kn': 'Kannada'}
                lang_name = lang_names.get(self.detected_language, 'English')
                language_instruction = (
                    f"\n\nIMPORTANT: The user is speaking in {lang_name}. "
                    f"ALWAYS respond in {lang_name} to keep the conversation consistent."
                )

            today = _date.today().isoformat()
            system_prompt = f"""You are PAL's appointment-booking assistant, a warm and efficient voice receptionist.
Your ONLY job is to help this patient book a medical appointment. Do not give medical advice or discuss records — if asked, gently steer back to booking.

Today's date is {today}. You are booking for patient_id: {self.patient_id} — always pass this exact id to the tools.

Follow this order:
1. Find out which doctor and clinic the patient wants, and their preferred date.
2. Call get_appointment_slots to fetch real openings. Never invent slots — only offer what the tool returns.
3. Read the options back in natural spoken language (e.g. "I have 11:30 in the morning or 3 in the afternoon").
4. When the patient picks a time, ALWAYS confirm doctor, clinic, date and time out loud before booking.
5. Call book_appointment only after the patient confirms, then read back the confirmation.

Keep every reply SHORT (1-2 sentences) — this is a voice call. Ask one question at a time.{language_instruction}"""

            # Build messages with the last few turns for context.
            messages = [{"role": "system", "content": system_prompt}]
            for turn in self.conversation_history[-5:]:
                messages.append({"role": "user", "content": turn["user"]})
                messages.append({"role": "assistant", "content": turn["assistant"]})
            messages.append({"role": "user", "content": query})

            vertex_client = get_vertex_client()
            fastmcp_client = get_fastmcp_client()

            # Expose ONLY the DocEHR scheduling tools to this booking agent.
            all_tools = await fastmcp_client.get_tool_definitions()
            tools = [
                t for t in all_tools
                if t.get("function", {}).get("name") in BOOKING_TOOL_NAMES
            ]

            answer = None
            async for db in get_db():
                try:
                    if tools:
                        # Gemma tool-calling loop over the DocEHR MCP tools.
                        for round_num in range(MAX_BOOKING_TOOL_ROUNDS):
                            response = await vertex_client.generate_with_tools(messages, tools)
                            message = response.choices[0].message

                            if not message.tool_calls:
                                answer = message.content
                                break

                            log.info(
                                f"[VoiceChat] Tool round {round_num + 1}: "
                                f"{[tc.function.name for tc in message.tool_calls]}"
                            )
                            messages.append({
                                "role": "assistant",
                                "content": message.content,
                                "tool_calls": [tc.dict() for tc in message.tool_calls],
                            })

                            for tool_call in message.tool_calls:
                                tool_name = tool_call.function.name
                                try:
                                    tool_args = json.loads(tool_call.function.arguments or "{}")
                                except json.JSONDecodeError:
                                    tool_args = {}
                                # This agent always books for the session's patient.
                                tool_args.setdefault("patient_id", self.patient_id)
                                log.info(f"[VoiceChat] Calling {tool_name} args={tool_args}")
                                try:
                                    tool_result = await fastmcp_client.call_tool(tool_name, tool_args, db)
                                except Exception as tool_err:
                                    log.error(f"[VoiceChat] Tool {tool_name} failed: {tool_err}")
                                    tool_result = {"error": str(tool_err)}
                                messages.append({
                                    "role": "tool",
                                    "tool_call_id": tool_call.id,
                                    "content": json.dumps(tool_result, default=str),
                                })

                        if answer is None:
                            # Hit the tool-round cap — force a final spoken answer.
                            response = await vertex_client.generate_with_tools(messages, tools)
                            answer = response.choices[0].message.content or ""
                    else:
                        # DocEHR not configured yet — still run the LLM so the agent
                        # talks; booking activates once DOCEHR_MCP_URL and
                        # DOCEHR_ENABLED are set. (Step "run the llm perfectly".)
                        answer = await vertex_client.generate(messages)
                finally:
                    break  # Single DB session is all we need per turn

            if not answer:
                answer = "Sorry, I didn't catch that. Which doctor would you like to see?"

            # Store this turn in conversation history
            self.conversation_history.append({"user": query, "assistant": answer})
            log.info(f"[VoiceChat] Conversation history now has {len(self.conversation_history)} turns")

            if not self.conversation_id:
                self.conversation_id = str(uuid_lib.uuid4())

            # Send answer text to client, then speak it
            await self.send_json({"type": "agent", "text": answer})
            await self.speak_text(answer)

        except Exception as e:
            log.error(f"Error processing query: {e}")
            await self.speak_text("Sorry, there was an error. Please try again.")
        finally:
            self.state = "listening"
            await self.send_json({"type": "state", "value": "listening"})

    async def speak_text(self, text: str):
        """Convert text to speech and stream to client"""
        if not self.tts_stream:
            log.warning(f"[VoiceChat] TTS stream not available, skipping speech: '{text[:50]}...'")
            # Just send text without audio
            self.state = "listening"
            await self.send_json({"type": "state", "value": "listening"})
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
            log.error(f"TTS error: {e} - Continuing without speech")
            # Skip TTS and just return to listening
            self.state = "listening"
            await self.send_json({"type": "state", "value": "listening"})

    async def _wait_for_silence(self):
        """Wait 3 seconds of silence, then process buffered transcript"""
        try:
            await asyncio.sleep(self.silence_timeout)

            # 3 seconds passed without new speech
            if self.current_transcript_buffer and len(self.current_transcript_buffer) >= 3:
                log.info(f"[VoiceChat] 3s silence detected, processing buffered text: '{self.current_transcript_buffer}'")

                # Detect language from first meaningful utterance
                if not self.detected_language and len(self.current_transcript_buffer) > 5:
                    # Simple language detection based on script
                    import unicodedata
                    sample = self.current_transcript_buffer[:50]
                    if any('ऀ' <= c <= 'ॿ' for c in sample):  # Devanagari
                        self.detected_language = 'hi'
                    elif any('ಀ' <= c <= '೿' for c in sample):  # Kannada
                        self.detected_language = 'kn'
                    else:
                        self.detected_language = 'en'
                    log.info(f"[VoiceChat] Detected language: {self.detected_language}")

                # Process the query
                await self.process_user_query(self.current_transcript_buffer)

                # Clear buffer
                self.current_transcript_buffer = ""

        except asyncio.CancelledError:
            # New speech came in, silence timer was cancelled
            log.info(f"[VoiceChat] Silence timer cancelled (new speech detected)")
            pass

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


@router.post("/voice-chat/sessions", status_code=201)
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

    log.info(f"[VoiceChat] Created session {session_id} for user {current_user.id}")
    log.info(f"[VoiceChat] Total active sessions: {len(_SESSIONS)}")

    return {
        "session_id": session_id,
        "token": token,
        "ws_url": f"/ws/voice-chat/{session_id}?token={token}",
        "language": req.language
    }


@router.websocket("/ws/voice-chat/{session_id}")
async def voice_chat_websocket(
    websocket: WebSocket,
    session_id: str,
    token: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """WebSocket endpoint for voice chat"""
    log.info(f"[VoiceChat] WebSocket connect attempt: session_id={session_id}, token={token[:10]}...")
    sess = _SESSIONS.get(session_id)
    log.info(f"[VoiceChat] Session found: {sess is not None}")

    if not sess:
        log.warning(f"[VoiceChat] Session not found for {session_id}")
        await websocket.close(code=4401)
        return

    if not secrets.compare_digest(token, sess["token"]):
        log.warning(f"[VoiceChat] Token mismatch for {session_id}")
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

    log.info(f"[VoiceChat] Creating session object for {session_id}")
    session = VoiceChatSession(
        websocket=websocket,
        session_id=session_id,
        patient_id=sess["patient_id"],
        language=sess["language"],
        gender=sess["gender"],
        user=user
    )

    log.info(f"[VoiceChat] About to call session.run() for {session_id}")
    try:
        await session.run()
    except WebSocketDisconnect:
        log.info(f"[VoiceChat] WebSocket disconnected for {session_id}")
    except Exception as e:
        log.exception(f"[VoiceChat] session.run() crashed for {session_id}: {e}")
    finally:
        log.info(f"[VoiceChat] Cleaning up session {session_id}")
        sess["status"] = "ended"


import contextlib
