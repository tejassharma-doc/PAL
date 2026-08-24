"""
Sarvam AI HTTP + WebSocket client.

Covers everything the PAL voice agent needs:
  * chat completions      POST /v1/chat/completions        (sarvam-30b / 105b)
  * streaming STT          WSS  /speech-to-text/ws          (saaras:v3)
  * streaming TTS          WSS  /text-to-speech/ws          (bulbul:v3)
  * one-shot TTS           POST /text-to-speech
  * transliteration        POST /transliterate
  * translation            POST /translate
  * language ID            POST /text-lid

The API key is read from the environment (SARVAM_API_KEY) and is never logged.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
from collections.abc import AsyncIterator
from typing import Any

import httpx
import websockets

from .languages import Language, get as get_language

log = logging.getLogger("pal.sarvam")

# LiteLLM configuration for Gemma
LITELLM_BASE_URL = os.getenv("OPENAI_API_BASE", "http://34.14.174.141:4000/v1")
LITELLM_API_KEY = os.getenv("OPENAI_API_KEY", "sk-8cxtPKSUF-ENMMTD7pTnKg")
LITELLM_MODEL = os.getenv("GEMINI_MODEL", "vertex_ai/google/gemma-4-26b-a4b-it-maas")
USE_LITELLM = os.getenv("VOICE_USE_LITELLM", "true").lower() == "true"


BASE_URL = os.getenv("SARVAM_BASE_URL", "https://api.sarvam.ai")
WS_URL = os.getenv("SARVAM_WS_URL", "wss://api.sarvam.ai")

STT_MODEL = os.getenv("SARVAM_STT_MODEL", "saaras:v3")
TTS_MODEL = os.getenv("SARVAM_TTS_MODEL", "bulbul:v3")
LLM_MODEL = os.getenv("SARVAM_LLM_MODEL", "sarvam-30b")
LLM_MODEL_HEAVY = os.getenv("SARVAM_LLM_MODEL_HEAVY", "sarvam-105b")

# Client mic capture and TTS playback both run at 16 kHz to keep a single
# resampler-free path on the device. Bulbul defaults to 24 kHz; we ask for 16 k.
AUDIO_SAMPLE_RATE = int(os.getenv("SARVAM_SAMPLE_RATE", "16000"))


class SarvamError(RuntimeError):
    pass


def _api_key() -> str:
    key = os.getenv("SARVAM_API_KEY", "").strip()
    if not key:
        raise SarvamError(
            "SARVAM_API_KEY is not set. Put it in the server environment — never "
            "in client code or a committed .env."
        )
    return key


def _headers() -> dict[str, str]:
    return {"api-subscription-key": _api_key(), "Content-Type": "application/json"}


def _redact(payload: Any) -> Any:
    """Strip audio blobs before anything reaches the log."""
    if isinstance(payload, dict):
        return {
            k: ("<audio>" if k in {"audio", "audios", "data"} else _redact(v))
            for k, v in payload.items()
        }
    return payload


# ── Text endpoints ────────────────────────────────────────────────────────────

async def chat(
    messages: list[dict[str, str]],
    *,
    model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 400,
    stream: bool = False,
    reasoning_effort: str | None = "low",
    tools: list[dict] | None = None,
    timeout: float = 30.0,
) -> Any:
    """
    Non-streaming: returns the assistant message dict.
    Streaming: returns an async iterator of text deltas.
    """
    # Use LiteLLM (Gemma) for voice conversations
    if USE_LITELLM:
        body: dict[str, Any] = {
            "model": LITELLM_MODEL,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": stream,
        }
        # LiteLLM doesn't support reasoning_effort, skip it
        if tools:
            body["tools"] = tools
            body["tool_choice"] = "auto"

        headers = {"Authorization": f"Bearer {LITELLM_API_KEY}", "Content-Type": "application/json"}

        if not stream:
            async with httpx.AsyncClient(timeout=timeout) as http:
                r = await http.post(
                    f"{LITELLM_BASE_URL}/chat/completions", json=body, headers=headers
                )
                if r.status_code >= 400:
                    raise SarvamError(f"litellm chat {r.status_code}: {r.text[:400]}")
                msg = r.json()["choices"][0]["message"]
                # Gemma returns content in reasoning_content field
                if not msg.get("content") and msg.get("reasoning_content"):
                    msg["content"] = msg["reasoning_content"]
                return msg

        return _litellm_chat_stream(body, timeout)
    
    # Original Sarvam code
    body: dict[str, Any] = {
        "model": model or LLM_MODEL,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": stream,
    }
    if reasoning_effort:
        body["reasoning_effort"] = reasoning_effort
    if tools:
        body["tools"] = tools
        body["tool_choice"] = "auto"

    if not stream:
        async with httpx.AsyncClient(timeout=timeout) as http:
            r = await http.post(
                f"{BASE_URL}/v1/chat/completions", json=body, headers=_headers()
            )
            if r.status_code >= 400:
                raise SarvamError(f"chat {r.status_code}: {r.text[:400]}")
            return r.json()["choices"][0]["message"]

    return _chat_stream(body, timeout)


async def _litellm_chat_stream(body: dict, timeout: float) -> AsyncIterator[str]:
    """Stream chat completions from LiteLLM (Gemma)"""
    headers = {"Authorization": f"Bearer {LITELLM_API_KEY}", "Content-Type": "application/json"}
    async with (
        httpx.AsyncClient(timeout=timeout) as http,
        http.stream(
            "POST", f"{LITELLM_BASE_URL}/chat/completions", json=body, headers=headers
        ) as r,
    ):
            if r.status_code >= 400:
                raise SarvamError(f"litellm stream {r.status_code}: {await r.aread()!r}")
            async for line in r.aiter_lines():
                if not line.startswith("data:"):
                    continue
                chunk = line[5:].strip()
                if not chunk or chunk == "[DONE]":
                    continue
                try:
                    delta = json.loads(chunk)["choices"][0].get("delta", {})
                except (json.JSONDecodeError, KeyError, IndexError):
                    continue
                # Gemma may return in reasoning_content instead of content
                piece = delta.get("content") or delta.get("reasoning_content")
                if piece:
                    yield piece


async def _chat_stream(body: dict, timeout: float) -> AsyncIterator[str]:
    async with (
        httpx.AsyncClient(timeout=timeout) as http,
        http.stream(
            "POST", f"{BASE_URL}/v1/chat/completions", json=body, headers=_headers()
        ) as r,
    ):
            if r.status_code >= 400:
                raise SarvamError(f"chat stream {r.status_code}: {await r.aread()!r}")
            async for line in r.aiter_lines():
                if not line.startswith("data:"):
                    continue
                chunk = line[5:].strip()
                if not chunk or chunk == "[DONE]":
                    continue
                try:
                    delta = json.loads(chunk)["choices"][0].get("delta", {})
                except (json.JSONDecodeError, KeyError, IndexError):
                    continue
                # Gemma may return in reasoning_content instead of content
                piece = delta.get("content") or delta.get("reasoning_content")
                if piece:
                    yield piece


async def transliterate(
    text: str, *, source_language_code: str, target_language_code: str
) -> str:
    """Script conversion (e.g. Urdu Perso-Arabic -> Devanagari for the hi-IN voice)."""
    async with httpx.AsyncClient(timeout=15.0) as http:
        r = await http.post(
            f"{BASE_URL}/transliterate",
            json={
                "input": text,
                "source_language_code": source_language_code,
                "target_language_code": target_language_code,
                "numerals_format": "international",
            },
            headers=_headers(),
        )
        if r.status_code >= 400:
            log.warning("transliterate failed %s — passing text through", r.status_code)
            return text
        return r.json().get("transliterated_text") or text


async def translate(text: str, *, source: str, target: str) -> str:
    async with httpx.AsyncClient(timeout=20.0) as http:
        r = await http.post(
            f"{BASE_URL}/translate",
            json={
                "input": text,
                "source_language_code": source,
                "target_language_code": target,
                "mode": "modern-colloquial",
            },
            headers=_headers(),
        )
        if r.status_code >= 400:
            raise SarvamError(f"translate {r.status_code}: {r.text[:200]}")
        return r.json().get("translated_text", text)


async def identify_language(text: str) -> str | None:
    async with httpx.AsyncClient(timeout=10.0) as http:
        r = await http.post(
            f"{BASE_URL}/text-lid", json={"input": text}, headers=_headers()
        )
        if r.status_code >= 400:
            return None
        return r.json().get("language_code")


async def tts_once(
    text: str, *, lang: Language, gender: str = "female", pace: float = 1.0
) -> bytes:
    """One-shot synthesis -> WAV bytes. Used for cached prompts and ringtones."""
    async with httpx.AsyncClient(timeout=30.0) as http:
        r = await http.post(
            f"{BASE_URL}/text-to-speech",
            json={
                "text": text[:2400],
                "target_language_code": lang.tts,
                "speaker": lang.speaker(gender),
                "model": TTS_MODEL,
                "pace": pace,
                "speech_sample_rate": AUDIO_SAMPLE_RATE,
            },
            headers=_headers(),
        )
        if r.status_code >= 400:
            raise SarvamError(f"tts {r.status_code}: {r.text[:200]}")
        audios = r.json().get("audios") or []
        return base64.b64decode(audios[0]) if audios else b""


# ── Streaming STT (Saaras v3) ─────────────────────────────────────────────────

class SttStream:
    """
    Full-duplex STT socket.

    Send 16-bit PCM @16 kHz with `send_pcm()`. Consume `events()` for:
        {"kind": "speech_start"}                     -> caller began talking (barge-in)
        {"kind": "speech_end"}                       -> VAD end-of-turn
        {"kind": "transcript", "text": ..., "lang": ..., "confidence": ...}
        {"kind": "error", "message": ...}
    """

    def __init__(self, lang: Language, *, high_vad_sensitivity: bool = True):
        self.lang = lang
        self._high_vad = high_vad_sensitivity
        self._ws: websockets.WebSocketClientProtocol | None = None

    def _url(self) -> str:
        params = [
            f"model={STT_MODEL}",
            f"mode={self.lang.stt_mode}",
            f"sample_rate={AUDIO_SAMPLE_RATE}",
            "input_audio_codec=pcm_s16le",
            "vad_signals=true",
            "flush_signal=true",
            f"high_vad_sensitivity={'true' if self._high_vad else 'false'}",
        ]
        # Locking the language raises accuracy; 'unknown' lets Saaras auto-detect.
        params.append(f"language-code={self.lang.stt or 'unknown'}")
        return f"{WS_URL}/speech-to-text/ws?" + "&".join(params)

    async def __aenter__(self) -> SttStream:
        self._ws = await websockets.connect(
            self._url(),
            additional_headers={"api-subscription-key": _api_key()},
            max_size=None,
            ping_interval=20,
        )
        return self

    async def __aexit__(self, *_exc) -> None:
        await self.close()

    async def send_pcm(self, pcm: bytes) -> None:
        if not self._ws:
            return
        await self._ws.send(
            json.dumps(
                {
                    "audio": {
                        "data": base64.b64encode(pcm).decode(),
                        "sample_rate": str(AUDIO_SAMPLE_RATE),
                        "encoding": "audio/wav",
                    }
                }
            )
        )

    async def flush(self) -> None:
        """Force finalisation of the current partial turn."""
        if self._ws:
            await self._ws.send(json.dumps({"type": "flush"}))

    async def events(self) -> AsyncIterator[dict[str, Any]]:
        if not self._ws:
            return
        async for raw in self._ws:
            try:
                msg = json.loads(raw)
            except (TypeError, json.JSONDecodeError):
                continue
            kind, data = msg.get("type"), msg.get("data") or {}
            if kind == "events":
                signal = data.get("signal_type")
                if signal == "START_SPEECH":
                    yield {"kind": "speech_start"}
                elif signal == "END_SPEECH":
                    yield {"kind": "speech_end"}
            elif kind == "data":
                text = (data.get("transcript") or "").strip()
                if text:
                    yield {
                        "kind": "transcript",
                        "text": text,
                        "lang": data.get("language_code"),
                        "confidence": data.get("language_probability"),
                        "latency": (data.get("metrics") or {}).get("processing_latency"),
                    }
            elif kind == "error":
                yield {"kind": "error", "message": data.get("error") or data.get("message")}

    async def close(self) -> None:
        if self._ws:
            try:
                await self._ws.close()
            finally:
                self._ws = None


# ── Streaming TTS (Bulbul v3) ─────────────────────────────────────────────────

class TtsStream:
    """
    Sentence-in / audio-chunk-out socket.

    `say()` pushes a text fragment; `audio()` yields raw PCM (linear16) chunks as
    soon as Bulbul produces them, so the first syllable reaches the device before
    the sentence is finished. `cancel()` implements barge-in: the socket is torn
    down and reopened, which is the only reliable way to stop in-flight audio.
    """

    def __init__(self, lang: Language, *, gender: str = "female", pace: float = 1.0):
        self.lang = lang
        self.gender = gender
        self.pace = pace
        self._ws: websockets.WebSocketClientProtocol | None = None
        self._pinger: asyncio.Task | None = None

    async def __aenter__(self) -> TtsStream:
        await self.connect()
        return self

    async def __aexit__(self, *_exc) -> None:
        await self.close()

    async def connect(self) -> None:
        self._ws = await websockets.connect(
            f"{WS_URL}/text-to-speech/ws?model={TTS_MODEL}&send_completion_event=true",
            additional_headers={"api-subscription-key": _api_key()},
            max_size=None,
            ping_interval=20,
        )
        await self._ws.send(
            json.dumps(
                {
                    "type": "config",
                    "data": {
                        "model": TTS_MODEL,
                        "target_language_code": self.lang.tts,
                        "speaker": self.lang.speaker(self.gender),
                        "pace": self.pace,
                        "temperature": 0.5,
                        # linear16 keeps the device path decoder-free
                        "output_audio_codec": "linear16",
                        "speech_sample_rate": str(AUDIO_SAMPLE_RATE),
                        "min_buffer_size": 40,
                        "max_chunk_length": 120,
                    },
                }
            )
        )
        self._pinger = asyncio.create_task(self._keepalive())

    async def _keepalive(self) -> None:
        # Sarvam closes an idle TTS socket after ~60 s.
        try:
            while self._ws:
                await asyncio.sleep(20)
                if self._ws:
                    await self._ws.send(json.dumps({"type": "ping"}))
        except (asyncio.CancelledError, websockets.WebSocketException):
            pass

    async def say(self, text: str) -> None:
        if self._ws and text.strip():
            await self._ws.send(json.dumps({"type": "text", "data": {"text": text}}))

    async def flush(self) -> None:
        if self._ws:
            await self._ws.send(json.dumps({"type": "flush"}))

    async def audio(self) -> AsyncIterator[dict[str, Any]]:
        if not self._ws:
            return
        async for raw in self._ws:
            try:
                msg = json.loads(raw)
            except (TypeError, json.JSONDecodeError):
                continue
            kind, data = msg.get("type"), msg.get("data") or {}
            if kind == "audio" and data.get("audio"):
                yield {"kind": "audio", "pcm": base64.b64decode(data["audio"])}
            elif kind == "event" and data.get("event_type") == "final":
                yield {"kind": "final"}
            elif kind == "error":
                log.warning("tts error: %s", data.get("message"))
                yield {"kind": "error", "message": data.get("message")}

    async def cancel(self) -> None:
        """Barge-in: drop the socket so queued audio dies, then reconnect."""
        await self.close()
        await self.connect()

    async def close(self) -> None:
        if self._pinger:
            self._pinger.cancel()
            self._pinger = None
        if self._ws:
            try:
                await self._ws.close()
            finally:
                self._ws = None


async def voice_text_for_tts(text: str, lang: Language) -> str:
    """
    Prepare LLM output for Bulbul.

    Perso-Arabic and Ol Chiki scripts have no Bulbul voice, so we transliterate
    into the fallback voice's script first. Everything else passes through —
    bulbul:v3 reads code-mixed Latin/Indic text natively, which is what makes
    Hinglish work without a special path.
    """
    if lang.needs_transliteration:
        target = get_language(lang.translit_to).code
        return await transliterate(
            text, source_language_code=lang.code, target_language_code=target
        )
    return text
