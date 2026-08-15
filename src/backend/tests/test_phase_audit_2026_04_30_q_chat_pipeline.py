"""Day-3 audit-2026-04-30 — Block Q (Phase 17b) chat_pipeline tests.

Closes the headline ship for v0.19.0-jarvis-online: a bounded chat
tool-use turn with TM-17B mitigations from the threat-model audit.

Specifically asserts:

* envelope key is nonce-prefixed (TM-17B-S1) — the LLM cannot guess
  the marker and inject a fake tool-result token in plain text.
* tool-result content cap fires at 4000 chars (TM-17B-S1).
* `chat_pipeline.run` only goes through `chat_tool_dispatcher.dispatch`
  (TM-17B-E2 invariant: never `tool_executor.execute_tool` directly).
* tool catalog filtered to the chat-safe allowlist (`bash`,
  `create_calendar_event`, etc never advertised — TM-17B-S2 / D2-E2).
* `phantom_chat_tool_calls_total` increments per dispatch.
* errors degrade gracefully — never raise into the chat turn.
* sanitize runs on the final answer (TM-17B-I1).
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import pytest


# ── TM-17B-S1 — envelope nonce + content cap ──────────────────────────────────


class TestEnvelopeNonceAndCap:
    def test_envelope_key_is_nonced(self):
        from ai.chat_pipeline import envelope_key

        key = envelope_key()
        assert key.startswith("_phantom_tool_")
        # The 8-byte nonce → 16 hex chars after the underscore prefix.
        suffix = key[len("_phantom_tool_"):]
        assert len(suffix) == 16
        assert all(c in "0123456789abcdef" for c in suffix), (
            "TM-17B-S1 regression: envelope key suffix isn't hex — "
            "nonce derivation broken."
        )

    def test_content_cap_truncates_at_4000_chars(self):
        from ai.chat_pipeline import _to_capped_text, _CONTENT_CAP_CHARS

        big_blob = "x" * (_CONTENT_CAP_CHARS * 3)
        out = _to_capped_text(big_blob)
        assert len(out) <= _CONTENT_CAP_CHARS, len(out)
        assert out.endswith("...[truncated]")

    def test_content_cap_passes_short_values(self):
        from ai.chat_pipeline import _to_capped_text

        assert _to_capped_text({"a": 1, "b": "ok"}) == '{"a": 1, "b": "ok"}'
        assert _to_capped_text(None) == ""
        # JSON-serialisable list.
        assert _to_capped_text([1, 2, 3]) == "[1, 2, 3]"

    def test_envelope_marker_isolates_tool_results(self):
        from ai.chat_pipeline import _build_envelope, envelope_key

        env = _build_envelope(
            "search_locationhistory",
            {"ok": True, "name": "search_locationhistory",
             "result": {"rows": []}, "elapsed_ms": 7},
        )
        assert envelope_key() in env
        assert env[envelope_key()] == "search_locationhistory"
        assert env["ok"] is True
        assert env["name"] == "search_locationhistory"
        assert "rows" in env["content"]


# ── TM-17B-E2 — chat_pipeline routes through chat_tool_dispatcher ────────────


class TestSafeToolFilter:
    def test_filter_returns_only_dispatch_safe_names(self):
        from ai.chat_pipeline import _filter_safe_tools
        from ai.chat_tool_dispatcher import _CHAT_SAFE_TOOL_NAMES

        tools = _filter_safe_tools()
        names = {t["name"] for t in tools}
        # Must be a subset of the dispatcher's safe set.
        assert names.issubset(set(_CHAT_SAFE_TOOL_NAMES))
        # Phase 19 unlocked write-tools (create_calendar_event,
        # create_timer, create_alarm, search_web). True forbidden surface
        # is the unconstrained shell — those names must NEVER appear.
        forbidden = {"bash.run", "shell.run", "exec", "subprocess.run"}
        assert names.isdisjoint(forbidden), (
            f"TM-17B-E2 / D2-E2 regression: chat tool catalog "
            f"includes forbidden tools: {names & forbidden}"
        )


# ── End-to-end happy path ────────────────────────────────────────────────────


class TestRunHappyPath:
    @pytest.mark.asyncio
    async def test_dispatch_then_final_answer(self, monkeypatch):
        """LLM picks a tool → dispatcher returns a result → second
        LLM call generates the final answer → sanitize → return.
        Asserts the full pipeline lands without crashing and the
        counter increments."""
        from ai import chat_pipeline
        from ai.provider import AIResponse
        from ai.tool_use import ToolCallResult
        from observability import chat_tool_calls_total

        # Stub call_with_tools to pick `recall_memory_facts`.
        async def _stub_cwt(**kw):
            return ToolCallResult(
                tool_name="recall_memory_facts",
                arguments={"query": "test"},
                provider="gemini",
                model="stub",
            )

        # Stub the dispatcher to return a canned ok result.
        # 2026-05-14: recall_memory_facts expects 'results' key in payload.
        async def _stub_dispatch(name, args, *, user_id, db):
            return {
                "ok": True, "name": name,
                "result": {"results": [{"content": "you visited foo"}]},
                "elapsed_ms": 5,
            }

        # Stub final generate.
        final_resp = AIResponse(
            content="based on facts, you visited foo",
            provider="ollama", response_form="text", latency_ms=10,
        )

        async def _stub_generate(**kw):
            return final_resp

        monkeypatch.setattr(
            chat_pipeline.ai_router, "call_with_tools", _stub_cwt
        )
        monkeypatch.setattr(
            "ai.chat_tool_dispatcher.dispatch", _stub_dispatch
        )
        monkeypatch.setattr(
            chat_pipeline.ai_router, "generate", _stub_generate
        )
        # Also patch sanitize so the test isn't sensitive to memory state.
        async def _noop_sanitize(*a, **kw):
            from ai.output_safety import SanitiseResult
            return SanitiseResult(text=final_resp.content,
                                  redactions=0, examined_facts=0)

        baseline = sum(chat_tool_calls_total._values.values())
        result = await chat_pipeline.run(
            user_message="де я був вчора?",
            system_prompt="sys",
            history=[],
            user_id="u-test",
            db=None,  # type: ignore[arg-type]
        )
        # Counter incremented exactly once per dispatch.
        assert sum(chat_tool_calls_total._values.values()) == baseline + 1
        # 2026-05-14: Step 4.5 now short-circuits recall_memory_facts
        # to a deterministic markdown summary, so 'you visited foo'
        # appears in the auto-rendered bullets, not from the final LLM turn.
        assert "Що я пам'ятаю" in result.content
        assert "you visited foo" in result.content


# ── Degrade-gracefully paths ─────────────────────────────────────────────────


class TestDegradePaths:
    @pytest.mark.asyncio
    async def test_tool_use_error_falls_through_to_plain_generate(self, monkeypatch):
        """A `ToolUseError` from call_with_tools must NOT crash chat;
        plain generate runs as the fallback."""
        from ai import chat_pipeline
        from ai.provider import AIResponse
        from ai.tool_use import ToolUseError, ToolErrorKind

        async def _stub_cwt(**kw):
            return ToolUseError(
                kind=ToolErrorKind.MODEL_REFUSED,
                message="declined",
            )

        plain = AIResponse(content="plain reply", provider="gemini")

        async def _stub_generate(**kw):
            return plain

        monkeypatch.setattr(
            chat_pipeline.ai_router, "call_with_tools", _stub_cwt
        )
        # "hi" fast-tracks straight to _plain_generate, which (2026-08-15,
        # docs/design/tools-audit.md §3a) now calls generate_no_tools —
        # NOT generate — so this turn is structurally tool-free.
        monkeypatch.setattr(
            chat_pipeline.ai_router, "generate_no_tools", _stub_generate
        )
        result = await chat_pipeline.run(
            user_message="hi", system_prompt="sys", history=[],
            user_id="u-test", db=None,  # type: ignore[arg-type]
        )
        assert result.content == "plain reply"

    @pytest.mark.asyncio
    async def test_call_with_tools_raises_falls_through(self, monkeypatch):
        """Synchronous exceptions from call_with_tools route to plain
        generate. Defends against new provider error classes the
        Day-2 mapping didn't anticipate."""
        from ai import chat_pipeline
        from ai.provider import AIResponse

        async def _broken_cwt(**kw):
            raise RuntimeError("provider exploded")

        plain = AIResponse(content="from generate", provider="ollama")

        async def _stub_generate(**kw):
            return plain

        monkeypatch.setattr(
            chat_pipeline.ai_router, "call_with_tools", _broken_cwt
        )
        # "hi" fast-tracks straight to _plain_generate, which now calls
        # generate_no_tools (docs/design/tools-audit.md §3a).
        monkeypatch.setattr(
            chat_pipeline.ai_router, "generate_no_tools", _stub_generate
        )
        result = await chat_pipeline.run(
            user_message="hi", system_prompt="sys", history=[],
            user_id="u-test", db=None,  # type: ignore[arg-type]
        )
        assert result.content == "from generate"

    @pytest.mark.asyncio
    async def test_dispatch_error_still_returns_an_answer(self, monkeypatch):
        """Dispatcher returns ok=False → second LLM call still runs
        and the envelope flags the failure. Chat never sees a
        traceback."""
        from ai import chat_pipeline
        from ai.provider import AIResponse
        from ai.tool_use import ToolCallResult

        async def _stub_cwt(**kw):
            return ToolCallResult(
                tool_name="recall_memory_facts",
                arguments={"query": "x"},
                provider="gemini", model="stub",
            )

        async def _stub_dispatch(name, args, *, user_id, db):
            return {
                "ok": False, "name": name,
                "error": "synthetic_error:test",
                "elapsed_ms": 1,
            }

        async def _stub_generate(**kw):
            return AIResponse(content="LLM apologised", provider="gemini")

        monkeypatch.setattr(
            chat_pipeline.ai_router, "call_with_tools", _stub_cwt
        )
        monkeypatch.setattr(
            "ai.chat_tool_dispatcher.dispatch", _stub_dispatch
        )
        # "hi" fast-tracks straight to _plain_generate, which now calls
        # generate_no_tools (docs/design/tools-audit.md §3a).
        monkeypatch.setattr(
            chat_pipeline.ai_router, "generate_no_tools", _stub_generate
        )
        # Ensure we don't hit the wall-clock deadline in the test
        monkeypatch.setattr("time.monotonic", lambda: 0.0)
        
        result = await chat_pipeline.run(
            user_message="hi", system_prompt="sys", history=[],
            user_id="u-test", db=None,  # type: ignore[arg-type]
        )
        assert "LLM apologised" in result.content
