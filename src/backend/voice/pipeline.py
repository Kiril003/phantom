"""
Voice pipeline — glue between STT, the chat router, and TTS.

This module owns the process-local singletons so route handlers never
need to construct providers themselves. The singletons honour live
settings changes: mutate `config.voice_stt_mode` via /settings and call
`reset_providers()` to force a rebuild on the next request.
"""
from __future__ import annotations

import logging
import threading
from typing import Optional

from voice.stt_engine import (
    STTProvider,
    STTResult,
    build_stt_provider,
    decode_to_mono16k,
)
from voice.tts_engine import (
    TTSProvider,
    TTSResult,
    build_tts_provider,
)

logger = logging.getLogger(__name__)


_lock = threading.Lock()
_stt: Optional[STTProvider] = None
_tts: Optional[TTSProvider] = None


def get_stt_provider() -> STTProvider:
    """Lazily build the STT provider; thread-safe so burst requests from
    multiple workers don't race through the chain."""
    global _stt
    if _stt is None:
        with _lock:
            if _stt is None:
                _stt = build_stt_provider()
                logger.info("STT provider active: %s", _stt.name)
    return _stt


def get_tts_provider() -> TTSProvider:
    global _tts
    if _tts is None:
        with _lock:
            if _tts is None:
                _tts = build_tts_provider()
                logger.info("TTS provider active: %s", _tts.name)
    return _tts


def reset_providers() -> None:
    """Force a rebuild of both providers — call after a voice_* setting
    changes in /settings so the new mode / voice takes effect."""
    global _stt, _tts
    with _lock:
        _stt = None
        _tts = None


async def transcribe_blob(raw: bytes, language: str) -> STTResult:
    """Decode and transcribe a caller-supplied audio blob."""
    audio = decode_to_mono16k(raw)
    return await get_stt_provider().transcribe(audio, language)


async def synthesize_text(text: str, voice: str, speed: float) -> TTSResult:
    return await get_tts_provider().synthesize(text, voice, speed)
