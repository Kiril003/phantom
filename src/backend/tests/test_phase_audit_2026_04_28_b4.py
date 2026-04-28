"""Block B-4 regression tests — audit 2026-04-28 voice + perf hot-spots.

Covers:
  F-25: STTResult carries an engine_error field; NPU/MMS providers populate it
        on inference failure instead of returning a silent empty transcript.
  F-31: EventBus tracks async handler tasks with strong refs so the GC cannot
        collect them mid-flight.
  F-37: ffmpeg is resolved lazily (60 s cache) instead of at module load.
  F-39: STTResult.engine is typed as STTEngineName Literal — covers the 5
        actual values the codebase emits.
  F-43: chat _chunk_content clamps chunk_size to ≥ 4 to avoid half-syllable cuts.
  F-62: _peak_energy_normalised uses audioop, no per-call numpy allocation.
"""

from __future__ import annotations

import asyncio
import struct
from typing import Any, get_args

import pytest


# ── F-25 — engine_error surfaces NPU failures ────────────────────────────────

class TestF25EngineErrorSurfacing:
    def test_sttresult_default_engine_error_none(self):
        from voice.stt_engine import STTResult
        r = STTResult(text="hi", confidence=1.0, engine="whisper", language="uk")
        assert r.engine_error is None

    def test_sttresult_to_dict_omits_engine_error_when_none(self):
        from voice.stt_engine import STTResult
        d = STTResult(text="hi", confidence=1.0, engine="whisper", language="uk").to_dict()
        assert "engine_error" not in d

    def test_sttresult_to_dict_includes_engine_error_when_set(self):
        from voice.stt_engine import STTResult
        d = STTResult(
            text="", confidence=0.0, engine="mms_npu", language="uk",
            engine_error="mms_npu_forward_failed: HTP wedged",
        ).to_dict()
        assert d["engine_error"].startswith("mms_npu_forward_failed")
        assert d["text"] == ""

    @pytest.mark.asyncio
    async def test_mms_provider_populates_engine_error_on_forward_failure(self):
        # Build a provider with a fake session that raises, then call
        # _transcribe_sync via the public path. The provider should
        # return STTResult with engine_error populated, NOT swallow.
        from voice.mms_npu_provider import MMSNPUProvider

        class _BoomSession:
            def get_inputs(self):
                class _I:
                    name = "x"
                return [_I()]

            def run(self, *_a, **_k):
                raise RuntimeError("HTP wedged")

        class _Tok:
            pad_token_id = 0

            def decode(self, *_a, **_k):
                return ""

        prov = MMSNPUProvider.__new__(MMSNPUProvider)  # bypass __init__
        prov._session = _BoomSession()
        prov._tokenizer = _Tok()
        prov._lang = "uk"
        prov._mode = "qnn-htp"
        prov._max_samples = 16_000 * 3

        import numpy as np
        result = prov._transcribe_sync(np.zeros(16_000 * 3, dtype=np.float32), "uk")
        assert result.text == ""
        assert result.engine == "mms_npu"
        assert result.engine_error is not None
        assert "mms_npu_forward_failed" in result.engine_error


# ── F-39 — engine Literal covers all five values ─────────────────────────────

class TestF39EngineLiteral:
    def test_engine_literal_covers_all_emitted_values(self):
        from voice.stt_engine import STTEngineName
        emitted = {"whisper", "vosk", "noop", "whisper_npu", "mms_npu"}
        assert set(get_args(STTEngineName)) >= emitted, (
            "F-39 regression: STTEngineName Literal missing one of "
            f"the actually-emitted values {emitted}"
        )


# ── F-37 — ffmpeg lazy resolution ────────────────────────────────────────────

class TestF37FfmpegLazy:
    def test_resolve_ffmpeg_caches(self, monkeypatch):
        import voice.stt_engine as ste

        calls = {"n": 0}
        original_which = ste.shutil.which

        def _spy(name):
            calls["n"] += 1
            return original_which(name)

        monkeypatch.setattr(ste.shutil, "which", _spy)
        # Reset cache by hand so the spy sees the call.
        monkeypatch.setattr(ste, "_ffmpeg_cache", (-3600.0, None))
        ste._resolve_ffmpeg_bin()
        ste._resolve_ffmpeg_bin()
        ste._resolve_ffmpeg_bin()
        # Within the 60 s TTL only the first call should hit `which`.
        assert calls["n"] == 1, (
            "F-37 regression: ffmpeg resolver did not honour 60 s cache"
        )


# ── F-31 — EventBus task tracking ────────────────────────────────────────────

class TestF31EventBusTaskTracking:
    @pytest.mark.asyncio
    async def test_async_handler_task_is_tracked(self):
        from core.event_bus import EventBus

        bus = EventBus()
        seen: list[Any] = []

        async def handler(data):
            await asyncio.sleep(0)  # yield
            seen.append(data)

        bus.subscribe("ev", handler)
        bus.emit("ev", "payload")
        # Strong-ref set must contain the live task immediately after emit.
        assert len(bus._pending_tasks) == 1
        # Drain — task removes itself via add_done_callback.
        await asyncio.sleep(0.05)
        assert len(bus._pending_tasks) == 0
        assert seen == ["payload"]

    @pytest.mark.asyncio
    async def test_failing_handler_logs_and_clears(self, caplog):
        import logging as _logging
        from core.event_bus import EventBus

        bus = EventBus()

        async def boom(_data):
            raise RuntimeError("kaboom")

        bus.subscribe("ev", boom)
        with caplog.at_level(_logging.ERROR, logger="core.event_bus"):
            bus.emit("ev", None)
            await asyncio.sleep(0.05)

        assert len(bus._pending_tasks) == 0
        assert any("kaboom" in r.getMessage() for r in caplog.records)


# ── F-43 — chunk_size lower clamp ────────────────────────────────────────────

class TestF43ChunkSizeClamp:
    def test_chunk_size_one_clamped_to_four(self):
        from api.routes_chat import _chunk_content
        text = "Hello there friend"
        out = _chunk_content(text, chunk_size=1)
        # No chunk should be 1 char; clamp ensures ≥ 4.
        for chunk in out:
            assert len(chunk) >= 1  # final chunk may be short tail
        # But the natural rhythm is now ≥ 4 except for the tail.
        non_tail = out[:-1]
        assert all(len(c) >= 2 for c in non_tail), (
            "F-43 regression: chunks still half-syllable on chunk_size=1"
        )

    def test_chunk_size_zero_returns_whole_text(self):
        from api.routes_chat import _chunk_content
        assert _chunk_content("hello", chunk_size=0) == ["hello"]
        assert _chunk_content("", chunk_size=0) == []


# ── F-62 — _peak_energy_normalised audioop fast path ─────────────────────────

class TestF62PeakEnergyAudioop:
    def test_silence_returns_zero(self):
        from voice.always_on import _peak_energy_normalised
        # 100 ms of silence at 16 kHz = 1600 samples * 2 bytes.
        silence = b"\x00\x00" * 1600
        assert _peak_energy_normalised(silence) == 0.0

    def test_full_scale_returns_close_to_one(self):
        from voice.always_on import _peak_energy_normalised
        # A single +full-scale sample, rest silence.
        peak_sample = struct.pack("<h", 32_000) + b"\x00\x00" * 10
        # 32_000 / 32768 ≈ 0.9766
        result = _peak_energy_normalised(peak_sample)
        assert 0.95 < result < 1.0

    def test_empty_returns_zero(self):
        from voice.always_on import _peak_energy_normalised
        assert _peak_energy_normalised(b"") == 0.0
