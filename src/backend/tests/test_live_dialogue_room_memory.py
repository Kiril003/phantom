"""Пам'ять тримає те, що сказали PHANTOM, а не те, що він підслухав.

Рішення власника від 13.08.2026: у контекст лягають лише відправлені репліки.
Перевіряємо ефект — рядок у буфері слуху, — а не відсутність винятку. Обидва
шляхи завершення (Whisper і швидкий Vosk) мають однакову поведінку, тому
кожен вектор проганяється двічі.
"""
from __future__ import annotations

import os

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-live-dialogue-room")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")

from core.context_engine import context_engine  # noqa: E402
from voice.always_on import (  # noqa: E402
    MODE_CONTINUOUS,
    MODE_WAKE_WORD,
    AlwaysOnOrchestrator,
)
from voice.vad import SPEECH_END, SPEECH_START  # noqa: E402


class _FakeVAD:
    def __init__(self) -> None:
        self._queue: list[list[str]] = []

    def queue(self, *event_lists: list[str]) -> None:
        self._queue.extend(event_lists)

    def process(self, pcm: bytes) -> list[str]:
        return self._queue.pop(0) if self._queue else []

    def reset(self) -> None:
        pass


class _FakeWake:
    def process(self, pcm: bytes):
        return None

    def finalise(self):
        return None

    def reset(self) -> None:
        pass


def _install_fake_recognizer(monkeypatch, text: str) -> None:
    import voice.streaming_recognizer as sr_mod
    from voice.streaming_recognizer import FinalEvent

    class _Rec:
        def feed(self, _pcm):
            return None

        def finalise(self):
            return FinalEvent(text=text, confidence=0.9)

    monkeypatch.setattr(sr_mod, "StreamingVoskRecognizer", lambda *a, **k: _Rec())


@pytest.fixture
def heard(monkeypatch) -> list[str]:
    recorded: list[str] = []
    monkeypatch.setattr(
        context_engine, "record_heard_speech", lambda text: recorded.append(text),
    )
    return recorded


async def _one_utterance(
    monkeypatch,
    *,
    mode: str,
    transcript: str,
    wake_phrase: str = "",
    streaming: bool = False,
) -> list[dict]:
    vad = _FakeVAD()
    events: list[dict] = []

    async def _emit(ev: dict) -> None:
        events.append(ev)

    async def _transcribe(_pcm: bytes) -> tuple[str, float]:
        return transcript, 0.9

    if streaming:
        _install_fake_recognizer(monkeypatch, transcript)

    orch = AlwaysOnOrchestrator(
        vad=vad,  # type: ignore[arg-type]
        wake_spotter=_FakeWake(),  # type: ignore[arg-type]
        vosk_model=object(),
        event_callback=_emit,
        mode=mode,
        wake_phrase=wake_phrase,
        transcribe_fn=_transcribe,
        streaming_partials=streaming,
    )
    vad.queue([SPEECH_START], [SPEECH_END])
    await orch.process_frame(b"\x01" * 320)
    await orch.process_frame(b"\x01" * 320)
    return events


def _types(events: list[dict]) -> list[str]:
    return [e["type"] for e in events]


_BOTH_PATHS = pytest.mark.parametrize("streaming", [False, True], ids=["whisper", "vosk_fast"])


@_BOTH_PATHS
async def test_overheard_speech_is_not_kept(monkeypatch, heard, streaming) -> None:
    events = await _one_utterance(
        monkeypatch,
        mode=MODE_WAKE_WORD,
        wake_phrase="фантом",
        transcript="та він учора знову напився і не прийшов",
        streaming=streaming,
    )
    assert "rejected" in _types(events)
    assert "final" not in _types(events)
    assert heard == []


@_BOTH_PATHS
async def test_a_dispatched_turn_is_kept(monkeypatch, heard, streaming) -> None:
    events = await _one_utterance(
        monkeypatch,
        mode=MODE_WAKE_WORD,
        wake_phrase="фантом",
        transcript="фантом, який зараз час",
        streaming=streaming,
    )
    finals = [e for e in events if e["type"] == "final"]
    assert len(finals) == 1
    assert heard == [finals[0]["transcript"]] == ["який зараз час"]


@_BOTH_PATHS
async def test_empty_transcript_leaves_no_trace(monkeypatch, heard, streaming) -> None:
    events = await _one_utterance(
        monkeypatch, mode=MODE_CONTINUOUS, transcript="   ", streaming=streaming,
    )
    assert "rejected" in _types(events)
    assert heard == []


@_BOTH_PATHS
async def test_continuous_turn_is_kept(monkeypatch, heard, streaming) -> None:
    events = await _one_utterance(
        monkeypatch,
        mode=MODE_CONTINUOUS,
        transcript="постав таймер на десять хвилин",
        streaming=streaming,
    )
    assert [e["type"] for e in events if e["type"] == "final"] == ["final"]
    assert heard == ["постав таймер на десять хвилин"]


async def test_the_buffer_really_reads_back(monkeypatch) -> None:
    # Ефект, а не відсутність винятку: рядок мусить бути видимим у буфері.
    monkeypatch.setattr(context_engine, "_hearing_buffer", [])
    await _one_utterance(monkeypatch, mode=MODE_CONTINUOUS, transcript="увімкни світло")
    assert "увімкни світло" in context_engine.get_recent_hearing(window_s=60)

    await _one_utterance(
        monkeypatch, mode=MODE_WAKE_WORD, wake_phrase="фантом", transcript="це не до тебе",
    )
    assert context_engine.get_recent_hearing(window_s=60) == ["увімкни світло"]
