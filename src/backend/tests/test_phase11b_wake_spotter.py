"""
Phase 11b — Wake-word spotter unit tests.

Most tests use a ``_FakeRecognizer`` that lets us script what Vosk
"hears" without loading the real acoustic model. One optional
integration test loads the real Vosk UK model and verifies the
KaldiRecognizer builds cleanly with the restricted grammar and that
*no* second vosk.Model copy is created — critical RAM invariant from
the Phase 11a audit.
"""
from __future__ import annotations

import json
import sys
import types
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from voice.wake_spotter import WakeResult, WakeSpotter, _build_grammar


# ──────────────────── helpers ────────────────────


class _FakeRecognizer:
    """Scriptable stand-in for vosk.KaldiRecognizer. Caller queues
    ``Result`` / ``FinalResult`` JSON payloads and an optional bool
    that AcceptWaveform should return. Records calls to let tests
    assert ``SetWords`` was enabled."""

    def __init__(self) -> None:
        self._boundaries: list[bool] = []
        self._result_payloads: list[str] = []
        self._final_payloads: list[str] = []
        self.set_words_called_with: list[bool] = []
        self.accept_calls: list[bytes] = []

    def queue_result(self, payload: str, *, boundary: bool = True) -> None:
        self._boundaries.append(boundary)
        self._result_payloads.append(payload)

    def queue_final(self, payload: str) -> None:
        self._final_payloads.append(payload)

    def SetWords(self, flag: bool) -> None:
        self.set_words_called_with.append(flag)

    def AcceptWaveform(self, pcm: bytes) -> bool:
        self.accept_calls.append(pcm)
        return self._boundaries.pop(0) if self._boundaries else False

    def Result(self) -> str:
        return self._result_payloads.pop(0) if self._result_payloads else "{}"

    def FinalResult(self) -> str:
        return (
            self._final_payloads.pop(0)
            if self._final_payloads
            else (self._result_payloads.pop(0) if self._result_payloads else "{}")
        )


class _FakeVoskModule:
    """Injected into ``sys.modules['vosk']`` so WakeSpotter's lazy
    ``import vosk`` returns a controllable recogniser factory."""

    def __init__(self) -> None:
        self.instances: list[_FakeRecognizer] = []
        self.constructor_args: list[tuple] = []

    def KaldiRecognizer(self, model, sample_rate: int, grammar: str):
        self.constructor_args.append((model, sample_rate, grammar))
        rec = _FakeRecognizer()
        self.instances.append(rec)
        return rec


@pytest.fixture
def fake_vosk(monkeypatch):
    fake = _FakeVoskModule()
    module = types.ModuleType("vosk")
    module.KaldiRecognizer = fake.KaldiRecognizer
    # Keep other attrs (SetLogLevel etc.) as no-ops in case anything else
    # imports vosk in the same process.
    module.SetLogLevel = lambda level: None
    monkeypatch.setitem(sys.modules, "vosk", module)
    yield fake


# ──────────────────── grammar builder ────────────────────


class TestBuildGrammar:
    def test_wraps_wake_words_with_unk_filler(self) -> None:
        grammar = _build_grammar(["фантом"])
        assert json.loads(grammar) == ["фантом", "[unk]"]

    def test_dedupes_and_sorts(self) -> None:
        grammar = _build_grammar(["фантом", "Фантом", "phantom"])
        tokens = json.loads(grammar)
        # unk always present; wake tokens deduped and lowercased
        assert "[unk]" in tokens
        assert tokens.count("фантом") == 1
        assert "phantom" in tokens

    def test_rejects_empty_list(self) -> None:
        with pytest.raises(ValueError, match="at least one"):
            _build_grammar([])

    def test_rejects_all_whitespace(self) -> None:
        with pytest.raises(ValueError, match="at least one"):
            _build_grammar(["  ", ""])


# ──────────────────── WakeSpotter construction ────────────────────


class TestWakeSpotterConstruction:
    def test_builds_recogniser_with_restricted_grammar(self, fake_vosk) -> None:
        model = MagicMock(name="vosk_model")
        WakeSpotter(model, wake_words="фантом", sample_rate=16_000)
        assert len(fake_vosk.constructor_args) == 1
        ctor_model, ctor_rate, ctor_grammar = fake_vosk.constructor_args[0]
        assert ctor_model is model
        assert ctor_rate == 16_000
        assert json.loads(ctor_grammar) == ["фантом", "[unk]"]
        # SetWords(True) called so we get per-word confidence
        assert fake_vosk.instances[-1].set_words_called_with == [True]

    def test_string_wake_words_split_by_comma(self, fake_vosk) -> None:
        model = MagicMock()
        spotter = WakeSpotter(model, wake_words="фантом, phantom, привіт")
        assert set(spotter.wake_tokens) == {"фантом", "phantom", "привіт"}

    def test_rejects_empty_wake_words(self, fake_vosk) -> None:
        model = MagicMock()
        with pytest.raises(ValueError, match="at least one"):
            WakeSpotter(model, wake_words="")


# ──────────────────── WakeSpotter.process ────────────────────


class TestWakeSpotterProcess:
    def _make(self, fake_vosk, **kwargs) -> tuple[WakeSpotter, _FakeRecognizer]:
        model = MagicMock(name="vosk_model")
        spotter = WakeSpotter(model, **kwargs)
        return spotter, fake_vosk.instances[-1]

    def test_odd_length_bytes_raises(self, fake_vosk) -> None:
        spotter, _ = self._make(fake_vosk)
        with pytest.raises(ValueError, match="even"):
            spotter.process(b"\x00\x01\x02")

    def test_empty_bytes_returns_none(self, fake_vosk) -> None:
        spotter, rec = self._make(fake_vosk)
        assert spotter.process(b"") is None
        assert rec.accept_calls == []  # didn't even touch Vosk

    def test_mid_utterance_returns_none(self, fake_vosk) -> None:
        spotter, rec = self._make(fake_vosk)
        # No boundary queued → AcceptWaveform returns False
        assert spotter.process(b"\x00\x00" * 160) is None
        assert len(rec.accept_calls) == 1

    def test_boundary_with_phantom_and_high_conf_matches(self, fake_vosk) -> None:
        spotter, rec = self._make(fake_vosk, confidence_min=0.6)
        rec.queue_result(json.dumps({
            "text": "фантом",
            "result": [{"word": "фантом", "conf": 0.92}],
        }))
        result = spotter.process(b"\x00\x00" * 160)
        assert isinstance(result, WakeResult)
        assert result.matched is True
        assert result.transcript == "фантом"
        assert result.confidence == pytest.approx(0.92)

    def test_boundary_with_phantom_but_low_conf_does_not_match(self, fake_vosk) -> None:
        spotter, rec = self._make(fake_vosk, confidence_min=0.6)
        rec.queue_result(json.dumps({
            "text": "фантом",
            "result": [{"word": "фантом", "conf": 0.30}],
        }))
        result = spotter.process(b"\x00\x00" * 160)
        assert result is not None
        assert result.matched is False
        assert result.confidence == pytest.approx(0.30)

    def test_boundary_without_phantom_does_not_match(self, fake_vosk) -> None:
        spotter, rec = self._make(fake_vosk)
        rec.queue_result(json.dumps({
            "text": "[unk] [unk] [unk]",
            "result": [
                {"word": "[unk]", "conf": 0.9},
                {"word": "[unk]", "conf": 0.9},
                {"word": "[unk]", "conf": 0.9},
            ],
        }))
        result = spotter.process(b"\x00\x00" * 160)
        assert result is not None
        assert result.matched is False
        # All-[unk] transcripts compute confidence = 0.0 (unk entries skipped)
        assert result.confidence == 0.0

    def test_boundary_mixed_phantom_and_unk_match(self, fake_vosk) -> None:
        """A real-world match: 'фантом який час' where Vosk collapses
        'який час' to [unk] [unk]. Confidence should be driven by the
        фантом word, not dragged down by the [unk]s."""
        spotter, rec = self._make(fake_vosk, confidence_min=0.6)
        rec.queue_result(json.dumps({
            "text": "фантом [unk] [unk]",
            "result": [
                {"word": "фантом", "conf": 0.85},
                {"word": "[unk]", "conf": 0.5},
                {"word": "[unk]", "conf": 0.4},
            ],
        }))
        result = spotter.process(b"\x00\x00" * 160)
        assert result is not None
        assert result.matched is True
        assert result.confidence == pytest.approx(0.85)

    def test_rebuilds_recogniser_after_boundary(self, fake_vosk) -> None:
        spotter, rec = self._make(fake_vosk)
        rec.queue_result(json.dumps({"text": "", "result": []}))
        spotter.process(b"\x00\x00" * 160)
        # Rebuild creates a second recogniser, sharing the same model.
        assert len(fake_vosk.instances) == 2
        assert fake_vosk.constructor_args[0][0] is fake_vosk.constructor_args[1][0]

    def test_invalid_json_from_vosk_is_handled(self, fake_vosk) -> None:
        spotter, rec = self._make(fake_vosk)
        rec.queue_result("{not json")
        result = spotter.process(b"\x00\x00" * 160)
        assert result is None


# ──────────────────── WakeSpotter.finalise & reset ────────────────────


class TestWakeSpotterFinaliseReset:
    def test_finalise_returns_result_and_rebuilds(self, fake_vosk) -> None:
        model = MagicMock()
        spotter = WakeSpotter(model)
        rec = fake_vosk.instances[-1]
        rec.queue_final(json.dumps({
            "text": "фантом",
            "result": [{"word": "фантом", "conf": 0.8}],
        }))
        result = spotter.finalise()
        assert result is not None
        assert result.matched is True
        assert len(fake_vosk.instances) == 2

    def test_reset_rebuilds_without_result(self, fake_vosk) -> None:
        model = MagicMock()
        spotter = WakeSpotter(model)
        spotter.reset()
        assert len(fake_vosk.instances) == 2
        _, _, grammar = fake_vosk.constructor_args[-1]
        assert json.loads(grammar) == ["фантом", "[unk]"]


# ──────────────────── RAM invariant (integration-ish) ────────────────────


class TestWakeSpotterRAMInvariant:
    """The Phase 11a audit's critical invariant: WakeSpotter must NOT
    construct a second vosk.Model. This test shows the construction
    path only touches KaldiRecognizer."""

    def test_constructor_does_not_touch_vosk_model(self, fake_vosk) -> None:
        model = MagicMock(name="shared_vosk_model")
        # If the spotter tried to call e.g. vosk.Model(...), our fake
        # module has no such attribute — it would AttributeError.
        WakeSpotter(model)
        # The passed-in model appears as the first arg of KaldiRecognizer
        # but was never *used* to construct anything new.
        assert fake_vosk.constructor_args[0][0] is model
        model.assert_not_called()  # no methods called on the mock itself


# ──────────────────── Real Vosk model smoke test (optional) ───────────


VOSK_MODEL_DIR = (
    Path(__file__).resolve().parent.parent
    / "voice" / "models" / "vosk-model-uk-v3"
)


class TestRealVoskSmoke:
    """Loads the real Vosk UK model and verifies the WakeSpotter
    KaldiRecognizer builds cleanly against it. Skipped when the model
    isn't available (CI / clean clone)."""

    def test_real_model_builds_recognizer(self) -> None:
        if not VOSK_MODEL_DIR.is_dir():
            pytest.skip(f"Real Vosk model not present at {VOSK_MODEL_DIR}")
        import vosk

        vosk.SetLogLevel(-1)
        model = vosk.Model(str(VOSK_MODEL_DIR))
        spotter = WakeSpotter(model, wake_words="фантом", confidence_min=0.6)
        # Feed 20 ms of silence; must not raise, and the utterance isn't
        # complete so no WakeResult emerges.
        silence_20ms = b"\x00\x00" * 320
        for _ in range(10):
            spotter.process(silence_20ms)
        # Force finalise — empty transcript, no match.
        result = spotter.finalise()
        assert result is not None
        assert result.matched is False
        assert result.transcript == ""
