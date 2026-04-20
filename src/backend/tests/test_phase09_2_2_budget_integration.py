"""
Phase 9.2.2 — F-01 budget thread-through.

Verifies the per-task LLM call budget actually fires from the production code
path (loop → tactical.plan → ai_router.call_with_tools → runtime.note_llm_call).

Phase 9.2.1 wired everything but loop.py forgot to pass task_id, so
note_llm_call short-circuited and the budget never counted real calls.
"""
from __future__ import annotations

import os
import logging
import tempfile

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase09-2-2")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


@pytest_asyncio.fixture
async def isolated_db(monkeypatch):
    import db.database as _dbm
    import db.models as _dm  # noqa: F401
    import importlib
    if not _dbm.Base.metadata.tables:
        importlib.reload(_dm)
    fd, tmp_file = tempfile.mkstemp(suffix=".db", prefix="phantom_p922_")
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


def _ok_result(tool_name="DONE_SUBGOAL"):
    from ai.tool_use import ToolCallResult
    return ToolCallResult(
        tool_name=tool_name,
        arguments={"summary": "done"},
        provider="gemini", model="gemini-2.5-flash", parse_attempts=1,
    )


class _CountingProvider:
    """Provider stub that always returns success and counts calls."""
    def __init__(self):
        self.calls = 0

    async def call_with_tools(self, *, system_prompt, user_message, tools, max_retries=3):
        self.calls += 1
        return _ok_result()


@pytest_asyncio.fixture
async def fresh_runtime(monkeypatch):
    """Build a fresh AgentRuntime with a known task_id slot."""
    from agent.runtime import AgentRuntime, TaskState
    from agent.schemas import SelfModel

    rt = AgentRuntime()
    rt.foreground_slot = TaskState(
        id="task-budget-1",
        goal="g",
        track="foreground",
        status="running",
        self_model=SelfModel(),
    )
    broadcasts: list[tuple[str, dict]] = []

    async def fake_broadcast(t, p):
        broadcasts.append((t, p))

    monkeypatch.setattr(rt, "_broadcast", fake_broadcast)
    # Re-bind the singleton so ai.provider's _runtime_note_llm_call sees this rt.
    import agent.runtime as _rt_mod
    monkeypatch.setattr(_rt_mod, "agent_runtime", rt)
    yield rt, broadcasts


# ═════════════════════════════════════════════════════════════════════════════
# F-01.A — task_id flows from tactical.plan through to runtime.note_llm_call
# ═════════════════════════════════════════════════════════════════════════════


class TestBudgetThreadThrough:
    @pytest.mark.asyncio
    async def test_tactical_plan_with_task_id_increments_counter(
        self, isolated_db, fresh_runtime, monkeypatch
    ):
        """Tactical.plan called with task_id increments runtime counter via router."""
        from agent.planner import tactical
        from agent.schemas import SelfModel, SubGoal
        from ai import provider as _provider_mod

        rt, _broadcasts = fresh_runtime
        monkeypatch.setattr(_provider_mod.config, "ai_primary_provider", "gemini")
        monkeypatch.setattr(_provider_mod.config, "ai_fallback_provider", "none")
        monkeypatch.setattr(_provider_mod.config, "ai_call_min_interval_ms", 0)
        # Fresh router with stub provider
        router = _provider_mod.AIRouter()
        router._providers["gemini"] = _CountingProvider()
        monkeypatch.setattr(tactical, "ai_router", router)

        for _ in range(5):
            await tactical.plan(
                step_idx=0,
                sub_goal=SubGoal(
                    description="d", rationale="r",
                    expected_actions=1, acceptance_criteria="",
                ),
                self_model=SelfModel(),
                observations=[],
                actions_in_sub_goal=0,
                task_id="task-budget-1",
            )

        assert rt.foreground_slot.llm_calls_this_task == 5

    @pytest.mark.asyncio
    async def test_budget_cap_fires_from_real_path(
        self, isolated_db, fresh_runtime, monkeypatch
    ):
        """With cap=3, the 4th tactical.plan call must surface call_budget_exhausted."""
        from agent.planner import tactical
        from agent import runtime as _rt_mod
        from agent.planner._llm import PlannerLLMError
        from agent.schemas import SelfModel, SubGoal
        from ai import provider as _provider_mod

        rt, _broadcasts = fresh_runtime
        monkeypatch.setattr(_provider_mod.config, "ai_primary_provider", "gemini")
        monkeypatch.setattr(_provider_mod.config, "ai_fallback_provider", "none")
        monkeypatch.setattr(_provider_mod.config, "ai_call_min_interval_ms", 0)
        monkeypatch.setattr(_rt_mod.config, "agent_max_llm_calls_per_task", 3)
        monkeypatch.setattr(_rt_mod.config, "agent_warn_llm_calls_per_task", 30)

        router = _provider_mod.AIRouter()
        router._providers["gemini"] = _CountingProvider()
        monkeypatch.setattr(tactical, "ai_router", router)

        # First two succeed (counter goes 1, 2; cap=3 not yet hit).
        for _ in range(2):
            await tactical.plan(
                step_idx=0,
                sub_goal=SubGoal(
                    description="d", rationale="r",
                    expected_actions=1, acceptance_criteria="",
                ),
                self_model=SelfModel(),
                observations=[],
                actions_in_sub_goal=0,
                task_id="task-budget-1",
            )
        # 3rd increments counter to 3; 3 >= cap_at=3 → False → router surfaces
        # ToolUseError(UNKNOWN, call_budget_exhausted), tactical re-raises as
        # PlannerLLMError.
        with pytest.raises(PlannerLLMError) as excinfo:
            await tactical.plan(
                step_idx=0,
                sub_goal=SubGoal(
                    description="d", rationale="r",
                    expected_actions=1, acceptance_criteria="",
                ),
                self_model=SelfModel(),
                observations=[],
                actions_in_sub_goal=0,
                task_id="task-budget-1",
            )
        assert "call_budget_exhausted" in str(excinfo.value)

    @pytest.mark.asyncio
    async def test_warn_threshold_emits_ws_event(
        self, isolated_db, fresh_runtime, monkeypatch
    ):
        """Crossing warn threshold emits agent.budget.warning exactly once."""
        from agent.planner import tactical
        from agent import runtime as _rt_mod
        from agent.schemas import SelfModel, SubGoal
        from ai import provider as _provider_mod

        rt, broadcasts = fresh_runtime
        monkeypatch.setattr(_provider_mod.config, "ai_primary_provider", "gemini")
        monkeypatch.setattr(_provider_mod.config, "ai_fallback_provider", "none")
        monkeypatch.setattr(_provider_mod.config, "ai_call_min_interval_ms", 0)
        monkeypatch.setattr(_rt_mod.config, "agent_warn_llm_calls_per_task", 2)
        monkeypatch.setattr(_rt_mod.config, "agent_max_llm_calls_per_task", 50)

        router = _provider_mod.AIRouter()
        router._providers["gemini"] = _CountingProvider()
        monkeypatch.setattr(tactical, "ai_router", router)

        for _ in range(4):
            await tactical.plan(
                step_idx=0,
                sub_goal=SubGoal(
                    description="d", rationale="r",
                    expected_actions=1, acceptance_criteria="",
                ),
                self_model=SelfModel(),
                observations=[],
                actions_in_sub_goal=0,
                task_id="task-budget-1",
            )

        warns = [e for e in broadcasts if e[0] == "agent.budget.warning"]
        assert len(warns) == 1, f"expected exactly one warn event, got {warns}"
        assert warns[0][1]["llm_calls_used"] >= 2
        assert warns[0][1]["warn_at"] == 2

    @pytest.mark.asyncio
    async def test_missing_task_id_logs_warning_but_call_proceeds(
        self, isolated_db, monkeypatch, caplog
    ):
        """When task_id is missing and the strict setting is on, a warning is logged."""
        from ai import provider as _provider_mod

        monkeypatch.setattr(_provider_mod.config, "agent_require_task_id_for_budget", True)

        with caplog.at_level(logging.WARNING, logger="ai.provider"):
            allowed = await _provider_mod._runtime_note_llm_call(None)
        assert allowed is True  # backwards compat — call still proceeds
        assert any("without task_id" in rec.message for rec in caplog.records), (
            "expected a WARNING about missing task_id"
        )

    @pytest.mark.asyncio
    async def test_loop_passes_task_id_to_tactical(self):
        """Source-level guarantee: the agent loop's tactical.plan call
        carries task_id=state.id. Phase 9.4a split the outer
        `run_task_loop` (track routing + timeout wrapper) from
        `_run_task_loop_impl` (actual ReAct body); the F-01 invariant
        now lives on the impl."""
        import inspect

        from agent import loop

        src = inspect.getsource(loop._run_task_loop_impl)
        assert "task_id=state.id" in src, (
            "agent.loop._run_task_loop_impl must pass task_id=state.id to tactical.plan"
        )
