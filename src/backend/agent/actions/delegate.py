"""
Phase 26-A — `agent.delegate` action.

The planner's primitive for fan-out: spawn a child sub-agent with a
specific role + goal + constraints, await its TaskReport, and surface
the outcome as a structured Observation the parent can reflect on.

Risk = LOW: spawning is recoverable (we cap depth + concurrency); the
sub-agent's own actions go through their own risk gate independently.
"""
from __future__ import annotations

import time
from typing import ClassVar

from pydantic import Field

from ..schemas import ActionResult, RiskLevel
from .base import Action, ActionContext


class AgentDelegate(Action):
    """Spawn a child sub-agent with a goal + role + constraints, await
    its completion, return the structured report as the action result.
    """

    name: ClassVar[str] = "agent.delegate"
    risk_level: ClassVar[RiskLevel] = RiskLevel.LOW
    reversible: ClassVar[bool] = False

    goal: str = Field(
        ...,
        min_length=4, max_length=2000,
        description=(
            "The exact goal the sub-agent should achieve, in plain language. "
            "Be concrete — the sub-agent only sees this string + the role "
            "label; it does NOT inherit your conversational context."
        ),
    )
    role: str = Field(
        default="generalist",
        max_length=64,
        description=(
            "Specialist label: 'senior_backend', 'reviewer', 'researcher', "
            "'data_analyst', 'documentation_writer', 'tester', 'translator' "
            "or any custom string. Helps the sub-agent's planner adapt prompt."
        ),
    )
    constraints: str = Field(
        default="",
        max_length=600,
        description=(
            "Optional one-line constraints — risk ceiling, time budget, "
            "must-do / must-avoid. Injected into the sub-agent's goal "
            "so the strategic planner reads them."
        ),
    )
    timeout_s: int = Field(
        default=300,
        ge=10, le=3600,
        description="Wall-clock deadline. Bounded so a stuck child can't hang the parent.",
    )
    branch: str | None = Field(
        default=None,
        description="Optional git branch name to isolate this sub-agent's work. If not provided, inherits parent's branch."
    )

    async def execute(self, ctx: ActionContext) -> ActionResult:
        runtime = ctx.runtime
        if runtime is None:
            return ActionResult(
                ok=False,
                error="agent.delegate requires runtime context",
                error_class="no_runtime",
            )

        try:
            parent = runtime.current_task
        except Exception:
            parent = None
        if parent is None or parent.id != ctx.task_id:
            return ActionResult(
                ok=False,
                error=(
                    "agent.delegate: current_task does not match action ctx — "
                    "cannot resolve parent for delegation."
                ),
                error_class="parent_unresolved",
            )

        from ..team.spawn import (
            DelegationDepthExceeded,
            SubagentSpawnError,
            TeamConcurrencyExceeded,
            announce_subagent_report,
            await_subagent,
            spawn_subagent,
        )

        started = time.monotonic()
        try:
            child_id = await spawn_subagent(
                runtime=runtime,
                parent_state=parent,
                goal=self.goal,
                role=self.role,
                constraints=self.constraints,
                timeout_s=self.timeout_s,
                branch=self.branch,
            )
        except DelegationDepthExceeded as exc:
            return ActionResult(
                ok=False,
                error=str(exc),
                error_class="depth_exceeded",
                elapsed_ms=int((time.monotonic() - started) * 1000),
            )
        except TeamConcurrencyExceeded as exc:
            return ActionResult(
                ok=False,
                error=str(exc),
                error_class="team_busy",
                elapsed_ms=int((time.monotonic() - started) * 1000),
            )
        except SubagentSpawnError as exc:
            return ActionResult(
                ok=False,
                error=str(exc),
                error_class="spawn_disabled",
                elapsed_ms=int((time.monotonic() - started) * 1000),
            )

        report = await await_subagent(
            child_id, timeout_s=float(self.timeout_s) + 5.0,
        )
        await announce_subagent_report(parent_state=parent, report=report)
        elapsed_ms = int((time.monotonic() - started) * 1000)

        ok = report.outcome == "done"
        return ActionResult(
            ok=ok,
            output={
                "child_task_id": report.child_task_id,
                "role": report.role,
                "outcome": report.outcome,
                "summary": report.summary,
                "details": dict(report.details),
                "elapsed_s": round(report.elapsed_s, 3),
            },
            error=None if ok else f"sub-agent outcome={report.outcome}: {report.summary}",
            error_class=None if ok else f"subagent_{report.outcome}",
            elapsed_ms=elapsed_ms,
            side_effects=["spawned_subagent"],
        )


__all__ = ["AgentDelegate"]
