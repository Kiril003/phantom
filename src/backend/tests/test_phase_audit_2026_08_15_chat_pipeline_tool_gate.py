"""Audit 2026-08-15 (docs/design/tools-audit.md §3a) — reproduces the
gate leak before fixing it.

`ai/chat_pipeline.py`'s own module docstring states the invariant:

    "chat tool-use NEVER reaches `tool_executor.execute_tool` directly;
    the dispatcher is the only path" (chat_pipeline.py:7-10)

and documents Step 5 as "ask the LLM for a final answer... no tools
advertised this round" (chat_pipeline.py:16-17).

In code, Step 5 calls `ai_router.generate(...)` with the real `user_id`
still attached. `GeminiProvider.generate()` (ai/gemini_provider.py) has
its OWN independent tool-merge/execute logic gated only on
`config.chat_tools_enabled is True and user_id is not None` — both true
on every Step-5 call — so it re-merges the full, unfiltered 59-name
`CHAT_DATA_TOOLS` catalog and, if the model picks one, executes it via
`ai.tool_executor.execute_tool` DIRECTLY, bypassing
`ai/chat_tool_dispatcher.py`'s allowlist and
`chat_pipeline._filter_safe_tools()`'s trim entirely.

This test drives `chat_pipeline.run()` for real (no stubbing of
`ai_router.generate` — that is exactly the seam the audit flagged), only
mocking the Gemini SDK boundary, and has the "final answer" call pick a
tool that is deliberately OUTSIDE `chat_tool_dispatcher.supported_tools()`
(one of the 12 names `docs/design/tools-audit.md` §1d lists as declared
in `CHAT_DATA_TOOLS` but absent from the chat-safe allowlist). If the
governed/ungoverned split the audit describes is real, that tool executes
anyway — proving the "dispatcher is the only path" invariant does not
hold for Step 5.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest


# ── Minimal doubles for the google-genai response shape ──────────────────────
# GeminiProvider.generate() only touches `.candidates[0].content.parts[i]`
# (`.function_call.{name,args}` / `.text`), `.usage_metadata`, and `.text`.


class _FakeFunctionCall:
    def __init__(self, name: str, args: dict):
        self.name = name
        self.args = args


class _FakePart:
    def __init__(self, *, function_call=None, text=None):
        self.function_call = function_call
        self.text = text


class _FakeContent:
    def __init__(self, parts):
        self.parts = parts


class _FakeCandidate:
    def __init__(self, parts):
        self.content = _FakeContent(parts)
        self.finish_reason = "STOP"


class _FakeResponse:
    def __init__(self, parts, text: str = ""):
        self.candidates = [_FakeCandidate(parts)]
        self.usage_metadata = None
        self.text = text


class _FakeModels:
    """Records every `generate_content` call and replays canned responses."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.calls: list[dict] = []

    async def generate_content(self, *, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config})
        if self._responses:
            return self._responses.pop(0)
        return _FakeResponse([_FakePart(text="кінець")])


class _FakeAio:
    def __init__(self, responses):
        self.models = _FakeModels(responses)


class _FakeClient:
    def __init__(self, responses):
        self.aio = _FakeAio(responses)


def _pick_ungoverned_tool_name() -> str:
    """One CHAT_DATA_TOOLS name that chat_tool_dispatcher does NOT allow —
    tools-audit.md §1d measured 12 of these (create_checkpoint,
    create_user_fact, delete_user_fact, get_recent_hearing, list_files,
    list_user_facts, make_directory, query_audit_log, query_wardriving,
    read_file, search_files, write_file)."""
    from ai.chat_tool_dispatcher import supported_tools
    from ai.chat_tools import CHAT_DATA_TOOLS

    declared = {t["name"] for t in CHAT_DATA_TOOLS}
    allowed = set(supported_tools())
    ungoverned = sorted(declared - allowed)
    assert ungoverned, (
        "Sanity precondition failed: every CHAT_DATA_TOOLS name is now in "
        "chat_tool_dispatcher's allowlist, so this test has no ungoverned "
        "tool left to prove the leak with. Re-check tools-audit.md §1d."
    )
    return ungoverned[0]


class TestStep5GateLeak:
    @pytest.mark.asyncio
    async def test_final_answer_call_cannot_execute_an_unallowlisted_tool(
        self, monkeypatch
    ):
        """RED before the fix: Step 5 ('final answer, no tools') must be
        structurally incapable of calling ai.tool_executor.execute_tool.
        If it does — for a tool name chat_tool_dispatcher never
        allowlisted — the TM-17B-E2 invariant chat_pipeline.py's own
        docstring claims is false in this build."""
        from ai import chat_pipeline
        from ai import gemini_provider
        from ai import chat_tool_dispatcher
        from ai.tool_use import ToolUseError, ToolErrorKind
        from config import config

        leaked_tool = _pick_ungoverned_tool_name()

        # chat_pipeline.run() is only entered in production when this is
        # True; force it here so GeminiProvider.generate()'s data-tool gate
        # is exercised exactly as it would be live.
        monkeypatch.setattr(config, "chat_tools_enabled", True)

        # ai_router is a process-wide singleton; other test files (e.g.
        # test_phase09_2_2_probe.py) inject fake providers straight into
        # `ai_router._providers["gemini"]` and don't always run after this
        # file alphabetically. Force get_provider("gemini") to build a
        # real GeminiProvider for this test regardless of run order, so
        # the `_get_client` patch below is the thing actually exercised.
        monkeypatch.setitem(
            chat_pipeline.ai_router._providers, "gemini", gemini_provider.GeminiProvider()
        )

        # Step 2 (round-1 tool pick) fails immediately — the loop's
        # `except Exception: break` sends control straight to Step 5 with
        # an empty tool trace. This is the shortest real path to Step 5;
        # it does NOT stub away the Step 5 call itself.
        async def _round1_fails(**kw):
            return ToolUseError(
                kind=ToolErrorKind.UNKNOWN,
                message="synthetic round-1 failure to reach Step 5",
                retriable=False,
            )

        monkeypatch.setattr(chat_pipeline.ai_router, "call_with_tools", _round1_fails)

        # Gemini SDK boundary: turn 1 of GeminiProvider.generate()'s own
        # internal loop picks `leaked_tool`; turn 2 (after the tool
        # "executes") returns plain text so the loop terminates.
        fake_client = _FakeClient([
            _FakeResponse([
                _FakePart(function_call=_FakeFunctionCall(leaked_tool, {"path": "x"}))
            ]),
            _FakeResponse([_FakePart(text="Готово.")]),
        ])
        monkeypatch.setattr(gemini_provider, "_get_client", lambda: fake_client)

        # Spy on the two dispatch surfaces to see which one actually ran.
        execute_tool_spy = AsyncMock(return_value={"ok": True, "content": "spied"})
        monkeypatch.setattr(gemini_provider, "execute_tool", execute_tool_spy)

        dispatch_spy = AsyncMock(
            return_value={"ok": False, "error": "should never be called in this test"}
        )
        monkeypatch.setattr(chat_tool_dispatcher, "dispatch", dispatch_spy)
        monkeypatch.setattr("ai.chat_tool_dispatcher.dispatch", dispatch_spy)

        await chat_pipeline.run(
            user_message="це не привітання, і не пусте",
            system_prompt="sys",
            history=[],
            user_id="u-test",
            db=None,  # type: ignore[arg-type]
        )

        leaked_calls = [
            call for call in execute_tool_spy.await_args_list
            if call.args and call.args[0] == leaked_tool
        ]
        assert not leaked_calls, (
            f"TM-17B-E2 gate leak reproduced: chat_pipeline.py's Step 5 "
            f"('final answer, no tools advertised this round') executed "
            f"{leaked_tool!r} via ai.tool_executor.execute_tool directly — "
            f"a tool chat_tool_dispatcher.supported_tools() never "
            f"allowlisted. GeminiProvider.generate() re-offered the full, "
            f"unfiltered CHAT_DATA_TOOLS catalog on a call chat_pipeline's "
            f"own docstring (lines 7-10, 16-17) describes as tool-free, "
            f"bypassing ai/chat_tool_dispatcher.py's allowlist entirely "
            f"(docs/design/tools-audit.md §3a)."
        )
        assert dispatch_spy.await_count == 0, (
            "chat_tool_dispatcher.dispatch was invoked during Step 5 — "
            "Step 5 must not dispatch tools through ANY path."
        )
