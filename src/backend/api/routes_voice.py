"""
Voice routes — TTS, STT.

Push-to-talk contract (Phase 07):
  POST /api/v1/voice/stt   multipart form, `file` = WAV/OGG/… blob.
       Returns {text, confidence, engine, language}.
  POST /api/v1/voice/tts   JSON {text, voice, speed, emotion_scale}.
       Returns audio/wav binary.
  GET  /api/v1/voice/status   config + active engine names — used by the
       Settings screen to tell operators which provider is running.

Wake-word always-on and true streaming STT during speech are deferred;
the front-end drives a tap-to-record loop against these HTTP endpoints.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, File, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field

from config import config
from voice.pipeline import (
    get_stt_provider,
    get_tts_provider,
    synthesize_text,
    transcribe_blob,
)
from voice.stt_engine import contains_wake_word

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/voice", tags=["voice"])


MAX_STT_BYTES = 10 * 1024 * 1024  # 10 MB — ~5 min of 16 kHz Opus is well under.
MAX_TTS_CHARS = 4_000


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=MAX_TTS_CHARS)
    voice: str = ""
    speed: float = 1.0
    emotion_scale: float = 1.0  # accepted but piper ignores for now


class STTResponse(BaseModel):
    text: str
    confidence: float
    engine: str
    language: str
    wake_word_matched: bool


class StatusResponse(BaseModel):
    stt_engine: str
    tts_engine: str
    stt_mode: str
    language: str
    tts_enabled: bool
    tts_voice: str
    wake_word_enabled: bool
    wake_words: str


@router.post("/stt", response_model=STTResponse)
async def transcribe_speech(file: UploadFile = File(...)) -> STTResponse:
    """Transcribe a single audio clip. Non-streaming — suitable for the
    browser's MediaRecorder tap-to-speak flow."""
    raw = await file.read()
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Empty audio upload",
        )
    if len(raw) > MAX_STT_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Audio too large ({len(raw)} bytes, max {MAX_STT_BYTES})",
        )
    try:
        result = await transcribe_blob(raw, config.voice_stt_language)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        logger.exception("STT pipeline failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"STT pipeline error: {exc}",
        ) from exc
    return STTResponse(
        text=result.text,
        confidence=result.confidence,
        engine=result.engine,
        language=result.language,
        wake_word_matched=contains_wake_word(result.text),
    )


@router.post("/tts")
async def synthesize_speech(req: TTSRequest) -> Response:
    """Render text to a WAV blob. Respects voice_tts_enabled (returns 100 ms
    of silence when disabled) and voice_tts_voice (falls back to the
    settings default when `req.voice` is empty)."""
    # Phase 9.2: when caller doesn't specify a voice, auto-select UA or EN
    # based on Cyrillic content ratio. Disabled callers always get the
    # configured `voice_tts_voice`.
    if req.voice.strip():
        voice = req.voice.strip()
    else:
        from voice.tts_engine import select_voice_for_text
        voice = select_voice_for_text(req.text)
    speed = req.speed if req.speed > 0 else config.voice_tts_speed
    try:
        result = await synthesize_text(req.text, voice, speed)
    except RuntimeError as exc:
        # Model-file-missing → meaningful 503 instead of generic 500.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        logger.exception("TTS pipeline failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"TTS pipeline error: {exc}",
        ) from exc
    return Response(
        content=result.audio_wav,
        media_type="audio/wav",
        headers={
            "X-Engine": result.engine,
            "X-Voice": result.voice,
            "X-Sample-Rate": str(result.sample_rate),
        },
    )


@router.get("/status", response_model=StatusResponse)
async def voice_status() -> StatusResponse:
    """Live snapshot of the voice subsystem — surfaces which provider
    actually loaded so a [soon]-vs-wired mismatch is obvious."""
    return StatusResponse(
        stt_engine=get_stt_provider().name,
        tts_engine=get_tts_provider().name,
        stt_mode=config.voice_stt_mode,
        language=config.voice_stt_language,
        tts_enabled=config.voice_tts_enabled,
        tts_voice=config.voice_tts_voice,
        wake_word_enabled=config.voice_wake_word_enabled,
        wake_words=config.voice_wake_words,
    )
