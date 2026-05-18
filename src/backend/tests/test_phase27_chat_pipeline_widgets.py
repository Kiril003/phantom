"""Phase 27-a — chat_pipeline widget short-circuit tests.

Closes the operator-reported bug "AI завжди відповідає plain text".

Pre-27a the chat pipeline only offered side-effect tools (alarm/timer/
calendar/vault/...) on its single tool-call round; widget tools
(respond_chart / respond_map / respond_metrics / ...) were defined but
never reached the LLM. Phase 27-a merges them into one catalog and
short-circuits past the dispatcher + final-generate when the LLM picks
a respond_* tool.

Asserts:

* `_build_tool_catalog()` includes every entry from `_filter_safe_tools()`
  AND every entry from `RESPONSE_FORM_TOOLS`.
* When the LLM picks a respond_* widget tool, `chat_pipeline.run` returns
  the widget AIResponse without calling `chat_tool_dispatcher.dispatch`
  or `ai_router.generate` (the second-round LLM call).
* The widget AIResponse carries the parsed `response_form` + attachments
  matching `parse_function_call`'s contract.
* Side-effect tools STILL go through the dispatcher (regression guard).
"""

from __future__ import annotations

import pytest


# ── Catalog merge ─────────────────────────────────────────────────────────────


class TestMergedToolCatalog:
    def test_catalog_excludes_widget_tools_by_default(self):
        from ai.chat_pipeline import _build_tool_catalog
        from ai.response_formatter import RESPONSE_FORM_TOOLS

        catalog = _build_tool_catalog()
        names = {t.name for t in catalog}
        widget_names = {t["name"] for t in RESPONSE_FORM_TOOLS}

        assert widget_names
        assert names.isdisjoint(widget_names)

    def test_catalog_includes_widget_tools_when_enabled(self, monkeypatch):
        from ai.chat_pipeline import _build_tool_catalog
        from ai.response_formatter import RESPONSE_FORM_TOOLS
        from config import config

        monkeypatch.setattr(config, "chat_response_widgets_enabled", True)

        catalog = _build_tool_catalog()
        names = {t.name for t in catalog}
        widget_names = {t["name"] for t in RESPONSE_FORM_TOOLS}

        assert widget_names, "RESPONSE_FORM_TOOLS is empty — sanity"
        assert widget_names.issubset(names), (
            "Phase 27-a regression: widget tools missing from chat "
            f"pipeline catalog. Missing: {widget_names - names}"
        )

    def test_catalog_includes_side_effect_tools(self):
        from ai.chat_pipeline import _build_tool_catalog, _filter_safe_tools

        catalog = _build_tool_catalog()
        names = {t.name for t in catalog}
        side_effect_names = {t["name"] for t in _filter_safe_tools()}

        assert side_effect_names, "side-effect catalog is empty — sanity"
        assert side_effect_names.issubset(names), (
            "Phase 27-a regression: side-effect tools dropped from "
            f"chat pipeline catalog. Missing: {side_effect_names - names}"
        )

    def test_catalog_no_duplicates(self):
        from ai.chat_pipeline import _build_tool_catalog

        catalog = _build_tool_catalog()
        names = [t.name for t in catalog]
        assert len(names) == len(set(names)), (
            "Phase 27-a regression: chat pipeline catalog has duplicate "
            f"tool names: {[n for n in names if names.count(n) > 1]}"
        )


# ── Widget short-circuit ──────────────────────────────────────────────────────


class TestWidgetShortCircuit:
    @pytest.mark.asyncio
    async def test_respond_chart_returns_widget_no_dispatch(self, monkeypatch):
        """LLM picks respond_chart → AIResponse with response_form='chart'
        and chart_data attachment, no dispatcher call, no second LLM call.
        """
        from ai import chat_pipeline
        from ai.tool_use import ToolCallResult
        from config import config

        monkeypatch.setattr(config, "chat_response_widgets_enabled", True)

        chart_args = {
            "content": "CPU тренд за тиждень",
            "chart_type": "line",
            "data": [
                {"name": "Mon", "cpu": 32},
                {"name": "Tue", "cpu": 41},
                {"name": "Wed", "cpu": 28},
            ],
            "title": "CPU per day",
            "x_key": "name",
            "y_keys": ["cpu"],
        }

        async def _stub_cwt(**kw):
            return ToolCallResult(
                tool_name="respond_chart",
                arguments=chart_args,
                provider="gemini",
                model="stub",
            )

        # Sentinels — must NOT be called for widget short-circuit.
        dispatch_calls: list[tuple] = []
        generate_calls: list[tuple] = []

        async def _forbidden_dispatch(name, args, *, user_id, db):
            dispatch_calls.append((name, args))
            return {"ok": False, "error": "should not have been called"}

        async def _forbidden_generate(**kw):
            generate_calls.append(kw)
            from ai.provider import AIResponse
            return AIResponse(content="should not appear", provider="x")

        monkeypatch.setattr(
            chat_pipeline.ai_router, "call_with_tools", _stub_cwt
        )
        monkeypatch.setattr(
            "ai.chat_tool_dispatcher.dispatch", _forbidden_dispatch
        )
        monkeypatch.setattr(
            chat_pipeline.ai_router, "generate", _forbidden_generate
        )

        result = await chat_pipeline.run(
            user_message="покажи мені CPU графік за тиждень",
            system_prompt="sys",
            history=[],
            user_id="u-test",
            db=None,  # type: ignore[arg-type]
        )

        # Widget AIResponse landed.
        assert result.response_form == "chart", (
            f"expected response_form='chart', got {result.response_form!r}"
        )
        assert "тренд" in result.content.lower() or "cpu" in result.content.lower()
        # chart_data attachment present.
        chart_atts = [
            a for a in (result.attachments or [])
            if isinstance(a, dict) and a.get("type") == "chart_data"
        ]
        assert chart_atts, (
            f"expected at least one chart_data attachment, got: {result.attachments}"
        )
        assert chart_atts[0]["data"]["chart_type"] == "line"
        assert chart_atts[0]["data"]["data"] == chart_args["data"]
        # NEITHER dispatcher NOR final generate fired.
        assert not dispatch_calls, (
            f"Phase 27-a invariant: respond_* tools must NOT go through "
            f"chat_tool_dispatcher.dispatch. Got: {dispatch_calls}"
        )
        assert not generate_calls, (
            f"Phase 27-a invariant: respond_* tools must short-circuit "
            f"the second-round generate(). Got: {generate_calls}"
        )

    @pytest.mark.asyncio
    async def test_respond_metrics_returns_widget(self, monkeypatch):
        """respond_metrics short-circuit produces metric_card attachment."""
        from ai import chat_pipeline
        from ai.tool_use import ToolCallResult
        from config import config

        monkeypatch.setattr(config, "chat_response_widgets_enabled", True)

        metrics_args = {
            "content": "Поточні показники",
            "metrics": [
                {"label": "CPU", "value": 38, "unit": "%", "trend": "stable"},
                {"label": "RAM", "value": 62, "unit": "%", "trend": "up"},
                {"label": "Battery", "value": 81, "unit": "%", "trend": "down"},
            ],
        }

        async def _stub_cwt(**kw):
            return ToolCallResult(
                tool_name="respond_metrics",
                arguments=metrics_args,
                provider="gemini",
                model="stub",
            )

        monkeypatch.setattr(
            chat_pipeline.ai_router, "call_with_tools", _stub_cwt
        )

        result = await chat_pipeline.run(
            user_message="скільки CPU зараз?",
            system_prompt="sys",
            history=[],
            user_id="u-test",
            db=None,  # type: ignore[arg-type]
        )

        assert result.response_form == "metric_cards"
        metric_atts = [
            a for a in (result.attachments or [])
            if isinstance(a, dict) and a.get("type") == "metric_card"
        ]
        assert metric_atts, f"missing metric_card attachment: {result.attachments}"
        assert len(metric_atts[0]["data"]["metrics"]) == 3


# ── Regression: side-effect tools still dispatch ──────────────────────────────


class TestSideEffectStillDispatches:
    @pytest.mark.asyncio
    async def test_create_timer_goes_through_dispatcher(self, monkeypatch):
        """Phase 27-a must NOT regress side-effect dispatch. When the LLM
        picks a non-respond_ tool, the existing dispatcher + final-generate
        path still fires."""
        from ai import chat_pipeline
        from ai.provider import AIResponse
        from ai.tool_use import ToolCallResult

        async def _stub_cwt(**kw):
            return ToolCallResult(
                tool_name="create_timer",
                arguments={"label": "tea", "duration_s": 120},
                provider="gemini",
                model="stub",
            )

        dispatched: list[str] = []

        async def _stub_dispatch(name, args, *, user_id, db):
            dispatched.append(name)
            return {
                "ok": True,
                "name": name,
                "result": {"id": "t-1", "label": "tea", "scene": {
                    "kind": "timer",
                    "data": {"timer_id": "t-1", "label": "tea"},
                }},
                "elapsed_ms": 3,
            }

        async def _stub_generate(**kw):
            return AIResponse(
                content="Таймер запущено",
                provider="gemini",
                response_form="text",
            )

        monkeypatch.setattr(
            chat_pipeline.ai_router, "call_with_tools", _stub_cwt
        )
        monkeypatch.setattr(
            "ai.chat_tool_dispatcher.dispatch", _stub_dispatch
        )
        monkeypatch.setattr(
            chat_pipeline.ai_router, "generate", _stub_generate
        )

        result = await chat_pipeline.run(
            user_message="постав таймер 2 хв",
            system_prompt="sys",
            history=[],
            user_id="u-test",
            db=None,  # type: ignore[arg-type]
        )

        assert dispatched == ["create_timer"], (
            f"Phase 27-a regression: side-effect tool bypassed the "
            f"dispatcher. dispatched={dispatched}"
        )
        # The tool's scene field promoted to attachments.
        scene_atts = [
            a for a in (result.attachments or [])
            if isinstance(a, dict) and a.get("type") == "scene"
        ]
        assert scene_atts, (
            f"expected scene attachment from timer dispatch, got: "
            f"{result.attachments}"
        )
        assert scene_atts[0]["data"]["kind"] == "timer"
