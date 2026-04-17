"""Voice routes — TTS, STT."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, UploadFile, status
from pydantic import BaseModel

router = APIRouter(prefix="/voice", tags=["voice"])


class TTSRequest(BaseModel):
    text: str
    voice: str = "Марина"
    speed: float = 1.0
    emotion_scale: float = 1.0


# TODO(phase-05): once StyleTTS2/Whisper pipelines land, these handlers must
# read the full voice_* block from `config` instead of the request defaults:
#   - voice_stt_mode / voice_stt_language / voice_stt_whisper_model /
#     voice_stt_whisper_device / voice_stt_hybrid_threshold
#   - voice_tts_enabled (gate the TTS handler) / voice_tts_voice /
#     voice_tts_speed / voice_tts_alpha / voice_tts_beta /
#     voice_tts_diffusion_steps / voice_tts_emotion_scale /
#     voice_tts_state_adaptation
#   - voice_wake_word_enabled / voice_wake_words (hotword task)
# Settings UI already surfaces these with a [soon] suffix; marker is kept in
# routes_settings.UNIMPLEMENTED_KEYS so labels flip automatically once wired.


@router.post("/tts")
async def synthesize_speech(req: TTSRequest):
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Implemented in Phase 05",
    )


@router.post("/stt")
async def transcribe_speech(file: UploadFile) -> dict:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Implemented in Phase 05",
    )
