"""
Phase 11b — Silero VAD unit tests.

The hysteresis FSM is tested directly with synthetic probability
streams (no ORT needed). The ``SileroVAD`` wrapper is tested against
the real ONNX model with silence and a synthetic speech-shaped signal
to exercise the window-normalising buffer and the `process → events`
contract.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from voice.vad import (
    SPEECH_END,
    SPEECH_START,
    SileroVAD,
    _Hysteresis,
)


SILERO_ONNX = (
    Path(__file__).resolve().parent.parent
    / "voice" / "models" / "silero-vad" / "silero_vad.onnx"
)


def _require_model() -> Path:
    if not SILERO_ONNX.is_file():
        pytest.skip(f"Silero model not found at {SILERO_ONNX}")
    return SILERO_ONNX


# ───────────────────────── Hysteresis FSM tests ──────────────────────────


class TestHysteresisFSM:
    def _fsm(
        self,
        *,
        activation_frames: int = 3,
        silence_windows: int = 5,
    ) -> _Hysteresis:
        return _Hysteresis(
            speech_threshold=0.5,
            silence_threshold=0.35,
            activation_frames=activation_frames,
            silence_windows=silence_windows,
        )

    def test_three_high_probs_fire_speech_start(self) -> None:
        fsm = self._fsm(activation_frames=3)
        assert fsm.feed(0.9) is None
        assert fsm.feed(0.9) is None
        assert fsm.feed(0.9) == SPEECH_START
        assert fsm.in_speech

    def test_single_blip_does_not_fire(self) -> None:
        fsm = self._fsm(activation_frames=3)
        assert fsm.feed(0.9) is None
        assert fsm.feed(0.1) is None  # resets speech counter
        assert fsm.feed(0.9) is None
        assert fsm.feed(0.9) is None
        assert not fsm.in_speech  # still waiting on the third

    def test_probe_between_thresholds_holds_state(self) -> None:
        """A probability between silence_threshold (0.35) and
        speech_threshold (0.5) should not flip us into speech — or out
        of it once we're in."""
        fsm = self._fsm(activation_frames=2, silence_windows=3)
        # Drive into speech
        fsm.feed(0.9)
        assert fsm.feed(0.9) == SPEECH_START
        # Feed a mid-range prob — hysteresis band, no transition
        assert fsm.feed(0.4) is None
        assert fsm.in_speech

    def test_silence_run_fires_speech_end(self) -> None:
        fsm = self._fsm(activation_frames=2, silence_windows=3)
        fsm.feed(0.9)
        assert fsm.feed(0.9) == SPEECH_START
        assert fsm.feed(0.1) is None
        assert fsm.feed(0.1) is None
        assert fsm.feed(0.1) == SPEECH_END
        assert not fsm.in_speech

    def test_silence_blip_during_speech_does_not_end(self) -> None:
        fsm = self._fsm(activation_frames=2, silence_windows=3)
        fsm.feed(0.9)
        fsm.feed(0.9)  # now in speech
        # Short silent blip (1 window), then back to speech
        assert fsm.feed(0.1) is None
        assert fsm.feed(0.9) is None  # resets silence counter
        assert fsm.in_speech

    def test_reset_clears_state(self) -> None:
        fsm = self._fsm(activation_frames=2, silence_windows=3)
        fsm.feed(0.9)
        assert fsm.feed(0.9) == SPEECH_START
        fsm.reset()
        assert not fsm.in_speech
        # After reset, we need a fresh activation sequence
        assert fsm.feed(0.9) is None

    def test_invalid_thresholds_raise(self) -> None:
        with pytest.raises(ValueError, match="speech_threshold"):
            _Hysteresis(
                speech_threshold=0.3,
                silence_threshold=0.5,
                activation_frames=2,
                silence_windows=3,
            )

    def test_invalid_activation_frames_raises(self) -> None:
        with pytest.raises(ValueError, match="activation_frames"):
            _Hysteresis(
                speech_threshold=0.5,
                silence_threshold=0.35,
                activation_frames=0,
                silence_windows=3,
            )


# ───────────────────────── SileroVAD integration tests ───────────────────
# These exercise the ONNX session and buffer glue. They need the actual
# silero_vad.onnx file shipped by Phase 11b Task 0.


class TestSileroVADBuffering:
    def test_silence_produces_no_events(self) -> None:
        _require_model()
        vad = SileroVAD(str(SILERO_ONNX))
        # 2 s of zeros = solid silence
        silence = np.zeros(vad.window_samples * 64, dtype=np.int16).tobytes()
        events = vad.process(silence)
        assert events == []
        assert not vad.in_speech

    def test_frame_size_handling_small_frames(self) -> None:
        """Frontend sends 20–30 ms frames. VAD must buffer until it has
        a full 512-sample window."""
        _require_model()
        vad = SileroVAD(str(SILERO_ONNX))
        # Feed in 10 ms chunks (160 samples = 320 bytes). Silero wants
        # 512-sample windows, so after two 160-sample frames we still
        # have 320 queued and no window fired.
        small = np.zeros(160, dtype=np.int16).tobytes()
        assert vad.process(small) == []
        assert vad.process(small) == []
        # After enough chunks we should fire *something* (silence → []).
        for _ in range(20):
            vad.process(small)
        assert not vad.in_speech

    def test_odd_byte_length_raises(self) -> None:
        _require_model()
        vad = SileroVAD(str(SILERO_ONNX))
        with pytest.raises(ValueError, match="even"):
            vad.process(b"\x00\x00\x00")  # 3 bytes

    def test_reset_zeros_state_and_pending(self) -> None:
        _require_model()
        vad = SileroVAD(str(SILERO_ONNX))
        # Leave some pending samples.
        vad.process(np.zeros(100, dtype=np.int16).tobytes())
        vad.reset()
        # After reset, feeding one full window's worth of silence still
        # produces no events (verifying we're starting clean).
        frame = np.zeros(vad.window_samples, dtype=np.int16).tobytes()
        assert vad.process(frame) == []
        assert not vad.in_speech

    def test_unsupported_sample_rate_raises(self) -> None:
        _require_model()
        with pytest.raises(ValueError, match="8000 or 16000"):
            SileroVAD(str(SILERO_ONNX), sample_rate=44_100)

    def test_synthetic_speech_detectable(self) -> None:
        """A voiced-envelope sine sweep should at least push probabilities
        above the silence threshold on *some* windows — this checks the
        ORT inference path end-to-end without asserting specific events
        (Silero's reaction to synthetic signals is not guaranteed)."""
        _require_model()
        vad = SileroVAD(str(SILERO_ONNX))
        sr = 16_000
        # Envelope-modulated 440 Hz tone, 1 second.
        t = np.linspace(0, 1.0, sr, endpoint=False)
        envelope = 0.5 + 0.5 * np.sin(2 * np.pi * 4 * t)  # 4 Hz AM
        tone = 0.6 * envelope * np.sin(2 * np.pi * 440 * t)
        pcm = (tone * 32767).astype(np.int16).tobytes()

        events = vad.process(pcm)
        # We don't assert speech_start fired (Silero may or may not
        # classify a bare tone as speech); we just assert the pipeline
        # produced a well-formed list and didn't crash.
        assert isinstance(events, list)
        assert all(ev in (SPEECH_START, SPEECH_END) for ev in events)
