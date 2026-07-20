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
import sys
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Optional

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
# Audit-2026-04-28 F-37: previously `shutil.which("ffmpeg")` ran at module
# import time, so an operator who installed ffmpeg post-boot ("install
# missing dep, refresh") kept getting 400s on WebM until the daemon was
# restarted. Resolve lazily with a 60 s cache so a fresh install is
# detected within one minute, and a removed binary is also re-checked.

_FFMPEG_CACHE_TTL_S = 60.0
_ffmpeg_cache: tuple[float, Optional[str]] = (-_FFMPEG_CACHE_TTL_S, None)


def _resolve_ffmpeg_bin() -> Optional[str]:
    global _ffmpeg_cache
    ts, cached = _ffmpeg_cache
    now = time.monotonic()
    if (now - ts) < _FFMPEG_CACHE_TTL_S:
        return cached
    found = shutil.which("ffmpeg")
    _ffmpeg_cache = (now, found)
    if found is None and cached is None and ts < 0:
        # Only log on the cold-boot resolve so we don't spam every minute.
        logger.warning(
            "ffmpeg not found on PATH — voice STT will 400 on WebM/Opus "
            "inputs (MediaRecorder default). Install via `apt install ffmpeg`."
        )
    elif found is not None and cached is None:
        logger.info("ffmpeg now available at %s — WebM/Opus decode re-enabled", found)
    return found


# Compatibility shim — kept so any external import that grabbed _FFMPEG_BIN
# at module load still resolves to *something* useful. Internal callers go
# through _resolve_ffmpeg_bin() directly.
_FFMPEG_BIN: Optional[str] = _resolve_ffmpeg_bin()


# ── Response dataclass ────────────────────────────────────────────────────────


STTEngineName = Literal["whisper", "vosk", "noop", "whisper_npu"]


@dataclass
class STTResult:
    text: str
    confidence: float
    # Audit-2026-04-28 F-39: tighten the type. Previous string-typed comment
    # said "whisper | vosk | noop" but the codebase now also emits
    # "whisper_npu", and frontend switches were probably missing that
    # branch.
    engine: STTEngineName
    language: str
    # Audit-2026-04-28 F-25: NPU providers can no longer report
    # inference failures as "successful empty transcript". When forward
    # fails, populate `engine_error` with a short reason; the route
    # handler returns 503 instead of pretending the user said nothing.
    engine_error: Optional[str] = None
    # Day-4 Block ID-1 (ADR-ID-001): the schema slot for the Day-5 ML
    # speaker resolver. UUID string when matched against an enrolled
    # User row, ``None`` when no match / no enrolment / disabled. Day-4
    # leaves this at the default — no provider code mutates it; the
    # resolver call lives in `voice.pipeline` (ADR-ID-002 / Day-5 wires).
    speaker_id: Optional[str] = None

    def to_dict(self) -> dict:
        out: dict = {
            "text": self.text,
            "confidence": self.confidence,
            "engine": self.engine,
            "language": self.language,
        }
        if self.engine_error:
            out["engine_error"] = self.engine_error
        # ADR-ID-001: omit when ``None`` so the WS frame size on the hot
        # path is unchanged for the 99 % case (no enrolled speakers).
        # Legacy clients that don't know about the field stay unaffected.
        if self.speaker_id is not None:
            out["speaker_id"] = self.speaker_id
        return out


# ── Audio normalisation ───────────────────────────────────────────────────────


def _ffmpeg_decode_to_mono16k(raw: bytes) -> np.ndarray:
    """Pipe ``raw`` through ffmpeg → mono 16 kHz float32 PCM ndarray.

    Phase 10.4 fix 4. Used as the fallback when ``soundfile.read`` can't
    decode a container (primarily WebM/Opus from the browser
    MediaRecorder). Produces WAV on stdout which ``soundfile.read``
    *can* parse — lets us keep a single float32 conversion path.
    """
    ffmpeg_bin = _resolve_ffmpeg_bin()
    if ffmpeg_bin is None:
        raise ValueError("ffmpeg not available for fallback decode")
    try:
        proc = subprocess.run(
            [
                ffmpeg_bin,
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
        # Audit-2026-04-28 F-37: probe via the lazy resolver so a
        # post-boot ffmpeg install is picked up without a daemon restart.
        if _resolve_ffmpeg_bin() is not None:
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


async def decode_to_mono16k_async(raw: bytes) -> np.ndarray:
    """Async-safe wrapper around :func:`decode_to_mono16k`.

    Brief 02 defect A-1: ``decode_to_mono16k`` can fall back to
    ``_ffmpeg_decode_to_mono16k``, which blocks on ``subprocess.run`` for
    up to 10s. Callers reachable from the event loop (routes, the voice
    pipeline) must go through this wrapper — or offload to a worker
    thread themselves — so a slow ffmpeg decode never stalls the loop.
    Synchronous callers (tests, scripts) should keep calling
    ``decode_to_mono16k`` directly; its own contract is unchanged.
    """
    return await asyncio.to_thread(decode_to_mono16k, raw)


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

    def get_model(self):
        """Public accessor used by the always-on wake spotter (Phase 11b)
        to share the already-loaded vosk.Model instead of paying the
        ~300 MB RAM cost again. Triggers lazy load on first call."""
        self._ensure_model()
        return self._model

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


# ── Hybrid provider ───────────────────────────────────────────────────────────


class HybridSTTProvider(STTProvider):
    """
    Wraps a primary provider with a fallback. If the primary times out
    (5 s) or raises an exception, the fallback takes over.
    """

    def __init__(self, primary: STTProvider, fallback: STTProvider) -> None:
        self.primary = primary
        self.fallback = fallback
        self.name = f"hybrid({primary.name}->{fallback.name})"

    async def transcribe(self, audio: np.ndarray, language: str) -> STTResult:
        try:
            # Audit-2026-05-09: 5s ceiling for primary engine (Whisper/NPU).
            # If it hangs or is too slow, we fall back to Vosk immediately.
            return await asyncio.wait_for(
                self.primary.transcribe(audio, language),
                timeout=5.0,
            )
        except (asyncio.TimeoutError, Exception) as exc:
            logger.warning(
                "Primary STT (%s) failed or timed out: %s. Falling back to %s",
                self.primary.name,
                exc,
                self.fallback.name,
            )
            # If fallback also fails, it will raise to the caller.
            return await self.fallback.transcribe(audio, language)


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


def _try_npu() -> Optional[STTProvider]:
    """Phase 15 — try the Hexagon HTP/QNN encoder path.

    Honors ``config.voice_stt_npu_enabled``; returns None silently when the
    operator hasn't opted in. The module import is lazy because it pulls in
    optimum + transformers + onnxruntime which we don't want in the cold
    path on hardware where NPU isn't relevant.

    Day-4 Block V-3 (ADR-DSH-001 / U5-PKG-C3): win32 hard-skip is a
    *factory branch, not an import-time check*. The audit established
    that ``onnxruntime-qnn`` import alone segfaults on x86_64 Windows;
    we must never even attempt the import there. Linux/macOS continue
    unchanged. This guards the packaged Windows desktop build.
    """
    if sys.platform == "win32":
        return None
    if not getattr(config, "voice_stt_npu_enabled", False):
        return None
    try:
        from voice.whisper_npu_provider import WhisperNPUProvider
        return WhisperNPUProvider()
    except Exception as exc:
        logger.info("NPU STT unavailable: %s", exc)
        return None


def build_stt_provider() -> STTProvider:
    """
    Pick an STT provider based on `config.voice_stt_mode`. Falls back
    through the chain: requested mode → other engine → noop.

    Phase 15 — voice_stt_npu_enabled → WhisperNPUProvider tried first.

    Explicit "vosk" still pins Vosk-only — operator intent wins over auto-
    upgrade.
    """
    mode = config.voice_stt_mode
    npu_first = bool(getattr(config, "voice_stt_npu_enabled", False))

    def _full_chain() -> list:
        c: list = []
        if npu_first:
            c.append(_try_npu)
        c.extend([_try_whisper, _try_vosk])
        return c

    chain: list = []
    if mode == "vosk":
        chain = [_try_vosk]  # explicit Vosk-only
    elif mode == "npu":
        chain = [_try_npu, _try_whisper, _try_vosk]
    elif mode == "whisper":
        chain = _full_chain() if npu_first else [_try_whisper, _try_vosk]
    else:  # "hybrid" + anything unknown
        chain = _full_chain() if npu_first else [_try_whisper, _try_vosk]

    # Instantiate the chain and wrap in Hybrid if plural.
    available: list[STTProvider] = []
    for builder in chain:
        p = builder()
        if p is not None:
            available.append(p)

    if not available:
        return NoopSTTProvider()
    
    if len(available) > 1 and mode != "vosk":
        # Wrap primary in Hybrid with the last available (usually Vosk) as fallback.
        # But we only want to wrap if the primary isn't already Vosk.
        primary = available[0]
        # Find a suitable fallback engine (Vosk is the best one for this).
        vosk_fallback = next((p for p in available if p.name == "vosk"), None)
        if vosk_fallback and primary.name != "vosk":
            return HybridSTTProvider(primary, vosk_fallback)
    
    return available[0]


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
