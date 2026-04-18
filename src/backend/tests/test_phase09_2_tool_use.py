"""
Phase 9.2 — tool-use abstraction (ToolSchema/ToolCallResult/ToolUseError),
Gemini native function-calling adapter, Ollama prompt-based JSON-mode adapter,
AIRouter routing + audit log, tactical planner integration.
"""
from __future__ import annotations

import asyncio
import json
import os
import tempfile

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase09-2")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


# ── Isolated DB ───────────────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def isolated_db(monkeypatch):
    import db.database as _dbm
    import db.models as _dm  # noqa: F401
    import importlib
    if not _dbm.Base.metadata.tables:
        importlib.reload(_dm)
    fd, tmp_file = tempfile.mkstemp(suffix=".db", prefix="phantom_p92tu_")
    os.close(fd)
    url = f"sqlite+aiosqlite:///{tmp_file}"
    engine = create_async_engine(url, echo=False, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.run_sync(_dbm.Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(_dbm, "engine", engine)
    monkeypatch.setattr(_dbm, "AsyncSessionLocal", factory)
    yield factory
    await engine.dispose()
    try:
        os.unlink(tmp_file)
    except OSError:
        pass


# ═════════════════════════════════════════════════════════════════════════════
# 1. ToolSchema + conversion helpers
# ═════════════════════════════════════════════════════════════════════════════


class TestToolSchema:
    def test_tool_schema_validates(self):
        from ai.tool_use import ToolSchema
        t = ToolSchema(
            name="fs.read", description="reads files",
            parameters={"type": "object", "properties": {"path": {"type": "string"}}},
            required=["path"], risk_level=1,
        )
        assert t.name == "fs.read"
        assert t.required == ["path"]

    def test_action_to_tool_schema_roundtrip(self):
        from ai.tool_use import action_to_tool_schema
        from agent.actions.fs import FsRead
        s = action_to_tool_schema(FsRead)
        assert s.name == "fs.read"
        assert "path" in s.parameters["properties"]
        assert "path" in s.required
        assert s.risk_level == 1

    def test_all_tactical_tools_includes_terminals(self):
        from ai.tool_use import all_tactical_tools
        from agent.actions.registry import registry
        names = {t.name for t in all_tactical_tools(registry)}
        assert "DONE_SUBGOAL" in names
        assert "DONE_TASK" in names
        assert "REFLECT" in names
        assert "fs.read" in names
        assert "bash.run" in names


# ═════════════════════════════════════════════════════════════════════════════
# 2. Gemini native tool-use (mocked)
# ═════════════════════════════════════════════════════════════════════════════


class _StubPart:
    def __init__(self, fn_name=None, fn_args=None, text=None):
        self.text = text
        if fn_name is not None:
            self.function_call = type("FC", (), {"name": fn_name, "args": fn_args or {}})()
        else:
            self.function_call = None


class _StubContent:
    def __init__(self, parts):
        self.parts = parts


class _StubCandidate:
    def __init__(self, parts):
        self.content = _StubContent(parts)


class _StubResponse:
    def __init__(self, parts):
        self.candidates = [_StubCandidate(parts)]


class _StubGeminiClient:
    """Replaces google.genai.Client.aio.models for tests."""

    def __init__(self, sequence):
        self.sequence = list(sequence)
        self.calls = 0

    @property
    def aio(self):
        return self

    @property
    def models(self):
        return self

    async def generate_content(self, *, model, contents, config):
        self.calls += 1
        if self.calls > len(self.sequence):
            raise RuntimeError("stub_gemini sequence exhausted")
        nxt = self.sequence[self.calls - 1]
        if isinstance(nxt, Exception):
            raise nxt
        return _StubResponse(nxt)


class TestGeminiToolUse:
    @pytest.mark.asyncio
    async def test_happy_path_function_call(self, monkeypatch):
        from ai import gemini_provider
        from ai.tool_use import ToolCallResult, all_tactical_tools
        from agent.actions.registry import registry

        stub = _StubGeminiClient([[_StubPart(fn_name="fs.read", fn_args={"path": "/etc/hostname"})]])
        monkeypatch.setattr(gemini_provider, "_get_client", lambda: stub)

        provider = gemini_provider.GeminiProvider()
        out = await provider.call_with_tools(
            system_prompt="sys", user_message="read it",
            tools=all_tactical_tools(registry),
        )
        assert isinstance(out, ToolCallResult)
        assert out.tool_name == "fs.read"
        assert out.arguments == {"path": "/etc/hostname"}
        assert out.provider == "gemini"

    @pytest.mark.asyncio
    async def test_text_only_refusal(self, monkeypatch):
        from ai import gemini_provider
        from ai.tool_use import ToolErrorKind, ToolUseError, all_tactical_tools
        from agent.actions.registry import registry

        stub = _StubGeminiClient([
            [_StubPart(text="I refuse")],
            [_StubPart(text="Still no")],
            [_StubPart(text="Nope")],
        ])
        monkeypatch.setattr(gemini_provider, "_get_client", lambda: stub)
        provider = gemini_provider.GeminiProvider()
        out = await provider.call_with_tools(
            system_prompt="s", user_message="u",
            tools=all_tactical_tools(registry), max_retries=3,
        )
        assert isinstance(out, ToolUseError)
        assert out.kind == ToolErrorKind.MODEL_REFUSED
        assert out.parse_attempts == 3

    @pytest.mark.asyncio
    async def test_unknown_tool_retries_then_succeeds(self, monkeypatch):
        from ai import gemini_provider
        from ai.tool_use import ToolCallResult, all_tactical_tools
        from agent.actions.registry import registry

        stub = _StubGeminiClient([
            [_StubPart(fn_name="respond_text", fn_args={"text": "hi"})],   # bad
            [_StubPart(fn_name="DONE_SUBGOAL", fn_args={"summary": "hi"})],  # good
        ])
        monkeypatch.setattr(gemini_provider, "_get_client", lambda: stub)
        provider = gemini_provider.GeminiProvider()
        out = await provider.call_with_tools(
            system_prompt="s", user_message="u",
            tools=all_tactical_tools(registry), max_retries=3,
        )
        assert isinstance(out, ToolCallResult)
        assert out.tool_name == "DONE_SUBGOAL"
        assert out.parse_attempts == 2

    @pytest.mark.asyncio
    async def test_network_error_returns_typed_error(self, monkeypatch):
        from ai import gemini_provider
        from ai.tool_use import ToolErrorKind, ToolUseError, all_tactical_tools
        from agent.actions.registry import registry

        stub = _StubGeminiClient([RuntimeError("connection refused")])
        monkeypatch.setattr(gemini_provider, "_get_client", lambda: stub)
        provider = gemini_provider.GeminiProvider()
        out = await provider.call_with_tools(
            system_prompt="s", user_message="u",
            tools=all_tactical_tools(registry),
        )
        assert isinstance(out, ToolUseError)
        assert out.kind in (ToolErrorKind.NETWORK, ToolErrorKind.TIMEOUT)

    @pytest.mark.asyncio
    async def test_no_tools_returns_invalid_args(self):
        from ai.gemini_provider import GeminiProvider
        from ai.tool_use import ToolErrorKind, ToolUseError
        out = await GeminiProvider().call_with_tools(
            system_prompt="s", user_message="u", tools=[]
        )
        assert isinstance(out, ToolUseError)
        assert out.kind == ToolErrorKind.INVALID_ARGS


# ═════════════════════════════════════════════════════════════════════════════
# 3. Ollama prompt-based tool-use (mocked)
# ═════════════════════════════════════════════════════════════════════════════


class _StubOllamaMessage:
    def __init__(self, content):
        self.content = content


class _StubOllamaResponse:
    def __init__(self, content):
        self.message = _StubOllamaMessage(content)


class _StubOllamaClient:
    def __init__(self, contents):
        self.contents = list(contents)
        self.calls = 0

    async def chat(self, *, model, messages, options, format=None):
        self.calls += 1
        if self.calls > len(self.contents):
            raise RuntimeError("stub_ollama exhausted")
        nxt = self.contents[self.calls - 1]
        if isinstance(nxt, Exception):
            raise nxt
        return _StubOllamaResponse(nxt)


class TestOllamaToolUse:
    @pytest.mark.asyncio
    async def test_happy_path_json(self, monkeypatch):
        from ai import ollama_provider
        from ai.tool_use import ToolCallResult, all_tactical_tools
        from agent.actions.registry import registry

        provider = ollama_provider.OllamaProvider()
        stub = _StubOllamaClient([
            json.dumps({"tool": "fs.read", "arguments": {"path": "/etc/hostname"},
                        "reasoning": "easy"}),
        ])
        monkeypatch.setattr(provider, "_client", lambda: stub)

        out = await provider.call_with_tools(
            system_prompt="s", user_message="u",
            tools=all_tactical_tools(registry),
        )
        assert isinstance(out, ToolCallResult)
        assert out.tool_name == "fs.read"
        assert out.arguments["path"] == "/etc/hostname"
        assert out.provider == "ollama"

    @pytest.mark.asyncio
    async def test_invalid_json_retries(self, monkeypatch):
        from ai import ollama_provider
        from ai.tool_use import ToolCallResult, all_tactical_tools
        from agent.actions.registry import registry

        provider = ollama_provider.OllamaProvider()
        stub = _StubOllamaClient([
            "not json",
            json.dumps({"tool": "DONE_SUBGOAL", "arguments": {"summary": "ok"}}),
        ])
        monkeypatch.setattr(provider, "_client", lambda: stub)

        out = await provider.call_with_tools(
            system_prompt="s", user_message="u",
            tools=all_tactical_tools(registry), max_retries=3,
        )
        assert isinstance(out, ToolCallResult)
        assert out.tool_name == "DONE_SUBGOAL"
        assert out.parse_attempts == 2

    @pytest.mark.asyncio
    async def test_unknown_tool_retries_with_feedback(self, monkeypatch):
        from ai import ollama_provider
        from ai.tool_use import ToolCallResult, all_tactical_tools
        from agent.actions.registry import registry

        provider = ollama_provider.OllamaProvider()
        stub = _StubOllamaClient([
            json.dumps({"tool": "respond_text", "arguments": {"text": "hi"}}),
            json.dumps({"tool": "DONE_SUBGOAL", "arguments": {"summary": "hi"}}),
        ])
        monkeypatch.setattr(provider, "_client", lambda: stub)

        out = await provider.call_with_tools(
            system_prompt="s", user_message="u",
            tools=all_tactical_tools(registry), max_retries=3,
        )
        assert isinstance(out, ToolCallResult)
        assert out.tool_name == "DONE_SUBGOAL"

    @pytest.mark.asyncio
    async def test_max_retries_returns_error(self, monkeypatch):
        from ai import ollama_provider
        from ai.tool_use import ToolErrorKind, ToolUseError, all_tactical_tools
        from agent.actions.registry import registry

        provider = ollama_provider.OllamaProvider()
        stub = _StubOllamaClient([
            json.dumps({"tool": "respond_text", "arguments": {}}),
            json.dumps({"tool": "respond_text", "arguments": {}}),
            json.dumps({"tool": "respond_text", "arguments": {}}),
        ])
        monkeypatch.setattr(provider, "_client", lambda: stub)

        out = await provider.call_with_tools(
            system_prompt="s", user_message="u",
            tools=all_tactical_tools(registry), max_retries=3,
        )
        assert isinstance(out, ToolUseError)
        assert out.kind == ToolErrorKind.UNKNOWN_TOOL

    @pytest.mark.asyncio
    async def test_missing_tool_field_is_refused(self, monkeypatch):
        from ai import ollama_provider
        from ai.tool_use import ToolErrorKind, ToolUseError, all_tactical_tools
        from agent.actions.registry import registry

        provider = ollama_provider.OllamaProvider()
        stub = _StubOllamaClient([
            json.dumps({"reasoning": "thinking"}),
            json.dumps({"reasoning": "thinking"}),
            json.dumps({"reasoning": "thinking"}),
        ])
        monkeypatch.setattr(provider, "_client", lambda: stub)
        out = await provider.call_with_tools(
            system_prompt="s", user_message="u",
            tools=all_tactical_tools(registry), max_retries=3,
        )
        assert isinstance(out, ToolUseError)
        assert out.kind == ToolErrorKind.MODEL_REFUSED


# ═════════════════════════════════════════════════════════════════════════════
# 4. Provider router (primary → fallback) + audit log
# ═════════════════════════════════════════════════════════════════════════════


class _FakeOk:
    def __init__(self, name="ollama", model="llama3.2:3b"):
        self.name = name
        self.model = model

    async def call_with_tools(self, **_kw):
        from ai.tool_use import ToolCallResult
        return ToolCallResult(
            tool_name="DONE_SUBGOAL", arguments={"summary": "done"},
            raw_reasoning="", parse_attempts=1,
            provider=self.name, model=self.model,
        )


class _FakeFail:
    def __init__(self, name="gemini", retriable=True):
        self.name = name
        self.retriable = retriable

    async def call_with_tools(self, **_kw):
        from ai.tool_use import ToolErrorKind, ToolUseError
        return ToolUseError(
            kind=ToolErrorKind.UNKNOWN_TOOL, message="fail",
            retriable=self.retriable, provider=self.name,
            model="x", parse_attempts=1,
        )


class TestRouter:
    @pytest.mark.asyncio
    async def test_primary_success_no_fallback(self, isolated_db, monkeypatch):
        from ai.provider import AIRouter
        from ai.tool_use import ToolCallResult, all_tactical_tools
        from agent.actions.registry import registry
        # Patch via ai.provider's view of config — phase00 reload may have
        # swapped the singleton out from under top-level `from config import config`.
        from ai import provider as _provider_mod
        r = AIRouter()
        r._providers = {"gemini": _FakeOk(name="gemini", model="g"), "ollama": _FakeOk()}
        monkeypatch.setattr(_provider_mod.config, "ai_primary_provider", "gemini")
        monkeypatch.setattr(_provider_mod.config, "ai_fallback_provider", "ollama")
        out = await r.call_with_tools(
            system_prompt="s", user_message="u",
            tools=all_tactical_tools(registry),
        )
        assert isinstance(out, ToolCallResult)
        assert out.provider == "gemini"

    @pytest.mark.asyncio
    async def test_primary_fail_fallback_succeeds(self, isolated_db, monkeypatch):
        from ai.provider import AIRouter
        from ai.tool_use import ToolCallResult, all_tactical_tools
        from agent.actions.registry import registry
        from ai import provider as _provider_mod
        r = AIRouter()
        r._providers = {"gemini": _FakeFail(), "ollama": _FakeOk()}
        monkeypatch.setattr(_provider_mod.config, "ai_primary_provider", "gemini")
        monkeypatch.setattr(_provider_mod.config, "ai_fallback_provider", "ollama")
        out = await r.call_with_tools(
            system_prompt="s", user_message="u",
            tools=all_tactical_tools(registry),
        )
        assert isinstance(out, ToolCallResult)
        assert out.provider == "ollama"

    @pytest.mark.asyncio
    async def test_both_fail_returns_error(self, isolated_db, monkeypatch):
        from ai.provider import AIRouter
        from ai.tool_use import ToolUseError, all_tactical_tools
        from agent.actions.registry import registry
        from ai import provider as _provider_mod
        r = AIRouter()
        r._providers = {"gemini": _FakeFail(), "ollama": _FakeFail("ollama")}
        monkeypatch.setattr(_provider_mod.config, "ai_primary_provider", "gemini")
        monkeypatch.setattr(_provider_mod.config, "ai_fallback_provider", "ollama")
        out = await r.call_with_tools(
            system_prompt="s", user_message="u",
            tools=all_tactical_tools(registry),
        )
        assert isinstance(out, ToolUseError)

    @pytest.mark.asyncio
    async def test_audit_log_written_per_attempt(self, isolated_db, monkeypatch):
        from sqlalchemy import select
        from ai.provider import AIRouter
        from ai.tool_use import all_tactical_tools
        from agent.actions.registry import registry
        from ai import provider as _provider_mod
        from db.database import get_session
        from db.models import AiToolUseLog

        r = AIRouter()
        r._providers = {"gemini": _FakeFail(), "ollama": _FakeOk()}
        monkeypatch.setattr(_provider_mod.config, "ai_primary_provider", "gemini")
        monkeypatch.setattr(_provider_mod.config, "ai_fallback_provider", "ollama")
        await r.call_with_tools(
            system_prompt="s", user_message="u",
            tools=all_tactical_tools(registry),
            task_id="task-xyz", step_idx=4,
        )
        async with get_session() as db:
            rows = (await db.execute(select(AiToolUseLog).order_by(AiToolUseLog.id))).scalars().all()
        assert len(rows) == 2
        assert rows[0].provider == "gemini" and rows[0].success is False
        assert rows[1].provider == "ollama" and rows[1].success is True
        assert rows[1].tool_name == "DONE_SUBGOAL"
        assert rows[0].task_id == "task-xyz"


# ═════════════════════════════════════════════════════════════════════════════
# 5. Tactical planner integration with mocked router
# ═════════════════════════════════════════════════════════════════════════════


class TestTacticalWithTools:
    @pytest.mark.asyncio
    async def test_tactical_picks_via_native_path(self, monkeypatch):
        from agent.planner import tactical
        from agent.schemas import SelfModel, SubGoal
        from ai.tool_use import ToolCallResult
        from config import config

        monkeypatch.setattr(config, "agent_use_native_tool_calling", True)

        async def stub(**_kw):
            return ToolCallResult(
                tool_name="fs.read",
                arguments={"path": "/etc/hostname",
                           "_intent": "read", "_what_i_see": "x",
                           "_what_i_plan": "y", "_why_this_works": "z",
                           "_what_could_fail": "f", "_objection": None,
                           "_confidence": 0.8},
                raw_reasoning="", parse_attempts=1,
                provider="gemini", model="g",
            )
        monkeypatch.setattr(tactical.ai_router, "call_with_tools", stub)

        step = await tactical.plan(
            step_idx=0,
            sub_goal=SubGoal(description="d", rationale="r",
                             expected_actions=1, acceptance_criteria=""),
            self_model=SelfModel(),
            observations=[], actions_in_sub_goal=0,
        )
        assert step.action == "fs.read"
        assert step.args == {"path": "/etc/hostname"}
        assert step.intent == "read"
        assert step.monologue.confidence == 0.8

    @pytest.mark.asyncio
    async def test_tactical_replans_when_objection_missing_for_medium(self, monkeypatch):
        from agent.planner import tactical
        from agent.schemas import SelfModel, SubGoal
        from ai.tool_use import ToolCallResult
        from config import config

        monkeypatch.setattr(config, "agent_use_native_tool_calling", True)

        calls = {"n": 0}

        async def stub(**_kw):
            calls["n"] += 1
            objection = None if calls["n"] == 1 else "could expose paths"
            return ToolCallResult(
                tool_name="bash.run",
                arguments={"cmd": "ls", "timeout_s": 2, "sandboxed": False,
                           "_intent": "list", "_what_i_see": "x",
                           "_what_i_plan": "ls", "_why_this_works": "duh",
                           "_what_could_fail": "denied",
                           "_objection": objection, "_confidence": 0.9},
                raw_reasoning="", parse_attempts=1,
                provider="gemini", model="g",
            )
        monkeypatch.setattr(tactical.ai_router, "call_with_tools", stub)

        step = await tactical.plan(
            step_idx=0,
            sub_goal=SubGoal(description="d", rationale="r",
                             expected_actions=1, acceptance_criteria=""),
            self_model=SelfModel(),
            observations=[], actions_in_sub_goal=0,
        )
        assert step.action == "bash.run"
        assert step.monologue.objection == "could expose paths"
        assert calls["n"] == 2
