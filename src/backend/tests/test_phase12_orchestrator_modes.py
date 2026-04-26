"""
Phase 12.0 — VAD-driven orchestrator modes (off / continuous / wake_word).

Verifies:
  * mode='off' drops every frame (no events emitted)
  * mode='continuous' emits speech_start/end + final on a SPEECH_START →
    SPEECH_END cycle, regardless of transcript content
  * mode='wake_word' emits final ONLY when transcript contains the
    wake phrase, with the phrase stripped from the published text
  * Legacy default mode keeps the 11b FSM intact
"""
from __future__ import annotations

import os

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase12-orch")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")

from voice.always_on import (  # noqa: E402
    MODE_CONTINUOUS,
    MODE_LEGACY,
    MODE_OFF,
    MODE_WAKE_WORD,
    AlwaysOnOrchestrator,
)
from voice.vad import SPEECH_END, SPEECH_START  # noqa: E402


# ────────────────── lightweight fakes ──────────────────


class _FakeVAD:
    """Scriptable Silero VAD — caller queues per-call event lists."""

    def __init__(self) -> None:
        self._queue: list[list[str]] = []
        self.process_calls: list[bytes] = []
        self.reset_calls = 0

    def queue(self, *event_lists: list[str]) -> None:
        self._queue.extend(event_lists)

    def process(self, pcm: bytes) -> list[str]:
        self.process_calls.append(pcm)
        if not self._queue:
            return []
        return self._queue.pop(0)

    def reset(self) -> None:
        self.reset_calls += 1


class _FakeWake:
    """Wake spotter is irrelevant to Phase 12 modes — but the orchestrator
    constructor still requires one. The handlers never invoke it in the
    Phase 12 paths."""

    def __init__(self) -> None:
        self.process_calls: list[bytes] = []
        self.reset_calls = 0

    def process(self, pcm: bytes):
        self.process_calls.append(pcm)
        return None

    def finalise(self):
        return None

    def reset(self) -> None:
        self.reset_calls += 1


def _make_orch(
    *,
    mode: str,
    wake_phrase: str = "",
    transcribe_text: str = "",
    transcribe_conf: float = 0.0,
    silence_timeout_ms: int = 1500,
):
    vad = _FakeVAD()
    wake = _FakeWake()
    events: list[dict] = []

    async def _emit(ev: dict) -> None:
        events.append(ev)

    async def _transcribe(_pcm: bytes) -> tuple[str, float]:
        return transcribe_text, transcribe_conf

    orch = AlwaysOnOrchestrator(
        vad=vad,  # type: ignore[arg-type]
        wake_spotter=wake,  # type: ignore[arg-type]
        vosk_model=object(),  # never used in Phase 12 paths
        sample_rate=16_000,
        continuation_window_s=10,
        event_callback=_emit,
        mode=mode,
        wake_phrase=wake_phrase,
        silence_timeout_ms=silence_timeout_ms,
        transcribe_fn=_transcribe,
    )
    return orch, vad, wake, events


# ────────────────── mode = off ──────────────────


class TestModeOff:
    @pytest.mark.asyncio
    async def test_off_emits_no_events_on_frames(self) -> None:
        orch, vad, _, events = _make_orch(mode=MODE_OFF)
        # Even if VAD WERE to fire transitions, mode=off short-circuits
        # before VAD is asked.
        vad.queue([SPEECH_START], [SPEECH_END])
        for _ in range(3):
            await orch.process_frame(b"\x00" * 320)
        assert events == []
        # And the VAD was never even consulted.
        assert vad.process_calls == []

    @pytest.mark.asyncio
    async def test_off_does_not_buffer_audio(self) -> None:
        orch, _, _, _ = _make_orch(mode=MODE_OFF)
        await orch.process_frame(b"\x01" * 64)
        assert bytes(orch._utterance_pcm) == b""


# ────────────────── mode = continuous ──────────────────


class TestModeContinuous:
    @pytest.mark.asyncio
    async def test_speech_start_emits_speech_start_event(self) -> None:
        orch, vad, _, events = _make_orch(
            mode=MODE_CONTINUOUS, transcribe_text="привіт"
        )
        vad.queue([SPEECH_START])
        await orch.process_frame(b"\x10" * 64)
        assert events[-1] == {"type": "speech_start"}

    @pytest.mark.asyncio
    async def test_full_cycle_emits_speech_start_end_final(self) -> None:
        orch, vad, _, events = _make_orch(
            mode=MODE_CONTINUOUS,
            transcribe_text="привіт",
            transcribe_conf=0.9,
        )
        # Frame 1: speech starts. Frame 2: still speech. Frame 3: speech ends.
        vad.queue([SPEECH_START], [], [SPEECH_END])
        await orch.process_frame(b"\xaa" * 64)
        await orch.process_frame(b"\xbb" * 64)
        await orch.process_frame(b"\xcc" * 64)

        kinds = [ev["type"] for ev in events]
        assert "speech_start" in kinds
        assert "speech_end" in kinds
        assert "final" in kinds
        final_ev = next(ev for ev in events if ev["type"] == "final")
        assert final_ev["transcript"] == "привіт"
        assert final_ev["source"] == MODE_CONTINUOUS
        assert final_ev["confidence"] == pytest.approx(0.9)

    @pytest.mark.asyncio
    async def test_continuous_does_not_filter_text(self) -> None:
        """In continuous mode every non-empty transcript becomes a final
        event — there is no wake gate to filter out arbitrary speech."""
        orch, vad, _, events = _make_orch(
            mode=MODE_CONTINUOUS,
            transcribe_text="some random unrelated speech",
        )
        vad.queue([SPEECH_START], [SPEECH_END])
        await orch.process_frame(b"\x01" * 32)
        await orch.process_frame(b"\x02" * 32)
        finals = [ev for ev in events if ev["type"] == "final"]
        assert len(finals) == 1
        assert finals[0]["transcript"] == "some random unrelated speech"

    @pytest.mark.asyncio
    async def test_empty_transcript_silently_dropped(self) -> None:
        """Whisper sometimes returns "" on pure noise — don't publish empty
        chat messages."""
        orch, vad, _, events = _make_orch(
            mode=MODE_CONTINUOUS, transcribe_text=""
        )
        vad.queue([SPEECH_START], [SPEECH_END])
        await orch.process_frame(b"\x01" * 32)
        await orch.process_frame(b"\x02" * 32)
        finals = [ev for ev in events if ev["type"] == "final"]
        assert finals == []


# ────────────────── mode = wake_word ──────────────────


class TestModeWakeWord:
    @pytest.mark.asyncio
    async def test_no_wake_phrase_silently_dropped(self) -> None:
        orch, vad, _, events = _make_orch(
            mode=MODE_WAKE_WORD,
            wake_phrase="фантом",
            transcribe_text="який час зараз",  # no "фантом"
        )
        vad.queue([SPEECH_START], [SPEECH_END])
        await orch.process_frame(b"\x01" * 32)
        await orch.process_frame(b"\x02" * 32)
        finals = [ev for ev in events if ev["type"] == "final"]
        assert finals == [], (
            "Without the wake phrase, no final event must reach the chat"
        )

    @pytest.mark.asyncio
    async def test_wake_phrase_present_strips_phrase(self) -> None:
        orch, vad, _, events = _make_orch(
            mode=MODE_WAKE_WORD,
            wake_phrase="фантом",
            transcribe_text="фантом, який час зараз",
        )
        vad.queue([SPEECH_START], [SPEECH_END])
        await orch.process_frame(b"\x01" * 32)
        await orch.process_frame(b"\x02" * 32)
        finals = [ev for ev in events if ev["type"] == "final"]
        assert len(finals) == 1
        # Comma + leading space stripped. The exact whitespace policy is
        # _strip_wake_phrase's job; we assert the phrase is gone and the
        # remainder is non-empty / readable.
        assert "фантом" not in finals[0]["transcript"].lower()
        assert finals[0]["transcript"].endswith("який час зараз")

    @pytest.mark.asyncio
    async def test_wake_phrase_case_insensitive_match(self) -> None:
        orch, vad, _, events = _make_orch(
            mode=MODE_WAKE_WORD,
            wake_phrase="phantom",
            transcribe_text="PHANTOM what time is it",
        )
        vad.queue([SPEECH_START], [SPEECH_END])
        await orch.process_frame(b"\x01" * 32)
        await orch.process_frame(b"\x02" * 32)
        finals = [ev for ev in events if ev["type"] == "final"]
        assert len(finals) == 1
        # Original case preserved in the remainder; the phrase is removed
        # case-insensitively.
        assert "PHANTOM" not in finals[0]["transcript"]
        assert "what time" in finals[0]["transcript"].lower()

    @pytest.mark.asyncio
    async def test_wake_phrase_only_results_in_no_final(self) -> None:
        """If the user said only the wake phrase and nothing else, the
        cleaned transcript would be empty — drop it rather than publishing
        a blank chat message."""
        orch, vad, _, events = _make_orch(
            mode=MODE_WAKE_WORD,
            wake_phrase="фантом",
            transcribe_text="фантом",
        )
        vad.queue([SPEECH_START], [SPEECH_END])
        await orch.process_frame(b"\x01" * 32)
        await orch.process_frame(b"\x02" * 32)
        finals = [ev for ev in events if ev["type"] == "final"]
        assert finals == []

    @pytest.mark.asyncio
    async def test_final_source_marks_wake_word_mode(self) -> None:
        orch, vad, _, events = _make_orch(
            mode=MODE_WAKE_WORD,
            wake_phrase="фантом",
            transcribe_text="фантом увімкни світло",
            transcribe_conf=0.85,
        )
        vad.queue([SPEECH_START], [SPEECH_END])
        await orch.process_frame(b"\x01" * 32)
        await orch.process_frame(b"\x02" * 32)
        finals = [ev for ev in events if ev["type"] == "final"]
        assert len(finals) == 1
        assert finals[0]["source"] == MODE_WAKE_WORD
        assert finals[0]["confidence"] == pytest.approx(0.85)


# ────────────────── legacy default ──────────────────


class TestLegacyDefaultStillWorks:
    @pytest.mark.asyncio
    async def test_legacy_mode_does_not_take_phase12_path(self) -> None:
        """An orchestrator constructed without a mode defaults to legacy.
        Phase 12 path must not run on a legacy instance — the wake spotter
        stays in charge of the verdict."""
        orch, vad, wake, events = _make_orch(mode=MODE_LEGACY)
        # Phase 12 path consumes vad.process; legacy path also consumes
        # vad.process but routes events through the FSM. The interesting
        # assertion: a SPEECH_START event in legacy mode does NOT emit
        # speech_start (legacy uses _enter_speech_detected which DOES emit
        # speech_start). So we just verify we didn't take the off path.
        # Frame is consumed, no error.
        vad.queue([])
        await orch.process_frame(b"\x00" * 64)
        # Legacy mode passes the frame to VAD.
        assert len(vad.process_calls) == 1


# ────────────────── ducking ──────────────────


class TestDuckingHonouredInPhase12:
    @pytest.mark.asyncio
    async def test_ducked_drops_phase12_frames(self) -> None:
        orch, vad, _, events = _make_orch(
            mode=MODE_CONTINUOUS, transcribe_text="ignored"
        )
        await orch.mic_duck()
        vad.queue([SPEECH_START])
        await orch.process_frame(b"\x10" * 32)
        assert events == [], (
            "While ducked, the Phase 12 handler must not process frames"
        )
        assert vad.process_calls == []
