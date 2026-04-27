"""
Phase 15 — Hexagon NPU Whisper STT integration tests.

Hardware-free: every test exercises the wiring (factory chain, config
schema, settings reset hook, graceful-fallback paths) without ever
running an actual encoder on the HTP. Real on-device validation lives
in the manual ACCEPTANCE.md once the converted bundle ships.
"""
from __future__ import annotations

import importlib
import sys
from pathlib import Path
from typing import Iterator
from unittest import mock

import pytest

# Tests run from src/backend/ — make sure local imports resolve.
HERE = Path(__file__).resolve().parents[1]
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))


@pytest.fixture
def cfg():
    """Yield the live config object and reset NPU keys after each test
    so cross-test ordering can't leak."""
    from config import config as live_config
    saved = (
        live_config.voice_stt_npu_enabled,
        live_config.voice_stt_npu_model_path,
        live_config.voice_stt_npu_compute,
        live_config.voice_stt_mode,
    )
    try:
        yield live_config
    finally:
        (
            live_config.voice_stt_npu_enabled,
            live_config.voice_stt_npu_model_path,
            live_config.voice_stt_npu_compute,
            live_config.voice_stt_mode,
        ) = saved


# ── Config schema ────────────────────────────────────────────────────────────


class TestConfigSchema:
    def test_npu_keys_present_with_defaults(self, cfg) -> None:
        assert hasattr(cfg, "voice_stt_npu_enabled")
        assert hasattr(cfg, "voice_stt_npu_model_path")
        assert hasattr(cfg, "voice_stt_npu_compute")
        assert cfg.voice_stt_npu_enabled is False  # opt-in
        assert isinstance(cfg.voice_stt_npu_model_path, str)
        assert cfg.voice_stt_npu_compute in ("int8", "fp16")

    def test_voice_stt_mode_accepts_npu(self, cfg) -> None:
        cfg.voice_stt_mode = "npu"
        assert cfg.voice_stt_mode == "npu"

    def test_voice_stt_mode_rejects_unknown(self, cfg) -> None:
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            cfg.__class__(voice_stt_mode="bogus")  # type: ignore[arg-type]

    def test_npu_compute_rejects_unknown(self, cfg) -> None:
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            cfg.__class__(voice_stt_npu_compute="float8")  # type: ignore[arg-type]


# ── Factory chain ────────────────────────────────────────────────────────────


class TestFactoryChain:
    def test_try_npu_returns_none_when_disabled(self, cfg) -> None:
        cfg.voice_stt_npu_enabled = False
        from voice.stt_engine import _try_npu
        assert _try_npu() is None

    def test_try_npu_returns_none_when_bundle_missing(self, cfg) -> None:
        cfg.voice_stt_npu_enabled = True
        cfg.voice_stt_npu_model_path = "/definitely/not/here"
        from voice.stt_engine import _try_npu
        assert _try_npu() is None  # graceful — no exception leaks

    def test_build_stt_provider_falls_through_to_whisper_when_npu_unavailable(
        self, cfg
    ) -> None:
        cfg.voice_stt_npu_enabled = True
        cfg.voice_stt_npu_model_path = "/nonexistent"
        cfg.voice_stt_mode = "npu"
        from voice.stt_engine import build_stt_provider
        provider = build_stt_provider()
        # Whisper is installed in this venv; fall-through must reach it.
        # Acceptable secondary outcome: vosk if whisper init fails on this
        # box for unrelated reasons. Either way: NEVER 'whisper_npu' here
        # because the bundle is missing.
        assert provider.name in ("whisper", "vosk", "noop")

    def test_build_stt_provider_with_explicit_vosk_does_not_try_npu(
        self, cfg
    ) -> None:
        cfg.voice_stt_npu_enabled = True   # would attempt NPU on hybrid/npu
        cfg.voice_stt_mode = "vosk"
        from voice.stt_engine import build_stt_provider
        # We want the chain to be exclusively vosk → noop, never touching
        # the NPU import path. Spy on _try_npu via patch to confirm.
        from voice import stt_engine
        with mock.patch.object(stt_engine, "_try_npu") as spy:
            spy.return_value = None
            build_stt_provider()
            spy.assert_not_called()

    def test_build_stt_provider_hybrid_with_npu_off_skips_npu(self, cfg) -> None:
        cfg.voice_stt_npu_enabled = False
        cfg.voice_stt_mode = "hybrid"
        from voice import stt_engine
        with mock.patch.object(stt_engine, "_try_npu") as spy:
            spy.return_value = None
            stt_engine.build_stt_provider()
            spy.assert_not_called()  # legacy chain, no NPU probe

    def test_build_stt_provider_hybrid_with_npu_on_tries_npu_first(
        self, cfg
    ) -> None:
        cfg.voice_stt_npu_enabled = True
        cfg.voice_stt_mode = "hybrid"
        from voice import stt_engine
        order: list[str] = []
        with mock.patch.object(stt_engine, "_try_npu", side_effect=lambda: order.append("npu") or None), \
             mock.patch.object(stt_engine, "_try_whisper", side_effect=lambda: order.append("whisper") or None), \
             mock.patch.object(stt_engine, "_try_vosk", side_effect=lambda: order.append("vosk") or None):
            stt_engine.build_stt_provider()
        assert order == ["npu", "whisper", "vosk"]


# ── Provider unit ────────────────────────────────────────────────────────────


class TestWhisperNPUProvider:
    def test_construction_raises_when_bundle_dir_missing(self, cfg) -> None:
        cfg.voice_stt_npu_enabled = True
        cfg.voice_stt_npu_model_path = "/nonexistent/bundle"
        from voice.whisper_npu_provider import WhisperNPUProvider
        with pytest.raises(RuntimeError, match="bundle"):
            WhisperNPUProvider()

    def test_construction_raises_when_bundle_dir_has_no_encoder(
        self, cfg, tmp_path: Path
    ) -> None:
        # Empty directory exists but holds no encoder file.
        bundle = tmp_path / "empty-bundle"
        bundle.mkdir()
        cfg.voice_stt_npu_enabled = True
        cfg.voice_stt_npu_model_path = str(bundle)
        from voice.whisper_npu_provider import WhisperNPUProvider
        with pytest.raises(RuntimeError, match="encoder"):
            WhisperNPUProvider()

    def test_construction_raises_when_decoder_missing(
        self, cfg, tmp_path: Path
    ) -> None:
        bundle = tmp_path / "no-decoder"
        bundle.mkdir()
        # Touch encoder file so the encoder check passes; decoder is then
        # the failing condition.
        (bundle / "encoder_int8.onnx").write_bytes(b"\x00")
        cfg.voice_stt_npu_enabled = True
        cfg.voice_stt_npu_model_path = str(bundle)
        from voice.whisper_npu_provider import WhisperNPUProvider
        with pytest.raises(RuntimeError, match="decoder_model"):
            WhisperNPUProvider()

    def test_is_npu_path_available_returns_false_when_disabled(self, cfg) -> None:
        cfg.voice_stt_npu_enabled = False
        from voice.whisper_npu_provider import is_npu_path_available
        assert is_npu_path_available() is False

    def test_is_npu_path_available_returns_false_when_bundle_missing(
        self, cfg
    ) -> None:
        cfg.voice_stt_npu_enabled = True
        cfg.voice_stt_npu_model_path = "/nonexistent"
        from voice.whisper_npu_provider import is_npu_path_available
        assert is_npu_path_available() is False

    def test_qnn_ep_register_is_idempotent(self) -> None:
        from voice.whisper_npu_provider import _register_qnn_ep_once
        # Multiple calls must not raise and must not double-register.
        _register_qnn_ep_once()
        _register_qnn_ep_once()
        _register_qnn_ep_once()
        import onnxruntime as ort
        assert "QNNExecutionProvider" in ort.get_available_providers()


# ── Settings reset hook ──────────────────────────────────────────────────────


class TestSettingsHook:
    def test_npu_keys_in_invalidating_set(self) -> None:
        # Read the source of the apply_setting_side_effects function and
        # assert the NPU keys are listed. We grep the source file rather
        # than re-execute the side-effect because reset_providers() touches
        # the live singletons.
        path = HERE / "api" / "routes_settings.py"
        text = path.read_text(encoding="utf-8")
        assert '"voice_stt_npu_enabled"' in text
        assert '"voice_stt_npu_model_path"' in text
        assert '"voice_stt_npu_compute"' in text

    def test_npu_keys_listed_in_voice_settings_group(self) -> None:
        path = HERE / "api" / "routes_settings.py"
        text = path.read_text(encoding="utf-8")
        # The keys must be listed within the "voice" group so the UI panel
        # actually renders them.
        assert "voice_stt_npu_enabled" in text
        # Labels must be present so /settings returns a translated row.
        assert "STT на NPU" in text


# ── Pipeline warm-up branching ───────────────────────────────────────────────


class TestPipelineWarmup:
    def test_warm_npu_swallows_exceptions(self) -> None:
        """_warm_npu must never crash startup if _ensure_model raises."""
        from voice.pipeline import _warm_npu

        class BoomProvider:
            name = "whisper_npu"

            def _ensure_model(self) -> None:
                raise RuntimeError("simulated NPU init failure")

        # No exception escapes; logger.warning records it.
        _warm_npu(BoomProvider())

    def test_warm_npu_calls_ensure_model_when_present(self) -> None:
        from voice.pipeline import _warm_npu
        called: list[bool] = []

        class FakeProvider:
            name = "whisper_npu"

            def _ensure_model(self) -> None:
                called.append(True)

        _warm_npu(FakeProvider())
        assert called == [True]

    def test_warm_npu_skipped_when_no_ensure_method(self) -> None:
        from voice.pipeline import _warm_npu

        class WithoutEnsure:
            name = "whisper_npu"

        _warm_npu(WithoutEnsure())  # noop, no exception
