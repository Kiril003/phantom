"""Day-4 Wave-2 — Block W-5: hardware-tier flag + chat_stream_delay_s
default flip (audit U2-ANIM-C2 + U8-PERF-C2).

Coverage:

1. config.chat_stream_delay_s default flips 0.05 → 0.0.
2. config.ui_hardware_tier exists with default "mid" + closed Literal.
3. routes_chat hot-path guards `if config.chat_stream_delay_s > 0:`
   so the new default skips the asyncio.sleep entirely (250-500 ms
   per turn shaved).
4. Operator can still set delay > 0 via Settings; the guard fires
   only when delay is strictly positive.
"""
from __future__ import annotations

from pathlib import Path

import pytest


class TestChatStreamDelayDefaultFlipped:
    def test_default_is_zero(self):
        from config import PhantomConfig

        default = PhantomConfig.model_fields["chat_stream_delay_s"].default
        assert default == 0.0, (
            f"W-5 regression: chat_stream_delay_s default flipped back "
            f"to {default!r}. Audit U8-PERF-C2 budget: 0.0 saves "
            "250-500 ms/turn; deploys that need throttling set the "
            "knob via Settings."
        )

    def test_routes_chat_guards_strict_positive(self):
        """The hot-path emit loop in routes_chat must guard the sleep
        call with `if config.chat_stream_delay_s > 0:`. Otherwise the
        new default still hops the event loop on every chunk."""
        body = (
            Path(__file__).resolve().parents[1]
            / "api" / "routes_chat.py"
        ).read_text(encoding="utf-8")
        assert "if config.chat_stream_delay_s > 0" in body, (
            "W-5 regression: routes_chat does NOT guard the inter-chunk "
            "sleep behind a strict-positive check. The new 0.0 default "
            "still pays the asyncio.sleep(0) yield-point cost (5-10 ms "
            "per turn)."
        )


class TestHardwareTierConfig:
    def test_default_is_mid(self):
        from config import PhantomConfig

        default = PhantomConfig.model_fields["ui_hardware_tier"].default
        assert default == "mid", (
            f"W-5: ui_hardware_tier default flipped to {default!r}; "
            "default 'mid' matches the Q6A baseline."
        )

    def test_literal_closed_to_three_values(self):
        """Pydantic Literal — only low/mid/high accepted."""
        from config import PhantomConfig

        cfg = PhantomConfig(ui_hardware_tier="low")
        assert cfg.ui_hardware_tier == "low"
        cfg = PhantomConfig(ui_hardware_tier="high")
        assert cfg.ui_hardware_tier == "high"
        with pytest.raises(Exception):
            PhantomConfig(ui_hardware_tier="ultra")  # type: ignore[arg-type]
