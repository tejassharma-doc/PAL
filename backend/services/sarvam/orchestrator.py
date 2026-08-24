"""
Full-duplex voice session orchestrator.

Bridges one device WebSocket (browser, Capacitor WebView, or React Native) to
Sarvam's STT and TTS sockets, with the PAL agent in the middle.

    device mic ──PCM 16k──▶ Saaras v3 STT ──text──▶ Sarvam-30B/105B
                                                          │
    device speaker ◀──PCM 16k── Bulbul v3 TTS ◀──sentences─┘

Wire protocol (device ↔ this server)
------------------------------------
client → server
    binary frame            16-bit little-endian PCM mono @16 kHz, 20–40 ms
    {"type":"start", "language":"hi-IN", "gender":"female",
     "context":{"patient":"...", "doctor":"...", ...}}
    {"type":"interrupt"}    client-side VAD detected the user talking over PAL
    {"type":"text", "text":"..."}   typed input (accessibility / poor network)
    {"type":"hangup"}

server → client
    binary frame            16-bit PCM mono @16 kHz to play out
    {"type":"ready", "language":..., "voice":..., "nativeVoice":bool}
    {"type":"state", "value":"listening|thinking|speaking"}
    {"type":"transcript", "text":..., "final":true}
    {"type":"agent", "text":...}
    {"type":"language", "code":...}     locked after auto-detect / caller switch
    {"type":"clear"}                    drop buffered audio — barge-in happened
    {"type":"error", "message":...}
    {"type":"ended", "summary":{...}}

Barge-in is handled on both sides: the client stops playback the moment it hears
itself talking (fast, local), and the server tears down the TTS socket so no
further audio is generated (authoritative).
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from typing import Any

from . import client
from .agent import PalVoiceAgent
from .languages import Language, get as get_language

log = logging.getLogger("pal.sarvam.session")

# Below this confidence we do not trust Saaras' auto-detected language enough to
# switch the voice mid-call — better to keep speaking the language we dialled in.
LANG_SWITCH_CONFIDENCE = 0.75
MAX_CALL_SECONDS = 60 * 12


class VoiceSession:
    def __init__(self, transport, *, session_id: str, tools: dict | None = None):
        self.t = transport                  # anything with send_json/send_bytes/receive
        self.id = session_id
        self.tools = tools or {}
        self.lang: Language = get_language("en-IN")
        self.gender = "female"
        self.agent: PalVoiceAgent | None = None
        self.stt: client.SttStream | None = None
        self.tts: client.TtsStream | None = None
        self.state = "idle"
        self.speaking = False
        self.turn_seq = 0                   # bumped on every barge-in
        self.started = time.monotonic()
        self.summary: dict[str, Any] = {}
        self._lang_locked = False
        self._tasks: list[asyncio.Task] = []
        self._turn: asyncio.Task | None = None
        self._closing = False

    # ── lifecycle ────────────────────────────────────────────────────────────
    async def run(self) -> None:
        try:
            if not await self._handshake():
                return
            self._tasks = [
                asyncio.create_task(self._pump_device(), name="device"),
                asyncio.create_task(self._pump_stt(), name="stt"),
                asyncio.create_task(self._pump_tts(), name="tts"),
                asyncio.create_task(self._watchdog(), name="watchdog"),
            ]
            done, pending = await asyncio.wait(
                self._tasks, return_when=asyncio.FIRST_COMPLETED
            )
            for task in pending:
                task.cancel()
            for task in done:
                if exc := task.exception():
                    log.warning("session %s: %s ended with %s", self.id, task.get_name(), exc)
        except Exception:
            log.exception("session %s crashed", self.id)
            await self._safe_json({"type": "error", "message": "voice session failed"})
        finally:
            await self.shutdown()

    async def _handshake(self) -> bool:
        """First device message must be `start`. 30 s to send it."""
        try:
            raw = await asyncio.wait_for(self.t.receive(), timeout=30)
        except asyncio.TimeoutError:
            await self._safe_json({"type": "error", "message": "no start message"})
            return False

        msg = _as_json(raw) or {}
        if msg.get("type") != "start":
            await self._safe_json({"type": "error", "message": "expected start"})
            return False

        self.lang = get_language(msg.get("language"))
        self.gender = "male" if msg.get("gender") == "male" else "female"
        self._lang_locked = self.lang.code != "auto"
        if self.lang.code == "auto":
            # Speak Hindi until Saaras tells us otherwise — widest comprehension.
            self.lang = get_language("hi-IN")
            self._lang_locked = False

        self.agent = PalVoiceAgent(
            self.lang, context=msg.get("context") or {}, tools=self.tools
        )
        self.stt = client.SttStream(
            get_language(msg.get("language")) if self._lang_locked else get_language("auto")
        )
        await self.stt.__aenter__()
        self.tts = client.TtsStream(self.lang, gender=self.gender)
        await self.tts.connect()

        await self._safe_json(
            {
                "type": "ready",
                "language": self.lang.code,
                "voice": self.lang.speaker(self.gender),
                "nativeVoice": self.lang.tts_native,
                "sampleRate": client.AUDIO_SAMPLE_RATE,
            }
        )
        self._turn = asyncio.create_task(self._speak_opening())
        return True

    async def shutdown(self) -> None:
        if self._closing:
            return
        self._closing = True
        for task in (*self._tasks, self._turn):
            if task:
                task.cancel()
        if self.agent:
            with contextlib.suppress(Exception):
                # Kept on the session so the HTTP status route can serve it after
                # the socket is gone.
                self.summary = await self.agent.summarise()
        with contextlib.suppress(Exception):
            if self.stt:
                await self.stt.close()
        with contextlib.suppress(Exception):
            if self.tts:
                await self.tts.close()
        await self._safe_json({"type": "ended", "summary": self.summary})

    async def _watchdog(self) -> None:
        while True:
            await asyncio.sleep(5)
            if time.monotonic() - self.started > MAX_CALL_SECONDS:
                log.info("session %s hit the call length cap", self.id)
                return

    # ── device → STT ─────────────────────────────────────────────────────────
    async def _pump_device(self) -> None:
        while True:
            raw = await self.t.receive()
            if raw is None:
                return
            if isinstance(raw, (bytes, bytearray)):
                if self.stt:
                    await self.stt.send_pcm(bytes(raw))
                continue
            msg = _as_json(raw)
            if not msg:
                continue
            kind = msg.get("type")
            if kind == "interrupt":
                await self._barge_in()
            elif kind == "text" and msg.get("text"):
                await self._handle_utterance(msg["text"].strip())
            elif kind in {"hangup", "end", "close"}:
                return

    # ── STT → agent ──────────────────────────────────────────────────────────
    async def _pump_stt(self) -> None:
        if not self.stt:
            return
        async for event in self.stt.events():
            kind = event["kind"]
            if kind == "speech_start":
                # Caller talking. If PAL is mid-sentence, that is a barge-in.
                if self.speaking:
                    await self._barge_in()
            elif kind == "speech_end":
                await self.stt.flush()
            elif kind == "transcript":
                await self._maybe_switch_language(event)
                await self._safe_json(
                    {"type": "transcript", "text": event["text"], "final": True}
                )
                await self._handle_utterance(event["text"])
            elif kind == "error":
                log.warning("stt error on %s: %s", self.id, event.get("message"))
                await self._safe_json(
                    {"type": "error", "message": "speech recognition dropped"}
                )

    async def _maybe_switch_language(self, event: dict) -> None:
        """Auto-detect path: lock to the detected language once we are confident."""
        if self._lang_locked or not event.get("lang"):
            return
        confidence = event.get("confidence") or 0
        if confidence < LANG_SWITCH_CONFIDENCE:
            return
        detected = get_language(event["lang"])
        self._lang_locked = True
        if detected.code == self.lang.code:
            return
        log.info("session %s switching to %s (p=%.2f)", self.id, detected.code, confidence)
        self.lang = detected
        if self.agent:
            self.agent.switch_language(detected)
        await self._replace_tts()
        await self._safe_json(
            {
                "type": "language",
                "code": detected.code,
                "nativeVoice": detected.tts_native,
                "voice": detected.speaker(self.gender),
            }
        )

    # ── agent → TTS ──────────────────────────────────────────────────────────
    async def _speak_opening(self) -> None:
        if not self.agent:
            return
        await self._set_state("thinking")
        try:
            line = await self.agent.opening_line()
        except Exception as exc:
            log.warning("opening line failed: %s", exc)
            return
        await self._say(line)

    async def _handle_utterance(self, text: str) -> None:
        if not text or not self.agent:
            return
        if self._turn and not self._turn.done():
            self._turn.cancel()
        self._turn = asyncio.create_task(self._run_turn(text))

    async def _run_turn(self, text: str) -> None:
        assert self.agent
        seq = self.turn_seq
        await self._set_state("thinking")
        try:
            async for sentence in self.agent.stream_reply_to(text):
                if seq != self.turn_seq:      # barge-in cancelled this turn
                    return
                await self._say(sentence, seq=seq)
            if self.tts and seq == self.turn_seq:
                await self.tts.flush()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.warning("turn failed on %s: %s", self.id, exc)
            await self._safe_json({"type": "error", "message": "could not answer"})
        finally:
            if seq == self.turn_seq and not self.speaking:
                await self._set_state("listening")

    async def _say(self, sentence: str, *, seq: int | None = None) -> None:
        if not sentence.strip() or not self.tts:
            return
        if seq is not None and seq != self.turn_seq:
            return
        await self._safe_json({"type": "agent", "text": sentence})
        # Perso-Arabic / Ol Chiki have no Bulbul voice — transliterate first.
        spoken = await client.voice_text_for_tts(sentence, self.lang)
        self.speaking = True
        await self._set_state("speaking")
        await self.tts.say(spoken)

    async def _replace_tts(self) -> None:
        """
        Swap in a fresh TTS socket for the current language.

        Dropping the old socket is the only reliable way to stop audio Sarvam has
        already started generating, so this is both the barge-in mechanism and the
        language-switch mechanism. `self.tts` is set to None first so the pump
        loop sees the change and stops writing stale audio to the device.
        """
        old, self.tts = self.tts, None
        if old is not None:
            with contextlib.suppress(Exception):
                await old.close()
        if self._closing:
            return
        try:
            fresh = client.TtsStream(self.lang, gender=self.gender)
            await fresh.connect()
            self.tts = fresh
        except Exception as exc:
            log.warning("session %s: could not reopen TTS (%s)", self.id, exc)
            await self._safe_json({"type": "error", "message": "voice output interrupted"})

    async def _pump_tts(self) -> None:
        """
        Long-lived supervisor for the TTS socket.

        It must outlive individual sockets. An earlier version spawned one task
        per socket, so the first barge-in — which replaces the socket — completed
        a task that `run()` was waiting on with FIRST_COMPLETED, and the whole
        call hung up. Here the loop simply picks up whatever `self.tts` currently
        is and keeps going.
        """
        failures = 0
        while not self._closing:
            tts = self.tts
            if tts is None:
                await asyncio.sleep(0.02)
                continue
            try:
                async for chunk in tts.audio():
                    if tts is not self.tts:    # replaced by barge-in / language switch
                        break
                    if chunk["kind"] == "audio":
                        await self._safe_bytes(chunk["pcm"])
                    elif chunk["kind"] == "final":
                        self.speaking = False
                        await self._set_state("listening")
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.warning("session %s: tts pump error %s", self.id, exc)
                await asyncio.sleep(0.05)
            if tts is self.tts and not self._closing:
                # The socket ended on its own — idle timeout or a server hangup.
                # Reopen so the next turn can still speak, backing off so a hard
                # outage cannot spin this loop.
                failures += 1
                await asyncio.sleep(min(0.05 * failures, 1.0))
                await self._replace_tts()
                if failures > 20:
                    log.error("session %s: TTS will not stay open, giving up", self.id)
                    return
            else:
                failures = 0

    async def _barge_in(self) -> None:
        """Kill in-flight speech: bump the turn seq, drop TTS, tell client to flush."""
        self.turn_seq += 1
        self.speaking = False
        if self._turn and not self._turn.done():
            self._turn.cancel()
        await self._safe_json({"type": "clear"})
        await self._replace_tts()
        await self._set_state("listening")

    # ── transport helpers ────────────────────────────────────────────────────
    async def _set_state(self, state: str) -> None:
        if state == self.state:
            return
        self.state = state
        await self._safe_json({"type": "state", "value": state})

    async def _safe_json(self, payload: dict) -> None:
        with contextlib.suppress(Exception):
            await self.t.send_json(payload)

    async def _safe_bytes(self, data: bytes) -> None:
        with contextlib.suppress(Exception):
            await self.t.send_bytes(data)


def _as_json(raw: Any) -> dict | None:
    if isinstance(raw, (bytes, bytearray)):
        return None
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else None
    except (TypeError, json.JSONDecodeError):
        return None
