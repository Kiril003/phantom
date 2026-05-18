"""Phase 9.2.3 cleanup — regression tests for F-06, F-07, and F-11.

Each test exercises the real code path the finding describes (not just the
unit under change): F-07 drives TimeWait.execute end-to-end with a live
ControlBus; F-06 drives strategic.plan through a monkey-patched LLM; F-11
drives tactical._legacy_plan with task_id threading asserted inline.
"""
from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.actions.base import ActionContext
from agent.actions.time_ import TimeWait
from agent.kernel.controls import ControlBus
from agent.cognition.planner._llm import BlockedQuotaError


# -----------------------------------------------------------------------------
# F-07 — time.wait honours runtime.controls.{emergency_stop,pause_event}
# -----------------------------------------------------------------------------


class _FakeRuntime:
    """Minimal runtime stub matching the attribute surface time.wait reads."""

    def __init__(self) -> None:
        self.controls = ControlBus()


@pytest.mark.asyncio
async def test_time_wait_interrupted_by_emergency_stop() -> None:
    runtime = _FakeRuntime()
    ctx = ActionContext(task_id="t1", step_idx=0, workspace_dir="/tmp", runtime=runtime)  # type: ignore[arg-type]
    action = TimeWait(seconds=5.0)

    async def fire_stop() -> None:
        await asyncio.sleep(0.25)
        runtime.controls.emergency_stop.set()

    stop_task = asyncio.create_task(fire_stop())
    result = await action.execute(ctx)
    await stop_task

    assert result.ok is False
    assert result.error == "interrupted_by_stop"
    assert result.error_class == "interrupted"
    assert result.elapsed_ms is not None and result.elapsed_ms < 2000


@pytest.mark.asyncio
async def test_time_wait_interrupted_by_pause() -> None:
    runtime = _FakeRuntime()
    ctx = ActionContext(task_id="t1", step_idx=0, workspace_dir="/tmp", runtime=runtime)  # type: ignore[arg-type]
    action = TimeWait(seconds=5.0)

    async def fire_pause() -> None:
        await asyncio.sleep(0.25)
        runtime.controls.pause_event.set()

    pause_task = asyncio.create_task(fire_pause())
    result = await action.execute(ctx)
    await pause_task

    assert result.ok is True
    assert result.output is not None
    assert result.output.get("interrupted_by") == "pause"
    assert result.elapsed_ms is not None and result.elapsed_ms < 2000


@pytest.mark.asyncio
async def test_time_wait_without_runtime_still_runs() -> None:
    """Legacy invariant — context without runtime must not crash."""
    ctx = ActionContext(task_id="t1", step_idx=0, workspace_dir="/tmp", runtime=None)  # type: ignore[arg-type]
    action = TimeWait(seconds=0.3)
    result = await action.execute(ctx)
    assert result.ok is True
    assert result.output is not None
    assert result.output.get("slept_s") == pytest.approx(0.3, abs=0.1)


# -----------------------------------------------------------------------------
# F-06 — BlockedQuotaError propagates through strategic.plan (not wrapped)
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_strategic_plan_propagates_blocked_quota_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """strategic.plan must NOT catch BlockedQuotaError and re-wrap it; the
    agent loop relies on the type to park the task on blocked_quota rather
    than finalise as failed.
    """
    from agent.cognition.planner import _llm, strategic
    from agent.schemas import SelfModel

    async def fake_llm_json(prompt: str, retry_message: str | None = None, *, task_id: str | None = None) -> dict:
        raise BlockedQuotaError("primary_quota_exhausted")

    monkeypatch.setattr(_llm, "llm_json", fake_llm_json)
    monkeypatch.setattr(strategic, "llm_json", fake_llm_json)

    sm = SelfModel(role="test", mood="neutral", energy=0.9, capabilities=[], recent_task_summary=None)
    with pytest.raises(BlockedQuotaError):
        await strategic.plan(goal="x", self_model=sm, task_id="t1")


# -----------------------------------------------------------------------------
# F-11 — legacy tactical plan inherits generate() resilience
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_legacy_tactical_plan_surfaces_blocked_quota(monkeypatch: pytest.MonkeyPatch) -> None:
    """Legacy (non-native-tool-calling) path goes through llm_json → _call →
    ai_router.generate. F-02's uplift means BlockedQuotaError now surfaces here
    too — the 9.1-era path is no longer quota-blind.
    """
    from agent.actions.registry import registry as default_registry
    from agent.cognition.planner import _llm, tactical
    from agent.schemas import SelfModel, SubGoal

    async def fake_llm_json(prompt: str, retry_message: str | None = None, *, task_id: str | None = None) -> dict:
        # task_id MUST propagate to llm_json so the budget counter runs.
        assert task_id == "t1", f"F-11 expects task_id to thread through legacy path, got {task_id!r}"
        raise BlockedQuotaError("quota_blocked_on_legacy_path")

    monkeypatch.setattr(_llm, "llm_json", fake_llm_json)
    monkeypatch.setattr(tactical, "llm_json", fake_llm_json)

    sm = SelfModel(role="test", mood="neutral", energy=0.9, capabilities=[], recent_task_summary=None)
    sg = SubGoal(description="do the thing", rationale="test", expected_actions=1, acceptance_criteria="")

    with pytest.raises(BlockedQuotaError):
        await tactical._legacy_plan(
            step_idx=0,
            sub_goal=sg,
            self_model=sm,
            observations=[],
            actions_in_sub_goal=0,
            registry_=default_registry,
            task_id="t1",
        )
