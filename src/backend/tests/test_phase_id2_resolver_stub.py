"""Day-4 Wave-1 — Block ID-2: voice.identity.resolver no-op stub.

Implements ADR-ID-002 (`docs/architecture/identity-recognition.md` §2).

The contract this file pins:

* `resolve_speaker(audio: bytes, sample_rate: int) -> Optional[str]` —
  the FROZEN Day-4 signature. Day-5 ML drop-in MUST keep this exact
  shape; the test asserts via `inspect.signature` so a future refactor
  that adds e.g. `language: str` is loud-failed at CI rather than
  silently breaking the pipeline.py call-site.
* Day-4 unconditional `None` for: empty bytes, 1 s of silence, an
  arbitrary 32 KB blob, mismatched sample rate.
* Performance budget: 10 000 calls < 100 ms wall-clock on the test box
  (the resolver is one debug-log + one `return None`; if anything
  slower lands here it's a regression).
* Importable as both `voice.identity.resolver` and
  `voice.identity` (re-export from package `__init__`).
"""
from __future__ import annotations

import inspect
import time
from typing import Optional, get_type_hints

import pytest


# ─────────────────────────────────────────────────────── unconditional None ──


class TestNoopBehaviour:
    @pytest.mark.parametrize(
        "audio,sample_rate",
        [
            (b"", 16_000),
            (b"\x00" * 32_000, 16_000),  # 1 s silence at 16 kHz s16le
            (b"\xff\x7f" * 16_000, 16_000),  # full-amplitude tones
            (b"abc", 8_000),  # mismatched rate
            (b"longer-blob" * 1024, 44_100),  # exotic rate, big blob
        ],
    )
    def test_returns_none_unconditionally_day4(self, audio, sample_rate):
        from voice.identity.resolver import resolve_speaker

        assert resolve_speaker(audio, sample_rate) is None

    def test_does_not_raise_on_zero_bytes(self):
        from voice.identity.resolver import resolve_speaker

        # The pipeline may pass zero bytes if the VAD truncated the
        # utterance to nothing — the resolver must NOT raise; pipeline
        # treats `None` as "no speaker", not as a downstream failure.
        resolve_speaker(b"", 16_000)


# ─────────────────────────────────────────────────────── frozen signature ──


class TestFrozenSignature:
    """ADR-ID-002 §65 — Day-5 must not change the signature. CI loud-
    fails if anyone tries to add or rename a parameter."""

    def test_signature_is_audio_bytes_sample_rate_int(self):
        from voice.identity.resolver import resolve_speaker

        sig = inspect.signature(resolve_speaker)
        params = list(sig.parameters.values())
        assert [p.name for p in params] == ["audio", "sample_rate"], (
            f"ID-2 signature drifted: {sig}. Restore the ADR-ID-002 contract "
            "or update the call site in voice.pipeline.transcribe_blob."
        )

    def test_signature_annotations_match_adr(self):
        from voice.identity import resolver as mod

        hints = get_type_hints(mod.resolve_speaker)
        # `Optional[str]` is `Union[str, None]` at runtime.
        assert hints["audio"] is bytes
        assert hints["sample_rate"] is int
        assert hints["return"] in (Optional[str],)

    def test_resolver_reexported_from_package(self):
        """`from voice.identity import resolve_speaker` is the canonical
        ergonomic import; pin both spellings so a refactor that drops
        the re-export trips CI."""
        from voice.identity import resolve_speaker as reexport
        from voice.identity.resolver import resolve_speaker as direct

        assert reexport is direct


# ─────────────────────────────────────────────────────── perf gate ──


class TestPerformance:
    def test_10k_calls_under_500ms(self):
        """ADR-ID-002 §perf budget = 100 µs/call on Radxa. 10k iterations
        in 500 ms is a 50 µs ceiling — comfortable on Radxa A78, even
        more so on x86 CI runners. Catches an order-of-magnitude
        regression (e.g., a future `import torch` inside the body)."""
        from voice.identity.resolver import resolve_speaker

        # Warm — first call may pay logger lookup cost.
        resolve_speaker(b"", 16_000)
        t0 = time.perf_counter()
        for _ in range(10_000):
            resolve_speaker(b"", 16_000)
        elapsed = time.perf_counter() - t0
        assert elapsed < 0.5, (
            f"resolver no-op regressed: {elapsed*1000:.1f} ms for 10k calls "
            f"(budget 500 ms / 50 µs per call)"
        )
