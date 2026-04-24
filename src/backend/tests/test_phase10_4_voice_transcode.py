"""
Phase 10.4 — voice STT ffmpeg fallback transcoder.

soundfile (libsndfile) cannot decode WebM/Opus, which is the default
MediaRecorder output on Chromium-family browsers. Pre-10.4 the backend
surfaced that as HTTP 400 "Format not recognised." Fix 4 shells out to
ffmpeg as a fallback.

These tests exercise:
- The fallback path on a real WebM fixture generated via ffmpeg.
- Graceful degradation when ffmpeg is missing.
- WAV happy-path still works unchanged (regression guard).
"""
from __future__ import annotations

import io
import os
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase10-4-voice")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


FFMPEG_BIN = shutil.which("ffmpeg")


def _wav_sine_bytes(duration_s: float = 0.5, freq: float = 440.0, sr: int = 16000) -> bytes:
    """Build a small in-memory WAV payload (soundfile's happy path)."""
    t = np.linspace(0, duration_s, int(sr * duration_s), endpoint=False, dtype=np.float32)
    audio = 0.2 * np.sin(2 * np.pi * freq * t).astype(np.float32)
    buf = io.BytesIO()
    sf.write(buf, audio, sr, format="WAV")
    return buf.getvalue()


def _webm_sine_bytes(duration_s: float = 1.0, freq: float = 440.0) -> bytes:
    """Produce a real WebM/Opus payload via ffmpeg (matches browser MediaRecorder)."""
    if FFMPEG_BIN is None:
        pytest.skip("ffmpeg not installed")
    proc = subprocess.run(
        [
            FFMPEG_BIN,
            "-hide_banner",
            "-loglevel", "error",
            "-f", "lavfi",
            "-i", f"sine=frequency={freq}:duration={duration_s}",
            "-c:a", "libopus",
            "-f", "webm",
            "pipe:1",
        ],
        capture_output=True,
        check=False,
        timeout=10,
    )
    assert proc.returncode == 0, f"ffmpeg fixture build failed: {proc.stderr.decode()[:200]}"
    return proc.stdout


def test_wav_happy_path_unchanged():
    """Regression guard — soundfile-decodable containers must NOT hit ffmpeg."""
    from voice.stt_engine import decode_to_mono16k

    wav = _wav_sine_bytes()
    audio = decode_to_mono16k(wav)

    assert audio.dtype == np.float32
    assert audio.ndim == 1
    assert len(audio) > 0
    assert np.abs(audio).max() > 0.0


@pytest.mark.skipif(FFMPEG_BIN is None, reason="ffmpeg not installed on host")
def test_webm_opus_decoded_via_ffmpeg_fallback():
    """The original Phase 10.3.1 symptom 4 regression: WebM/Opus → HTTP 400.

    With fix 4 the decode path now routes failures through ffmpeg and
    produces mono 16 kHz float32 PCM.
    """
    from voice.stt_engine import decode_to_mono16k, TARGET_SAMPLE_RATE

    webm = _webm_sine_bytes(duration_s=1.0)
    audio = decode_to_mono16k(webm)

    assert audio.dtype == np.float32
    assert audio.ndim == 1
    # ~1s of 16 kHz → ~16000 samples; tolerance ±500 for codec framing.
    assert abs(len(audio) - TARGET_SAMPLE_RATE) < 500
    # Actual audio, not silence.
    assert np.abs(audio).max() > 0.01


@pytest.mark.skipif(FFMPEG_BIN is None, reason="ffmpeg not installed on host")
def test_ffmpeg_decode_helper_directly():
    """Unit test on the ffmpeg helper itself."""
    from voice.stt_engine import _ffmpeg_decode_to_mono16k, TARGET_SAMPLE_RATE

    webm = _webm_sine_bytes(duration_s=0.5)
    audio = _ffmpeg_decode_to_mono16k(webm)

    assert audio.dtype == np.float32
    assert audio.ndim == 1
    assert abs(len(audio) - TARGET_SAMPLE_RATE // 2) < 500


def test_ffmpeg_missing_falls_through_to_value_error(monkeypatch):
    """When ffmpeg is absent, WebM input produces a clear ValueError, not a crash."""
    from voice import stt_engine

    monkeypatch.setattr(stt_engine, "_FFMPEG_BIN", None)

    # Minimal WebM header (libsndfile rejects this immediately).
    garbage = b"\x1a\x45\xdf\xa3" + b"webm-but-not-readable" + b"\x00" * 100

    with pytest.raises(ValueError, match="Could not decode audio"):
        stt_engine.decode_to_mono16k(garbage)


def test_ffmpeg_decode_helper_rejects_when_binary_missing(monkeypatch):
    from voice import stt_engine

    monkeypatch.setattr(stt_engine, "_FFMPEG_BIN", None)

    with pytest.raises(ValueError, match="ffmpeg not available"):
        stt_engine._ffmpeg_decode_to_mono16k(b"anything")


def test_empty_payload_still_raises():
    """Regression guard — empty payload must still be rejected early."""
    from voice.stt_engine import decode_to_mono16k

    with pytest.raises(ValueError, match="Empty"):
        decode_to_mono16k(b"")
