"""
Text-to-speech engine — PHANTOM OS voice pipeline.

Piper is the default Phase 07 provider — it has ARM64 wheels, ships with
bundled eSpeak-NG phonemisers (incl. Ukrainian), and consumes ~150 MB of
RAM for a medium-quality voice. StyleTTS2 is tracked in `UNIMPLEMENTED_KEYS`
for a later pass because it needs a ~2 GB checkpoint download and a
custom UA G2P.

All providers return a WAV `bytes` blob — the HTTP route serves it
as `audio/wav` without re-encoding.
"""
from __future__ import annotations

import asyncio
import io
import logging
import os
import wave
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from config import config

logger = logging.getLogger(__name__)


@dataclass
class TTSResult:
    audio_wav: bytes
    sample_rate: int
    engine: str
    voice: str

    def to_dict(self) -> dict:
        return {
            "engine": self.engine,
            "voice": self.voice,
            "sample_rate": self.sample_rate,
            "bytes": len(self.audio_wav),
        }


# ── Abstract provider ─────────────────────────────────────────────────────────


class TTSProvider(ABC):
    name: str = "abstract"

    @abstractmethod
    async def synthesize(self, text: str, voice: str, speed: float) -> TTSResult:
        """Render `text` to a WAV byte string."""


# ── Silent provider (no TTS backend installed) ────────────────────────────────


def _silent_wav(sample_rate: int = 22_050, duration_ms: int = 100) -> bytes:
    """A tiny valid WAV so clients that expect audio/wav don't choke."""
    buf = io.BytesIO()
    frames = int(sample_rate * duration_ms / 1000)
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(b"\x00\x00" * frames)
    return buf.getvalue()


class SilentTTSProvider(TTSProvider):
    """Returns ~100 ms of silence; used when voice_tts_enabled is False
    or when no backend engine is installed."""
    name = "silent"

    async def synthesize(self, text: str, voice: str, speed: float) -> TTSResult:
        return TTSResult(
            audio_wav=_silent_wav(),
            sample_rate=22_050,
            engine="silent",
            voice=voice,
        )


# ── Piper provider ────────────────────────────────────────────────────────────


def _resolve_piper_model(voice_name: str) -> Optional[Path]:
    """
    Locate a Piper `.onnx` voice model on disk. Piper distributes voices
    as individual .onnx + .onnx.json pairs; we accept either:
      - an absolute path to the .onnx file, or
      - a bare voice name like "uk_UA-ukrainian_tts-medium" searched under
        common install locations.
    """
    raw = (voice_name or "").strip()
    if not raw:
        return None
    if os.path.isabs(raw) and Path(raw).is_file():
        return Path(raw)
    # Normalise — Piper voices are named with a .onnx suffix in the registry.
    name = raw if raw.endswith(".onnx") else f"{raw}.onnx"
    candidates = [
        Path("/usr/share/piper-voices") / name,
        Path("/opt/piper-voices") / name,
        Path.home() / "piper-voices" / name,
        Path.cwd() / "piper_voices" / name,
        Path.cwd() / "voice_models" / name,
    ]
    for p in candidates:
        if p.is_file():
            return p
    return None


class PiperTTSProvider(TTSProvider):
    """
    Piper-TTS via its Python bindings. Per-voice models are cached so a
    settings change from one voice to another doesn't leak memory: we
    keep exactly ONE voice alive, evicting on change.
    """
    name = "piper"

    def __init__(self) -> None:
        try:
            from piper import PiperVoice  # noqa: F401
        except Exception as exc:
            raise RuntimeError(f"piper-tts not importable: {exc}") from exc
        self._voice_path: Optional[Path] = None
        self._voice = None  # PiperVoice instance

    def _ensure_voice(self, requested: str):
        from piper import PiperVoice
        path = _resolve_piper_model(requested)
        if path is None:
            raise RuntimeError(
                f"Piper voice model '{requested}' not found. Drop a .onnx "
                "+ .onnx.json pair under ~/piper-voices/ or set "
                "voice_tts_voice to an absolute path."
            )
        if self._voice_path == path and self._voice is not None:
            return self._voice
        logger.info("Loading Piper voice %s", path)
        self._voice = PiperVoice.load(str(path))
        self._voice_path = path
        return self._voice

    async def synthesize(self, text: str, voice: str, speed: float) -> TTSResult:
        return await asyncio.to_thread(self._synthesize_sync, text, voice, speed)

    def _synthesize_sync(self, text: str, voice: str, speed: float) -> TTSResult:
        from piper.config import SynthesisConfig
        v = self._ensure_voice(voice)
        # Piper's length_scale maps inversely to "speed" — >1 slower, <1 faster.
        # We present speed in the UI (1.0 = natural), so convert.
        length_scale = 1.0 / max(speed, 0.1)
        syn_cfg = SynthesisConfig(length_scale=length_scale)

        buf = io.BytesIO()
        with wave.open(buf, "wb") as wav_file:
            v.synthesize_wav(text, wav_file, syn_config=syn_cfg)
        data = buf.getvalue()

        # Pull the sample rate back out of the WAV header so clients know
        # what they're playing.
        with wave.open(io.BytesIO(data), "rb") as rb:
            sr = rb.getframerate()
        return TTSResult(
            audio_wav=data,
            sample_rate=sr,
            engine="piper",
            voice=voice,
        )


# ── Factory ───────────────────────────────────────────────────────────────────


def build_tts_provider() -> TTSProvider:
    """
    Choose a TTS provider. If voice_tts_enabled is off we short-circuit
    to Silent — this keeps the HTTP contract (always returns audio/wav)
    while telling the front-end via the engine name that TTS is disabled.
    """
    if not config.voice_tts_enabled:
        return SilentTTSProvider()
    try:
        return PiperTTSProvider()
    except Exception as exc:
        logger.warning("Piper unavailable, using SilentTTSProvider: %s", exc)
        return SilentTTSProvider()


# ── Phase 9.2 — language-aware voice selection ────────────────────────────────


def _cyrillic_ratio(text: str) -> float:
    """Fraction of letters in `text` that are Cyrillic. Spaces+punct ignored."""
    if not text:
        return 0.0
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return 0.0
    cyrillic = sum(
        1 for c in letters
        if "\u0400" <= c <= "\u04FF" or "\u0500" <= c <= "\u052F"
    )
    return cyrillic / len(letters)


def select_voice_for_text(text: str) -> str:
    """Pick UA or EN Piper voice based on Cyrillic content ratio.

    >50% Cyrillic → UA voice. Else EN voice. When auto-detection is off,
    return the configured `voice_tts_voice`.
    """
    if not getattr(config, "voice_tts_auto_language", True):
        return config.voice_tts_voice
    return (
        config.voice_tts_voice_uk
        if _cyrillic_ratio(text) > 0.5
        else config.voice_tts_voice_en
    )


__all__ = [
    "TTSProvider", "TTSResult", "SilentTTSProvider", "PiperTTSProvider",
    "build_tts_provider", "select_voice_for_text", "_cyrillic_ratio",
]
