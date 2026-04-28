"""
Phase 15b — MMS-1B NPU instant-tier STT integration tests.

Hardware-free: every test exercises the wiring (factory chain, config
schema, settings reset hook, graceful-fallback paths, CTC decode logic)
without ever running an actual encoder on the HTP. Real on-device
validation lives in the manual ACCEPTANCE.md once the per-language
bundle ships.
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest import mock

import numpy as np
import pytest

HERE = Path(__file__).resolve().parents[1]
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))


@pytest.fixture
def cfg():
    """Snapshot+restore every MMS-related config key around each test so
    cross-test ordering can't bleed."""
    from config import config as live_config
    saved = (
        live_config.voice_stt_mms_enabled,
        live_config.voice_stt_mms_lang,
        live_config.voice_stt_mms_bundle_dir,
        live_config.voice_stt_mms_compute,
        live_config.voice_stt_mms_refine_with_turbo,
        live_config.voice_stt_mms_refine_confidence_min,
        live_config.voice_stt_mode,
        live_config.voice_stt_npu_enabled,
    )
    try:
        yield live_config
    finally:
        (
            live_config.voice_stt_mms_enabled,
            live_config.voice_stt_mms_lang,
            live_config.voice_stt_mms_bundle_dir,
            live_config.voice_stt_mms_compute,
            live_config.voice_stt_mms_refine_with_turbo,
            live_config.voice_stt_mms_refine_confidence_min,
            live_config.voice_stt_mode,
            live_config.voice_stt_npu_enabled,
        ) = saved


# ── Config schema ────────────────────────────────────────────────────────────


class TestConfigSchema:
    def test_mms_keys_present_with_defaults(self, cfg) -> None:
        assert hasattr(cfg, "voice_stt_mms_enabled")
        assert hasattr(cfg, "voice_stt_mms_lang")
        assert hasattr(cfg, "voice_stt_mms_bundle_dir")
        assert hasattr(cfg, "voice_stt_mms_compute")
        assert hasattr(cfg, "voice_stt_mms_refine_with_turbo")
        assert hasattr(cfg, "voice_stt_mms_refine_confidence_min")
        assert cfg.voice_stt_mms_enabled is False  # opt-in
        assert cfg.voice_stt_mms_lang == "ukr"
        assert cfg.voice_stt_mms_compute in ("int8", "fp16")
        assert 0.0 <= cfg.voice_stt_mms_refine_confidence_min <= 1.0

    def test_voice_stt_mode_accepts_mms(self, cfg) -> None:
        cfg.voice_stt_mode = "mms"
        assert cfg.voice_stt_mode == "mms"

    def test_mms_compute_rejects_unknown(self, cfg) -> None:
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            cfg.__class__(voice_stt_mms_compute="float8")  # type: ignore[arg-type]

    def test_mms_lang_rejects_empty(self, cfg) -> None:
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            cfg.__class__(voice_stt_mms_lang="")

    def test_mms_lang_rejects_too_long(self, cfg) -> None:
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            cfg.__class__(voice_stt_mms_lang="ukrainianverylong")

    def test_mms_refine_threshold_rejects_out_of_bounds(self, cfg) -> None:
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            cfg.__class__(voice_stt_mms_refine_confidence_min=1.5)
        with pytest.raises(ValidationError):
            cfg.__class__(voice_stt_mms_refine_confidence_min=-0.01)


# ── Factory chain ────────────────────────────────────────────────────────────


class TestFactoryChain:
    def test_try_mms_returns_none_when_disabled(self, cfg) -> None:
        cfg.voice_stt_mms_enabled = False
        from voice.stt_engine import _try_mms
        assert _try_mms() is None

    def test_try_mms_returns_none_when_bundle_missing(self, cfg) -> None:
        cfg.voice_stt_mms_enabled = True
        cfg.voice_stt_mms_bundle_dir = "/definitely/not/here"
        cfg.voice_stt_mms_lang = "ukr"
        from voice.stt_engine import _try_mms
        assert _try_mms() is None  # graceful — no exception leaks

    def test_build_falls_through_when_mms_unavailable(self, cfg) -> None:
        cfg.voice_stt_mms_enabled = True
        cfg.voice_stt_mms_bundle_dir = "/nonexistent"
        cfg.voice_stt_mode = "mms"
        from voice.stt_engine import build_stt_provider
        provider = build_stt_provider()
        # Whisper installed in this venv → fallback should land on it.
        # If whisper init fails for unrelated reasons, vosk/noop are fine.
        # NEVER 'mms_npu' here because the bundle is missing.
        assert provider.name in ("whisper", "vosk", "noop")

    def test_explicit_vosk_does_not_try_mms(self, cfg) -> None:
        cfg.voice_stt_mms_enabled = True
        cfg.voice_stt_mode = "vosk"
        from voice import stt_engine
        with mock.patch.object(stt_engine, "_try_mms") as spy:
            spy.return_value = None
            stt_engine.build_stt_provider()
            spy.assert_not_called()

    def test_hybrid_with_mms_off_skips_mms(self, cfg) -> None:
        cfg.voice_stt_mms_enabled = False
        cfg.voice_stt_npu_enabled = False
        cfg.voice_stt_mode = "hybrid"
        from voice import stt_engine
        with mock.patch.object(stt_engine, "_try_mms") as spy:
            spy.return_value = None
            stt_engine.build_stt_provider()
            spy.assert_not_called()

    def test_hybrid_with_mms_on_tries_mms_first(self, cfg) -> None:
        cfg.voice_stt_mms_enabled = True
        cfg.voice_stt_npu_enabled = False
        cfg.voice_stt_mode = "hybrid"
        from voice import stt_engine
        order: list[str] = []
        with mock.patch.object(stt_engine, "_try_mms",
                               side_effect=lambda: order.append("mms") or None), \
             mock.patch.object(stt_engine, "_try_npu",
                               side_effect=lambda: order.append("npu") or None), \
             mock.patch.object(stt_engine, "_try_whisper",
                               side_effect=lambda: order.append("whisper") or None), \
             mock.patch.object(stt_engine, "_try_vosk",
                               side_effect=lambda: order.append("vosk") or None):
            stt_engine.build_stt_provider()
        # MMS strictly precedes Whisper-NPU and CPU paths.
        assert order[0] == "mms"
        assert "whisper" in order
        assert "vosk" in order

    def test_mms_first_when_both_enabled(self, cfg) -> None:
        """MMS is the instant tier — must precede Whisper-NPU even when
        both flags are on."""
        cfg.voice_stt_mms_enabled = True
        cfg.voice_stt_npu_enabled = True
        cfg.voice_stt_mode = "hybrid"
        from voice import stt_engine
        order: list[str] = []
        with mock.patch.object(stt_engine, "_try_mms",
                               side_effect=lambda: order.append("mms") or None), \
             mock.patch.object(stt_engine, "_try_npu",
                               side_effect=lambda: order.append("npu") or None), \
             mock.patch.object(stt_engine, "_try_whisper",
                               side_effect=lambda: order.append("whisper") or None), \
             mock.patch.object(stt_engine, "_try_vosk",
                               side_effect=lambda: order.append("vosk") or None):
            stt_engine.build_stt_provider()
        assert order.index("mms") < order.index("npu")
        assert order.index("npu") < order.index("whisper")


# ── Provider unit ────────────────────────────────────────────────────────────


class TestMMSNPUProvider:
    def test_construction_raises_when_bundle_missing(self, cfg) -> None:
        cfg.voice_stt_mms_enabled = True
        cfg.voice_stt_mms_bundle_dir = "/nonexistent"
        cfg.voice_stt_mms_lang = "ukr"
        from voice.mms_npu_provider import MMSNPUProvider
        with pytest.raises(RuntimeError, match="MMS bundle"):
            MMSNPUProvider()

    def test_construction_raises_when_no_encoder_in_bundle(
        self, cfg, tmp_path: Path
    ) -> None:
        bundle = tmp_path / "mms-ukr-qnn"
        bundle.mkdir()
        # Drop a vocab.json so _resolve_mms_bundle finds the dir, but no
        # encoder file → second check must trip.
        (bundle / "vocab.json").write_text("{}", encoding="utf-8")
        cfg.voice_stt_mms_enabled = True
        cfg.voice_stt_mms_bundle_dir = str(tmp_path)
        cfg.voice_stt_mms_lang = "ukr"
        from voice.mms_npu_provider import MMSNPUProvider
        with pytest.raises(RuntimeError, match="encoder"):
            MMSNPUProvider()

    def test_resolve_bundle_picks_per_lang_subdir(self, tmp_path: Path) -> None:
        from voice.mms_npu_provider import _resolve_mms_bundle
        # Layout: tmp/mms-ukr-qnn/vocab.json
        bundle = tmp_path / "mms-ukr-qnn"
        bundle.mkdir()
        (bundle / "vocab.json").write_text("{}", encoding="utf-8")
        resolved = _resolve_mms_bundle(str(tmp_path), "ukr")
        assert resolved == bundle

    def test_resolve_bundle_returns_none_when_missing_vocab(
        self, tmp_path: Path
    ) -> None:
        from voice.mms_npu_provider import _resolve_mms_bundle
        bundle = tmp_path / "mms-ukr-qnn"
        bundle.mkdir()
        # No vocab.json → considered incomplete → not picked.
        assert _resolve_mms_bundle(str(tmp_path), "ukr") is None

    def test_is_mms_path_available_returns_false_when_disabled(self, cfg) -> None:
        cfg.voice_stt_mms_enabled = False
        from voice.mms_npu_provider import is_mms_path_available
        assert is_mms_path_available() is False

    def test_is_mms_path_available_returns_false_when_bundle_missing(self, cfg) -> None:
        cfg.voice_stt_mms_enabled = True
        cfg.voice_stt_mms_bundle_dir = "/nonexistent"
        cfg.voice_stt_mms_lang = "ukr"
        from voice.mms_npu_provider import is_mms_path_available
        assert is_mms_path_available() is False


# ── CTC decode (pure logic, no model needed) ─────────────────────────────────


class TestCTCDecode:
    def test_collapses_repeats(self) -> None:
        from voice.mms_npu_provider import MMSNPUProvider
        # 5-frame logits, vocab size 4. Argmax sequence: [1, 1, 2, 2, 3].
        # Pad token = 0. Expected kept: [1, 2, 3].
        logits = np.zeros((5, 4), dtype=np.float32)
        logits[0, 1] = 10
        logits[1, 1] = 10
        logits[2, 2] = 10
        logits[3, 2] = 10
        logits[4, 3] = 10
        ids, conf = MMSNPUProvider._ctc_greedy_decode(logits, pad_token_id=0)
        assert ids == [1, 2, 3]
        assert conf > 0.99  # ~1.0 because softmax is sharp

    def test_drops_blanks(self) -> None:
        from voice.mms_npu_provider import MMSNPUProvider
        # Argmax: [0, 1, 0, 2, 0]. With pad/blank=0, kept: [1, 2].
        logits = np.zeros((5, 3), dtype=np.float32)
        logits[0, 0] = 5
        logits[1, 1] = 5
        logits[2, 0] = 5
        logits[3, 2] = 5
        logits[4, 0] = 5
        ids, conf = MMSNPUProvider._ctc_greedy_decode(logits, pad_token_id=0)
        assert ids == [1, 2]
        assert 0.0 < conf <= 1.0

    def test_empty_logits(self) -> None:
        from voice.mms_npu_provider import MMSNPUProvider
        logits = np.zeros((0, 32), dtype=np.float32)
        ids, conf = MMSNPUProvider._ctc_greedy_decode(logits, pad_token_id=0)
        assert ids == []
        assert conf == 0.0

    def test_all_blanks(self) -> None:
        from voice.mms_npu_provider import MMSNPUProvider
        # 4 frames all argmax=blank → no tokens kept.
        logits = np.zeros((4, 5), dtype=np.float32)
        logits[:, 0] = 10  # blank wins everywhere
        ids, conf = MMSNPUProvider._ctc_greedy_decode(logits, pad_token_id=0)
        assert ids == []
        assert conf == 0.0


# ── Audio framing (pad/trim to compiled window) ──────────────────────────────


class TestPadOrTrim:
    @pytest.fixture
    def fake_provider(self, cfg, tmp_path: Path):
        """Build an MMSNPUProvider stub with all heavy paths short-circuited
        so we can poke at _pad_or_trim without loading transformers/onnx."""
        bundle = tmp_path / "mms-ukr-qnn"
        bundle.mkdir()
        (bundle / "vocab.json").write_text("{}", encoding="utf-8")
        (bundle / "encoder_int8.onnx").write_bytes(b"\x00")  # presence only
        (bundle / "meta.json").write_text(
            '{"lang":"ukr","sample_rate":"16000","max_samples":"480000"}',
            encoding="utf-8",
        )
        cfg.voice_stt_mms_enabled = True
        cfg.voice_stt_mms_bundle_dir = str(tmp_path)
        cfg.voice_stt_mms_lang = "ukr"
        # Patch _register_qnn_ep_once so we don't need the QNN EP wheel
        # available in a unit-test image.
        from voice import mms_npu_provider as mod
        with mock.patch.object(mod, "_register_qnn_ep_once"):
            return mod.MMSNPUProvider()

    def test_pads_short_audio_with_zeros(self, fake_provider) -> None:
        n = 16_000  # 1 sec
        audio = np.full(n, 0.5, dtype=np.float32)
        out = fake_provider._pad_or_trim(audio)
        assert out.shape == (480_000,)
        assert np.allclose(out[:n], 0.5)
        assert np.allclose(out[n:], 0.0)  # zero-pad tail

    def test_truncates_long_audio(self, fake_provider) -> None:
        n = 600_000  # 37.5 sec — over 30s window
        audio = np.full(n, 0.5, dtype=np.float32)
        out = fake_provider._pad_or_trim(audio)
        assert out.shape == (480_000,)
        assert np.allclose(out, 0.5)


# ── Settings panel surface ───────────────────────────────────────────────────


class TestSettingsSurface:
    def test_mms_keys_in_voice_category(self) -> None:
        path = HERE / "api" / "routes_settings.py"
        text = path.read_text(encoding="utf-8")
        for key in (
            "voice_stt_mms_enabled",
            "voice_stt_mms_lang",
            "voice_stt_mms_bundle_dir",
            "voice_stt_mms_compute",
            "voice_stt_mms_refine_with_turbo",
            "voice_stt_mms_refine_confidence_min",
        ):
            assert f'"{key}"' in text, f"{key} missing from routes_settings.py"
        assert "MMS instant-tier" in text  # label rendered

    def test_mms_keys_invalidate_provider_cache(self) -> None:
        path = HERE / "api" / "routes_settings.py"
        text = path.read_text(encoding="utf-8")
        # Provider cache must reset when bundle/lang/compute change so the
        # next request rebuilds with the new MMS settings.
        block = text.split("invalidating_keys = {", 1)[1].split("}", 1)[0]
        for key in ("voice_stt_mms_enabled", "voice_stt_mms_lang",
                    "voice_stt_mms_bundle_dir", "voice_stt_mms_compute"):
            assert key in block, f"{key} not in invalidating_keys block"
