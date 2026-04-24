"""
Phase 11b — AlwaysOnOrchestrator state-machine tests.

The orchestrator owns state transitions, cooldown timing, mic ducking,
and the callback contract. VAD and wake-spotter are injected so we can
script their outputs without touching Silero ONNX or Vosk.
"""
from __future__ import annotations

import asyncio
import sys
import types
from unittest.mock import AsyncMock, MagicMock

import pytest

from voice.always_on import (
    STATE_CAPTURING_CONTINUATION,
    STATE_COOLDOWN,
    STATE_IDLE,
    STATE_SPEECH_DETECTED,
    AlwaysOnOrchestrator,
)
from voice.vad import SPEECH_END, SPEECH_START
from voice.wake_spotter import WakeResult


# ──────────────────── scriptable fakes ────────────────────


class _FakeVAD:
    """Scriptable VAD: caller queues lists of events to return from
    successive ``process`` calls."""

    def __init__(self) -> None:
        self._queue: list[list[str]] = []
        self.reset_calls = 0
        self.process_calls: list[bytes] = []

    def queue(self, *event_lists: list[str]) -> None:
        self._queue.extend(event_lists)

    def process(self, pcm: bytes) -> list[str]:
        self.process_calls.append(pcm)
        return self._queue.pop(0) if self._queue else []

    def reset(self) -> None:
        self.reset_calls += 1


class _FakeWakeSpotter:
    """Scriptable wake spotter: finalise() pops from a queue."""

    def __init__(self) -> None:
        self._finalise_queue: list[WakeResult | None] = []
        self.process_calls: list[bytes] = []
        self.reset_calls = 0
        self.finalise_calls = 0

    def queue_finalise(self, result: WakeResult | None) -> None:
        self._finalise_queue.append(result)

    def process(self, pcm: bytes):
        self.process_calls.append(pcm)
        return None  # ignored by orchestrator

    def finalise(self) -> WakeResult | None:
        self.finalise_calls += 1
        return self._finalise_queue.pop(0) if self._finalise_queue else None

    def reset(self) -> None:
        self.reset_calls += 1


# ──────────────────── vosk module stub ────────────────────


class _FakeKaldiRecognizer:
    """Returns a scripted JSON payload from FinalResult, ignoring
    AcceptWaveform input."""

    _transcript: str = ""
    _confidence: float = 0.0

    def __init__(self, model, rate) -> None:
        self.model = model
        self.rate = rate

    def SetWords(self, flag: bool) -> None:
        pass

    def AcceptWaveform(self, pcm: bytes) -> bool:
        return False

    def FinalResult(self) -> str:
        import json

        return json.dumps(
            {
                "text": self._transcript,
                "result": [
                    {"word": w, "conf": self._confidence}
                    for w in self._transcript.split()
                ],
            }
        )


@pytest.fixture
def fake_vosk_module(monkeypatch):
    """Inject sys.modules['vosk'] with a KaldiRecognizer whose
    transcript is controllable per-test."""
    module = types.ModuleType("vosk")

    def set_transcript(text: str, confidence: float = 0.9) -> None:
        _FakeKaldiRecognizer._transcript = text
        _FakeKaldiRecognizer._confidence = confidence

    module.KaldiRecognizer = _FakeKaldiRecognizer
    module.SetLogLevel = lambda level: None
    module.set_transcript = set_transcript  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "vosk", module)
    yield module


# ──────────────────── helpers ────────────────────


def _build_orch(
    *,
    continuation_window_s: int = 10,
    callback: AsyncMock | None = None,
) -> tuple[AlwaysOnOrchestrator, _FakeVAD, _FakeWakeSpotter, AsyncMock]:
    vad = _FakeVAD()
    wake = _FakeWakeSpotter()
    cb = callback or AsyncMock()
    orch = AlwaysOnOrchestrator(
        vad=vad,
        wake_spotter=wake,
        vosk_model=MagicMock(name="vosk_model"),
        sample_rate=16_000,
        continuation_window_s=continuation_window_s,
        event_callback=cb,
    )
    return orch, vad, wake, cb


def _event_types(cb: AsyncMock) -> list[str]:
    return [call.args[0]["type"] for call in cb.await_args_list]


FRAME_640 = b"\x00\x01" * 160  # 20 ms worth at 16 kHz; content doesn't matter


# ──────────────────── state transitions ────────────────────


class TestInitialState:
    async def test_starts_idle(self) -> None:
        orch, *_ = _build_orch()
        assert orch.state == STATE_IDLE
        assert not orch.is_ducked


class TestIdleToSpeechDetected:
    async def test_vad_speech_start_transitions(self) -> None:
        orch, vad, wake, cb = _build_orch()
        vad.queue([SPEECH_START])
        await orch.process_frame(FRAME_640)
        assert orch.state == STATE_SPEECH_DETECTED
        assert _event_types(cb) == ["speech_start"]
        assert wake.reset_calls == 1  # fresh recogniser for new utterance


class TestSpeechDetectedFlow:
    async def test_no_wake_match_returns_to_idle(self, fake_vosk_module) -> None:
        orch, vad, wake, cb = _build_orch()
        vad.queue([SPEECH_START], [], [SPEECH_END])
        wake.queue_finalise(
            WakeResult(matched=False, confidence=0.1, transcript="[unk]")
        )
        await orch.process_frame(FRAME_640)  # speech_start
        await orch.process_frame(FRAME_640)  # mid-utterance
        await orch.process_frame(FRAME_640)  # speech_end, no wake
        assert orch.state == STATE_IDLE
        # speech_start + speech_end only; no wake, no final
        assert _event_types(cb) == ["speech_start", "speech_end"]

    async def test_wake_match_triggers_final_and_cooldown(
        self, fake_vosk_module
    ) -> None:
        fake_vosk_module.set_transcript("фантом який час", confidence=0.85)
        orch, vad, wake, cb = _build_orch(continuation_window_s=60)
        vad.queue([SPEECH_START], [SPEECH_END])
        wake.queue_finalise(
            WakeResult(matched=True, confidence=0.82, transcript="фантом")
        )
        await orch.process_frame(FRAME_640)  # speech_start
        await orch.process_frame(FRAME_640)  # speech_end → wake → final → cooldown
        assert orch.state == STATE_COOLDOWN
        types_emitted = _event_types(cb)
        assert types_emitted == [
            "speech_start",
            "speech_end",
            "wake",
            "final",
            "cooldown_start",
        ]
        # Verify final event carries the transcribed command, source=wake.
        final_event = cb.await_args_list[3].args[0]
        assert final_event["type"] == "final"
        assert final_event["source"] == "wake"
        assert final_event["transcript"] == "фантом який час"
        assert final_event["confidence"] == pytest.approx(0.85)

    async def test_utterance_pcm_fed_to_wake_spotter(self) -> None:
        orch, vad, wake, _ = _build_orch()
        vad.queue([SPEECH_START], [], [SPEECH_END])
        wake.queue_finalise(
            WakeResult(matched=False, confidence=0.1, transcript="")
        )
        await orch.process_frame(FRAME_640)
        await orch.process_frame(FRAME_640)
        await orch.process_frame(FRAME_640)
        # Two frames during SPEECH_DETECTED were forwarded to wake spotter
        assert len(wake.process_calls) == 2


class TestCooldownAndContinuation:
    async def test_cooldown_timer_returns_to_idle(self, fake_vosk_module) -> None:
        """Short window, then await the timer."""
        fake_vosk_module.set_transcript("фантом тест")
        orch, vad, wake, cb = _build_orch(continuation_window_s=0)  # immediate
        vad.queue([SPEECH_START], [SPEECH_END])
        wake.queue_finalise(
            WakeResult(matched=True, confidence=0.8, transcript="фантом")
        )
        await orch.process_frame(FRAME_640)
        await orch.process_frame(FRAME_640)  # enters cooldown, schedules timer
        # Yield so the timer task gets a chance to run.
        await asyncio.sleep(0.05)
        assert orch.state == STATE_IDLE
        assert "cooldown_end" in _event_types(cb)

    async def test_speech_in_cooldown_starts_continuation(
        self, fake_vosk_module
    ) -> None:
        fake_vosk_module.set_transcript("фантом привіт")
        orch, vad, wake, cb = _build_orch(continuation_window_s=60)
        vad.queue(
            [SPEECH_START],       # initial speech_start
            [SPEECH_END],         # utterance end → COOLDOWN
            [SPEECH_START],       # continuation start
            [SPEECH_END],         # continuation end
        )
        wake.queue_finalise(
            WakeResult(matched=True, confidence=0.8, transcript="фантом")
        )
        await orch.process_frame(FRAME_640)
        await orch.process_frame(FRAME_640)
        assert orch.state == STATE_COOLDOWN
        # New speech during cooldown
        fake_vosk_module.set_transcript("додай ще каву")
        await orch.process_frame(FRAME_640)
        assert orch.state == STATE_CAPTURING_CONTINUATION
        # End of continuation
        await orch.process_frame(FRAME_640)
        assert orch.state == STATE_COOLDOWN
        types_emitted = _event_types(cb)
        # Expect two final events: one wake-source, one continuation-source.
        finals = [
            call.args[0]
            for call in cb.await_args_list
            if call.args[0]["type"] == "final"
        ]
        assert len(finals) == 2
        assert finals[0]["source"] == "wake"
        assert finals[1]["source"] == "continuation"
        assert finals[1]["transcript"] == "додай ще каву"


class TestMicDucking:
    async def test_ducked_frames_are_dropped(self) -> None:
        orch, vad, wake, cb = _build_orch()
        await orch.mic_duck()
        assert orch.is_ducked
        vad.queue([SPEECH_START])  # would fire if processed
        await orch.process_frame(FRAME_640)
        assert vad.process_calls == []  # never reached VAD
        assert cb.await_count == 0

    async def test_mic_duck_resets_in_progress_state(
        self, fake_vosk_module
    ) -> None:
        orch, vad, _, cb = _build_orch()
        vad.queue([SPEECH_START])
        await orch.process_frame(FRAME_640)
        assert orch.state == STATE_SPEECH_DETECTED
        await orch.mic_duck()
        assert orch.state == STATE_IDLE
        assert orch.is_ducked

    async def test_mic_unduck_resumes_processing(self) -> None:
        orch, vad, _, _ = _build_orch()
        await orch.mic_duck()
        await orch.mic_unduck()
        assert not orch.is_ducked
        vad.queue([SPEECH_START])
        await orch.process_frame(FRAME_640)
        assert orch.state == STATE_SPEECH_DETECTED


class TestResetCommand:
    async def test_reset_clears_state_but_preserves_ducking(self) -> None:
        orch, vad, _, _ = _build_orch()
        vad.queue([SPEECH_START])
        await orch.process_frame(FRAME_640)
        await orch.mic_duck()
        await orch.reset()
        assert orch.state == STATE_IDLE
        # Ducking was on — reset should not toggle it off.
        assert orch.is_ducked


class TestCallbackRobustness:
    async def test_callback_exception_does_not_break_pipeline(self) -> None:
        bad_cb = AsyncMock(side_effect=RuntimeError("consumer exploded"))
        orch, vad, _, _ = _build_orch(callback=bad_cb)
        vad.queue([SPEECH_START])
        # Should not raise — exception is swallowed + logged.
        await orch.process_frame(FRAME_640)
        # State still advanced despite the callback failure.
        assert orch.state == STATE_SPEECH_DETECTED

    async def test_no_callback_is_safe(self) -> None:
        vad = _FakeVAD()
        orch = AlwaysOnOrchestrator(
            vad=vad,
            wake_spotter=_FakeWakeSpotter(),
            vosk_model=MagicMock(),
            event_callback=None,
        )
        vad.queue([SPEECH_START])
        await orch.process_frame(FRAME_640)
        assert orch.state == STATE_SPEECH_DETECTED


class TestErrorHandling:
    async def test_vad_value_error_emits_error_event(self) -> None:
        orch, vad, _, cb = _build_orch()

        def bad_process(pcm):
            raise ValueError("odd length")

        vad.process = bad_process  # type: ignore[method-assign]
        await orch.process_frame(b"\x00\x01\x02")  # whatever
        error_events = [
            call.args[0] for call in cb.await_args_list
            if call.args[0]["type"] == "error"
        ]
        assert len(error_events) == 1
        assert "odd length" in error_events[0]["message"]

    async def test_empty_frame_is_noop(self) -> None:
        orch, vad, _, cb = _build_orch()
        await orch.process_frame(b"")
        assert vad.process_calls == []
        assert cb.await_count == 0


class TestConfigNewFields:
    """Make sure the Phase 11b config additions survived the edit."""

    def test_new_fields_have_expected_defaults(self) -> None:
        from config import config

        assert hasattr(config, "voice_always_on_enabled")
        assert hasattr(config, "voice_wake_confidence_min")
        assert hasattr(config, "voice_continuation_window_s")
        assert hasattr(config, "voice_mic_duck_on_tts")
        assert config.voice_always_on_enabled is False
        assert config.voice_wake_confidence_min == pytest.approx(0.6)
        assert config.voice_continuation_window_s == 10
        assert config.voice_mic_duck_on_tts is True
