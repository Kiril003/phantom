"""
Phase 13b — orchestrator integration with streaming partials and the
optional Whisper background refine. The StreamingVoskRecognizer is
mocked so these tests run without a Vosk model on disk.
"""
from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import MagicMock

import pytest


def _make_orch(
    *,
    mode: str = "continuous",
    streaming_partials: bool = True,
    refine_with_whisper: bool = False,
    refine_diff_threshold: float = 0.85,
    partial_debounce_ms: int = 0,
    transcribe_text: str = "",
    transcribe_conf: float = 0.0,
    wake_phrase: str = "фантом",
):
    """Construct an orchestrator with stubbed VAD / wake / event sink.

    The test queues VAD events via ``vad.queue([...])`` which mirrors
    how test_phase12_orchestrator_modes does it.
    """
    from voice.always_on import AlwaysOnOrchestrator

    class _FakeVAD:
        def __init__(self) -> None:
            self._queue: list[list[str]] = []
            self.in_speech = False

        def queue(self, events: list[str]) -> None:
            self._queue.append(events)

        def process(self, _frame: bytes) -> list[str]:
            if not self._queue:
                return []
            return self._queue.pop(0)

        def reset(self) -> None:
            self._queue.clear()
            self.in_speech = False

    vad = _FakeVAD()
    wake = MagicMock()

    events: list[dict] = []

    async def _emit(payload: dict) -> None:
        events.append(payload)

    async def _transcribe(_audio: bytes) -> tuple[str, float]:
        return transcribe_text, transcribe_conf

    orch = AlwaysOnOrchestrator(
        vad=vad,  # type: ignore[arg-type]
        wake_spotter=wake,
        vosk_model=object(),  # any truthy sentinel — streaming_recognizer is mocked
        sample_rate=16_000,
        continuation_window_s=10,
        event_callback=_emit,
        mode=mode,
        wake_phrase=wake_phrase,
        silence_timeout_ms=800,
        transcribe_fn=_transcribe,
        streaming_partials=streaming_partials,
        partial_debounce_ms=partial_debounce_ms,
        refine_with_whisper=refine_with_whisper,
        refine_diff_threshold=refine_diff_threshold,
    )
    return orch, vad, events


# ─────────── streaming partials ────────────


@pytest.mark.asyncio
async def test_partial_emitted_during_speech(monkeypatch) -> None:
    """When streaming is on, every changed partial from the recognizer
    must surface on the event sink as a `partial` event."""
    # Stub the recognizer module before constructing the orchestrator so
    # the patch is in place when speech_start arrives.
    fake_rec = MagicMock()
    from voice.streaming_recognizer import PartialEvent, FinalEvent
    feed_responses = iter([
        None,  # speech_start frame produces no partial yet
        PartialEvent(text="при", is_committed=False, stability=1),
        PartialEvent(text="привіт", is_committed=False, stability=1),
        None,  # debounce / unchanged
    ])

    def _feed(_pcm):
        try:
            return next(feed_responses)
        except StopIteration:
            return None
    fake_rec.feed = _feed
    fake_rec.finalise = lambda: FinalEvent(text="привіт", confidence=0.91)

    def _fake_factory(*_a: Any, **_kw: Any):
        return fake_rec

    import voice.streaming_recognizer as sr_mod
    monkeypatch.setattr(sr_mod, "StreamingVoskRecognizer", _fake_factory)

    orch, vad, events = _make_orch(streaming_partials=True)

    vad.queue(["speech_start"])
    await orch.process_frame(b"\x10" * 64)
    vad.queue([])
    await orch.process_frame(b"\x10" * 64)
    vad.queue([])
    await orch.process_frame(b"\x10" * 64)
    vad.queue([])
    await orch.process_frame(b"\x10" * 64)
    vad.queue(["speech_end"])
    await orch.process_frame(b"\x10" * 64)

    # Жива розмова: VAD більше не закриває репліку сам — «привіт» має
    # завершений хвіст, тож черга тримає її до 700 мс тиші й аж тоді закриває.
    hold = orch._hold_task
    assert hold is not None, "черга мала взяти кермо після паузи"
    await hold

    types = [e["type"] for e in events]
    assert "speech_start" in types
    partials = [e for e in events if e["type"] == "partial"]
    assert [p["transcript"] for p in partials] == ["при", "привіт"]
    assert types[-1] == "final"
    final = [e for e in events if e["type"] == "final"][0]
    assert final["transcript"] == "привіт"
    assert final["source"] == "vosk_fast"


def _install_fake_recognizer(monkeypatch, *, final_text: str, final_conf: float):
    """Helper: replace StreamingVoskRecognizer with a plain-function stub.

    MagicMock.feed/finalise are NOT thread-safe under asyncio.to_thread;
    plain functions avoid the race entirely. Each call to ``feed`` returns
    None (no partial); ``finalise`` returns the configured FinalEvent.
    """
    from voice.streaming_recognizer import FinalEvent
    import voice.streaming_recognizer as sr_mod

    final_event = FinalEvent(text=final_text, confidence=final_conf)

    class _PlainRec:
        def feed(self, _pcm):
            return None

        def finalise(self):
            return final_event

    rec = _PlainRec()
    monkeypatch.setattr(sr_mod, "StreamingVoskRecognizer", lambda *_a, **_kw: rec)
    return rec


@pytest.mark.asyncio
async def test_streaming_off_falls_back_to_whisper(monkeypatch) -> None:
    """When streaming_partials=False, the orchestrator must keep emitting
    no `partial` events and fall back to the existing Whisper finalise."""
    orch, vad, events = _make_orch(
        streaming_partials=False, transcribe_text="привіт", transcribe_conf=0.7,
    )

    # Should never construct a streaming recognizer.
    import voice.streaming_recognizer as sr_mod

    def _must_not_build(*_a, **_kw):
        raise AssertionError("must not build streaming recognizer")
    monkeypatch.setattr(sr_mod, "StreamingVoskRecognizer", _must_not_build)

    vad.queue(["speech_start"])
    await orch.process_frame(b"\x10" * 64)
    vad.queue(["speech_end"])
    await orch.process_frame(b"\x10" * 64)

    types = [e["type"] for e in events]
    assert "partial" not in types
    final = [e for e in events if e["type"] == "final"][0]
    assert final["source"] == "continuous"
    assert final["transcript"] == "привіт"


@pytest.mark.asyncio
async def test_streaming_wake_word_strips_phrase(monkeypatch) -> None:
    _install_fake_recognizer(monkeypatch, final_text="фантом який час", final_conf=0.85)
    orch, vad, events = _make_orch(
        mode="wake_word", streaming_partials=True, wake_phrase="фантом",
    )

    vad.queue(["speech_start"])
    await orch.process_frame(b"\x10" * 64)
    vad.queue(["speech_end"])
    await orch.process_frame(b"\x10" * 64)

    final = [e for e in events if e["type"] == "final"][0]
    assert final["transcript"] == "який час"
    assert final["source"] == "vosk_fast"


@pytest.mark.asyncio
async def test_streaming_wake_word_missing_phrase_rejects(monkeypatch) -> None:
    _install_fake_recognizer(monkeypatch, final_text="привіт як справи", final_conf=0.9)
    orch, vad, events = _make_orch(
        mode="wake_word", streaming_partials=True, wake_phrase="фантом",
    )

    vad.queue(["speech_start"])
    await orch.process_frame(b"\x10" * 64)
    vad.queue(["speech_end"])
    await orch.process_frame(b"\x10" * 64)

    types = [e["type"] for e in events]
    assert "rejected" in types
    assert "final" not in types


@pytest.mark.asyncio
async def test_empty_streaming_final_emits_rejected(monkeypatch) -> None:
    _install_fake_recognizer(monkeypatch, final_text="", final_conf=0.0)
    orch, vad, events = _make_orch(streaming_partials=True)

    vad.queue(["speech_start"])
    await orch.process_frame(b"\x10" * 64)
    vad.queue(["speech_end"])
    await orch.process_frame(b"\x10" * 64)

    assert [e["type"] for e in events][-1] == "rejected"


# ─────────── duck / reset interplay ────────────


@pytest.mark.asyncio
async def test_reset_during_streaming_drops_recognizer(monkeypatch) -> None:
    rec = _install_fake_recognizer(monkeypatch, final_text="привіт", final_conf=0.9)
    orch, vad, _events = _make_orch(streaming_partials=True)

    vad.queue(["speech_start"])
    await orch.process_frame(b"\x10" * 64)
    assert orch._streaming_rec is rec  # builder was called

    await orch.reset()
    assert orch._streaming_rec is None


# ─────────── Whisper refine ────────────


@pytest.mark.asyncio
async def test_refine_emits_final_revised_when_text_differs(monkeypatch) -> None:
    """Whisper says something materially different → final_revised."""
    _install_fake_recognizer(monkeypatch, final_text="приві", final_conf=0.5)
    orch, vad, events = _make_orch(
        streaming_partials=True,
        refine_with_whisper=True,
        refine_diff_threshold=0.85,
        transcribe_text="привіт як справи у тебе сьогодні",
        transcribe_conf=0.95,
    )

    vad.queue(["speech_start"])
    await orch.process_frame(b"\x10" * 64)
    vad.queue(["speech_end"])
    await orch.process_frame(b"\x10" * 64)

    # Wait for the background refine task to complete.
    if orch._refine_task is not None:
        await orch._refine_task

    types = [e["type"] for e in events]
    assert "final" in types
    assert "final_revised" in types
    revised = [e for e in events if e["type"] == "final_revised"][0]
    assert revised["transcript"] == "привіт як справи у тебе сьогодні"
    assert revised["source"] == "whisper_quality"
    assert revised["diff_ratio"] < 0.85


@pytest.mark.asyncio
async def test_refine_silent_when_text_close(monkeypatch) -> None:
    """When Whisper agrees with Vosk, no final_revised is emitted."""
    _install_fake_recognizer(monkeypatch, final_text="привіт", final_conf=0.9)
    orch, vad, events = _make_orch(
        streaming_partials=True,
        refine_with_whisper=True,
        refine_diff_threshold=0.85,
        transcribe_text="привіт",  # identical to Vosk
        transcribe_conf=0.95,
    )

    vad.queue(["speech_start"])
    await orch.process_frame(b"\x10" * 64)
    vad.queue(["speech_end"])
    await orch.process_frame(b"\x10" * 64)

    if orch._refine_task is not None:
        await orch._refine_task

    types = [e["type"] for e in events]
    assert "final_revised" not in types


@pytest.mark.asyncio
async def test_refine_disabled_never_runs(monkeypatch) -> None:
    """refine_with_whisper=False must not spawn a refine task at all."""
    _install_fake_recognizer(monkeypatch, final_text="привіт", final_conf=0.9)
    orch, vad, events = _make_orch(
        streaming_partials=True,
        refine_with_whisper=False,
        transcribe_text="something different",
        transcribe_conf=0.8,
    )

    vad.queue(["speech_start"])
    await orch.process_frame(b"\x10" * 64)
    vad.queue(["speech_end"])
    await orch.process_frame(b"\x10" * 64)

    assert orch._refine_task is None
    types = [e["type"] for e in events]
    assert "final_revised" not in types


# ─────────── helpers ────────────


def test_string_similarity_identical() -> None:
    from voice.always_on import _string_similarity
    assert _string_similarity("привіт", "привіт") == 1.0


def test_string_similarity_disjoint() -> None:
    from voice.always_on import _string_similarity
    # Even completely different short strings won't be exactly 0.0
    # (SequenceMatcher counts char overlap), but should be < 0.5.
    assert _string_similarity("foo", "bar") < 0.5


def test_string_similarity_empty_handling() -> None:
    from voice.always_on import _string_similarity
    assert _string_similarity("", "") == 1.0
    assert _string_similarity("a", "") == 0.0
    assert _string_similarity("", "b") == 0.0
