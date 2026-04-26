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


# Phase 11c.4 — RLock (reentrant) instead of Lock. `get_vosk_model()` is
# called while still holding `_lock` from `get_stt_provider()` (or vice
# versa) on the same thread; with a non-reentrant Lock the second
# acquire deadlocks indefinitely, freezing the worker building the
# always-on orchestrator and (transitively, before the to_thread fixes)
# the entire event loop.
_lock = threading.RLock()
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
    global _stt, _tts, _vosk_model
    with _lock:
        _stt = None
        _tts = None
        _vosk_model = None
    # Phase 12.0 — VAD ORT session cache is independent; drop it too so a
    # voice_* setting that affects the model path picks up the change.
    try:
        from voice.vad import reset_vad_session
        reset_vad_session()
    except Exception:
        pass


async def transcribe_blob(raw: bytes, language: str) -> STTResult:
    """Decode and transcribe a caller-supplied audio blob."""
    audio = decode_to_mono16k(raw)
    return await get_stt_provider().transcribe(audio, language)


_vosk_model = None


def get_vosk_model():
    """Return a shared ``vosk.Model`` instance, loading it on first call.

    Phase 11b always-on voice needs Vosk for wake-word spotting and for
    post-wake utterance transcription, regardless of which mode
    ``voice_stt_mode`` selects for push-to-talk. If the active STT
    provider is Vosk we reuse the model it already loaded; otherwise we
    load it fresh via the same path resolver.

    Raises ``RuntimeError`` if the model directory isn't found on disk
    so callers can disable always-on cleanly.
    """
    global _vosk_model
    if _vosk_model is not None:
        return _vosk_model
    with _lock:
        if _vosk_model is not None:
            return _vosk_model
        provider = get_stt_provider()
        if hasattr(provider, "get_model"):
            try:
                _vosk_model = provider.get_model()
                logger.info("always-on: reusing Vosk model from STT provider")
                return _vosk_model
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "always-on: STT provider's Vosk model unavailable (%s); "
                    "loading fresh",
                    exc,
                )
        from voice.stt_engine import _resolve_vosk_model_path

        path = _resolve_vosk_model_path()
        if path is None:
            raise RuntimeError(
                "always-on voice: Vosk model directory not found on disk"
            )
        import vosk

        vosk.SetLogLevel(-1)
        logger.info("always-on: loading fresh Vosk model from %s", path)
        _vosk_model = vosk.Model(str(path))
        return _vosk_model


def reset_vosk_model() -> None:
    """Drop the cached Vosk reference — called by reset_providers()
    when voice settings change."""
    global _vosk_model
    with _lock:
        _vosk_model = None


async def synthesize_text(text: str, voice: str, speed: float) -> TTSResult:
    return await get_tts_provider().synthesize(text, voice, speed)


# ─── Phase 12.0 — startup preload (Bug 2 fix) ───────────────────────────────


def preload_voice_models(silero_vad_path: Optional[str] = None) -> dict[str, str]:
    """Pre-load the Silero VAD ORT session, the Vosk model, and (when the
    active STT provider has one) the Whisper model. Returns a status map
    so the lifespan logger can record which singletons came up.

    Models stay loaded for the process lifetime via the existing
    ``_stt`` / ``_vosk_model`` / ``_vad_session`` module-level globals.
    Without this preload, the first WS connection paid 8-10s of cold load
    on the event loop's worker thread (11c.5 Bug 2).
    """
    statuses: dict[str, str] = {}

    # Silero VAD ORT session
    if silero_vad_path:
        from pathlib import Path as _Path
        if _Path(silero_vad_path).is_file():
            try:
                from voice.vad import get_vad_session
                get_vad_session(silero_vad_path)
                statuses["silero_vad"] = "loaded"
            except Exception as exc:
                statuses["silero_vad"] = f"failed: {exc}"
        else:
            statuses["silero_vad"] = f"skipped: {silero_vad_path} missing"
    else:
        statuses["silero_vad"] = "skipped: no path supplied"

    # Vosk model — used by the wake-spotter and the always-on transcribe
    # fallback. ``get_vosk_model`` already memoises via the module lock.
    try:
        get_vosk_model()
        statuses["vosk"] = "loaded"
    except Exception as exc:
        statuses["vosk"] = f"failed: {exc}"

    # Whisper — only the FasterWhisper provider has ``_ensure_model``.
    # Other providers (vosk-only) just touch their cached model so this
    # is a noop for them.
    try:
        provider = get_stt_provider()
        ensure = getattr(provider, "_ensure_model", None)
        if callable(ensure):
            ensure()
            statuses["whisper"] = "loaded"
        else:
            statuses["whisper"] = f"skipped: {provider.name} has no whisper model"
    except Exception as exc:
        statuses["whisper"] = f"failed: {exc}"

    return statuses
