"""
Phase 10 — Chat tool-use tests.

Covers:
- Tool catalog integrity (8 data tools, distinct names, schemas parse)
- Gemini FunctionDeclaration builder with merged catalog
- Tool executor dispatch + happy/error/timeout paths
- Date-range + datetime free-form parsers
- Max-3-tool-calls-per-turn enforcement in gemini_provider.generate()
- Tool result round-trip through the generate loop
- Graceful-degradation: tool error doesn't crash the chat reply
- system-prompt guidance block is injected
"""
from __future__ import annotations

import asyncio
import os
import tempfile
import types as _pytypes
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase10-tool-use")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


# ── Fake google.genai types — avoid pulling the real SDK for unit tests ──────


class _FakeType:
    """Stand-in for google.genai.types.Type enum values."""

    STRING = "STRING"
    INTEGER = "INTEGER"
    NUMBER = "NUMBER"
    BOOLEAN = "BOOLEAN"
    ARRAY = "ARRAY"
    OBJECT = "OBJECT"


def _fake_schema(**kw):
    return {"kind": "Schema", **kw}


def _fake_function_declaration(**kw):
    return {"kind": "FunctionDeclaration", **kw}


def _fake_tool(**kw):
    return {"kind": "Tool", **kw}


@pytest.fixture(autouse=True)
def _fake_genai_types(monkeypatch):
    import sys

    fake_types = _pytypes.ModuleType("google.genai.types")
    fake_types.GenerateContentConfig = lambda **kw: dict(kw)  # type: ignore[attr-defined]
    fake_types.ToolConfig = lambda **kw: {"kind": "ToolConfig", **kw}  # type: ignore[attr-defined]
    fake_types.FunctionCallingConfig = lambda **kw: {"kind": "FCC", **kw}  # type: ignore[attr-defined]
    fake_types.SafetySetting = lambda **kw: {"kind": "SafetySetting", **kw}  # type: ignore[attr-defined]
    fake_types.Schema = _fake_schema  # type: ignore[attr-defined]
    fake_types.FunctionDeclaration = _fake_function_declaration  # type: ignore[attr-defined]
    fake_types.Tool = _fake_tool  # type: ignore[attr-defined]
    fake_types.Type = _FakeType  # type: ignore[attr-defined]
    fake_genai = _pytypes.ModuleType("google.genai")
    fake_genai.types = fake_types  # type: ignore[attr-defined]
    fake_google = sys.modules.get("google") or _pytypes.ModuleType("google")
    fake_google.genai = fake_genai  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "google", fake_google)
    monkeypatch.setitem(sys.modules, "google.genai", fake_genai)
    monkeypatch.setitem(sys.modules, "google.genai.types", fake_types)


# ── Tool catalog ──────────────────────────────────────────────────────────────


class TestChatToolsCatalog:
    def test_catalog_has_expected_tools(self):
        from ai.chat_tools import CHAT_DATA_TOOLS, DATA_TOOL_NAMES

        assert len(CHAT_DATA_TOOLS) == 8
        expected = {
            "search_locationhistory",
            "query_temporal_anchors",
            "recall_memory_facts",
            "get_system_metrics",
            "get_sensor_status",
            "search_web",
            "get_calendar_events",
            "create_calendar_event",
        }
        assert set(t["name"] for t in CHAT_DATA_TOOLS) == expected
        assert DATA_TOOL_NAMES == frozenset(expected)

    def test_each_tool_has_valid_schema(self):
        from ai.chat_tools import CHAT_DATA_TOOLS

        for tool in CHAT_DATA_TOOLS:
            assert "name" in tool and isinstance(tool["name"], str)
            assert "description" in tool and tool["description"].strip()
            params = tool["parameters"]
            assert params["type"] == "object"
            assert "properties" in params
            assert "required" in params
            for req in params["required"]:
                assert req in params["properties"], (
                    f"required field {req!r} missing from properties in {tool['name']}"
                )

    def test_tool_names_are_distinct_from_response_form_tools(self):
        from ai.chat_tools import DATA_TOOL_NAMES
        from ai.response_formatter import RESPONSE_FORM_TOOLS

        response_names = {t["name"] for t in RESPONSE_FORM_TOOLS}
        assert not (DATA_TOOL_NAMES & response_names)

    def test_get_tool_schema_lookup(self):
        from ai.chat_tools import get_tool_schema

        assert get_tool_schema("search_locationhistory") is not None
        assert get_tool_schema("nonexistent_tool") is None


# ── Gemini tools builder accepts merged catalog ───────────────────────────────


class TestGeminiToolsBuilder:
    def test_builder_merges_catalogs(self):
        from ai.chat_tools import CHAT_DATA_TOOLS
        from ai.gemini_provider import _build_gemini_tools
        from ai.response_formatter import RESPONSE_FORM_TOOLS

        merged = [*RESPONSE_FORM_TOOLS, *CHAT_DATA_TOOLS]
        out = _build_gemini_tools(merged)
        decls = out[0]["function_declarations"]
        names = [d["name"] for d in decls]
        assert len(names) == len(RESPONSE_FORM_TOOLS) + len(CHAT_DATA_TOOLS)
        for t in CHAT_DATA_TOOLS:
            assert t["name"] in names

    def test_builder_default_is_response_forms_only(self):
        from ai.gemini_provider import _build_gemini_tools
        from ai.response_formatter import RESPONSE_FORM_TOOLS

        out = _build_gemini_tools()
        decls = out[0]["function_declarations"]
        assert len(decls) == len(RESPONSE_FORM_TOOLS)


# ── Prompt guidance ───────────────────────────────────────────────────────────


class TestPromptGuidance:
    def test_data_tools_guidance_exists(self):
        from ai.personality import DATA_TOOLS_GUIDANCE

        assert "ДАНІ СИСТЕМИ" in DATA_TOOLS_GUIDANCE
        # Every data tool should be named in the guidance for discoverability.
        for name in [
            "search_locationhistory",
            "query_temporal_anchors",
            "recall_memory_facts",
            "get_system_metrics",
            "get_sensor_status",
            "search_web",
            "get_calendar_events",
            "create_calendar_event",
        ]:
            assert name in DATA_TOOLS_GUIDANCE, f"{name!r} missing from guidance"

    def test_build_system_prompt_appends_data_tools_block(self):
        from ai.prompt_builder import build_system_prompt

        prompt = build_system_prompt(
            snapshot={"where": {}, "when": {"hour": 12}, "body": {},
                      "system": {"state": "DIALOGUE"}},
            user_dict={"username": "phantom", "role": "ROOT", "preferences": {}},
            behavioral_model={"trust_level": 0.9, "honest_gap": 0.0,
                              "total_interactions": 5},
            memory_hints=[],
            recent_places=[],
        )
        assert "ДАНІ СИСТЕМИ" in prompt
        # Must come AFTER the response-forms block so data-tool guidance is
        # the freshest instruction in Gemini's context.
        assert prompt.index("ДАНІ СИСТЕМИ") > prompt.index("ФОРМИ ВІДПОВІДІ")


# ── Date parser ───────────────────────────────────────────────────────────────


class TestDateParsers:
    def test_parse_date_range_keywords(self):
        from ai.tool_executor import _parse_date_range

        for kw in ("today", "tomorrow", "yesterday", "this_week", "next_week"):
            w = _parse_date_range(kw)
            assert w is not None, f"{kw!r} should parse"
            assert w[0] < w[1]

    def test_parse_date_range_iso_date_and_range(self):
        from ai.tool_executor import _parse_date_range

        single = _parse_date_range("2026-04-25")
        assert single is not None and single[0].date().isoformat() == "2026-04-25"

        rng = _parse_date_range("2026-04-25..2026-04-30")
        assert rng is not None
        assert rng[0].date().isoformat() == "2026-04-25"
        assert rng[1].date().isoformat() == "2026-04-30"

    def test_parse_date_range_invalid(self):
        from ai.tool_executor import _parse_date_range

        assert _parse_date_range("") is None
        assert _parse_date_range("not a date") is None
        assert _parse_date_range("2099-13-40") is None

    def test_parse_datetime_freeform_iso(self):
        from ai.tool_executor import _parse_datetime_freeform

        dt = _parse_datetime_freeform("2026-04-25T14:30")
        assert dt is not None and dt.year == 2026 and dt.hour == 14 and dt.minute == 30

    def test_parse_datetime_freeform_ukrainian(self):
        from ai.tool_executor import _parse_datetime_freeform

        dt = _parse_datetime_freeform("завтра о 14:00")
        assert dt is not None and dt.hour == 14 and dt.minute == 0
        tomorrow = (datetime.now(tz=timezone.utc).date() + timedelta(days=1))
        assert dt.date() == tomorrow

    def test_parse_datetime_freeform_english(self):
        from ai.tool_executor import _parse_datetime_freeform

        dt = _parse_datetime_freeform("tomorrow at 9")
        assert dt is not None and dt.hour == 9

    def test_parse_datetime_freeform_garbage(self):
        from ai.tool_executor import _parse_datetime_freeform

        assert _parse_datetime_freeform("bogus string") is None


# ── Tool executor: dispatch + error paths (no DB needed) ──────────────────────


class TestToolExecutorDispatch:
    @pytest.mark.asyncio
    async def test_unknown_tool_returns_error_dict(self):
        from ai.tool_executor import execute_tool

        r = await execute_tool("definitely_not_a_tool", {}, user_id="u1")
        assert r.get("ok") is not True
        assert r["error_kind"] == "unknown_tool"

    @pytest.mark.asyncio
    async def test_timeout_wraps_slow_tool(self, monkeypatch):
        from ai import tool_executor as te

        async def _slow(args, user_id):
            await asyncio.sleep(5)
            return {"ok": True}

        monkeypatch.setitem(te._HANDLERS, "search_web", _slow)
        r = await te.execute_tool("search_web", {"query": "hi"}, user_id="u1", timeout_s=0.1)
        assert r["error_kind"] == "timeout"

    @pytest.mark.asyncio
    async def test_handler_exception_returns_error_dict(self, monkeypatch):
        from ai import tool_executor as te

        async def _boom(args, user_id):
            raise RuntimeError("kaboom")

        monkeypatch.setitem(te._HANDLERS, "get_system_metrics", _boom)
        r = await te.execute_tool("get_system_metrics", {}, user_id="u1")
        assert r["error_kind"] == "exception"
        assert "kaboom" in r["error"]

    @pytest.mark.asyncio
    async def test_invalid_args_for_recall_memory_facts(self):
        from ai.tool_executor import execute_tool

        r = await execute_tool("recall_memory_facts", {}, user_id="u1")
        assert r.get("ok") is not True
        assert r["error_kind"] == "invalid_args"


# ── Tool executor: get_system_metrics (psutil, works offline) ─────────────────


class TestGetSystemMetrics:
    @pytest.mark.asyncio
    async def test_metrics_shape(self):
        from ai.tool_executor import execute_tool

        r = await execute_tool("get_system_metrics", {}, user_id="u1")
        assert r["ok"] is True
        for key in ("cpu_pct", "ram_used_mb", "ram_total_mb", "disk_used_gb",
                    "disk_total_gb", "uptime_sec", "load_1min"):
            assert key in r


# ── Tool executor: get_sensor_status via ContextEngine singleton ──────────────


class TestGetSensorStatus:
    @pytest.mark.asyncio
    async def test_sensor_status_returns_envelope(self):
        from ai.tool_executor import execute_tool

        r = await execute_tool("get_sensor_status", {}, user_id="u1")
        assert r["ok"] is True
        for layer in ("radar", "camera", "environment", "gps", "battery"):
            assert layer in r


# ── Calendar round-trip against a real SQLite DB ──────────────────────────────


@pytest_asyncio.fixture
async def _test_db(monkeypatch):
    """Spin up a tmp async sqlite engine and patch AsyncSessionLocal."""
    from db import database as _db_mod
    from db.models import Base

    tmp = Path(tempfile.gettempdir()) / f"phantom-test-{uuid.uuid4().hex}.db"
    url = f"sqlite+aiosqlite:///{tmp}"
    engine = create_async_engine(url, future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    original_engine = _db_mod.engine
    original_factory = _db_mod.AsyncSessionLocal
    _db_mod.engine = engine
    _db_mod.AsyncSessionLocal = factory

    yield factory

    _db_mod.engine = original_engine
    _db_mod.AsyncSessionLocal = original_factory
    await engine.dispose()
    tmp.unlink(missing_ok=True)


class TestCalendarRoundTrip:
    @pytest.mark.asyncio
    async def test_create_then_read_events(self, _test_db):
        from ai.tool_executor import execute_tool

        user_id = str(uuid.uuid4())

        tomorrow = datetime.now(tz=timezone.utc) + timedelta(days=1)
        start_iso = tomorrow.replace(hour=14, minute=0, second=0, microsecond=0).isoformat()

        created = await execute_tool(
            "create_calendar_event",
            {"title": "Phase 10 test meeting", "start_at": start_iso},
            user_id=user_id,
        )
        assert created["ok"] is True
        assert created["title"] == "Phase 10 test meeting"

        read = await execute_tool(
            "get_calendar_events",
            {"date_range": "tomorrow"},
            user_id=user_id,
        )
        assert read["ok"] is True
        assert read["count"] == 1
        assert read["events"][0]["title"] == "Phase 10 test meeting"

    @pytest.mark.asyncio
    async def test_get_calendar_events_empty_range(self, _test_db):
        from ai.tool_executor import execute_tool

        r = await execute_tool(
            "get_calendar_events",
            {"date_range": "2030-01-01..2030-01-07"},
            user_id=str(uuid.uuid4()),
        )
        assert r["ok"] is True
        assert r["count"] == 0
        assert r["events"] == []

    @pytest.mark.asyncio
    async def test_create_rejects_invalid_start(self, _test_db):
        from ai.tool_executor import execute_tool

        r = await execute_tool(
            "create_calendar_event",
            {"title": "bad event", "start_at": "not a datetime"},
            user_id=str(uuid.uuid4()),
        )
        assert r.get("ok") is not True
        assert r["error_kind"] == "invalid_args"

    @pytest.mark.asyncio
    async def test_search_locationhistory_empty(self, _test_db):
        from ai.tool_executor import execute_tool

        r = await execute_tool(
            "search_locationhistory",
            {"hours_ago": 48},
            user_id=str(uuid.uuid4()),
        )
        assert r["ok"] is True
        assert r["count"] == 0


# ── Generate loop: max-3 tool calls + round-trip ──────────────────────────────


def _make_part(*, fn_name=None, fn_args=None, text=None):
    if fn_name is not None:
        fc = SimpleNamespace(name=fn_name, args=(fn_args or {}))
        return SimpleNamespace(function_call=fc, text=None)
    p = SimpleNamespace(text=text)
    p.function_call = None
    return p


def _make_response(*, parts, response_text="", total_tokens=10):
    candidate = SimpleNamespace(content=SimpleNamespace(parts=parts))
    usage = SimpleNamespace(total_token_count=total_tokens)
    return SimpleNamespace(candidates=[candidate], usage_metadata=usage, text=response_text)


class _ScriptedModels:
    """Returns a different response per .generate_content call, in order."""

    def __init__(self, responses):
        self._queue = list(responses)
        self.captured_contents: list = []
        self.captured_tool_counts: list[int] = []

    async def generate_content(self, *, model, contents, config):
        self.captured_contents.append([dict(c) for c in contents])
        try:
            tools = config.get("tools") if isinstance(config, dict) else None
            if tools:
                self.captured_tool_counts.append(
                    len(tools[0].get("function_declarations", []))
                )
        except Exception:
            self.captured_tool_counts.append(-1)
        if not self._queue:
            raise AssertionError("scripted responses exhausted")
        return self._queue.pop(0)


class _FakeClient:
    def __init__(self, models):
        self.aio = SimpleNamespace(models=models)


class TestGenerateToolLoop:
    @pytest.mark.asyncio
    async def test_data_tool_executes_and_loops(self, monkeypatch):
        """get_system_metrics → respond_metrics round-trip."""
        from ai import gemini_provider as gp

        responses = [
            _make_response(parts=[_make_part(fn_name="get_system_metrics", fn_args={})]),
            _make_response(parts=[_make_part(
                fn_name="respond_metrics",
                fn_args={"content": "Поточне навантаження.", "metrics": [
                    {"label": "CPU", "value": 42, "unit": "%", "trend": "stable"},
                ]},
            )]),
        ]
        models = _ScriptedModels(responses)
        monkeypatch.setattr(gp, "_get_client", lambda: _FakeClient(models))

        async def _fake_exec(name, args, user_id, timeout_s=5.0):
            return {"ok": True, "cpu_pct": 42.0, "ram_pct": 50.0}

        monkeypatch.setattr(gp, "execute_tool", _fake_exec)

        provider = gp.GeminiProvider()
        result = await provider.generate(
            "покажи CPU", "system", [], user_id="u1",
        )
        assert result.response_form == "metric_cards"
        assert len(models.captured_contents) == 2
        # Second call's contents must include the function_response part.
        second_contents = models.captured_contents[1]
        assert any(
            "function_response" in p
            for c in second_contents for p in c.get("parts", [])
        )

    @pytest.mark.asyncio
    async def test_max_three_tool_calls_enforced(self, monkeypatch):
        """Force 4 data-tool calls; the 4th response should come WITHOUT data tools."""
        from ai import gemini_provider as gp
        from ai.response_formatter import RESPONSE_FORM_TOOLS

        responses = [
            _make_response(parts=[_make_part(fn_name="search_locationhistory", fn_args={})]),
            _make_response(parts=[_make_part(fn_name="get_system_metrics", fn_args={})]),
            _make_response(parts=[_make_part(fn_name="get_sensor_status", fn_args={})]),
            # After 3 data calls we should force no-data-tools and the model
            # must emit either a response form or text. Return plain text.
            _make_response(parts=[_make_part(text="fallback text after cap")]),
        ]
        models = _ScriptedModels(responses)
        monkeypatch.setattr(gp, "_get_client", lambda: _FakeClient(models))

        async def _fake_exec(name, args, user_id, timeout_s=5.0):
            return {"ok": True}

        monkeypatch.setattr(gp, "execute_tool", _fake_exec)

        provider = gp.GeminiProvider()
        result = await provider.generate("run many tools", "system", [], user_id="u1")

        assert "fallback text after cap" in result.content
        # 4 total calls (3 data tool calls + 1 final forced without data tools)
        assert len(models.captured_contents) == 4
        # First three calls use the full catalog (7 response forms + 8 data = 15);
        # the fourth must use the reduced catalog (7 response forms only).
        expected_full = len(RESPONSE_FORM_TOOLS) + 8
        expected_reduced = len(RESPONSE_FORM_TOOLS)
        assert models.captured_tool_counts[0] == expected_full
        assert models.captured_tool_counts[3] == expected_reduced

    @pytest.mark.asyncio
    async def test_no_data_tools_when_user_id_absent(self, monkeypatch):
        from ai import gemini_provider as gp
        from ai.response_formatter import RESPONSE_FORM_TOOLS

        responses = [
            _make_response(parts=[_make_part(fn_name="respond_text", fn_args={"content": "ok"})]),
        ]
        models = _ScriptedModels(responses)
        monkeypatch.setattr(gp, "_get_client", lambda: _FakeClient(models))

        provider = gp.GeminiProvider()
        await provider.generate("hi", "system", [])
        # Only response-form tools should have been offered.
        assert models.captured_tool_counts[0] == len(RESPONSE_FORM_TOOLS)

    @pytest.mark.asyncio
    async def test_tool_error_does_not_crash_chat(self, monkeypatch):
        """Tool handler error → LLM still formulates a reply."""
        from ai import gemini_provider as gp

        responses = [
            _make_response(parts=[_make_part(fn_name="search_web", fn_args={"query": "x"})]),
            _make_response(parts=[_make_part(text="sorry — web search unavailable")]),
        ]
        models = _ScriptedModels(responses)
        monkeypatch.setattr(gp, "_get_client", lambda: _FakeClient(models))

        async def _fake_exec(name, args, user_id, timeout_s=5.0):
            return {"error": "nope", "error_kind": "unavailable"}

        monkeypatch.setattr(gp, "execute_tool", _fake_exec)

        provider = gp.GeminiProvider()
        result = await provider.generate("news?", "system", [], user_id="u1")
        assert result.content.startswith("sorry")
        assert result.response_form == "text"


__all__: list[str] = []
