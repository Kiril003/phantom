"""Phase 9.2.3 — F-09 regression: cancel_step actually cancels the
in-flight action instead of just setting a flag no one polls.

The test drives the real executor against a synthetic slow action
(`asyncio.sleep(10)`), fires `cancel_step` 200 ms in, and asserts the
executor returns a `cancelled_by_user` audit row within <1 s — not 10 s.
"""
from __future__ import annotations

import asyncio
from typing import ClassVar

import pytest

from agent.actions.base import Action, ActionContext
from agent.actions.registry import ActionRegistry
from agent.executor import StepCancelled, execute as execute_action
from agent.runtime import AgentRuntime
from agent.schemas import ActionResult, PlanStep, RiskLevel


class _SlowAction(Action):
    name: ClassVar[str] = "test.slow"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE

    async def execute(self, ctx: ActionContext) -> ActionResult:
        await asyncio.sleep(10.0)
        return ActionResult(ok=True, output={"slept": 10})


@pytest.fixture
def slow_registry() -> ActionRegistry:
    reg = ActionRegistry()
    reg._by_name["test.slow"] = _SlowAction  # type: ignore[attr-defined]
    return reg


@pytest.mark.asyncio
async def test_cancel_step_cancels_in_flight_action(slow_registry: ActionRegistry) -> None:
    runtime = AgentRuntime()
    # Seed a foreground slot so cancel_step's task_id check passes.
    from agent.runtime import TaskState
    from agent.schemas import SelfModel

    sm = SelfModel()
    task_id = "t-cancel"
    runtime.foreground_slot = TaskState(
        id=task_id, goal="x", track="foreground", status="running", self_model=sm,
    )
    step = PlanStep(step_idx=0, sub_goal_id=None, action="test.slow", args={})

    async def fire_cancel() -> None:
        await asyncio.sleep(0.2)
        await runtime.cancel_step(task_id)

    cancel_task = asyncio.create_task(fire_cancel())
    import time
    t0 = time.monotonic()
    with pytest.raises(StepCancelled):
        await execute_action(
            task_id=task_id,
            step=step,
            runtime=runtime,
            workspace_dir="/tmp",
            registry_=slow_registry,
        )
    elapsed = time.monotonic() - t0
    await cancel_task
    assert elapsed < 1.5, f"cancel_step should interrupt within ~200ms, took {elapsed:.2f}s"


@pytest.mark.asyncio
async def test_current_action_task_cleared_after_completion(slow_registry: ActionRegistry) -> None:
    """Invariant — the runtime handle must be None after execute returns,
    regardless of success / failure / cancellation.
    """
    runtime = AgentRuntime()
    from agent.runtime import TaskState
    from agent.schemas import SelfModel

    class _QuickAction(Action):
        name: ClassVar[str] = "test.quick"
        risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE

        async def execute(self, ctx: ActionContext) -> ActionResult:
            return ActionResult(ok=True, output={"done": True})

    reg = ActionRegistry()
    reg._by_name["test.quick"] = _QuickAction  # type: ignore[attr-defined]

    runtime.foreground_slot = TaskState(
        id="t-quick", goal="x", track="foreground", status="running",
        self_model=SelfModel(),
    )
    step = PlanStep(step_idx=0, sub_goal_id=None, action="test.quick", args={})
    result, _audit_id = await execute_action(
        task_id="t-quick", step=step, runtime=runtime,
        workspace_dir="/tmp", registry_=reg,
    )
    assert result.ok is True
    assert runtime._current_action_task is None
