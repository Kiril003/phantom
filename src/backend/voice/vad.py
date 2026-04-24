"""
Silero VAD (voice activity detection) — Phase 11b always-on voice pipeline.

The Silero v5 ONNX model distributed by snakers4/silero-vad expects
512-sample windows at 16 kHz (~32 ms). The WebSocket transport delivers
20–30 ms PCM frames from the browser, so this module owns a small ring
buffer that normalises whatever frame size arrives to Silero's native
window size.

Public contract
---------------
* ``SileroVAD(model_path, sample_rate=16000, silence_ms=500,
   speech_threshold=0.5, silence_threshold=0.35,
   activation_frames=3)``
* ``process(pcm_bytes: bytes) -> list[str]`` — feeds s16le PCM. Returns a
  list of transition event names that fired *during this call*; possible
  values are ``"speech_start"`` and ``"speech_end"``. Returns ``[]`` when
  no transition fired (the common case).
* ``reset() -> None`` — clears the ORT state tensor and hysteresis
  counters. Called by the orchestrator between utterances and when mic
  ducking begins.

Hysteresis
----------
A bare ``prob > 0.5`` threshold flips on every noise blip. We gate each
transition with two kinds of hysteresis:

1. **Asymmetric thresholds.** ``speech_threshold`` is higher than
   ``silence_threshold`` (Schmitt-trigger shape). A window between the
   two maintains whichever state we're already in.
2. **Frame counting.** Entering speech requires ``activation_frames``
   consecutive above-threshold windows (default 3). Entering silence
   requires a silent run of ``silence_ms`` to elapse.

These values are wired to the (previously dead) ``voice_vad_silence_ms``
and ``voice_vad_speech_pad_ms`` settings on ``config`` so the operator
can tune them from the settings screen.

ONNX Runtime only — no torch dependency on the hot path.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Iterable

import numpy as np
import onnxruntime as ort

logger = logging.getLogger(__name__)


SPEECH_START = "speech_start"
SPEECH_END = "speech_end"

# Silero v5 ONNX model hard-codes these window sizes. 256 at 8 kHz,
# 512 at 16 kHz — anything else triggers a shape-mismatch error inside ORT.
_SILERO_WINDOW_SAMPLES_16K = 512
_SILERO_WINDOW_SAMPLES_8K = 256


@dataclass(frozen=True)
class VADConfig:
    sample_rate: int = 16_000
    silence_ms: int = 500
    speech_threshold: float = 0.5
    silence_threshold: float = 0.35
    activation_frames: int = 3


class _Hysteresis:
    """Tiny FSM that eats per-window speech probabilities and emits
    speech_start / speech_end transitions. Isolated so it can be
    unit-tested without standing up an ORT session."""

    def __init__(
        self,
        *,
        speech_threshold: float,
        silence_threshold: float,
        activation_frames: int,
        silence_windows: int,
    ) -> None:
        if speech_threshold <= silence_threshold:
            raise ValueError(
                "speech_threshold must be > silence_threshold "
                f"(got {speech_threshold} <= {silence_threshold})"
            )
        if activation_frames < 1:
            raise ValueError("activation_frames must be >= 1")
        if silence_windows < 1:
            raise ValueError("silence_windows must be >= 1")
        self._speech_threshold = speech_threshold
        self._silence_threshold = silence_threshold
        self._activation_frames = activation_frames
        self._silence_windows = silence_windows
        self._in_speech = False
        self._consecutive_speech = 0
        self._consecutive_silence = 0

    def reset(self) -> None:
        self._in_speech = False
        self._consecutive_speech = 0
        self._consecutive_silence = 0

    @property
    def in_speech(self) -> bool:
        return self._in_speech

    def feed(self, prob: float) -> str | None:
        if self._in_speech:
            if prob < self._silence_threshold:
                self._consecutive_silence += 1
                if self._consecutive_silence >= self._silence_windows:
                    self._in_speech = False
                    self._consecutive_silence = 0
                    self._consecutive_speech = 0
                    return SPEECH_END
            else:
                # above silence_threshold — reset silence counter
                self._consecutive_silence = 0
        else:
            if prob > self._speech_threshold:
                self._consecutive_speech += 1
                if self._consecutive_speech >= self._activation_frames:
                    self._in_speech = True
                    self._consecutive_speech = 0
                    self._consecutive_silence = 0
                    return SPEECH_START
            else:
                self._consecutive_speech = 0
        return None


class SileroVAD:
    """Window-normalising Silero VAD wrapper.

    Construction loads the ONNX model. ``process`` is cheap enough to call
    from the audio loop (≤ 1 ms per window on the Dragon Q6A's A78 core)
    but it is *not* thread-safe — one instance per WebSocket connection.
    """

    def __init__(
        self,
        model_path: str,
        *,
        sample_rate: int = 16_000,
        silence_ms: int = 500,
        speech_threshold: float = 0.5,
        silence_threshold: float = 0.35,
        activation_frames: int = 3,
    ) -> None:
        if sample_rate == 16_000:
            self._window_samples = _SILERO_WINDOW_SAMPLES_16K
        elif sample_rate == 8_000:
            self._window_samples = _SILERO_WINDOW_SAMPLES_8K
        else:
            raise ValueError(
                f"Silero VAD supports 8000 or 16000 Hz only (got {sample_rate})"
            )
        self._sample_rate = sample_rate

        window_ms = 1000 * self._window_samples / sample_rate
        silence_windows = max(1, int(silence_ms // window_ms))

        self._hysteresis = _Hysteresis(
            speech_threshold=speech_threshold,
            silence_threshold=silence_threshold,
            activation_frames=activation_frames,
            silence_windows=silence_windows,
        )

        logger.info(
            "Loading Silero VAD ONNX model from %s (sr=%d, window=%d samples, "
            "silence_windows=%d)",
            model_path, sample_rate, self._window_samples, silence_windows,
        )
        # Force CPU provider — onnxruntime's GPU provider probing has
        # been flagging /sys/class/drm warnings on Radxa; CPU is more
        # than fast enough for 512-sample Silero (<1 ms inference).
        self._session = ort.InferenceSession(
            model_path, providers=["CPUExecutionProvider"],
        )
        self._state = np.zeros((2, 1, 128), dtype=np.float32)
        # Int16 pending samples that didn't yet fill a full window.
        self._pending = np.zeros(0, dtype=np.int16)

    def reset(self) -> None:
        self._hysteresis.reset()
        self._state = np.zeros((2, 1, 128), dtype=np.float32)
        self._pending = np.zeros(0, dtype=np.int16)

    @property
    def in_speech(self) -> bool:
        return self._hysteresis.in_speech

    @property
    def window_samples(self) -> int:
        return self._window_samples

    def process(self, pcm_bytes: bytes) -> list[str]:
        """Feed raw mono s16le PCM bytes. Returns 0+ transitions that
        fired while consuming the input."""
        if not pcm_bytes:
            return []
        if len(pcm_bytes) % 2 != 0:
            raise ValueError(
                f"pcm_bytes length must be even (s16le); got {len(pcm_bytes)}"
            )

        incoming = np.frombuffer(pcm_bytes, dtype=np.int16)
        if self._pending.size:
            buffer = np.concatenate([self._pending, incoming])
        else:
            buffer = incoming

        events: list[str] = []
        idx = 0
        n = buffer.size
        while n - idx >= self._window_samples:
            window = buffer[idx : idx + self._window_samples]
            idx += self._window_samples
            prob = self._infer(window)
            event = self._hysteresis.feed(prob)
            if event is not None:
                events.append(event)

        # Keep the tail; it'll join the next frame's buffer.
        self._pending = buffer[idx:].copy()
        return events

    def _infer(self, pcm_int16: np.ndarray) -> float:
        audio = (pcm_int16.astype(np.float32) / 32768.0).reshape(1, -1)
        outputs = self._session.run(
            None,
            {
                "input": audio,
                "state": self._state,
                "sr": np.array(self._sample_rate, dtype=np.int64),
            },
        )
        prob = float(outputs[0][0, 0])
        self._state = outputs[1]
        return prob

    # Exposed for tests that want to feed synthetic probabilities without
    # running ORT. Not part of the public orchestrator contract.
    def _feed_probs_for_testing(self, probs: Iterable[float]) -> list[str]:
        events = []
        for p in probs:
            ev = self._hysteresis.feed(p)
            if ev is not None:
                events.append(ev)
        return events
