"""
Phase 13a quick-wins — config defaults & literal expansions.

13a.1: voice_stt_whisper_model default lowered "medium" → "small" so the
       always-on path on Radxa CPU finalises in ~500-900 ms instead of
       1.5-3 s. "tiny" added to the Literal as a last-resort fast option.
"""
from __future__ import annotations

from typing import get_args

import pytest

from config import PhantomConfig


def test_whisper_model_default_is_small() -> None:
    cfg = PhantomConfig(_env_file=None)
    assert cfg.voice_stt_whisper_model == "small"


def test_whisper_model_literal_includes_tiny() -> None:
    """tiny must be a valid value so operators can opt into the cheapest model."""
    field = PhantomConfig.model_fields["voice_stt_whisper_model"]
    allowed = set(get_args(field.annotation))
    assert "tiny" in allowed
    # Existing options must remain so the dropdown doesn't lose entries.
    assert {"tiny", "small", "medium", "large-v3"}.issubset(allowed)


def test_whisper_model_tiny_accepted(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VOICE_STT_WHISPER_MODEL", "tiny")
    cfg = PhantomConfig(_env_file=None)
    assert cfg.voice_stt_whisper_model == "tiny"


def test_whisper_model_invalid_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VOICE_STT_WHISPER_MODEL", "huge")
    with pytest.raises(Exception):  # pydantic.ValidationError
        PhantomConfig(_env_file=None)


# ──────────── 13a.3 — backend energy fast-path skip ─────────────────


def test_voice_energy_skip_threshold_default() -> None:
    cfg = PhantomConfig(_env_file=None)
    # Default must be > 0 so the fast-path is enabled out of the box.
    assert cfg.voice_energy_skip_threshold > 0.0
    # …but small enough that whisper-level speech (peak ≈ 0.1+) is never
    # skipped accidentally.
    assert cfg.voice_energy_skip_threshold < 0.05


def test_peak_energy_normalised_silence_below_threshold() -> None:
    from voice.always_on import _peak_energy_normalised
    silence = b"\x00\x00" * 480  # 30 ms of pure zero
    assert _peak_energy_normalised(silence) == 0.0


def test_peak_energy_normalised_loud_above_threshold() -> None:
    from voice.always_on import _peak_energy_normalised
    # Half-scale s16 sample == 0.5 normalised
    import struct
    loud = struct.pack("<h", 16384) * 480
    val = _peak_energy_normalised(loud)
    assert 0.49 < val < 0.51


def test_peak_energy_normalised_empty() -> None:
    from voice.always_on import _peak_energy_normalised
    assert _peak_energy_normalised(b"") == 0.0


def test_orchestrator_skips_silent_frame_when_idle() -> None:
    """Tihi kadry ne mayut' vyklikaty Silero VAD inference."""
    import asyncio
    from unittest.mock import MagicMock
    from voice.always_on import AlwaysOnOrchestrator, MODE_CONTINUOUS

    fake_vad = MagicMock()
    fake_vad.process = MagicMock(return_value=[])
    fake_wake = MagicMock()

    orch = AlwaysOnOrchestrator(
        vad=fake_vad,
        wake_spotter=fake_wake,
        vosk_model=None,
        mode=MODE_CONTINUOUS,
        wake_phrase="фантом",
        silence_timeout_ms=800,
        energy_skip_threshold=0.005,
    )
    silence = b"\x00\x00" * 480

    asyncio.run(orch.process_frame(silence))

    # vad.process must NOT have been called when idle + silent + threshold>0
    fake_vad.process.assert_not_called()


def test_orchestrator_does_not_skip_when_threshold_zero() -> None:
    """Threshold 0.0 must disable the fast-path (legacy behaviour)."""
    import asyncio
    from unittest.mock import MagicMock
    from voice.always_on import AlwaysOnOrchestrator, MODE_CONTINUOUS

    fake_vad = MagicMock()
    fake_vad.process = MagicMock(return_value=[])
    fake_wake = MagicMock()

    orch = AlwaysOnOrchestrator(
        vad=fake_vad,
        wake_spotter=fake_wake,
        vosk_model=None,
        mode=MODE_CONTINUOUS,
        wake_phrase="фантом",
        silence_timeout_ms=800,
        energy_skip_threshold=0.0,  # disabled
    )
    silence = b"\x00\x00" * 480

    asyncio.run(orch.process_frame(silence))

    fake_vad.process.assert_called_once()


# ──────────── 13a.4 — model warm-up at startup ─────────────────────


def test_warm_vosk_calls_accept_and_finalresult() -> None:
    from unittest.mock import MagicMock, patch

    fake_rec = MagicMock()
    fake_rec.AcceptWaveform = MagicMock(return_value=False)
    fake_rec.FinalResult = MagicMock(return_value="{}")

    with patch("vosk.KaldiRecognizer", return_value=fake_rec):
        from voice.pipeline import _warm_vosk
        _warm_vosk(model=MagicMock())

    fake_rec.AcceptWaveform.assert_called_once()
    fake_rec.FinalResult.assert_called_once()


def test_warm_vosk_swallows_failures() -> None:
    """A warm-up failure must NOT propagate — startup keeps going."""
    from unittest.mock import patch

    with patch("vosk.KaldiRecognizer", side_effect=RuntimeError("kaboom")):
        from voice.pipeline import _warm_vosk
        # If this raises, the test fails.
        _warm_vosk(model=object())


def test_warm_whisper_drains_segments() -> None:
    from unittest.mock import MagicMock

    fake_segment = object()
    fake_provider = MagicMock()
    fake_provider._model = MagicMock()
    fake_provider._model.transcribe = MagicMock(
        return_value=(iter([fake_segment]), MagicMock())
    )

    from voice.pipeline import _warm_whisper
    _warm_whisper(fake_provider)

    fake_provider._model.transcribe.assert_called_once()
    # Confirm the silence call shape
    call_args = fake_provider._model.transcribe.call_args
    kwargs = call_args.kwargs
    assert kwargs["language"] == "uk"
    assert kwargs["beam_size"] == 1


def test_warm_whisper_swallows_failures() -> None:
    from unittest.mock import MagicMock

    fake_provider = MagicMock()
    fake_provider._model = MagicMock()
    fake_provider._model.transcribe = MagicMock(side_effect=RuntimeError("kaboom"))

    from voice.pipeline import _warm_whisper
    # Must not raise.
    _warm_whisper(fake_provider)


def test_orchestrator_processes_loud_frame_when_idle() -> None:
    """Hlasnye kadry mayut' vyklikati VAD navit' z fast-path threshold."""
    import asyncio
    import struct
    from unittest.mock import MagicMock
    from voice.always_on import AlwaysOnOrchestrator, MODE_CONTINUOUS

    fake_vad = MagicMock()
    fake_vad.process = MagicMock(return_value=[])
    fake_wake = MagicMock()

    orch = AlwaysOnOrchestrator(
        vad=fake_vad,
        wake_spotter=fake_wake,
        vosk_model=None,
        mode=MODE_CONTINUOUS,
        wake_phrase="фантом",
        silence_timeout_ms=800,
        energy_skip_threshold=0.005,
    )
    loud = struct.pack("<h", 16384) * 480  # peak 0.5 — well above 0.005

    asyncio.run(orch.process_frame(loud))

    fake_vad.process.assert_called_once()
