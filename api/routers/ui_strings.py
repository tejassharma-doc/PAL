"""
Long-tail UI translation.

The clients ship hand-written UI packs for English, Hinglish and the 12 largest
Indian languages. For the remaining languages (Konkani, Kashmiri, Sindhi,
Sanskrit, Santali, Manipuri, Bodo, Maithili, Dogri, Nepali) this endpoint
translates the English pack once with Sarvam and caches it, so nobody ships or
maintains machine-translated files.

Cache lives on disk (UI_STRINGS_CACHE_DIR, default ./.cache/ui-strings) so a
restart does not re-bill the translation calls. Delete a file to refresh it, or
paste a reviewed pack into the client's i18n.js — baked packs always win.

Mount:  app.include_router(ui_strings.router)
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path

from fastapi import APIRouter, Query

from services.sarvam import client as sarvam
from services.sarvam.languages import get as get_language

log = logging.getLogger("pal.ui_strings")
router = APIRouter(prefix="/voice", tags=["voice"])

CACHE_DIR = Path(os.getenv("UI_STRINGS_CACHE_DIR", ".cache/ui-strings"))

# Source of truth. Keep in sync with web/i18n.js `en`.
EN: dict[str, str] = {
    "appTitle": "PAL Voice",
    "tagline": "Talk to PAL in your language",
    "language": "Language",
    "auto": "Detect automatically",
    "voice": "Voice",
    "female": "Female",
    "male": "Male",
    "startCall": "Call PAL",
    "endCall": "End call",
    "mute": "Mute",
    "unmute": "Unmute",
    "connecting": "Connecting",
    "listening": "Listening",
    "speaking": "PAL is speaking",
    "thinking": "Thinking",
    "you": "You",
    "pal": "PAL",
    "typeInstead": "Type instead",
    "send": "Send",
    "callEnded": "Call ended",
    "micDenied": "PAL needs microphone access to make the call.",
    "fallbackVoice": "Spoken with the closest available voice",
    "preview": "Hear this voice",
    "incoming": "PAL is calling",
    "accept": "Accept",
    "decline": "Decline",
}

_locks: dict[str, asyncio.Lock] = {}


def _read_cache(path: Path) -> dict[str, str] | None:
    """Returns None when there is no usable cache entry."""
    try:
        return json.loads(path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        path.unlink(missing_ok=True)
        return None


def _write_cache(path: Path, strings: dict[str, str]) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(strings, ensure_ascii=False, indent=1), "utf-8")
    except OSError as exc:
        log.warning("could not cache ui-strings: %s", exc)


@router.get("/ui-strings")
async def ui_strings(lang: str = Query(...)) -> dict:
    target = get_language(lang)
    if target.code in {"en-IN", "auto"}:
        return {"language": "en-IN", "strings": EN, "source": "builtin"}

    cache_file = CACHE_DIR / f"{target.code}.json"
    # Disk work goes to a thread: this endpoint is called during call setup, and
    # blocking the event loop there costs the caller ring latency.
    cached = await asyncio.to_thread(_read_cache, cache_file)
    if cached is not None:
        return {"language": target.code, "strings": cached, "source": "cache"}

    lock = _locks.setdefault(target.code, asyncio.Lock())
    async with lock:
        cached = await asyncio.to_thread(_read_cache, cache_file)
        if cached is not None:  # filled while we waited
            return {"language": target.code, "strings": cached, "source": "cache"}

        strings: dict[str, str] = {}
        # Translated one key at a time: these are UI fragments, and batching them
        # into one blob makes the model merge or reorder lines.
        async def one(key: str, value: str) -> None:
            try:
                strings[key] = await sarvam.translate(
                    value, source="en-IN", target=target.code
                )
            except Exception as exc:
                log.warning("ui-strings %s/%s failed: %s", target.code, key, exc)
                strings[key] = value

        # "PAL" is a product name — never translate it.
        await asyncio.gather(
            *(one(k, v) for k, v in EN.items() if k not in {"pal", "appTitle"})
        )
        strings["pal"] = "PAL"
        strings["appTitle"] = EN["appTitle"]

        await asyncio.to_thread(_write_cache, cache_file, strings)

    return {"language": target.code, "strings": strings, "source": "sarvam"}
