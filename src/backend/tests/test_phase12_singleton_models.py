"""
Phase 12.0 — Singleton VAD + voice-model preload tests.

Verifies:
  * ``get_vad_session`` constructs ``ort.InferenceSession`` exactly once
    across many calls with the same path (Bug 2 fix).
  * ``reset_vad_session`` drops the cache so the next call rebuilds.
  * ``preload_voice_models`` returns a status map covering vad / vosk /
    whisper without raising even when underlying models are missing.
"""
from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase12-singletons")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")


@pytest.fixture(autouse=True)
def _reset_vad():
    """Each test starts with a clean VAD singleton so order doesn't matter."""
    from voice.vad import reset_vad_session
    reset_vad_session()
    yield
    reset_vad_session()


class TestVadSessionSingleton:
    def test_two_calls_same_path_share_one_session(self) -> None:
        """The whole point of the singleton: don't reload the ONNX graph
        on every WS connection. We patch ort.InferenceSession to count
        constructor invocations."""
        from voice import vad as vad_mod

        with patch.object(vad_mod.ort, "InferenceSession") as mock_ctor:
            mock_ctor.return_value = MagicMock(name="fake_session")
            s1 = vad_mod.get_vad_session("/fake/path/silero.onnx")
            s2 = vad_mod.get_vad_session("/fake/path/silero.onnx")
            assert s1 is s2, "Singleton must return the same instance"
            assert mock_ctor.call_count == 1, (
                "ort.InferenceSession must be called exactly once for "
                "repeat acquires of the same path"
            )

    def test_call_with_different_path_rebuilds(self) -> None:
        """A path change is rare (model location is fixed) but if it
        happens the cache must rebuild rather than silently returning a
        stale session."""
        from voice import vad as vad_mod

        with patch.object(vad_mod.ort, "InferenceSession") as mock_ctor:
            sess_a = MagicMock(name="sess_a")
            sess_b = MagicMock(name="sess_b")
            mock_ctor.side_effect = [sess_a, sess_b]
            s1 = vad_mod.get_vad_session("/path/a.onnx")
            s2 = vad_mod.get_vad_session("/path/b.onnx")
            assert s1 is sess_a
            assert s2 is sess_b
            assert mock_ctor.call_count == 2

    def test_reset_drops_cache(self) -> None:
        from voice import vad as vad_mod

        with patch.object(vad_mod.ort, "InferenceSession") as mock_ctor:
            mock_ctor.return_value = MagicMock(name="sess")
            vad_mod.get_vad_session("/path/x.onnx")
            assert mock_ctor.call_count == 1
            vad_mod.reset_vad_session()
            vad_mod.get_vad_session("/path/x.onnx")
            assert mock_ctor.call_count == 2, (
                "After reset, the next acquire must hit the constructor again"
            )

    def test_logs_loading_message_only_once(self, caplog) -> None:
        """Gate 5 — backend log shows 'Loading Silero VAD' exactly ONCE
        per process. If we acquire 5 times, the log line still fires once."""
        import logging
        from voice import vad as vad_mod

        with patch.object(vad_mod.ort, "InferenceSession") as mock_ctor:
            mock_ctor.return_value = MagicMock(name="sess")
            with caplog.at_level(logging.INFO, logger="voice.vad"):
                for _ in range(5):
                    vad_mod.get_vad_session("/path/once.onnx")
            loading_lines = [
                rec for rec in caplog.records
                if "Loading Silero VAD ONNX model" in rec.getMessage()
            ]
            assert len(loading_lines) == 1, (
                f"Expected exactly 1 loading log line, got {len(loading_lines)}"
            )


class TestPreloadVoiceModels:
    def test_returns_status_map(self) -> None:
        from voice.pipeline import preload_voice_models

        statuses = preload_voice_models(silero_vad_path=None)
        assert isinstance(statuses, dict)
        # Must always touch all three keys so the lifespan log is
        # complete even when individual loads fail.
        assert "silero_vad" in statuses
        assert "vosk" in statuses
        assert "whisper" in statuses

    def test_silero_path_missing_is_skipped_not_failed(self) -> None:
        from voice.pipeline import preload_voice_models

        statuses = preload_voice_models(
            silero_vad_path="/definitely/does/not/exist.onnx"
        )
        assert "skipped" in statuses["silero_vad"]
        # Specifically must not raise — the lifespan must be tolerant of
        # a missing model in dev environments without the artifact.

    def test_silero_path_present_loads_session(self, tmp_path) -> None:
        """When the path exists and ort.InferenceSession is mocked, the
        helper reports loaded."""
        from voice import vad as vad_mod
        from voice.pipeline import preload_voice_models

        fake_model = tmp_path / "silero.onnx"
        fake_model.write_bytes(b"\x00\x00")
        with patch.object(vad_mod.ort, "InferenceSession") as mock_ctor:
            mock_ctor.return_value = MagicMock(name="sess")
            statuses = preload_voice_models(silero_vad_path=str(fake_model))
        assert statuses["silero_vad"] == "loaded"

    def test_does_not_raise_when_all_subsystems_unavailable(self) -> None:
        """Even if every model load throws, the helper must return a
        status map — the lifespan continues regardless."""
        from voice.pipeline import preload_voice_models

        with patch("voice.pipeline.get_vosk_model", side_effect=RuntimeError("no vosk")):
            statuses = preload_voice_models(silero_vad_path=None)
        assert "failed" in statuses["vosk"]


class TestVadResetWiredIntoResetProviders:
    """reset_providers() should drop the VAD session too — otherwise a
    voice_* setting change wouldn't pick up a new model path."""

    def test_reset_providers_clears_vad_session(self) -> None:
        from voice import vad as vad_mod
        from voice.pipeline import reset_providers

        with patch.object(vad_mod.ort, "InferenceSession") as mock_ctor:
            mock_ctor.return_value = MagicMock(name="sess")
            vad_mod.get_vad_session("/path/y.onnx")
            assert vad_mod._vad_session is not None
            reset_providers()
            assert vad_mod._vad_session is None
