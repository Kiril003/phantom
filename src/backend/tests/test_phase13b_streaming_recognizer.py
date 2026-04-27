"""
Phase 13b — StreamingVoskRecognizer unit tests.

vosk.KaldiRecognizer is mocked so these tests do NOT need a model on
disk. The orchestrator integration tests (test_phase13b_streaming.py)
exercise the wiring end-to-end with a fake recognizer.
"""
from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest


class _FakeRec:
    """Minimal stand-in for vosk.KaldiRecognizer."""
    def __init__(self) -> None:
        self.partials: list[str] = []  # list of payloads to return
        self.commits: list[str] = []   # list of (committed_text, accept_returns_true)
        self.final_payload: str = ""
        self._partial_idx = 0
        self._commit_idx = 0
        self._next_is_commit = False

    def SetWords(self, *_):
        pass

    def AcceptWaveform(self, _bytes):
        # Caller queues whether this frame should commit via .queue_commit() / .queue_partial().
        if self._next_is_commit:
            self._next_is_commit = False
            return True
        return False

    def Result(self) -> str:
        if self._commit_idx < len(self.commits):
            out = self.commits[self._commit_idx]
            self._commit_idx += 1
            return out
        return "{}"

    def PartialResult(self) -> str:
        if self._partial_idx < len(self.partials):
            out = self.partials[self._partial_idx]
            self._partial_idx += 1
            return out
        return "{}"

    def FinalResult(self) -> str:
        return self.final_payload or "{}"

    def queue_partial(self, text: str) -> None:
        self.partials.append(json.dumps({"partial": text}))

    def queue_commit(self, text: str) -> None:
        self.commits.append(json.dumps({"text": text}))
        self._next_is_commit = True


@pytest.fixture
def recognizer_factory():
    fake = _FakeRec()
    with patch("vosk.KaldiRecognizer", return_value=fake):
        from voice.streaming_recognizer import StreamingVoskRecognizer
        rec = StreamingVoskRecognizer(
            vosk_model=MagicMock(),
            sample_rate=16_000,
            debounce_ms=0,  # zero debounce for predictable tests
        )
    return rec, fake


# ────────────────────────── feed() basics ────────────────────────────


def test_feed_empty_returns_none(recognizer_factory) -> None:
    rec, _ = recognizer_factory
    assert rec.feed(b"") is None


def test_feed_returns_partial_with_new_text(recognizer_factory) -> None:
    rec, fake = recognizer_factory
    fake.queue_partial("при")
    ev = rec.feed(b"\x01\x02" * 100)
    assert ev is not None
    assert ev.text == "при"
    assert ev.is_committed is False


def test_feed_returns_none_when_text_unchanged(recognizer_factory) -> None:
    rec, fake = recognizer_factory
    fake.queue_partial("при")
    fake.queue_partial("при")
    ev1 = rec.feed(b"\x01" * 100)
    ev2 = rec.feed(b"\x01" * 100)
    assert ev1 is not None and ev1.text == "при"
    assert ev2 is None  # same text → no event


def test_stability_counter_increments_on_unchanged_text(recognizer_factory) -> None:
    rec, fake = recognizer_factory
    fake.queue_partial("привіт")
    fake.queue_partial("привіт")
    fake.queue_partial("привіт")
    rec.feed(b"\x00" * 50)  # emit 1
    rec.feed(b"\x00" * 50)  # silent (stability=2)
    rec.feed(b"\x00" * 50)  # silent (stability=3)
    assert rec._stability == 3


def test_stability_resets_on_text_change(recognizer_factory) -> None:
    rec, fake = recognizer_factory
    fake.queue_partial("при")
    fake.queue_partial("при")
    fake.queue_partial("привіт")
    rec.feed(b"\x00" * 50)
    rec.feed(b"\x00" * 50)
    ev = rec.feed(b"\x00" * 50)
    assert ev is not None
    assert ev.text == "привіт"
    assert ev.stability == 1


# ────────────────── committed (AcceptWaveform True) ─────────────────────


def test_commit_event_is_marked(recognizer_factory) -> None:
    rec, fake = recognizer_factory
    fake.queue_commit("привіт")
    ev = rec.feed(b"\x00" * 50)
    assert ev is not None
    assert ev.is_committed is True
    assert ev.text == "привіт"


def test_commit_then_partial_concatenates(recognizer_factory) -> None:
    rec, fake = recognizer_factory
    fake.queue_commit("привіт")
    fake.queue_partial("як справ")
    ev1 = rec.feed(b"\x00" * 50)
    ev2 = rec.feed(b"\x00" * 50)
    assert ev1.text == "привіт"
    assert ev2.text == "привіт як справ"


# ───────────────────────── debounce ─────────────────────────────────────


def test_debounce_swallows_new_text_within_window() -> None:
    fake = _FakeRec()
    with patch("vosk.KaldiRecognizer", return_value=fake):
        from voice.streaming_recognizer import StreamingVoskRecognizer
        rec = StreamingVoskRecognizer(
            vosk_model=MagicMock(),
            sample_rate=16_000,
            debounce_ms=500,  # 500 ms window
        )
    fake.queue_partial("при")
    fake.queue_partial("привіт")  # arrives < 500ms later
    ev1 = rec.feed(b"\x00" * 50)
    ev2 = rec.feed(b"\x00" * 50)
    assert ev1 is not None
    # Second call within debounce: cached but suppressed.
    assert ev2 is None


def test_debounce_committed_event_bypasses() -> None:
    """Committed chunks must always be emitted regardless of debounce."""
    fake = _FakeRec()
    with patch("vosk.KaldiRecognizer", return_value=fake):
        from voice.streaming_recognizer import StreamingVoskRecognizer
        rec = StreamingVoskRecognizer(
            vosk_model=MagicMock(),
            sample_rate=16_000,
            debounce_ms=500,
        )
    # Frame 1: emit a regular partial so the debounce timer starts.
    fake.queue_partial("при")
    ev1 = rec.feed(b"\x00" * 50)
    assert ev1 is not None and ev1.is_committed is False
    # Frame 2: arrives quickly (well within 500 ms). It is a commit, so
    # it must NOT be suppressed by debounce.
    fake.queue_commit("привіт")
    ev2 = rec.feed(b"\x00" * 50)
    assert ev2 is not None
    assert ev2.is_committed is True
    assert ev2.text == "привіт"


# ──────────────────────────── finalise ──────────────────────────────────


def test_finalise_returns_text_and_confidence(recognizer_factory) -> None:
    rec, fake = recognizer_factory
    fake.queue_partial("привіт")
    rec.feed(b"\x00" * 50)
    fake.final_payload = json.dumps({
        "text": "привіт",
        "result": [{"word": "привіт", "conf": 0.92}],
    })
    final = rec.finalise()
    assert final.text == "привіт"
    assert final.confidence == pytest.approx(0.92)


def test_finalise_zero_confidence_for_silent_input(recognizer_factory) -> None:
    rec, fake = recognizer_factory
    fake.final_payload = "{}"
    final = rec.finalise()
    assert final.text == ""
    assert final.confidence == 0.0


def test_finalise_after_committed_appends_tail(recognizer_factory) -> None:
    rec, fake = recognizer_factory
    fake.queue_commit("привіт")
    rec.feed(b"\x00" * 50)
    fake.final_payload = json.dumps({
        "text": "як справи",
        "result": [
            {"word": "як", "conf": 0.8},
            {"word": "справи", "conf": 0.9},
        ],
    })
    final = rec.finalise()
    assert final.text == "привіт як справи"
    assert final.confidence == pytest.approx(0.85)


# ───────────────────────── safety / robustness ──────────────────────────


def test_invalid_json_swallowed(recognizer_factory) -> None:
    rec, fake = recognizer_factory
    fake.partials.append("not-json{")  # raw bad payload
    fake._partial_idx = 0
    ev = rec.feed(b"\x00" * 50)
    # Bad JSON → empty text → no event.
    assert ev is None
