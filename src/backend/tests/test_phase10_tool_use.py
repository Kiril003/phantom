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
        from ai.chat_tools import CHAT_DATA_TOOLS
    
        # Phase 25/26 — catalog has grown significantly
        assert len(CHAT_DATA_TOOLS) >= 8
    
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
        names = set(t["name"] for t in CHAT_DATA_TOOLS)
        for name in expected:
            assert name in names

    def test_each_tool_has_valid_schema(self):
        from ai.chat_tools import CHAT_DATA_TOOLS

        for tool in CHAT_DATA_TOOLS:
            assert "name" in tool and isinstance(tool["name"], str)
            assert "description" in tool and tool["description"].strip()
            params = tool["parameters"]
            assert params["type"] == "object"
            assert "properties" in params
            # Інструмент без аргументів законно не має `required` — порожній
            # список там був би шумом. Вимагаємо ключ лише коли є що вимагати.
            if params["properties"]:
                assert "required" in params, f"{tool['name']} має поля, але не має required"
            for req in params.get("required", []):
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
        # Gemini rejects dots in function names, so the builder coerces them to
        # `__`. Compare against the sanitised form — `map.plan_route` ships as
        # `map__plan_route` and `_restore_name` maps it back on the way in.
        from ai.gemini_provider import _sanitize_name
        for t in CHAT_DATA_TOOLS:
            assert _sanitize_name(t["name"]) in names

    def test_builder_default_is_response_forms_only(self):
        from ai.gemini_provider import _build_gemini_tools
        from ai.response_formatter import RESPONSE_FORM_TOOLS

        out = _build_gemini_tools()
        decls = out[0]["function_declarations"]
        assert len(decls) == len(RESPONSE_FORM_TOOLS)


# ── Prompt guidance ───────────────────────────────────────────────────────────


class TestPromptGuidance:
    def test_data_tools_guidance_exists(self):
        """Підказка вчить ПРАВИЛА, а не перелічує імена.

        Перелік інструментів у прозі був дублем: Gemini і так отримує їх
        нативними деклараціями зі схемами (`chat_tools.CHAT_DATA_TOOLS`).
        Тест перевіряв саме той дубль і застарів, коли підказку стиснули.
        Тепер тримаємо обидві половини на своїх місцях.
        """
        from ai.personality import DATA_TOOLS_GUIDANCE
        from ai.chat_tools import CHAT_DATA_TOOLS

        assert "ДАНІ ТА ДІЇ" in DATA_TOOLS_GUIDANCE
        assert "виклич інструмент" in DATA_TOOLS_GUIDANCE

        declared = {t["name"] for t in CHAT_DATA_TOOLS}
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
            assert name in declared, f"{name!r} не оголошений моделі"

    def test_build_system_prompt_appends_data_tools_block(self, monkeypatch):
        # Data-tool guidance is controlled separately from response-form
        # widgets so chat can be grounded without card/widget spam.
        from ai.prompt_builder import build_system_prompt
        from config import config
        monkeypatch.setattr(config, "chat_tools_enabled", True)
        # Розділення двох контролів і є предметом тесту, тож другий прапорець
        # треба ПРИБИТИ явно. Без цього тест успадковував живий конфіг, де
        # віджети ввімкнені, і падав на власному ж припущенні.
        monkeypatch.setattr(config, "chat_response_widgets_enabled", False)

        prompt = build_system_prompt(
            snapshot={"where": {}, "when": {"hour": 12}, "body": {},
                      "system": {"state": "DIALOGUE"}},
            user_dict={"username": "phantom", "role": "ROOT", "preferences": {}},
            behavioral_model={"trust_level": 0.9, "honest_gap": 0.0,
                              "total_interactions": 5},
            memory_hints=[],
            recent_places=[],
        )
        assert "ДАНІ ТА ДІЇ" in prompt
        assert "ФОРМИ ВІДПОВІДІ" not in prompt
        # Phase 10.3 — register guidance is appended LAST so it's the
        # freshest instruction in Gemini's context.
        assert "РЕГІСТР:" in prompt
        assert prompt.index("РЕГІСТР:") > prompt.index("ДАНІ ТА ДІЇ")


# ── Date parser ───────────────────────────────────────────────────────────────


class TestDateParsers:
    def test_parse_date_range_keywords(self):
        from ai.tool_executor import _parse_date_range

        for kw in ("today", "tomorrow", "yesterday", "this_week", "next_week"):
            w = _parse_date_range(kw)
            assert w is not None, f"{kw!r} should parse"
            assert w[0] < w[1]

    def test_parse_date_range_iso_date_and_range(self):
        from ai.tool_executor import _parse_date_range, _local_tz

        tz = _local_tz()

        single = _parse_date_range("2026-04-25")
        assert single is not None
        # Phase 10.3 — range is computed in user's LOCAL tz; viewing the
        # returned UTC timestamps through that tz must recover the requested
        # local date.
        assert single[0].astimezone(tz).date().isoformat() == "2026-04-25"
        assert single[1].astimezone(tz).date().isoformat() == "2026-04-25"

        rng = _parse_date_range("2026-04-25..2026-04-30")
        assert rng is not None
        assert rng[0].astimezone(tz).date().isoformat() == "2026-04-25"
        assert rng[1].astimezone(tz).date().isoformat() == "2026-04-30"

    def test_parse_date_range_invalid(self):
        from ai.tool_executor import _parse_date_range

        assert _parse_date_range("") is None
        assert _parse_date_range("not a date") is None
        assert _parse_date_range("2099-13-40") is None

    def test_parse_datetime_freeform_iso(self):
        from ai.tool_executor import _parse_datetime_freeform, _local_tz

        dt = _parse_datetime_freeform("2026-04-25T14:30")
        assert dt is not None
        # Phase 10.3 — naive ISO is interpreted as local wall clock and
        # returned normalised to UTC. Convert back to local to verify.
        local = dt.astimezone(_local_tz())
        assert local.year == 2026
        assert local.month == 4
        assert local.day == 25
        assert local.hour == 14 and local.minute == 30

    def test_parse_datetime_freeform_ukrainian(self):
        from ai.tool_executor import _parse_datetime_freeform, _local_tz, _today_local

        dt = _parse_datetime_freeform("завтра о 14:00")
        assert dt is not None
        local = dt.astimezone(_local_tz())
        assert local.hour == 14 and local.minute == 0
        assert local.date() == _today_local() + timedelta(days=1)

    def test_parse_datetime_freeform_english(self):
        from ai.tool_executor import _parse_datetime_freeform, _local_tz

        dt = _parse_datetime_freeform("tomorrow at 9")
        assert dt is not None
        local = dt.astimezone(_local_tz())
        assert local.hour == 9

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
        from datetime import time as _dtime

        from ai.tool_executor import _local_tz, _today_local, execute_tool

        user_id = str(uuid.uuid4())

        # Phase 10.3 — express "tomorrow 14:00 local" explicitly so the
        # round-trip is tz-correct regardless of where the test host is.
        tomorrow_local = _today_local() + timedelta(days=1)
        start_local = datetime.combine(tomorrow_local, _dtime(14, 0)).replace(
            tzinfo=_local_tz()
        )
        start_iso = start_local.isoformat()

        created = await execute_tool(
            "create_calendar_event",
            {
                "title": "Phase 10 test meeting",
                "start_at": start_iso,
                "notes": "Phase 10.3 description round-trip",
            },
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
        # Fix 2 — description/notes write-through must survive the round trip.
        assert read["events"][0]["notes"] == "Phase 10.3 description round-trip"

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
        # After a data-tool round-trip the provider appends genai Content /
        # Part objects alongside the plain dicts, and `dict()` on those raises
        # "object is not iterable" — which surfaced as a stub failure rather
        # than as the provider behaviour under test. Record them as-is.
        self.captured_contents.append([
            dict(c) if isinstance(c, dict) else c for c in contents
        ])
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


def _has_function_response(contents) -> bool:
    """True when any part in `contents` carries a function_response.

    Contents mix plain dicts (the history the provider builds) with genai
    Content/Part objects (the tool-result turn it appends), so both shapes have
    to be understood. Reading only the dict shape made this assertion blow up
    on the object shape instead of testing the provider.
    """
    for c in contents:
        parts = c.get("parts", []) if isinstance(c, dict) else (getattr(c, "parts", None) or [])
        for p in parts:
            if isinstance(p, dict):
                if "function_response" in p:
                    return True
            elif getattr(p, "function_response", None) is not None:
                return True
    return False


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
        from config import config
        monkeypatch.setattr(config, "chat_tools_enabled", True)
        monkeypatch.setattr(config, "chat_response_widgets_enabled", True)

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
        assert _has_function_response(second_contents), (
            "second call must carry the tool result back to the model"
        )

    @pytest.mark.asyncio
    async def test_data_tool_cap_forces_a_final_call_without_data_tools(self, monkeypatch):
        """At the cap the provider must re-ask WITHOUT data tools.

        Derived from `MAX_TOOL_CALLS_PER_TURN` rather than hardcoded: the cap
        moved from 3 to 5 and this test kept scripting three calls, so it was
        exercising the pre-cap path and asserting the post-cap outcome.
        """
        from ai import gemini_provider as gp
        from ai.response_formatter import RESPONSE_FORM_TOOLS
        from ai.tool_executor import MAX_TOOL_CALLS_PER_TURN

        data_tool_names = ["search_locationhistory", "get_system_metrics", "get_sensor_status"]
        responses = [
            _make_response(parts=[_make_part(
                fn_name=data_tool_names[i % len(data_tool_names)], fn_args={},
            )])
            for i in range(MAX_TOOL_CALLS_PER_TURN)
        ]
        # At the cap the provider re-asks with data tools removed; the model
        # then has to answer with a response form or plain text.
        responses.append(_make_response(parts=[_make_part(text="fallback text after cap")]))
        models = _ScriptedModels(responses)
        monkeypatch.setattr(gp, "_get_client", lambda: _FakeClient(models))
        from config import config
        # Both halves of the catalog must be pinned ON. This test is about the
        # cap, not about the deploy defaults — and with `chat_tools_enabled`
        # left at its (now False) default, `with_data_tools` is off, the tool
        # loop never runs, and the scripted turns fall through to the empty-text
        # fallback instead of exercising the cap at all.
        monkeypatch.setattr(config, "chat_tools_enabled", True)
        monkeypatch.setattr(config, "chat_response_widgets_enabled", True)

        async def _fake_exec(name, args, user_id, timeout_s=5.0):
            return {"ok": True}

        monkeypatch.setattr(gp, "execute_tool", _fake_exec)

        provider = gp.GeminiProvider()
        result = await provider.generate("run many tools", "system", [], user_id="u1")

        assert "fallback text after cap" in result.content
        # MAX_TOOL_CALLS_PER_TURN data calls + 1 final forced call.
        assert len(models.captured_contents) == MAX_TOOL_CALLS_PER_TURN + 1
        # Calls up to the cap use the full catalog (response forms + data
        # tools, exactly what gemini_provider.generate merges); the final one
        # must use the reduced catalog (response forms only).
        from ai.chat_tools import CHAT_DATA_TOOLS

        expected_full = len(RESPONSE_FORM_TOOLS) + len(CHAT_DATA_TOOLS)
        expected_reduced = len(RESPONSE_FORM_TOOLS)
        assert models.captured_tool_counts[0] == expected_full
        assert models.captured_tool_counts[MAX_TOOL_CALLS_PER_TURN] == expected_reduced

    @pytest.mark.asyncio
    async def test_no_tools_at_all_when_user_id_absent(self, monkeypatch):
        """An anonymous turn gets no function catalog whatsoever.

        `gemini_provider.generate` gates BOTH halves on the caller being
        identified:

            data_tools_enabled = config.chat_tools_enabled and user_id is not None
            widgets_enabled    = config.chat_response_widgets_enabled and user_id is not None

        so with no `user_id` neither the data tools nor the response-form tools
        are offered. This test used to assert response forms were still present
        — written before widgets were gated on identity — which could not hold:
        the provider never sets a `tools` key, so nothing was captured and the
        assertion died on IndexError rather than on its actual claim.

        The claim worth pinning is the security one the name promises: an
        unidentified caller is never handed data tools.
        """
        from ai import gemini_provider as gp
        from ai.chat_tools import DATA_TOOL_NAMES

        responses = [
            _make_response(parts=[_make_part(text="ok")]),
        ]
        models = _ScriptedModels(responses)
        monkeypatch.setattr(gp, "_get_client", lambda: _FakeClient(models))
        # Both flags ON, so the assertion rests on the user_id gate alone
        # rather than on whatever the ambient defaults happen to be.
        from config import config
        monkeypatch.setattr(config, "chat_tools_enabled", True)
        monkeypatch.setattr(config, "chat_response_widgets_enabled", True)

        provider = gp.GeminiProvider()
        await provider.generate("hi", "system", [])

        assert models.captured_tool_counts == [], (
            "an anonymous turn must be offered no function catalog at all"
        )
        # Belt and braces: no data tool name reached the wire.
        flat = repr(models.captured_contents)
        for name in DATA_TOOL_NAMES:
            assert name not in flat, f"data tool {name!r} leaked to an anonymous turn"

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
        # Відповідь оператору українською — англійське «sorry» лишилось у
        # тесті з часів, коли фолбек був англійським.
        assert result.content
        assert not result.content.lower().startswith("sorry")
        assert result.response_form == "text"


# ── Phase 10.3 — timezone, description, logging regressions ───────────────────


class TestPhase10_3Timezone:
    """The 'завтра' lookup bug the user hit on 2026-04-24: event created for
    local-tomorrow was not returned by get_calendar_events(date_range='tomorrow')
    because boundary math used UTC. These tests pin the local-tz contract."""

    def test_today_and_tomorrow_differ_by_one_local_day(self):
        from ai.tool_executor import _local_tz, _parse_date_range

        tz = _local_tz()
        today = _parse_date_range("today")
        tomorrow = _parse_date_range("tomorrow")
        assert today is not None and tomorrow is not None
        today_local_date = today[0].astimezone(tz).date()
        tomorrow_local_date = tomorrow[0].astimezone(tz).date()
        assert tomorrow_local_date == today_local_date + timedelta(days=1)

    def test_tomorrow_bounds_span_full_local_day(self):
        from ai.tool_executor import _local_tz, _parse_date_range

        tz = _local_tz()
        bounds = _parse_date_range("tomorrow")
        assert bounds is not None
        start_local = bounds[0].astimezone(tz)
        end_local = bounds[1].astimezone(tz)
        assert start_local.hour == 0 and start_local.minute == 0
        assert end_local.hour == 23 and end_local.minute == 59
        assert start_local.date() == end_local.date()

    def test_this_week_spans_seven_local_days(self):
        from ai.tool_executor import _local_tz, _parse_date_range

        tz = _local_tz()
        bounds = _parse_date_range("this_week")
        assert bounds is not None
        start_local = bounds[0].astimezone(tz)
        end_local = bounds[1].astimezone(tz)
        assert (end_local.date() - start_local.date()).days == 6
        # Week starts on Monday (tools_calendar_first_day default).
        assert start_local.weekday() == 0

    @pytest.mark.asyncio
    async def test_tomorrow_query_finds_event_created_for_local_tomorrow(
        self, _test_db,
    ):
        """Reproduces the user live-test bug: create 'завтра 18:00', then
        query 'plany na zavtra?'. Pre-fix this returned empty."""
        from ai.tool_executor import execute_tool

        user_id = str(uuid.uuid4())

        created = await execute_tool(
            "create_calendar_event",
            {
                "title": "Відпочити",
                "start_at": "завтра о 18:00",
                "notes": "що я обіцяв відпочити",
            },
            user_id=user_id,
        )
        assert created["ok"] is True

        read = await execute_tool(
            "get_calendar_events",
            {"date_range": "tomorrow"},
            user_id=user_id,
        )
        assert read["ok"] is True
        assert read["count"] == 1
        assert read["events"][0]["title"] == "Відпочити"
        # Fix 2 — notes → description is persisted and comes back.
        assert read["events"][0]["notes"] == "що я обіцяв відпочити"

    @pytest.mark.asyncio
    async def test_today_query_does_not_return_tomorrows_event(self, _test_db):
        """Regression: tomorrow's event must NOT leak into today's window."""
        from ai.tool_executor import execute_tool

        user_id = str(uuid.uuid4())
        await execute_tool(
            "create_calendar_event",
            {"title": "Tomorrow thing", "start_at": "завтра о 10:00"},
            user_id=user_id,
        )
        read = await execute_tool(
            "get_calendar_events",
            {"date_range": "today"},
            user_id=user_id,
        )
        assert read["ok"] is True
        assert read["count"] == 0


class TestPhase10_3DescriptionField:
    @pytest.mark.asyncio
    async def test_description_column_written_via_notes(self, _test_db):
        """Handler maps tool param `notes` → DB column `description`."""
        from ai.tool_executor import execute_tool
        from db import database as _db_mod
        from db.models import CalendarEvent
        from sqlalchemy import select

        user_id = str(uuid.uuid4())
        r = await execute_tool(
            "create_calendar_event",
            {
                "title": "coffee with ada",
                "start_at": "завтра о 09:30",
                "notes": "розмова про Phase 10.3",
            },
            user_id=user_id,
        )
        assert r["ok"] is True

        async with _db_mod.AsyncSessionLocal() as db:
            row = (await db.execute(
                select(CalendarEvent).where(CalendarEvent.user_id == user_id)
            )).scalar_one()
        assert row.description == "розмова про Phase 10.3"

    @pytest.mark.asyncio
    async def test_description_empty_when_no_notes(self, _test_db):
        """Empty-string default is preserved when user omits notes."""
        from ai.tool_executor import execute_tool
        from db import database as _db_mod
        from db.models import CalendarEvent
        from sqlalchemy import select

        user_id = str(uuid.uuid4())
        r = await execute_tool(
            "create_calendar_event",
            {"title": "standup", "start_at": "завтра о 10:00"},
            user_id=user_id,
        )
        assert r["ok"] is True

        async with _db_mod.AsyncSessionLocal() as db:
            row = (await db.execute(
                select(CalendarEvent).where(CalendarEvent.user_id == user_id)
            )).scalar_one()
        assert row.description == ""

    def test_tool_schema_emphasises_notes_for_context(self):
        """The chat system prompt must instruct the LLM to populate notes."""
        from ai.chat_tools import get_tool_schema

        schema = get_tool_schema("create_calendar_event")
        assert schema is not None
        desc = schema["description"].lower()
        # Guidance must mention both title-vs-notes separation AND timezone.
        assert "notes" in desc
        assert "title" in desc
        assert "локальн" in desc  # локальний / локальному


class TestPhase10_3ToolLogging:
    @pytest.mark.asyncio
    async def test_invocation_log_includes_tool_user_and_args(self, caplog):
        """Gate 6 contract: every dispatch emits `invoked tool=X user=Y args=...`."""
        import logging

        from ai.tool_executor import execute_tool

        caplog.set_level(logging.INFO, logger="ai.tool_executor")
        await execute_tool("definitely_unknown_tool", {"x": 1}, user_id="tester")
        # Unknown tools return before logging (no dispatch); positive case:
        caplog.clear()
        await execute_tool("get_system_metrics", {}, user_id="tester")
        messages = " | ".join(r.getMessage() for r in caplog.records)
        assert "invoked tool=get_system_metrics" in messages
        assert "user=tester" in messages

    def test_args_snippet_truncates_long_values(self):
        from ai.tool_executor import _args_snippet

        s = _args_snippet({"query": "x" * 500})
        assert len(s) <= 200
        assert "..." in s

    def test_args_snippet_handles_empty_args(self):
        from ai.tool_executor import _args_snippet

        assert _args_snippet({}) == "{}"


__all__: list[str] = []
