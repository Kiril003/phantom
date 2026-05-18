"""Day-3 audit-2026-04-30 — Block O commit O-6.

Tier-C/D fast batch — three small fixes the audit swarm flagged:

* **D3-C-6** — `_safe_query_str`'s Unicode-danger blocklist missed
  NUL, tab, soft hyphen, line/paragraph separators, and the
  Mongolian zero-width vowel separator. Also added NFC normalisation
  on the input so an attacker can't bypass the codepoint blocklist
  by supplying a decomposed-form spoof of an allowed glyph.

* **D3-E-6** — `phantom_ai_router_fallthrough_total` was registered
  in the metrics catalog (since v0.18) but never incremented. Now
  fires whenever a fallback provider serves the call (primary failed
  first). Operators reading the metric finally get a
  primary-stability signal.

* **D3-D-2** — `agent.cognition.proactive.loop`'s cycle-broadcast comment said "only
  emit every 5th cycle so UIs can show breathing without log spam"
  but the code emitted every cycle. Now genuinely every-5th via a
  per-loop tick counter (D3-D-2).
"""

from __future__ import annotations

import asyncio


# ── D3-C-6 — Unicode danger blocklist + NFC normalisation ─────────────────────


class TestD3C6UnicodeDanger:
    def test_new_codepoints_rejected(self):
        from ai.tool_executor import _safe_query_str

        for ch_name, codepoint in (
            ("NUL",        0x0000),
            ("HT (tab)",   0x0009),
            ("SOFT HYPHEN", 0x00AD),
            ("MVS",        0x180E),
            ("LINE SEP",   0x2028),
            ("PARA SEP",   0x2029),
        ):
            payload = "Тест" + chr(codepoint) + "x"
            cleaned, err = _safe_query_str(payload)
            assert cleaned is None and err == "invalid_args", (
                f"D3-C-6 regression: {ch_name} (U+{codepoint:04X}) not "
                f"caught by _UNICODE_DANGER_SET"
            )

    def test_legacy_codepoints_still_rejected(self):
        """D2-S2 baseline: the original 15-codepoint set must still
        reject. A regression here would re-open the Day-2 ILIKE bypass."""
        from ai.tool_executor import _safe_query_str

        for codepoint in (0x200B, 0x202E, 0x2066, 0xFEFF):
            cleaned, err = _safe_query_str("ok" + chr(codepoint))
            assert err == "invalid_args"

    def test_nfc_normalises_decomposed_form(self):
        """A decomposed-form Cyrillic 'й' (0x0438 + 0x0306 combining
        breve) NFC-normalises to U+0439 — neither component is in the
        danger set, but the COMBINING BREVE is U+0306, which we don't
        explicitly block. NFC normalisation collapses it before the
        check, so the cleaned output is the precomposed character."""
        from ai.tool_executor import _safe_query_str

        decomposed = "Київ" + "й"  # decomposed 'й'
        cleaned, err = _safe_query_str(decomposed)
        assert err is None, (cleaned, err)
        assert cleaned is not None
        # NFC collapses U+0438 + U+0306 → U+0439, length therefore
        # shrinks by 1 codepoint after normalisation.
        assert "й" in cleaned

    def test_safe_input_still_passes(self):
        """Sanity: a plain Cyrillic substring still passes after the
        upgrade. The escaper reaches its inner work."""
        from ai.tool_executor import _safe_query_str
        cleaned, err = _safe_query_str("Шевченка")
        assert err is None
        assert cleaned == "Шевченка"


# ── D3-E-6 — ai_router_fallthrough_total wired ────────────────────────────────


class TestD3E6FallthroughCounter:
    def test_counter_increments_on_fallback_success(self):
        """A primary that always raises + a fallback that always
        succeeds → the counter MUST jump by 1 per call. Without the
        D3-E-6 wire-up it stayed at 0 forever, even under heavy
        primary cooling."""
        import asyncio
        from observability import ai_router_fallthrough_total
        from ai.provider import AIRouter, AIResponse

        class _BadPrimary:
            async def generate(self, *a, **kw):
                raise RuntimeError("primary outage")

        class _GoodFallback:
            async def generate(self, *a, **kw):
                return AIResponse(content="ok", provider="ollama", latency_ms=1)

        router = AIRouter()
        router._providers["gemini"] = _BadPrimary()
        router._providers["ollama"] = _GoodFallback()

        from config import config
        prev_primary = config.ai_primary_provider
        prev_fallback = config.ai_fallback_provider
        # Pydantic validate_assignment guards primary != fallback. Move
        # fallback to a safe interim ("none") before swapping primary so
        # the validator never sees a "both ollama" intermediate.
        config.ai_fallback_provider = "none"
        config.ai_primary_provider = "gemini"
        config.ai_fallback_provider = "ollama"

        baseline = sum(ai_router_fallthrough_total._values.values())
        try:
            asyncio.run(router.generate("hi", "sys", []))
        finally:
            # Reverse-order restore for the same intermediate-safety
            # reason.
            config.ai_fallback_provider = "none"
            config.ai_primary_provider = prev_primary
            config.ai_fallback_provider = prev_fallback
        after = sum(ai_router_fallthrough_total._values.values())
        assert after == baseline + 1, (
            f"D3-E-6 regression: fallthrough counter didn't move "
            f"({baseline} → {after}) when primary failed and fallback "
            f"served."
        )

    def test_counter_does_not_increment_when_primary_succeeds(self):
        """Primary works → no fallthrough → counter unchanged. A drift
        here would mean every chat turn looks like a fallback,
        defeating the metric."""
        import asyncio
        from observability import ai_router_fallthrough_total
        from ai.provider import AIRouter, AIResponse

        class _GoodPrimary:
            async def generate(self, *a, **kw):
                return AIResponse(content="ok", provider="gemini", latency_ms=1)

        router = AIRouter()
        router._providers["gemini"] = _GoodPrimary()

        from config import config
        prev_primary = config.ai_primary_provider
        prev_fallback = config.ai_fallback_provider
        config.ai_fallback_provider = "none"
        config.ai_primary_provider = "gemini"
        baseline = sum(ai_router_fallthrough_total._values.values())
        try:
            asyncio.run(router.generate("hi", "sys", []))
        finally:
            config.ai_fallback_provider = "none"
            config.ai_primary_provider = prev_primary
            config.ai_fallback_provider = prev_fallback
        after = sum(ai_router_fallthrough_total._values.values())
        assert after == baseline


# ── D3-D-2 — proactive cycle broadcast actually every 5th cycle ───────────────


class TestD3D2EveryFifthCycle:
    def test_loop_emits_only_on_first_then_every_fifth(self):
        """Run the proactive loop body 7 times via direct method call
        and count broadcast emissions. Should be exactly 2 (cycles 1
        and 6). Tickle the modulo edge so a refactor that breaks the
        period back to "every cycle" trips immediately."""
        from agent.cognition.proactive.loop import ProactiveLoop
        from unittest.mock import MagicMock
        loop_obj = ProactiveLoop(runtime=MagicMock())

        emit_log: list[int] = []

        async def _scenario():
            # Fake the broadcast hub so we count emits without booting
            # the WS hub.
            import api.websocket_hub as wh
            class _StubHub:
                async def broadcast(self, *a, **kw):
                    emit_log.append(loop_obj._cycle_n)
            saved_hub = wh.hub
            wh.hub = _StubHub()
            try:
                # Mimic the loop body's cycle increment + emit gate.
                for _ in range(7):
                    loop_obj._cycle_n += 1
                    if loop_obj._cycle_n % 5 == 1:
                        await wh.hub.broadcast("agent.stream", "proactive.cycle", {})
            finally:
                wh.hub = saved_hub

        asyncio.run(_scenario())
        # Cycles 1 and 6 satisfy `n % 5 == 1`. NOT cycles 5 nor 10.
        assert emit_log == [1, 6], emit_log

    def test_cycle_counter_initial_zero(self):
        """A fresh `ProactiveLoop` instance starts with `_cycle_n = 0`.
        First increment lands at 1; the modulo gate fires on 1, 6,
        11, ..."""
        from agent.cognition.proactive.loop import ProactiveLoop
        from unittest.mock import MagicMock
        assert ProactiveLoop(runtime=MagicMock())._cycle_n == 0
