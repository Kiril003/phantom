"""
Phase 12.1 — Silero VAD real-audio gate.

Phase 11b's ``test_synthetic_speech_detectable`` only asserted that the
pipeline didn't crash on a sine sweep — it explicitly skipped the
question of whether a ``speech_start`` event ever fires. That hole let
a context-prefix bug ship through every prior gate: the ONNX graph was
fed only the 512-sample window without the 64-sample context that
``silero_vad.OnnxWrapper.__call__`` carries between calls, so the LSTM
never warmed up and the speech probability was permanently floored
near zero (max 0.012 vs the 0.99+ the official wrapper produced on
the same model file).

These tests close that gap:

  * ``test_real_speech_fires_speech_start_and_end`` — feed the
    Phase 11b ``wake_phrase.wav`` fixture and require both transitions.
  * ``test_silence_produces_no_speech`` — feed the silence fixture
    and require zero events (regression bound on the lower side).
  * ``test_per_window_max_prob_crosses_threshold`` — assert the raw
    Silero probability crosses 0.5 on real speech, so a future
    refactor that breaks the inference path fails *here* instead of
    silently re-disabling always-on.
"""
from __future__ import annotations

import wave
from pathlib import Path

import pytest

from voice.vad import (
    SPEECH_END,
    SPEECH_START,
    SileroVAD,
    reset_vad_session,
)


SILERO_ONNX = (
    Path(__file__).resolve().parent.parent
    / "voice" / "models" / "silero-vad" / "silero_vad.onnx"
)
FIXTURES = Path(__file__).resolve().parent / "fixtures" / "audio"
WAKE_PHRASE_WAV = FIXTURES / "wake_phrase.wav"
SILENCE_WAV = FIXTURES / "silence.wav"

FRAME_BYTES = 960  # 30 ms @ 16 kHz s16le — what the WS hands to vad.process


def _require_assets() -> None:
    missing: list[str] = []
    if not SILERO_ONNX.is_file():
        missing.append(str(SILERO_ONNX))
    if not WAKE_PHRASE_WAV.is_file():
        missing.append(str(WAKE_PHRASE_WAV))
    if not SILENCE_WAV.is_file():
        missing.append(str(SILENCE_WAV))
    if missing:
        pytest.skip(f"Phase 12.1 VAD fixtures missing: {missing}")


def _read_pcm(path: Path) -> bytes:
    with wave.open(str(path), "rb") as w:
        assert w.getframerate() == 16_000, (
            f"{path} must be 16 kHz mono s16le"
        )
        assert w.getnchannels() == 1
        assert w.getsampwidth() == 2
        return w.readframes(w.getnframes())


def _feed(vad: SileroVAD, pcm: bytes) -> list[str]:
    """Feed PCM in 30 ms chunks like the WS handler does."""
    events: list[str] = []
    for i in range(0, len(pcm), FRAME_BYTES):
        chunk = pcm[i : i + FRAME_BYTES]
        if not chunk:
            break
        events.extend(vad.process(chunk))
    return events


@pytest.fixture(autouse=True)
def _isolate_vad_session():
    """Each test starts with a clean VAD ORT session so a previous
    test's ``_state`` cannot leak into this one."""
    reset_vad_session()
    yield
    reset_vad_session()


class TestVADRealAudio:
    def test_real_speech_fires_speech_start_and_end(self) -> None:
        _require_assets()
        vad = SileroVAD(str(SILERO_ONNX), sample_rate=16_000, silence_ms=1_500)
        pcm = _read_pcm(WAKE_PHRASE_WAV)
        # Pad with 2 s of silence so the silence_ms hysteresis has time
        # to fire SPEECH_END after the utterance ends.
        pcm = pcm + b"\x00" * (2 * 16_000 * 2)
        events = _feed(vad, pcm)
        assert SPEECH_START in events, (
            "VAD never reported speech_start on real speech — Silero "
            "context-prefix bug? Got events: "
            f"{events!r}"
        )
        assert SPEECH_END in events, (
            f"VAD reported speech_start but no speech_end. Events: {events!r}"
        )

    def test_silence_produces_no_speech(self) -> None:
        _require_assets()
        vad = SileroVAD(str(SILERO_ONNX), sample_rate=16_000, silence_ms=1_500)
        pcm = _read_pcm(SILENCE_WAV)
        events = _feed(vad, pcm)
        assert SPEECH_START not in events, (
            f"VAD false-positive on silence fixture: {events!r}"
        )

    def test_per_window_max_prob_crosses_threshold(self) -> None:
        """Direct probe of ``_infer`` — guards the math, not the FSM.

        If a future refactor changes window size, sr type, or context
        carry-over, the FSM-based test above might still pass on a
        downstream fluke. This one fails surgically when the model
        output itself regresses.
        """
        _require_assets()
        vad = SileroVAD(str(SILERO_ONNX), sample_rate=16_000)
        pcm = _read_pcm(WAKE_PHRASE_WAV)

        import numpy as np

        arr = np.frombuffer(pcm, dtype=np.int16)
        max_prob = 0.0
        for i in range(0, len(arr) - vad.window_samples + 1, vad.window_samples):
            window = arr[i : i + vad.window_samples]
            p = vad._infer(window)
            max_prob = max(max_prob, p)
        assert max_prob > 0.5, (
            "Silero per-window max probability on real speech is "
            f"{max_prob:.4f} (expected > 0.5). The ONNX context-prefix "
            "is likely broken — see voice/vad.py:_infer."
        )
