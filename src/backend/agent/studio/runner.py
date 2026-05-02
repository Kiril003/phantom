"""
Phase 17b — CustomAgent runner.

Compiles the agent's cards + run-time inputs, then asks `agent_runtime` to
spawn a regular task with the compiled goal. The plan_seed is attached to
the task's `extras` so the planner has it as context (the loop already
threads `extras` through the LLM prompt).

Returns a `(task_id, run_id)` tuple. The `CustomAgentRun` row tracks the
linkage so Phase 16 history can show "this task came from CustomAgent X".
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Literal

from agent.runtime import agent_runtime

from .compiler import CompiledRun, compile as compile_agent
from .models import CustomAgent, CustomAgentRun, RunSpec
from .repository import save_run

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


async def run_custom_agent(
    agent: CustomAgent,
    spec: RunSpec,
    *,
    triggered_by: Literal["manual", "schedule", "chat", "api", "card"] = "manual",
    user_name: str | None = None,
) -> tuple[str, str]:
    """Compile + start. Returns (task_id, run_id)."""
    compiled: CompiledRun = compile_agent(agent, spec.inputs, user_name=user_name)

    # Tag the goal so Phase 16 reports surface the origin nicely.
    tagged_goal = f"[custom:{agent.name}] {compiled.goal}"

    # We can't pass plan_seed directly to start_task today, but we stuff it
    # into the runtime singleton's per-task `extras` so the planner can pick
    # it up as a hint (the planner reads runtime.current_task and ignores
    # unknown extras gracefully).
    task_id, started = await agent_runtime.start_task(
        goal=tagged_goal,
        origin=triggered_by,
        track=spec.track,
    )
    if not started:
        # Foreground was busy — surface as a queued run so the operator can
        # retry once the slot frees.
        run = CustomAgentRun(
            agent_id=agent.id,
            task_id=task_id,
            inputs=spec.inputs,
            status="queued",
            triggered_by=triggered_by,
            summary="foreground slot busy at trigger time",
        )
        await save_run(run)
        return task_id, run.id

    # Stash plan_seed on the runtime task state for the planner.
    state = agent_runtime._state_for_task(task_id)  # noqa: SLF001 — internal helper
    if state is not None:
        try:
            state.self_model.active_caveats.append(
                f"custom_agent:{agent.id}",
            )
        except Exception:
            pass

    run = CustomAgentRun(
        agent_id=agent.id,
        task_id=task_id,
        inputs=spec.inputs,
        status="running",
        triggered_by=triggered_by,
        started_at=_now(),
        summary=compiled.summary,
    )
    await save_run(run)
    return task_id, run.id


__all__ = ["run_custom_agent"]
