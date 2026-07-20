"""Day-4 Wave-1 — Block ID-1: speaker_id slot on STTResult (ADR-ID-001).

Closes audit-2026-05-01-day4 finding U6-ID-* schema gap (no slot for
the Day-5 ML speaker-resolver output). Implements
`docs/architecture/identity-recognition.md` §1.

The contract:

* `STTResult.speaker_id` defaults to `None`. Construction with positional
  args is unchanged (`speaker_id` is keyword-only via dataclass default
  position) — every existing call site keeps working.
* `to_dict()` OMITS the `speaker_id` key when the value is `None`. This
  is the back-compat invariant per ADR-ID-001 §35: legacy WS clients
  parsing the frame must not see a new key in the 99 % case.
* `to_dict()` INCLUDES the key when set to a string. Day-5 ML resolver
  populates this; clients that opt in get the speaker pill.
* All five existing engine literals continue to work without speaker_id.
"""
from __future__ import annotations

import pytest


# ─────────────────────────────────────────────── default behaviour ──


class TestSpeakerIdDefault:
    def test_speaker_id_defaults_to_none(self):
        from voice.stt_engine import STTResult

        r = STTResult(text="hi", confidence=1.0, engine="whisper", language="uk")
        assert r.speaker_id is None

    def test_existing_positional_construction_still_works(self):
        """Pin: a future refactor that re-orders dataclass fields would
        silently break every existing `STTResult(text=..., confidence=...,
        engine=..., language=...)` call."""
        from voice.stt_engine import STTResult

        r = STTResult(
            text="hi",
            confidence=0.95,
            engine="whisper",
            language="uk",
        )
        assert r.text == "hi"
        assert r.confidence == 0.95
        assert r.engine == "whisper"
        assert r.language == "uk"
        assert r.engine_error is None
        assert r.speaker_id is None

    @pytest.mark.parametrize(
        "engine",
        ["whisper", "vosk", "noop", "whisper_npu"],
    )
    def test_all_engines_accept_speaker_id(self, engine):
        from voice.stt_engine import STTResult

        r = STTResult(
            text="x",
            confidence=1.0,
            engine=engine,
            language="uk",
            speaker_id="user-uuid-123",
        )
        assert r.speaker_id == "user-uuid-123"


# ─────────────────────────────────────────────── to_dict shape ──


class TestToDictShape:
    def test_to_dict_omits_speaker_id_when_none(self):
        """ADR-ID-001 §35: WS frame size unchanged for the 99 % case
        (no enrolled speakers). Legacy parsers that don't know about
        the field stay correct."""
        from voice.stt_engine import STTResult

        r = STTResult(text="hi", confidence=1.0, engine="whisper", language="uk")
        d = r.to_dict()

        assert "speaker_id" not in d, (
            "ID-1 regression: to_dict carried speaker_id=null on the wire. "
            "Day-4 invariant requires omission for back-compat."
        )

    def test_to_dict_includes_speaker_id_when_set(self):
        """Once Day-5 wires the resolver, the field MUST appear."""
        from voice.stt_engine import STTResult

        r = STTResult(
            text="hi",
            confidence=1.0,
            engine="whisper",
            language="uk",
            speaker_id="0c1e2f3a-4b5c-6d7e-8f9a-0b1c2d3e4f50",
        )
        d = r.to_dict()

        assert d["speaker_id"] == "0c1e2f3a-4b5c-6d7e-8f9a-0b1c2d3e4f50"

    def test_to_dict_keeps_existing_keys(self):
        """Sanity: the four canonical keys are still present and ID-1
        only adds — never removes — fields."""
        from voice.stt_engine import STTResult

        r = STTResult(text="hi", confidence=1.0, engine="whisper", language="uk")
        d = r.to_dict()

        assert set(d.keys()) == {"text", "confidence", "engine", "language"}

    def test_to_dict_with_engine_error_and_speaker_id_both(self):
        """Both optional keys can co-exist on the wire — operator may
        see a 503-class error AND a resolver answer if the resolver
        ran before the failure."""
        from voice.stt_engine import STTResult

        r = STTResult(
            text="",
            confidence=0.0,
            engine="whisper_npu",
            language="uk",
            engine_error="qnn_oom",
            speaker_id="some-uuid",
        )
        d = r.to_dict()

        assert d["engine_error"] == "qnn_oom"
        assert d["speaker_id"] == "some-uuid"


# ─────────────────────────────────────────────── back-compat with day-2 ──


class TestDay2BackCompat:
    def test_day2_b4_engine_error_omission_preserved(self):
        """The audit-2026-04-28 B-4 invariant — `engine_error` omitted
        when None — still holds. ID-1 must not regress that."""
        from voice.stt_engine import STTResult

        r = STTResult(text="hi", confidence=1.0, engine="whisper", language="uk")
        d = r.to_dict()

        assert "engine_error" not in d
