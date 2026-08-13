"""Day-4 Wave-2 — Block V-6: Histogram primitive + 3 latency instruments
(ADR-RTP-002, `docs/architecture/desktop-shell.md`).

Closes audit U8-PERF-G1 ("no SLO defined, no histogram, no acceptance
test that asserts a p50") + U8-PERF-H3 ("chat / STT / TTS / AI all
log latency_ms into JSON metadata but never aggregate").

Coverage:

1. ``Histogram.observe(150)`` then ``render()`` includes
   ``_bucket{le="250"} 1`` and ``_bucket{le="100"} 0``, plus ``_sum 150``
   and ``_count 1``. Cumulative-bucket invariant holds.
2. Negative observations are silently dropped.
3. Non-numeric observations are silently dropped (defensive guard).
4. Multiple observations across buckets render with the right cumulative
   counts.
5. Labelled observations partition the buckets per label-key.
6. ``render()`` on a cold (no-observation) histogram still yields
   ``_count 0`` so dashboards don't blink "metric missing".
7. Default bucket boundaries match ADR-RTP-002 spec
   (5/10/25/50/100/250/500/1000/2500/5000/10000 ms).
8. The 3 concrete instruments are registered in ``_REGISTRY``.
9. ``transcribe_blob`` records into ``voice_stt_latency_ms`` labelled
   by engine.
10. ``websocket_hub.broadcast`` records into ``ws_broadcast_latency_ms``.
11. ``routes_chat`` REST + WS branches both observe into
    ``chat_response_latency_ms`` (verified by source-grep — runtime
    integration covered downstream by chat regression suites).
"""
from __future__ import annotations

import asyncio
import re
from pathlib import Path

import pytest


# ───────────────────────────────────────────────────────────── primitive ──


class TestHistogramPrimitive:
    def test_observe_renders_cumulative_buckets(self):
        from observability import Histogram

        h = Histogram("phantom_test_latency_ms", "Test histogram.")
        h.observe(150.0)
        rendered = list(h.render())

        # Cumulative: le=250 covers 150; le=100 does NOT.
        assert any(re.search(r'_bucket\{le="250"\} 1\b', line) for line in rendered), (
            f"V-6: le=250 bucket should be 1 after observe(150). Got: {rendered}"
        )
        assert any(re.search(r'_bucket\{le="100"\} 0\b', line) for line in rendered), (
            f"V-6: le=100 bucket should be 0 (150 > 100). Got: {rendered}"
        )
        # +Inf and sum/count.
        assert any('le="+Inf"' in line and " 1" in line for line in rendered)
        assert any(line.endswith(" 150.0") and "_sum" in line for line in rendered)
        assert any(line.endswith(" 1") and "_count" in line for line in rendered)

    def test_negative_observation_dropped(self):
        from observability import Histogram

        h = Histogram("t", "t")
        h.observe(-1.0)
        rendered = list(h.render())
        assert any('_count 0' in line for line in rendered), (
            f"V-6: negative observation must not increment count. Got: {rendered}"
        )

    def test_non_numeric_observation_dropped(self):
        """Defensive: a buggy caller passing a str must not crash the
        chat hot-path. observe() silently drops + the histogram
        keeps its zero state."""
        from observability import Histogram

        h = Histogram("t", "t")
        h.observe("not-a-float")  # type: ignore[arg-type]
        h.observe(None)  # type: ignore[arg-type]
        rendered = list(h.render())
        assert any('_count 0' in line for line in rendered)

    def test_multi_observation_cumulative(self):
        from observability import Histogram

        h = Histogram("t", "t")
        for v in [3, 7, 30, 80, 600]:
            h.observe(v)
        rendered = list(h.render())
        # le=5 covers only 3 → 1
        # le=10 covers 3, 7 → 2
        # le=50 covers 3, 7, 30 → 3
        # le=100 covers 3, 7, 30, 80 → 4
        # le=500 covers 3, 7, 30, 80 → 4
        # le=1000 covers all 5 → 5
        # +Inf → 5
        assert _bucket_value(rendered, le="5") == 1
        assert _bucket_value(rendered, le="10") == 2
        assert _bucket_value(rendered, le="50") == 3
        assert _bucket_value(rendered, le="100") == 4
        assert _bucket_value(rendered, le="500") == 4
        assert _bucket_value(rendered, le="1000") == 5
        assert _bucket_value(rendered, le="+Inf") == 5

    def test_labelled_partition(self):
        from observability import Histogram

        h = Histogram("t", "t")
        h.observe(150, engine="vosk")
        h.observe(250, engine="vosk")
        h.observe(40, engine="whisper")
        rendered = list(h.render())

        # Vosk: le=250 → 2 (both observations); le=100 → 0; le=500 → 2.
        # Whisper: le=50 → 1; le=25 → 0.
        vosk_le250 = _labelled_bucket(rendered, engine="vosk", le="250")
        vosk_le100 = _labelled_bucket(rendered, engine="vosk", le="100")
        whisper_le50 = _labelled_bucket(rendered, engine="whisper", le="50")
        whisper_le25 = _labelled_bucket(rendered, engine="whisper", le="25")
        assert vosk_le250 == 2, rendered
        assert vosk_le100 == 0, rendered
        assert whisper_le50 == 1, rendered
        assert whisper_le25 == 0, rendered

    def test_cold_histogram_renders_zero_count(self):
        from observability import Histogram

        h = Histogram("t", "t")
        rendered = "\n".join(h.render())
        assert "_count 0" in rendered, (
            "V-6: cold histogram must yield _count 0 so dashboards don't "
            "blink 'metric missing'."
        )

    def test_default_bucket_boundaries_match_adr(self):
        from observability import DEFAULT_BUCKETS_MS

        assert DEFAULT_BUCKETS_MS == (
            5.0, 10.0, 25.0, 50.0, 100.0, 250.0, 500.0,
            1000.0, 2500.0, 5000.0, 10000.0,
        ), (
            "V-6: DEFAULT_BUCKETS_MS deviated from ADR-RTP-002 spec — "
            "downstream dashboards depend on this exact bucket layout."
        )


# ──────────────────────────────────────────────────── concrete instruments ──


class TestConcreteInstrumentsRegistered:
    def test_three_histograms_present_in_registry(self):
        from observability import (
            _REGISTRY,
            chat_response_latency_ms,
            voice_stt_latency_ms,
            ws_broadcast_latency_ms,
        )

        for instrument in (
            chat_response_latency_ms,
            voice_stt_latency_ms,
            ws_broadcast_latency_ms,
        ):
            assert instrument in _REGISTRY, (
                f"V-6: {instrument.name} not registered in _REGISTRY — "
                "/metrics will not surface it."
            )

    def test_histogram_emits_type_line(self):
        """Sanity: when rendered, the instrument emits the
        ``# TYPE … histogram`` line — the Prometheus parser keys on
        this to map exposition into the right metric type."""
        from observability import chat_response_latency_ms

        rendered = "\n".join(chat_response_latency_ms.render())
        assert "# TYPE phantom_chat_response_latency_ms histogram" in rendered


# ─────────────────────────────────────────────────────── observation points ──


class TestSttObservationPoint:
    @pytest.mark.asyncio
    async def test_transcribe_blob_records_latency_with_engine_label(
        self, monkeypatch
    ):
        """``transcribe_blob`` must observe into voice_stt_latency_ms with
        an ``engine=...`` label so per-backend p50/p95 splits work."""
        import voice.pipeline as vp
        from voice.stt_engine import STTResult
        from observability import voice_stt_latency_ms

        # Snapshot count BEFORE so we're delta-aware vs other tests.
        before_vosk = _read_count(voice_stt_latency_ms, engine="vosk")

        class _StubProvider:
            async def transcribe(self, audio, language):
                # Pretend STT took ~75 ms.
                await asyncio.sleep(0.075)
                return STTResult(
                    text="hello", confidence=0.9, engine="vosk",
                    language=language,
                )

        monkeypatch.setattr(vp, "get_stt_provider", lambda: _StubProvider())
        # `transcribe_blob` calls `decode_to_mono16k_async` — audit A-1 moved
        # the decode off the event loop because ffmpeg can take ~10 s. Patching
        # the sync `decode_to_mono16k` left the real decoder in the path, which
        # then failed on this fake blob ("Invalid data found when processing
        # input") instead of exercising the histogram under test.
        async def _fake_decode(raw):
            return b"_audio_bytes_"

        monkeypatch.setattr(vp, "decode_to_mono16k_async", _fake_decode)

        result = await vp.transcribe_blob(b"raw-pcm-bytes", "uk")
        assert result.text == "hello"

        after_vosk = _read_count(voice_stt_latency_ms, engine="vosk")
        assert after_vosk - before_vosk == 1, (
            f"V-6: voice_stt_latency_ms{{engine='vosk'}} did not bump "
            f"(delta={after_vosk - before_vosk})"
        )


class TestWsBroadcastObservationPoint:
    @pytest.mark.asyncio
    async def test_broadcast_records_latency_even_with_no_clients(self):
        """Empty broadcast (no clients connected) still records — gives
        operators a baseline ping for the broadcast path."""
        from api.websocket_hub import WebSocketHub
        from observability import ws_broadcast_latency_ms

        before = _total_count(ws_broadcast_latency_ms)
        hub = WebSocketHub()
        await hub.broadcast("system", "noop", {"k": "v"})
        after = _total_count(ws_broadcast_latency_ms)
        assert after - before == 1, (
            f"V-6: ws_broadcast_latency_ms count did not bump on "
            f"empty-target broadcast (delta={after - before})"
        )


class TestChatLatencyObservationWired:
    """Runtime integration is covered by the chat regression suites
    (the Histogram observation point is silent on the happy path).
    Source-grep here is the static contract — if a refactor accidentally
    drops the observation, the next chat-stack run still measures, but
    /metrics aggregation breaks. Catch it at static-pin."""

    def test_routes_chat_observes_in_both_paths(self):
        body = (
            Path(__file__).resolve().parents[1]
            / "api"
            / "routes_chat.py"
        ).read_text(encoding="utf-8")
        # Both REST POST and WS chat handlers compute latency_ms then
        # call observability.chat_response_latency_ms.observe(latency_ms).
        # We assert the observation appears at least twice so a refactor
        # that drops one path is caught.
        occurrences = body.count("chat_response_latency_ms.observe")
        assert occurrences >= 2, (
            f"V-6: routes_chat.py has only {occurrences} chat_response_"
            "latency_ms.observe() call(s); expected >= 2 (REST + WS "
            "branches). A refactor dropped an observation point."
        )


# ──────────────────────────────────────────────────────────── helpers ──


_NUM_RE = re.compile(r"\s+([0-9]+(?:\.[0-9]+)?)\s*$")


def _bucket_value(rendered_lines: list[str], le: str) -> int:
    """Find the unlabelled-by-engine bucket count for the given le=…
    string (e.g. ``"250"`` or ``"+Inf"``)."""
    needle = f'le="{le}"'
    for line in rendered_lines:
        if line.startswith("#"):
            continue
        if "_bucket" not in line:
            continue
        if needle not in line:
            continue
        m = _NUM_RE.search(line)
        if m:
            return int(float(m.group(1)))
    raise AssertionError(
        f"V-6: bucket le={le!r} not found in render. Got: {rendered_lines}"
    )


def _labelled_bucket(rendered_lines: list[str], **labels) -> int:
    """Find the bucket count for an exact label combination."""
    le = labels.pop("le")
    label_pairs = sorted({**labels, "le": le}.items())
    needle = ",".join(f'{k}="{v}"' for k, v in label_pairs)
    for line in rendered_lines:
        if line.startswith("#"):
            continue
        if "_bucket" not in line:
            continue
        if "{" + needle + "}" not in line:
            continue
        m = _NUM_RE.search(line)
        if m:
            return int(float(m.group(1)))
    raise AssertionError(
        f"V-6: labelled bucket {needle!r} not found. Got: {rendered_lines}"
    )


def _read_count(histogram, **labels) -> int:
    """Read the labelled ``_count`` value for a histogram."""
    label_frag = ",".join(f'{k}="{v}"' for k, v in sorted(labels.items()))
    for line in histogram.render():
        if line.startswith("#"):
            continue
        if "_count" not in line:
            continue
        if label_frag and label_frag not in line:
            continue
        m = _NUM_RE.search(line)
        if m:
            return int(float(m.group(1)))
    return 0


def _total_count(histogram) -> int:
    """Read the unlabelled ``_count`` value (or sum across labels for
    the no-label case)."""
    total = 0
    for line in histogram.render():
        if line.startswith("#"):
            continue
        # Match either `name_count VALUE` (no labels) or
        # `name_count{...} VALUE` (labelled).
        if "_count" not in line:
            continue
        if "_bucket" in line or "_sum" in line:
            continue
        m = _NUM_RE.search(line)
        if m:
            total += int(float(m.group(1)))
    return total
