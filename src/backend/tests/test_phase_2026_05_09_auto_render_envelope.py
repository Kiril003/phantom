"""Phase 2026-05-09 — `_auto_render_envelope` Step-4.5 short-circuit.

Why this test exists
--------------------
Gemini's round-2 widget pick was unreliable: with `recall_memory_facts`
it picked `respond_code` and rendered the function-call syntax as Python
in the operator's chat. With `search_web` it picked `respond_terminal`
with a curl. The chain "data tool → widget render" worked in principle
but Gemini didn't reliably populate widget args from the envelope.

The fix lives in `chat_pipeline.run()` Step 4.5 — for tools with a
stable result shape we render the widget directly, no second LLM
round, no syntax leak. This file pins down:

1. Each shaped tool produces the right widget AIResponse.
2. The Step-5 LLM round is NOT touched (no token spend, no leak).
3. Side-effect tools (e.g. `create_timer`) keep falling through to
   the existing dispatch + Step-5 path so their `scene` attachment
   logic is unaffected.
4. Failed dispatches and unknown tools fall through (None).
"""
from __future__ import annotations

import pytest

from ai import chat_pipeline
from ai.provider import AIResponse
from ai.tool_use import ToolCallResult


# ── Unit: the helper itself ───────────────────────────────────────────────────


class TestAutoRenderEnvelopeUnit:
    def test_get_system_metrics_produces_metric_cards(self):
        r = chat_pipeline._auto_render_envelope(
            "get_system_metrics",
            {"ok": True, "result": {
                "cpu_pct": 38.4, "ram_pct": 62.1, "disk_pct": 71.3,
                "load_1min": 0.84,
            }},
            None,
        )
        assert isinstance(r, AIResponse)
        assert r.response_form == "metric_cards"
        assert r.attachments[0]["type"] == "metric_card"
        labels = [m["label"] for m in r.attachments[0]["data"]["metrics"]]
        assert labels == ["CPU", "RAM", "Диск", "Load"]

    def test_search_web_produces_markdown_with_sources(self):
        r = chat_pipeline._auto_render_envelope(
            "search_web",
            {"ok": True, "result": {
                "summary": "Київ +12°C",
                "sources": [{"title": "meteo", "url": "https://x.test/a"}],
                "grounded": True,
            }},
            None,
        )
        assert isinstance(r, AIResponse)
        assert r.response_form == "markdown"
        assert "Київ" in r.content
        assert "meteo" in r.content
        assert "https://x.test/a" in r.content

    def test_recall_memory_facts_uses_results_key_not_facts(self):
        # Regression: the dispatcher returns `result={"results": [...]}`
        # (from tool_executor's `_ok(results=...)`). An earlier draft of
        # `_auto_render_envelope` looked for `result["facts"]` and produced
        # an empty bullet list for any actual recall — silently. Pin the
        # correct key here.
        r = chat_pipeline._auto_render_envelope(
            "recall_memory_facts",
            {"ok": True, "result": {
                "results": [
                    {"content": "Кирил - оператор"},
                    {"content": "Працює українською"},
                ],
                "count": 2,
            }},
            None,
        )
        assert isinstance(r, AIResponse)
        assert r.response_form == "markdown"
        assert "Кирил" in r.content
        assert "українською" in r.content

    def test_recall_memory_facts_empty_returns_text(self):
        r = chat_pipeline._auto_render_envelope(
            "recall_memory_facts",
            {"ok": True, "result": {"results": [], "count": 0}},
            None,
        )
        assert isinstance(r, AIResponse)
        assert r.response_form == "text"
        assert "Поки що" in r.content

    def test_failed_dispatch_falls_through(self):
        assert chat_pipeline._auto_render_envelope(
            "search_web",
            {"ok": False, "error": "unavailable"},
            None,
        ) is None

    def test_side_effect_tool_falls_through(self):
        # create_timer + scene must keep the existing dispatch + Step-5
        # path; the operator wants an LLM-written confirmation alongside
        # the timer scene attachment.
        assert chat_pipeline._auto_render_envelope(
            "create_timer",
            {"ok": True, "result": {"id": "t-1", "scene": {"kind": "timer"}}},
            {"kind": "timer"},
        ) is None

    def test_unknown_tool_falls_through(self):
        assert chat_pipeline._auto_render_envelope(
            "unknown_tool",
            {"ok": True, "result": {"foo": 1}},
            None,
        ) is None

    def test_get_system_metrics_empty_falls_through(self):
        assert chat_pipeline._auto_render_envelope(
            "get_system_metrics",
            {"ok": True, "result": {}},
            None,
        ) is None

    def test_search_web_empty_falls_through(self):
        assert chat_pipeline._auto_render_envelope(
            "search_web",
            {"ok": True, "result": {"summary": "", "sources": []}},
            None,
        ) is None

    def test_get_my_location_produces_map(self):
        r = chat_pipeline._auto_render_envelope(
            "get_my_location",
            {"ok": True, "result": {"lat": 49.8, "lon": 24.0, "place_name": "Kyiv", "accuracy_m": 10.0}},
            None,
        )
        assert isinstance(r, AIResponse)
        assert r.response_form == "map"
        assert r.attachments[0]["type"] == "map_markers"
        assert r.attachments[0]["data"]["markers"][0]["lat"] == 49.8
        assert r.attachments[0]["data"]["center"] == [49.8, 24.0]

    def test_get_my_location_no_gps_produces_text(self):
        r = chat_pipeline._auto_render_envelope(
            "get_my_location",
            {"ok": True, "result": {"lat": None, "lon": None, "place_name": "Unknown"}},
            None,
        )
        assert isinstance(r, AIResponse)
        assert r.response_form == "text"
        assert "GPS недоступний" in r.content


# ── Integration: full chat_pipeline.run() short-circuit ──────────────────────


class TestAutoRenderShortCircuitsStep5:
    """Step 4.5 must return BEFORE the Step-5 LLM round. Otherwise we
    pay tokens, latency, and risk Gemini still picking the wrong widget.
    These tests stub out the round-2 generate; if it gets called we fail.
    """

    @pytest.mark.asyncio
    async def test_get_system_metrics_short_circuits(self, monkeypatch):
        await self._assert_short_circuit(
            monkeypatch,
            tool_name="get_system_metrics",
            payload={"cpu_pct": 38.0, "ram_pct": 62.0, "disk_pct": 71.0,
                     "load_1min": 0.84},
            expect_form="metric_cards",
            expect_in_content=None,
            expect_attachment_type="metric_card",
        )

    @pytest.mark.asyncio
    async def test_search_web_short_circuits(self, monkeypatch):
        await self._assert_short_circuit(
            monkeypatch,
            tool_name="search_web",
            payload={"summary": "Київ +12°C",
                     "sources": [{"title": "meteo", "url": "https://x.test/a"}],
                     "grounded": True},
            expect_form="markdown",
            expect_in_content="meteo",
            expect_attachment_type=None,
        )

    @pytest.mark.asyncio
    async def test_recall_memory_facts_short_circuits(self, monkeypatch):
        await self._assert_short_circuit(
            monkeypatch,
            tool_name="recall_memory_facts",
            payload={"results": [
                {"content": "Кирил - оператор"},
                {"content": "Працює українською"},
            ], "count": 2},
            expect_form="markdown",
            expect_in_content="Кирил",
            expect_attachment_type=None,
        )

    async def _assert_short_circuit(
        self, monkeypatch, *,
        tool_name: str, payload: dict,
        expect_form: str,
        expect_in_content: str | None,
        expect_attachment_type: str | None,
    ):
        round2_calls: list[tuple] = []

        async def _stub_cwt(**_kw):
            return ToolCallResult(
                tool_name=tool_name, arguments={},
                provider="gemini", model="stub",
            )

        async def _stub_dispatch(name, _args, *, user_id, db):
            return {"ok": True, "name": name, "result": payload, "elapsed_ms": 3}

        async def _stub_generate(**kw):
            round2_calls.append(("generate", kw))
            return AIResponse(content="LEAKED ROUND-2", provider="gemini")

        monkeypatch.setattr(chat_pipeline.ai_router, "call_with_tools", _stub_cwt)
        monkeypatch.setattr("ai.chat_tool_dispatcher.dispatch", _stub_dispatch)
        monkeypatch.setattr(chat_pipeline.ai_router, "generate", _stub_generate)

        result = await chat_pipeline.run(
            user_message="?", system_prompt="sys",
            history=[], user_id="u-test", db=None,  # type: ignore[arg-type]
        )

        assert result.response_form == expect_form, (
            f"want {expect_form}, got {result.response_form}; "
            f"content={result.content!r}"
        )
        if expect_in_content:
            assert expect_in_content in result.content, (
                f"missing {expect_in_content!r} in {result.content!r}"
            )
        if expect_attachment_type:
            atts = [
                a for a in (result.attachments or [])
                if isinstance(a, dict) and a.get("type") == expect_attachment_type
            ]
            assert atts, (
                f"missing {expect_attachment_type!r} attachment in "
                f"{result.attachments!r}"
            )
        # The whole point: Gemini round-2 must NOT have been touched.
        assert not round2_calls, (
            f"Step 4.5 leaked into Step-5 generate(): {round2_calls}"
        )

    @pytest.mark.asyncio
    async def test_side_effect_tool_avoids_widget_hallucination(self, monkeypatch):
        """Symptom-A fix: a side-effect tool that returns a `scene` must NOT
        be short-circuited into a widget AIResponse — it falls through
        `_auto_render_envelope`, runs the real dispatcher + Step-5 generate,
        and the operator gets an LLM-written confirmation with the timer
        scene promoted to an attachment (no `respond_terminal`-style
        hallucinated widget form).

        Rewritten 2026-05-15: the original asserted against a removed
        `chat_pipeline.ai_hub.dispatch("chat_subtask")` architecture. The
        current pipeline uses `ai_router.call_with_tools` + the
        `chat_tool_dispatcher`; this exercises the same invariant on that
        API (mirrors test_phase27::test_create_timer_goes_through_dispatcher).
        """
        generate_calls: list[dict] = []

        async def _stub_cwt(**_kw):
            return ToolCallResult(
                tool_name="create_timer", arguments={"minutes": 5},
                provider="gemini", model="stub",
            )

        async def _stub_tool_dispatch(name, _args, *, user_id, db):
            return {
                "ok": True,
                "name": name,
                "result": {"id": "t-1", "scene": {"kind": "timer"}},
                "elapsed_ms": 3,
            }

        async def _stub_generate(**kw):
            generate_calls.append(kw)
            return AIResponse(
                content="Таймер встановлено.",
                provider="gemini",
                response_form="text",
            )

        monkeypatch.setattr(chat_pipeline.ai_router, "call_with_tools", _stub_cwt)
        monkeypatch.setattr("ai.chat_tool_dispatcher.dispatch", _stub_tool_dispatch)
        monkeypatch.setattr(chat_pipeline.ai_router, "generate", _stub_generate)

        result = await chat_pipeline.run(
            user_message="таймер на 5 хвилин", system_prompt="sys",
            history=[], user_id="u-test", db=None,  # type: ignore[arg-type]
        )

        # Step-5 generate DID run (side-effect tool is NOT widget-short-
        # circuited) and produced a plain-text confirmation.
        assert generate_calls, "side-effect tool must reach the Step-5 generate"
        assert result.response_form == "text"
        # The dispatch scene is promoted to an attachment, not rendered as
        # a hallucinated widget form.
        scene_atts = [
            a for a in (result.attachments or [])
            if isinstance(a, dict) and a.get("type") == "scene"
        ]
        assert scene_atts, f"expected scene attachment, got {result.attachments}"
        assert scene_atts[0]["data"]["kind"] == "timer"
