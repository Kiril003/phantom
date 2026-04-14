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
