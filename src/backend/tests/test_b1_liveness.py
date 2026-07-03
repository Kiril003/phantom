"""B1 liveness sprint — streaming round-1, catalog trim, thought_signature.

Asserts the three latency mechanics shipped in the B1 sprint:

* `GeminiProvider.call_with_tools_stream` — text deltas flow to
  `on_delta` as they arrive; the first function_call part aborts
  consumption and returns a ToolCallResult on the tool path.
* `AIRouter.call_with_tools_stream` — primary streaming path with a
  fallback to the fully-resilient sync `call_with_tools`.
* `chat_pipeline.run` turn-1 uses the streaming router entry when an
  `on_delta` sink is provided.
* `generate()` replays the model function-call turn verbatim
  (candidate.content) so thought_signature survives — no 400s on
  multi-turn tool chains.
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from ai.tool_use import ToolCallResult, ToolErrorKind, ToolSchema, ToolUseError


def _tool(name: str = "search_web") -> ToolSchema:
    return ToolSchema(
        name=name,
        description="test tool",
        parameters={"type": "object", "properties": {}},
    )


def _text_chunk(text: str):
    part = SimpleNamespace(text=text, function_call=None)
    content = SimpleNamespace(parts=[part])
    return SimpleNamespace(candidates=[SimpleNamespace(content=content)])


def _fn_chunk(name: str, args: dict | None = None):
    fc = SimpleNamespace(name=name, args=args or {})
    part = SimpleNamespace(text=None, function_call=fc)
    content = SimpleNamespace(parts=[part])
    return SimpleNamespace(candidates=[SimpleNamespace(content=content)])


def _fake_client(chunks: list):
    async def _stream(**_kwargs):
        async def _gen():
            for c in chunks:
                yield c
        return _gen()

    aio = SimpleNamespace(models=SimpleNamespace(generate_content_stream=_stream))
    return SimpleNamespace(aio=aio)


# ── GeminiProvider.call_with_tools_stream ─────────────────────────────────────


class TestGeminiStreamRound1:
    @pytest.mark.asyncio
    async def test_text_only_streams_deltas_and_returns_no_tool(self):
        from ai.gemini_provider import GeminiProvider

        deltas: list[str] = []

        async def on_delta(t: str) -> None:
            deltas.append(t)

        client = _fake_client([_text_chunk("Прив"), _text_chunk("іт!")])
        with patch("ai.gemini_provider._get_client", return_value=client):
            out = await GeminiProvider().call_with_tools_stream(
                system_prompt="s",
                user_message="u",
                tools=[_tool()],
                history=[],
                on_delta=on_delta,
            )
        assert isinstance(out, ToolCallResult)
        assert out.tool_name == ""
        assert out.raw_reasoning == "Привіт!"
        assert deltas == ["Прив", "іт!"]

    @pytest.mark.asyncio
    async def test_function_call_switches_to_tool_path(self):
        from ai.gemini_provider import GeminiProvider

        deltas: list[str] = []

        async def on_delta(t: str) -> None:
            deltas.append(t)

        chunks = [
            _text_chunk("Зараз гляну. "),
            _fn_chunk("search_web", {"query": "météo"}),
            _text_chunk("NEVER-CONSUMED"),
        ]
        client = _fake_client(chunks)
        with patch("ai.gemini_provider._get_client", return_value=client):
            out = await GeminiProvider().call_with_tools_stream(
                system_prompt="s",
                user_message="u",
                tools=[_tool("search_web")],
                history=[],
                on_delta=on_delta,
            )
        assert isinstance(out, ToolCallResult)
        assert out.tool_name == "search_web"
        assert out.arguments == {"query": "météo"}
        # The preamble streamed; the post-fn chunk was never consumed.
        assert deltas == ["Зараз гляну. "]
        assert "NEVER-CONSUMED" not in out.raw_reasoning

    @pytest.mark.asyncio
    async def test_sanitized_names_restored(self):
        from ai.gemini_provider import GeminiProvider

        client = _fake_client([_fn_chunk("map__plan_route", {})])
        with patch("ai.gemini_provider._get_client", return_value=client):
            out = await GeminiProvider().call_with_tools_stream(
                system_prompt="s",
                user_message="u",
                tools=[_tool("map.plan_route")],
                history=[],
            )
        assert isinstance(out, ToolCallResult)
        assert out.tool_name == "map.plan_route"

    @pytest.mark.asyncio
    async def test_stream_error_returns_tool_use_error(self):
        from ai.gemini_provider import GeminiProvider

        async def _boom(**_kwargs):
            raise RuntimeError("503 UNAVAILABLE upstream")

        client = SimpleNamespace(
            aio=SimpleNamespace(models=SimpleNamespace(generate_content_stream=_boom))
        )
        with patch("ai.gemini_provider._get_client", return_value=client):
            out = await GeminiProvider().call_with_tools_stream(
                system_prompt="s",
                user_message="u",
                tools=[_tool()],
                history=[],
            )
        assert isinstance(out, ToolUseError)
        assert out.kind == ToolErrorKind.PROVIDER_UNAVAILABLE


# ── AIRouter.call_with_tools_stream ───────────────────────────────────────────


class TestRouterStreamFallback:
    def _router_with(self, provider):
        from ai.provider import AIRouter

        r = AIRouter()
        r._providers["gemini"] = provider
        return r

    @pytest.mark.asyncio
    async def test_streaming_success_returns_result(self):
        ok = ToolCallResult(tool_name="", arguments={}, raw_reasoning="hi", provider="gemini")
        provider = SimpleNamespace(
            call_with_tools_stream=AsyncMock(return_value=ok),
            call_with_tools=AsyncMock(),
        )
        router = self._router_with(provider)
        with patch("config.config.ai_primary_provider", "gemini"):
            out = await router.call_with_tools_stream(
                system_prompt="s", user_message="u", tools=[_tool()],
            )
        assert isinstance(out, ToolCallResult)
        assert out.raw_reasoning == "hi"
        provider.call_with_tools.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_stream_failure_falls_back_to_sync(self):
        err = ToolUseError(
            kind=ToolErrorKind.NETWORK, message="net", retriable=True, provider="gemini",
        )
        sync_ok = ToolCallResult(tool_name="search_web", arguments={}, provider="gemini")
        provider = SimpleNamespace(
            call_with_tools_stream=AsyncMock(return_value=err),
            call_with_tools=AsyncMock(return_value=sync_ok),
        )
        router = self._router_with(provider)
        with patch("config.config.ai_primary_provider", "gemini"):
            out = await router.call_with_tools_stream(
                system_prompt="s", user_message="u", tools=[_tool()],
            )
        assert isinstance(out, ToolCallResult)
        assert out.tool_name == "search_web"
        provider.call_with_tools.assert_awaited()

    @pytest.mark.asyncio
    async def test_stream_exception_falls_back_to_sync(self):
        sync_ok = ToolCallResult(tool_name="", arguments={}, raw_reasoning="ok", provider="gemini")
        provider = SimpleNamespace(
            call_with_tools_stream=AsyncMock(side_effect=RuntimeError("boom")),
            call_with_tools=AsyncMock(return_value=sync_ok),
        )
        router = self._router_with(provider)
        with patch("config.config.ai_primary_provider", "gemini"):
            out = await router.call_with_tools_stream(
                system_prompt="s", user_message="u", tools=[_tool()],
            )
        assert isinstance(out, ToolCallResult)
        assert out.raw_reasoning == "ok"


# ── chat_pipeline turn-1 uses the streaming entry ─────────────────────────────


class TestPipelineTurn1Streams:
    @pytest.mark.asyncio
    async def test_turn1_calls_streaming_router_when_on_delta(self):
        from ai import chat_pipeline

        no_tool = ToolCallResult(
            tool_name="", arguments={}, raw_reasoning="стрімлена відповідь",
            provider="gemini",
        )
        sanitized = SimpleNamespace(text="стрімлена відповідь")

        async def on_delta(_t: str) -> None:
            pass

        with (
            patch("ai.provider.ai_router.call_with_tools_stream",
                  new=AsyncMock(return_value=no_tool)) as stream_mock,
            patch("ai.provider.ai_router.call_with_tools",
                  new=AsyncMock()) as sync_mock,
            patch("ai.output_safety.sanitize",
                  new=AsyncMock(return_value=sanitized)),
            patch("config.config.ai_streaming", True),
            patch("config.config.chat_response_widgets_enabled", False),
        ):
            resp = await chat_pipeline.run(
                "розкажи мені про квантову заплутаність детально",
                "sys",
                [],
                user_id="u1",
                db=None,
                on_delta=on_delta,
            )
        stream_mock.assert_awaited()
        sync_mock.assert_not_awaited()
        assert resp.content == "стрімлена відповідь"

    @pytest.mark.asyncio
    async def test_no_on_delta_uses_sync_router(self):
        from ai import chat_pipeline

        no_tool = ToolCallResult(
            tool_name="", arguments={}, raw_reasoning="відповідь", provider="gemini",
        )
        sanitized = SimpleNamespace(text="відповідь")
        with (
            patch("ai.provider.ai_router.call_with_tools_stream",
                  new=AsyncMock()) as stream_mock,
            patch("ai.provider.ai_router.call_with_tools",
                  new=AsyncMock(return_value=no_tool)) as sync_mock,
            patch("ai.output_safety.sanitize",
                  new=AsyncMock(return_value=sanitized)),
            patch("config.config.chat_response_widgets_enabled", False),
        ):
            resp = await chat_pipeline.run(
                "розкажи мені про квантову заплутаність детально",
                "sys",
                [],
                user_id="u1",
                db=None,
            )
        sync_mock.assert_awaited()
        stream_mock.assert_not_awaited()
        assert resp.content == "відповідь"


# ── tool_relevance — round-1 catalog trim ─────────────────────────────────────


class TestToolRelevance:
    def _available(self) -> list[str]:
        from ai.chat_tool_dispatcher import supported_tools
        from ai.response_formatter import RESPONSE_FORM_TOOLS

        return supported_tools() + [t["name"] for t in RESPONSE_FORM_TOOLS]

    def test_cap_15(self):
        from ai.tool_relevance import select_relevant, MAX_ROUND1_TOOLS

        picked = select_relevant(
            "створи таймер, подію в календарі, знайди маршрут, покажи метрики "
            "і порівняй курси у графіку через агента в терміналі",
            self._available(),
        )
        assert 0 < len(picked) <= MAX_ROUND1_TOOLS

    def test_family_match_beats_core(self):
        from ai.tool_relevance import select_relevant

        picked = select_relevant("постав будильник на 7 ранку", self._available())
        assert picked[0] == "create_alarm"
        assert "vault_reveal" not in picked

    def test_no_signal_falls_back_to_core(self):
        from ai.tool_relevance import select_relevant, CORE_TOOLS

        picked = select_relevant(
            "розкажи про квантову заплутаність", self._available(),
        )
        assert picked
        assert set(picked).issubset(set(CORE_TOOLS))

    def test_widget_triggers(self):
        from ai.tool_relevance import select_relevant

        picked = select_relevant(
            "намалюй графік температури за тиждень", self._available(),
        )
        assert "respond_chart" in picked

    def test_only_available_names_survive(self):
        from ai.tool_relevance import select_relevant

        picked = select_relevant("постав таймер на 5 хв", ["create_timer"])
        assert picked == ["create_timer"]

    def test_pipeline_trim_never_empties_catalog(self):
        from ai.chat_pipeline import _CatalogTool, _trim_tool_catalog

        catalog = [_CatalogTool(name="weird_tool_zzz", function={"name": "weird_tool_zzz"})]
        out = _trim_tool_catalog(catalog, "розкажи про квантову заплутаність")
        assert out == catalog  # nothing matched → full catalog, never []

    def test_pipeline_trim_filters_merged_catalog(self, monkeypatch):
        from config import config
        from ai.chat_pipeline import _build_tool_catalog, _trim_tool_catalog
        from ai.tool_relevance import MAX_ROUND1_TOOLS

        monkeypatch.setattr(config, "chat_response_widgets_enabled", True)
        full = _build_tool_catalog()
        trimmed = _trim_tool_catalog(full, "постав будильник на 7 ранку")
        assert len(trimmed) <= MAX_ROUND1_TOOLS < len(full)
        assert any(t.name == "create_alarm" for t in trimmed)


# ── thought_signature — verbatim function-call replay ─────────────────────────


class TestThoughtSignatureReplay:
    @pytest.mark.asyncio
    async def test_generate_replays_candidate_content_verbatim(self):
        """The tool loop must append the SDK candidate.content object, not a
        rebuilt {"function_call": ...} dict (which drops thought_signature)."""
        from ai.gemini_provider import GeminiProvider

        fc = SimpleNamespace(name="get_system_metrics", args={})
        fn_part = SimpleNamespace(text=None, function_call=fc)
        model_content = SimpleNamespace(parts=[fn_part], role="model")
        fn_response = SimpleNamespace(
            candidates=[SimpleNamespace(content=model_content, finish_reason=None)],
            usage_metadata=None,
            text="",
        )
        final_part = SimpleNamespace(text="готово", function_call=None)
        final_response = SimpleNamespace(
            candidates=[SimpleNamespace(
                content=SimpleNamespace(parts=[final_part], role="model"),
                finish_reason=None,
            )],
            usage_metadata=None,
            text="готово",
        )

        captured_contents: list = []

        async def _generate_content(*, model, contents, config):
            captured_contents.append(list(contents))
            return fn_response if len(captured_contents) == 1 else final_response

        client = SimpleNamespace(
            aio=SimpleNamespace(models=SimpleNamespace(generate_content=_generate_content))
        )
        with (
            patch("ai.gemini_provider._get_client", return_value=client),
            patch("ai.gemini_provider.execute_tool",
                  new=AsyncMock(return_value={"ok": True, "result": {}})),
            patch("config.config.chat_tools_enabled", True),
            patch("config.config.chat_response_widgets_enabled", False),
        ):
            out = await GeminiProvider().generate(
                "u", "s", [], user_id="u1",
            )
        assert out.content == "готово"
        # Second call's contents must contain the exact model_content object.
        second = captured_contents[1]
        assert any(c is model_content for c in second), (
            "thought_signature regression: model function-call turn was "
            "rebuilt as a dict instead of replaying candidate.content"
        )
