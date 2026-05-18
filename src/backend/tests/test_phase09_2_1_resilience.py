"""
Phase 9.2.1 — resilience patch:
  - Router exponential backoff + cooling state for RATE_LIMIT.
  - QUOTA_EXHAUSTED → blocked_quota task status + auto-resume probe.
  - Selector-failure hint in observations + tactical prompt nudge.
  - Repeat-action detection forces reflection / abandons sub-goal.
  - Per-task LLM call budget (warn + hard cap).
  - Min-interval enforcement between successive provider calls.
"""
from __future__ import annotations

import asyncio
import os
import tempfile
import time

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase09-2-1")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


@pytest_asyncio.fixture
async def isolated_db(monkeypatch):
    import db.database as _dbm
    import db.models as _dm  # noqa: F401
    import importlib
    if not _dbm.Base.metadata.tables:
        importlib.reload(_dm)
    fd, tmp_file = tempfile.mkstemp(suffix=".db", prefix="phantom_p921_")
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


def _make_tool():
    from ai.tool_use import ToolSchema
    return ToolSchema(
        name="fs.read",
        description="reads files",
        parameters={"type": "object", "properties": {"path": {"type": "string"}}},
        required=["path"],
    )


def _ok():
    from ai.tool_use import ToolCallResult
    return ToolCallResult(
        tool_name="fs.read", arguments={"path": "/etc/hostname"},
        provider="gemini", model="gemini-2.5-flash", parse_attempts=1,
    )


def _err(kind, message="boom", retriable=True, retry_after_s=None, provider="gemini"):
    from ai.tool_use import ToolUseError
    return ToolUseError(
        kind=kind, message=message, retriable=retriable,
        provider=provider, model="gemini-2.5-flash", parse_attempts=1,
        retry_after_s=retry_after_s,
    )


class _StubProvider:
    """Single-method stub returning a scripted sequence of outcomes."""
    def __init__(self, sequence):
        self._seq = list(sequence)
        self.calls = 0

    async def call_with_tools(self, *, system_prompt, user_message, tools, max_retries=3):
        self.calls += 1
        if not self._seq:
            return _ok()
        out = self._seq.pop(0)
        if isinstance(out, BaseException):
            raise out
        return out


def _wire_router(router, primary, fallback):
    router._providers["gemini"] = primary
    if fallback is not None:
        router._providers["ollama"] = fallback


# ═════════════════════════════════════════════════════════════════════════════
# 1. Gemini error classification
# ═════════════════════════════════════════════════════════════════════════════


class TestGeminiErrorClassification:
    def test_quota_daily_classified_as_quota_exhausted_not_retriable(self):
        from ai.gemini_provider import _classify_gemini_error
        from ai.tool_use import ToolErrorKind
        # The exact phrasing the Gemini SDK surfaces on free-tier exhaustion.
        exc = Exception(
            "429 RESOURCE_EXHAUSTED. Quota exceeded for metric: "
            "generate_content_free_tier_requests, limit: 20, model: gemini-2.5-flash."
        )
        kind, retriable, _ = _classify_gemini_error(exc)
        assert kind == ToolErrorKind.QUOTA_EXHAUSTED
        assert retriable is False

    def test_per_minute_429_classified_as_rate_limit_retriable(self):
        from ai.gemini_provider import _classify_gemini_error
        from ai.tool_use import ToolErrorKind
        exc = Exception(
            "429 RESOURCE_EXHAUSTED. Quota exceeded — please retry. "
            "retry_delay { seconds: 8 }"
        )
        kind, retriable, retry_after = _classify_gemini_error(exc)
        assert kind == ToolErrorKind.RATE_LIMIT
        assert retriable is True
        assert retry_after == 8.0

    def test_5xx_classified_as_provider_unavailable(self):
        from ai.gemini_provider import _classify_gemini_error
        from ai.tool_use import ToolErrorKind
        for snippet in (" 500 INTERNAL", " 503 UNAVAILABLE", " 502 Bad Gateway"):
            kind, retriable, _ = _classify_gemini_error(Exception(snippet))
            assert kind == ToolErrorKind.PROVIDER_UNAVAILABLE, snippet
            assert retriable is True


# ═════════════════════════════════════════════════════════════════════════════
# 2. Router 429 backoff + fallback
# ═════════════════════════════════════════════════════════════════════════════


class TestRouter429Backoff:
    @pytest.mark.asyncio
    async def test_rate_limit_retries_then_succeeds(self, isolated_db, monkeypatch):
        from ai.provider import AIRouter
        from ai import provider as _provider_mod
        from ai.tool_use import ToolErrorKind

        monkeypatch.setattr(_provider_mod.config, "ai_primary_provider", "gemini")
        monkeypatch.setattr(_provider_mod.config, "ai_fallback_provider", "none")
        monkeypatch.setattr(_provider_mod.config, "ai_call_min_interval_ms", 0)
        # Skip real sleeps to keep the test sub-second.
        sleeps: list[float] = []

        async def fake_sleep(s):
            sleeps.append(s)
        monkeypatch.setattr(_provider_mod.asyncio, "sleep", fake_sleep)

        primary = _StubProvider([
            _err(ToolErrorKind.RATE_LIMIT, retry_after_s=0.5),
            _err(ToolErrorKind.RATE_LIMIT, retry_after_s=0.5),
            _ok(),
        ])
        r = AIRouter()
        _wire_router(r, primary, None)
        result = await r.call_with_tools(
            system_prompt="", user_message="hi", tools=[_make_tool()],
            task_id=None, step_idx=None,
        )
        from ai.tool_use import ToolCallResult
        assert isinstance(result, ToolCallResult)
        assert primary.calls == 3
        assert sleeps and sleeps[0] == 0.5  # honoured retry_after

    @pytest.mark.asyncio
    async def test_rate_limit_exhaustion_falls_through_and_cools(self, isolated_db, monkeypatch):
        from ai.provider import AIRouter
        from ai import provider as _provider_mod
        from ai.tool_use import ToolErrorKind, ToolCallResult

        monkeypatch.setattr(_provider_mod.config, "ai_primary_provider", "gemini")
        monkeypatch.setattr(_provider_mod.config, "ai_fallback_provider", "ollama")
        monkeypatch.setattr(_provider_mod.config, "ai_call_min_interval_ms", 0)
        async def _np(_): pass
        monkeypatch.setattr(_provider_mod.asyncio, "sleep", _np)

        primary = _StubProvider([
            _err(ToolErrorKind.RATE_LIMIT) for _ in range(10)
        ])
        fallback = _StubProvider([_ok()])
        r = AIRouter()
        _wire_router(r, primary, fallback)
        result = await r.call_with_tools(
            system_prompt="", user_message="hi", tools=[_make_tool()],
        )
        assert isinstance(result, ToolCallResult)
        assert fallback.calls == 1
        assert "gemini" in r._cooling, f"expected gemini in cooling: {r._cooling}"

    @pytest.mark.asyncio
    async def test_quota_exhausted_falls_through_immediately(self, isolated_db, monkeypatch):
        from ai.provider import AIRouter
        from ai import provider as _provider_mod
        from ai.tool_use import ToolErrorKind, ToolCallResult

        monkeypatch.setattr(_provider_mod.config, "ai_primary_provider", "gemini")
        monkeypatch.setattr(_provider_mod.config, "ai_fallback_provider", "ollama")
        monkeypatch.setattr(_provider_mod.config, "ai_call_min_interval_ms", 0)
        async def _np(_): pass
        monkeypatch.setattr(_provider_mod.asyncio, "sleep", _np)

        primary = _StubProvider([
            _err(ToolErrorKind.QUOTA_EXHAUSTED, retriable=False),
        ])
        fallback = _StubProvider([_ok()])
        r = AIRouter()
        _wire_router(r, primary, fallback)
        result = await r.call_with_tools(
            system_prompt="", user_message="hi", tools=[_make_tool()],
        )
        assert isinstance(result, ToolCallResult)
        assert primary.calls == 1, "no rate-limit retries on QUOTA_EXHAUSTED"
        assert "gemini" in r._quota_exhausted


# ═════════════════════════════════════════════════════════════════════════════
# 3. Cooling state lifecycle
# ═════════════════════════════════════════════════════════════════════════════


class TestRouterCoolingState:
    @pytest.mark.asyncio
    async def test_cooling_marker_skips_primary_on_next_call(self, isolated_db, monkeypatch):
        from ai.provider import AIRouter
        from ai import provider as _provider_mod
        from ai.tool_use import ToolErrorKind, ToolCallResult

        monkeypatch.setattr(_provider_mod.config, "ai_primary_provider", "gemini")
        monkeypatch.setattr(_provider_mod.config, "ai_fallback_provider", "ollama")
        monkeypatch.setattr(_provider_mod.config, "ai_call_min_interval_ms", 0)
        async def _np(_): pass
        monkeypatch.setattr(_provider_mod.asyncio, "sleep", _np)

        primary = _StubProvider([_err(ToolErrorKind.RATE_LIMIT) for _ in range(10)])
        fallback = _StubProvider([_ok(), _ok()])
        r = AIRouter()
        _wire_router(r, primary, fallback)

        await r.call_with_tools(system_prompt="", user_message="hi", tools=[_make_tool()])
        assert "gemini" in r._cooling
        primary.calls = 0
        fallback.calls = 0
        result = await r.call_with_tools(system_prompt="", user_message="hi2", tools=[_make_tool()])
        assert isinstance(result, ToolCallResult)
        assert primary.calls == 0, "primary must be skipped while cooling"
        assert fallback.calls == 1

    def test_cooling_auto_expires(self):
        from ai.provider import AIRouter
        r = AIRouter()
        # Manually mark with a window that already ended.
        r._cooling["gemini"] = {
            "ends_monotonic": time.monotonic() - 1.0,
            "ends_iso": "1970-01-01T00:00:00+00:00",
            "reason": "rate_limit",
        }
        assert r._is_provider_available("gemini") is True
        assert "gemini" not in r._cooling


# ═════════════════════════════════════════════════════════════════════════════
# 4. Selector-failure hint in observations + tactical bias
# ═════════════════════════════════════════════════════════════════════════════


class TestSelectorBias:
    def test_selector_no_match_adds_hint_to_observation(self):
        from agent.cognition.observations import build_from_action_result
        from agent.schemas import (ActionResult, InnerMonologue, PlanStep)
        step = PlanStep(
            step_idx=3, sub_goal_id=None, action="browser.extract",
            args={"selector": "div.main-temp"}, intent="extract temp",
            monologue=InnerMonologue(
                what_i_see="page", what_i_plan="extract", why_this_works="selector",
                what_could_fail="miss", confidence=0.7,
            ),
        )
        result = ActionResult(
            ok=False, output=None, error="selector_no_match: div.main-temp",
            error_class="selector_no_match", elapsed_ms=18,
        )
        obs = build_from_action_result(step, result)
        assert "hint:selector_failed" in obs.entities
        assert "browser.click_by_description" in obs.content

    def test_tactical_prompt_contains_recovery_patterns(self):
        from agent.cognition.planner.tactical import _SYSTEM_PROMPT_UA
        assert "ПАТЕРНИ ВІДНОВЛЕННЯ" in _SYSTEM_PROMPT_UA
        assert "browser.click_by_description" in _SYSTEM_PROMPT_UA
        assert "DONE_SUBGOAL" in _SYSTEM_PROMPT_UA


# ═════════════════════════════════════════════════════════════════════════════
# 5. Repeat-action detection (canonicaliser + lookback)
# ═════════════════════════════════════════════════════════════════════════════


class TestRepeatActionDetection:
    def test_canonical_args_key_is_case_and_timestamp_insensitive(self):
        from agent.kernel.loop import _canonical_args_key
        a = _canonical_args_key("browser.extract", {"selector": "div.main-temp"})
        b = _canonical_args_key("browser.extract", {"selector": "DIV.MAIN-TEMP"})
        c = _canonical_args_key(
            "browser.extract",
            {"selector": "div.main-temp", "ts": "2026-04-18T20:30:00Z"},
        )
        d = _canonical_args_key("browser.extract", {"selector": "div.other"})
        assert a == b
        assert a == c
        assert a != d


# ═════════════════════════════════════════════════════════════════════════════
# 6. Per-task call budget — warn + hard cap
# ═════════════════════════════════════════════════════════════════════════════


class TestCallBudget:
    @pytest.mark.asyncio
    async def test_warn_event_fires_once_at_threshold(self, isolated_db, monkeypatch):
        from agent.kernel import runtime as _rt_mod
        from agent.kernel.runtime import AgentRuntime, TaskState
        from agent.schemas import SelfModel
        rt = AgentRuntime()
        rt.foreground_slot = TaskState(
            id="t1", goal="g", track="foreground", status="running",
            self_model=SelfModel(),
        )
        broadcasts: list[tuple[str, dict]] = []
        async def fake_broadcast(t, p):
            broadcasts.append((t, p))
        monkeypatch.setattr(rt, "_broadcast", fake_broadcast)
        # Patch via runtime's view — phase00's importlib.reload swaps the
        # singleton out from under top-level `from config import config`.
        monkeypatch.setattr(_rt_mod.config, "agent_warn_llm_calls_per_task", 3)
        monkeypatch.setattr(_rt_mod.config, "agent_max_llm_calls_per_task", 10)

        for _ in range(5):
            ok = await rt.note_llm_call("t1")
            assert ok is True

        warn_events = [e for e in broadcasts if e[0] == "agent.budget.warning"]
        assert len(warn_events) == 1, f"expected exactly one warning, got {len(warn_events)}"
        assert warn_events[0][1]["llm_calls_used"] >= 3

    @pytest.mark.asyncio
    async def test_hard_cap_returns_false_after_reaching_limit(self, isolated_db, monkeypatch):
        from agent.kernel import runtime as _rt_mod
        from agent.kernel.runtime import AgentRuntime, TaskState
        from agent.schemas import SelfModel
        rt = AgentRuntime()
        rt.foreground_slot = TaskState(
            id="t2", goal="g", track="foreground", status="running",
            self_model=SelfModel(),
        )
        async def _np(*_a, **_kw): pass
        monkeypatch.setattr(rt, "_broadcast", _np)
        monkeypatch.setattr(_rt_mod.config, "agent_warn_llm_calls_per_task", 30)
        monkeypatch.setattr(_rt_mod.config, "agent_max_llm_calls_per_task", 4)

        results = [await rt.note_llm_call("t2") for _ in range(6)]
        # First 3 under cap → True; 4th hits cap → False; subsequent stays False.
        assert results[:3] == [True, True, True]
        assert all(r is False for r in results[3:])


# ═════════════════════════════════════════════════════════════════════════════
# 7. Min-interval enforcement
# ═════════════════════════════════════════════════════════════════════════════


class TestMinIntervalEnforcement:
    @pytest.mark.asyncio
    async def test_second_call_sleeps_to_respect_min_interval(self, isolated_db, monkeypatch):
        from ai.provider import AIRouter
        from ai import provider as _provider_mod
        monkeypatch.setattr(_provider_mod.config, "ai_call_min_interval_ms", 250)

        sleeps: list[float] = []
        async def fake_sleep(s):
            sleeps.append(s)
        monkeypatch.setattr(_provider_mod.asyncio, "sleep", fake_sleep)

        r = AIRouter()
        # Mark the provider as having been called just now.
        r._last_call_at["gemini"] = time.monotonic()
        await r._respect_min_interval("gemini")
        assert sleeps, "second call must sleep at least once"
        assert 0 < sleeps[0] <= 0.26


# ═════════════════════════════════════════════════════════════════════════════
# 8. Blocked-quota status: tactical raises BlockedQuotaError → loop hands off to runtime
# ═════════════════════════════════════════════════════════════════════════════


class TestBlockedQuotaStatus:
    @pytest.mark.asyncio
    async def test_tactical_raises_blocked_quota_on_quota_exhausted(self, isolated_db, monkeypatch):
        from agent.cognition.planner import tactical, _llm
        from agent.schemas import SelfModel, SubGoal
        from ai.tool_use import ToolErrorKind, ToolUseError

        async def fake_call_with_tools(**kwargs):
            return ToolUseError(
                kind=ToolErrorKind.QUOTA_EXHAUSTED,
                message="quota toast",
                retriable=False,
                provider="gemini",
                model="gemini-2.5-flash",
                parse_attempts=1,
            )

        # Patch ai_router via tactical's view of it.
        monkeypatch.setattr(tactical.ai_router, "call_with_tools", fake_call_with_tools)
        with pytest.raises(_llm.BlockedQuotaError):
            await tactical.plan(
                step_idx=0,
                sub_goal=SubGoal(
                    description="d", rationale="r", expected_actions=1,
                    acceptance_criteria="",
                ),
                self_model=SelfModel(),
                observations=[],
                actions_in_sub_goal=0,
            )


# ═════════════════════════════════════════════════════════════════════════════
# 9. ai_tool_use_log resilience columns are populated
# ═════════════════════════════════════════════════════════════════════════════


class TestAuditLogColumns:
    @pytest.mark.asyncio
    async def test_fell_through_and_retry_after_persisted(self, isolated_db, monkeypatch):
        from ai.provider import AIRouter
        from ai import provider as _provider_mod
        from ai.tool_use import ToolErrorKind, ToolCallResult
        from db.models import AiToolUseLog
        from sqlalchemy import select

        monkeypatch.setattr(_provider_mod.config, "ai_primary_provider", "gemini")
        monkeypatch.setattr(_provider_mod.config, "ai_fallback_provider", "ollama")
        monkeypatch.setattr(_provider_mod.config, "ai_call_min_interval_ms", 0)
        async def _np(_): pass
        monkeypatch.setattr(_provider_mod.asyncio, "sleep", _np)

        primary = _StubProvider([
            _err(ToolErrorKind.RATE_LIMIT, retry_after_s=2.5),
            _err(ToolErrorKind.RATE_LIMIT, retry_after_s=2.5),
            _err(ToolErrorKind.RATE_LIMIT, retry_after_s=2.5),
            _err(ToolErrorKind.RATE_LIMIT, retry_after_s=2.5),
        ])
        fallback = _StubProvider([_ok()])
        r = AIRouter()
        _wire_router(r, primary, fallback)
        result = await r.call_with_tools(
            system_prompt="", user_message="hi", tools=[_make_tool()],
        )
        assert isinstance(result, ToolCallResult)
        async with isolated_db() as session:
            rows = (await session.execute(select(AiToolUseLog).order_by(AiToolUseLog.id))).scalars().all()
        # Every primary attempt has retry_after_s set; final fallback row has fell_through_to_fallback=True.
        primary_rows = [r for r in rows if r.provider == "gemini"]
        assert primary_rows, "expected at least one gemini attempt logged"
        assert all(r.retry_after_s == 2.5 for r in primary_rows)
        # Final cooling-trigger row on the last gemini attempt.
        assert any(r.cooling_triggered for r in primary_rows)
        # The successful fallback row.
        success_rows = [r for r in rows if r.success]
        assert success_rows, "expected one successful row"
        assert success_rows[-1].fell_through_to_fallback is True


__all__: list[str] = []
