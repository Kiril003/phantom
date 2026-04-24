"""
Speech-to-text engine — PHANTOM OS voice pipeline.

The backend normalises every incoming audio blob to mono 16-bit PCM at
16 kHz before handing it to a provider. Providers only see numpy float32
arrays so the same transcript logic is exercisable under test without
touching ffmpeg / libsndfile.

Provider precedence:
  hybrid  → Whisper if config.voice_stt_mode == "hybrid" AND faster-whisper
            is importable; otherwise Vosk.
  whisper → Whisper only (raises if not installed).
  vosk    → Vosk only.

Whisper isn't bundled on ARM64 dev images so `FasterWhisperProvider` is
loaded lazily and degrades gracefully to Vosk if the import fails.
"""
from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import re
import shutil
import subprocess
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np
import soundfile as sf

from config import config

logger = logging.getLogger(__name__)

TARGET_SAMPLE_RATE = 16_000

# ── ffmpeg fallback (Phase 10.4 fix 4) ────────────────────────────────────────
# soundfile/libsndfile has no WebM decoder, and the browser MediaRecorder
# emits audio/webm;codecs=opus by default on Chromium/Firefox. Rather than
# adding a native Python codec dep, we shell out to ffmpeg (a system package
# on Debian/Ubuntu/Radxa) as the fallback decoder when soundfile chokes.
#
# Resolved once at module load; `None` means ffmpeg is not on PATH and the
# fallback chain skips straight to ValueError.

_FFMPEG_BIN: Optional[str] = shutil.which("ffmpeg")
if _FFMPEG_BIN is None:
    logger.warning(
        "ffmpeg not found on PATH — voice STT will 400 on WebM/Opus inputs "
        "(MediaRecorder default). Install via `apt install ffmpeg`."
    )


# ── Response dataclass ────────────────────────────────────────────────────────


@dataclass
class STTResult:
    text: str
    confidence: float
    engine: str  # "whisper" | "vosk" | "noop"
    language: str

    def to_dict(self) -> dict:
        return {
            "text": self.text,
            "confidence": self.confidence,
            "engine": self.engine,
            "language": self.language,
        }


# ── Audio normalisation ───────────────────────────────────────────────────────


def _ffmpeg_decode_to_mono16k(raw: bytes) -> np.ndarray:
    """Pipe ``raw`` through ffmpeg → mono 16 kHz float32 PCM ndarray.

    Phase 10.4 fix 4. Used as the fallback when ``soundfile.read`` can't
    decode a container (primarily WebM/Opus from the browser
    MediaRecorder). Produces WAV on stdout which ``soundfile.read``
    *can* parse — lets us keep a single float32 conversion path.
    """
    if _FFMPEG_BIN is None:
        raise ValueError("ffmpeg not available for fallback decode")
    try:
        proc = subprocess.run(
            [
                _FFMPEG_BIN,
                "-hide_banner",
                "-loglevel", "error",
                "-i", "pipe:0",
                "-f", "wav",
                "-ar", str(TARGET_SAMPLE_RATE),
                "-ac", "1",
                "pipe:1",
            ],
            input=raw,
            capture_output=True,
            timeout=10,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise ValueError("ffmpeg decode timed out (>10s)") from exc
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"ffmpeg decode failed to launch: {exc}") from exc

    if proc.returncode != 0:
        stderr = (proc.stderr or b"").decode(errors="replace")[:200]
        raise ValueError(f"ffmpeg decode failed (rc={proc.returncode}): {stderr}")
    if not proc.stdout:
        raise ValueError("ffmpeg decode produced no output")

    data, sr = sf.read(io.BytesIO(proc.stdout), dtype="float32", always_2d=False)
    if data.ndim == 2:
        data = data.mean(axis=1)
    if sr != TARGET_SAMPLE_RATE:
        # ffmpeg's -ar is authoritative but guard against an unexpected header.
        data = _resample_linear(data.astype(np.float32, copy=False), sr, TARGET_SAMPLE_RATE)
    return data.astype(np.float32, copy=False)


def decode_to_mono16k(raw: bytes) -> np.ndarray:
    """
    Decode any libsndfile-supported container (WAV/OGG/FLAC/…) to mono
    float32 at 16 kHz. Returns a 1-D ndarray in [-1, 1].

    Phase 10.4 fix 4: on libsndfile failure (e.g. browser MediaRecorder's
    WebM/Opus default), falls back to ffmpeg transcoding if ffmpeg is
    present on the host.

    Raises ValueError on empty / unreadable payloads — routes catch this
    and surface a 400 to the client.
    """
    if not raw:
        raise ValueError("Empty audio payload")
    try:
        data, sr = sf.read(io.BytesIO(raw), dtype="float32", always_2d=False)
    except Exception as exc:  # sf raises LibsndfileError/RuntimeError on unknown formats
        if _FFMPEG_BIN is not None:
            logger.info(
                "decode_to_mono16k: soundfile failed (%s) — trying ffmpeg fallback",
                str(exc)[:120],
            )
            return _ffmpeg_decode_to_mono16k(raw)
        raise ValueError(f"Could not decode audio: {exc}") from exc

    if data.ndim == 2:
        data = data.mean(axis=1)  # downmix stereo → mono
    data = data.astype(np.float32, copy=False)

    if sr != TARGET_SAMPLE_RATE:
        data = _resample_linear(data, sr, TARGET_SAMPLE_RATE)
    return data


def _resample_linear(data: np.ndarray, src_rate: int, dst_rate: int) -> np.ndarray:
    """
    Linear interpolation resampler. Low-quality by audiophile standards but
    perfectly fine for speech recognition at 16 kHz and keeps the runtime
    dependency surface tiny (no scipy / librosa).
    """
    if src_rate == dst_rate:
        return data
    ratio = dst_rate / src_rate
    new_len = int(round(len(data) * ratio))
    if new_len <= 0:
        return np.zeros(0, dtype=np.float32)
    x_old = np.linspace(0, 1, num=len(data), endpoint=False, dtype=np.float32)
    x_new = np.linspace(0, 1, num=new_len, endpoint=False, dtype=np.float32)
    return np.interp(x_new, x_old, data).astype(np.float32, copy=False)


def to_pcm16_bytes(audio: np.ndarray) -> bytes:
    """Convert float32 [-1,1] → little-endian signed 16-bit PCM bytes."""
    clipped = np.clip(audio, -1.0, 1.0)
    return (clipped * 32767.0).astype("<i2").tobytes()


# ── Abstract provider ─────────────────────────────────────────────────────────


class STTProvider(ABC):
    name: str = "abstract"

    @abstractmethod
    async def transcribe(self, audio: np.ndarray, language: str) -> STTResult:
        """
        Transcribe `audio` (mono float32 @ 16 kHz). `language` is a 2-letter
        code ("uk"/"en") or "auto" — providers may ignore it.
        """


# ── Noop (tests / provider unavailable) ───────────────────────────────────────


class NoopSTTProvider(STTProvider):
    """
    Returns an empty transcript. Used as the final fallback when neither
    Whisper nor Vosk is installed so the route still returns something
    parseable instead of 500-ing.
    """
    name = "noop"

    async def transcribe(self, audio: np.ndarray, language: str) -> STTResult:
        logger.warning("STT noop provider active — no ASR engine installed.")
        return STTResult(text="", confidence=0.0, engine="noop", language=language)


# ── Vosk provider ─────────────────────────────────────────────────────────────


def _resolve_vosk_model_path() -> Optional[Path]:
    """
    Locate the Vosk model configured via `voice_stt_vosk_model`. Accepts
    either an absolute path (operator dropped a model there) or a bare name,
    searched under common install locations.
    """
    name = (config.voice_stt_vosk_model or "").strip()
    if not name:
        return None
    if os.path.isabs(name) and Path(name).is_dir():
        return Path(name)
    candidates = [
        Path("/usr/share/vosk-models") / name,
        Path("/opt/vosk") / name,
        Path.home() / "vosk-models" / name,
        Path.cwd() / "models" / name,
        Path.cwd() / "voice_models" / name,
    ]
    for p in candidates:
        if p.is_dir():
            return p
    return None


class VoskSTTProvider(STTProvider):
    """
    Vosk (Kaldi-compat) offline recogniser.

    Vosk has a hard dependency on a locally downloaded language model —
    if the model isn't present we fail loud at construction so the route
    can fall back to the noop provider rather than erroring per request.
    """
    name = "vosk"

    def __init__(self) -> None:
        try:
            import vosk  # noqa: F401
        except Exception as exc:
            raise RuntimeError(f"vosk not importable: {exc}") from exc

        self._model_path = _resolve_vosk_model_path()
        if self._model_path is None:
            raise RuntimeError(
                f"Vosk model '{config.voice_stt_vosk_model}' not found on disk. "
                "Download e.g. https://alphacephei.com/vosk/models and place it "
                "under ~/vosk-models/ or /opt/vosk/."
            )
        # Lazy-load the model on first transcribe — avoids paying the ~120 MB
        # RAM price at app startup if nobody hits the voice routes.
        self._model = None

    def _ensure_model(self) -> None:
        if self._model is not None:
            return
        import vosk
        vosk.SetLogLevel(-1)  # silence Kaldi spam
        logger.info("Loading Vosk model from %s", self._model_path)
        self._model = vosk.Model(str(self._model_path))

    async def transcribe(self, audio: np.ndarray, language: str) -> STTResult:
        # Vosk is blocking C++ → run in a worker thread so we don't stall
        # the event loop.
        return await asyncio.to_thread(self._transcribe_sync, audio, language)

    def _transcribe_sync(self, audio: np.ndarray, language: str) -> STTResult:
        import vosk
        self._ensure_model()
        assert self._model is not None
        rec = vosk.KaldiRecognizer(self._model, TARGET_SAMPLE_RATE)
        rec.SetWords(True)
        pcm = to_pcm16_bytes(audio)
        # Feed in chunks so Vosk emits incremental results; for push-to-talk
        # we only need FinalResult but chunking keeps memory bounded for
        # long clips.
        chunk = TARGET_SAMPLE_RATE * 2  # 1 s of PCM16
        for i in range(0, len(pcm), chunk):
            rec.AcceptWaveform(pcm[i : i + chunk])
        final = json.loads(rec.FinalResult() or "{}")
        text = (final.get("text") or "").strip()
        words = final.get("result") or []
        if words:
            conf = float(sum(w.get("conf", 0.0) for w in words) / len(words))
        else:
            # Vosk doesn't report confidence for a pure-silence input.
            conf = 1.0 if text else 0.0
        return STTResult(
            text=text,
            confidence=conf,
            engine="vosk",
            language=language if language != "auto" else "uk",
        )


# ── Faster-Whisper provider (optional) ────────────────────────────────────────


class FasterWhisperSTTProvider(STTProvider):
    """
    Primary STT on capable hardware. Loads the model lazily and honours
    `voice_stt_whisper_model` / `voice_stt_whisper_device` /
    `voice_stt_whisper_compute`.
    """
    name = "whisper"

    def __init__(self) -> None:
        try:
            from faster_whisper import WhisperModel  # noqa: F401
        except Exception as exc:
            raise RuntimeError(f"faster-whisper not importable: {exc}") from exc
        self._model = None

    def _ensure_model(self) -> None:
        if self._model is not None:
            return
        from faster_whisper import WhisperModel
        device = config.voice_stt_whisper_device
        # "auto" on machines without CUDA maps to "cpu"; this is a harmless
        # cast because faster-whisper doesn't understand "auto".
        if device == "auto":
            device = "cpu"
        logger.info(
            "Loading faster-whisper model=%s device=%s compute=%s",
            config.voice_stt_whisper_model, device, config.voice_stt_whisper_compute,
        )
        self._model = WhisperModel(
            config.voice_stt_whisper_model,
            device=device,
            compute_type=config.voice_stt_whisper_compute,
        )

    async def transcribe(self, audio: np.ndarray, language: str) -> STTResult:
        return await asyncio.to_thread(self._transcribe_sync, audio, language)

    def _transcribe_sync(self, audio: np.ndarray, language: str) -> STTResult:
        self._ensure_model()
        assert self._model is not None
        lang = None if language == "auto" else language
        segments, info = self._model.transcribe(
            audio,
            language=lang,
            beam_size=1,
            vad_filter=True,
        )
        chunks: list[str] = []
        mean_logprob = 0.0
        count = 0
        for seg in segments:
            chunks.append(seg.text.strip())
            mean_logprob += float(getattr(seg, "avg_logprob", 0.0))
            count += 1
        text = " ".join(c for c in chunks if c).strip()
        # logprob → pseudo-confidence in [0, 1] via exp clamp.
        conf = float(np.clip(np.exp(mean_logprob / max(count, 1)), 0.0, 1.0))
        return STTResult(
            text=text,
            confidence=conf,
            engine="whisper",
            language=getattr(info, "language", None) or lang or "auto",
        )


# ── Factory ───────────────────────────────────────────────────────────────────


def _try_whisper() -> Optional[STTProvider]:
    try:
        return FasterWhisperSTTProvider()
    except Exception as exc:
        logger.info("Whisper unavailable: %s", exc)
        return None


def _try_vosk() -> Optional[STTProvider]:
    try:
        return VoskSTTProvider()
    except Exception as exc:
        logger.info("Vosk unavailable: %s", exc)
        return None


def build_stt_provider() -> STTProvider:
    """
    Pick an STT provider based on `config.voice_stt_mode`. Falls back
    through the chain: requested mode → other engine → noop.
    """
    mode = config.voice_stt_mode
    chain: list = []
    if mode == "whisper":
        chain = [_try_whisper, _try_vosk]
    elif mode == "vosk":
        chain = [_try_vosk]  # explicit Vosk-only; don't silently upgrade
    else:  # "hybrid" and anything unknown
        chain = [_try_whisper, _try_vosk]
    for builder in chain:
        provider = builder()
        if provider is not None:
            return provider
    return NoopSTTProvider()


def contains_wake_word(text: str) -> bool:
    """
    Cheap wake-word match on a transcript. The "always-on hotword" phase
    hasn't shipped, but routes can still use this to filter out chatter
    when the operator has wake-word mode on.
    """
    if not text or not config.voice_wake_word_enabled:
        return False
    words = [w.strip().lower() for w in (config.voice_wake_words or "").split(",") if w.strip()]
    if not words:
        return False
    lowered = re.sub(r"[^\w\s]", " ", text.lower())
    return any(w in lowered for w in words)
