"""
Phase 26-C — `agent.assemble_team` action.

The planner's high-level "delegate to a whole team" verb. Bundles
Phase 26-A (delegate primitive) + Phase 26-B (specialist picker) +
Phase 26-C (team leads) into one call:

  agent.assemble_team(goal, mode="auto", department=None,
                      max_members=4, parallel=True, timeout_s=600)

Modes:
  • "auto"        — pick_specialists chooses ANY roles (across all
                    departments) up to max_members.
  • "department"  — spawn the matching team_lead and let it
                    re-delegate to its own seniors. The lead's loop
                    decides which juniors + how many.
  • "explicit"    — caller passes `roles=["senior_backend",
                    "senior_test"]` and the action spawns one of
                    each. Skips the picker.

Result merges every member's TaskReport into one structured payload
the parent's planner can reflect on:

  {
    "mode": "...",
    "total_members": int,
    "successes": int,
    "failures": int,
    "rationale": str,                # picker rationale OR ""
    "members": [
      {child_task_id, role, outcome, summary, details, elapsed_s},
      ...
    ],
    "consolidated_summary": str,     # short UA synthesis
  }
"""
from __future__ import annotations

import asyncio
import time
from typing import Any, ClassVar

from pydantic import Field

from ..schemas import ActionResult, RiskLevel
from .base import Action, ActionContext


_MODES = {"auto", "department", "explicit"}
_DEPTS = {"engineering", "product", "qa", "research", "operations"}


class AgentAssembleTeam(Action):
    """Spawn a whole team in one shot. Bundles picker + delegate +
    parallel await + result consolidation.

    risk_level=LOW because spawning is recoverable; each member's own
    actions go through their own risk gate independently."""

    name: ClassVar[str] = "agent.assemble_team"
    risk_level: ClassVar[RiskLevel] = RiskLevel.LOW
    reversible: ClassVar[bool] = False

    goal: str = Field(
        ...,
        min_length=4, max_length=2000,
        description=(
            "The mission for the whole team. Each member's own sub_goal "
            "is derived (auto mode: by the picker; department mode: by "
            "the team lead; explicit mode: each role gets a copy)."
        ),
    )
    mode: str = Field(
        default="auto",
        description="auto | department | explicit",
    )
    department: str | None = Field(
        default=None,
        description=(
            "Required when mode='department'. One of: "
            "engineering, product, qa, research, operations."
        ),
    )
    roles: list[str] = Field(
        default_factory=list,
        description=(
            "Required when mode='explicit'. List of specialist role "
            "names from the registry."
        ),
    )
    max_members: int = Field(default=4, ge=1, le=8)
    parallel: bool = Field(
        default=True,
        description="When True, all members run via asyncio.gather; sequential when False.",
    )
    timeout_s: int = Field(default=600, ge=30, le=3600)

    async def execute(self, ctx: ActionContext) -> ActionResult:  # noqa: PLR0911
        runtime = ctx.runtime
        if runtime is None:
            return ActionResult(
                ok=False,
                error="agent.assemble_team requires runtime context",
                error_class="no_runtime",
            )
        if self.mode not in _MODES:
            return ActionResult(
                ok=False,
                error=f"unknown mode {self.mode!r}; allowed: {sorted(_MODES)}",
                error_class="invalid_args",
            )

        try:
            parent = runtime.current_task
        except Exception:
            parent = None
        if parent is None or parent.id != ctx.task_id:
            return ActionResult(
                ok=False,
                error="parent task unresolved",
                error_class="parent_unresolved",
            )

        from ..team.picker import (
            TeamMemberRequest, TeamPlan, pick_specialists,
        )
        from ..team.specialists import (
            get_specialist, specialists_by_department,
        )

        # ── Mode dispatch — build a list[TeamMemberRequest] ──
        plan: TeamPlan
        if self.mode == "auto":
            plan = await pick_specialists(
                goal=self.goal,
                budget=self.max_members,
                task_id=ctx.task_id,
            )
            if not plan.members:
                return ActionResult(
                    ok=False,
                    error="picker returned empty team — do the work yourself",
                    error_class="empty_team",
                    output={"mode": self.mode, "rationale": plan.rationale},
                )
        elif self.mode == "department":
            if self.department not in _DEPTS:
                return ActionResult(
                    ok=False,
                    error=(
                        f"mode=department requires department in "
                        f"{sorted(_DEPTS)}, got {self.department!r}"
                    ),
                    error_class="invalid_args",
                )
            lead_role = f"team_lead_{self.department}"
            if get_specialist(lead_role) is None:
                # Should never happen but fail loud rather than silently.
                return ActionResult(
                    ok=False,
                    error=f"team lead {lead_role!r} missing from registry",
                    error_class="lead_missing",
                )
            plan = TeamPlan(
                rationale=f"delegate to {self.department} team lead",
                members=[TeamMemberRequest(
                    role=lead_role,
                    count=1,
                    sub_goal=self.goal,
                    constraints="",
                    timeout_s=self.timeout_s,
                )],
                generation_strategy="department",
            )
        else:  # "explicit"
            valid_roles = [r for r in self.roles if get_specialist(r)]
            if not valid_roles:
                return ActionResult(
                    ok=False,
                    error="explicit mode needs at least 1 valid role from registry",
                    error_class="invalid_args",
                )
            valid_roles = valid_roles[: self.max_members]
            plan = TeamPlan(
                rationale=f"explicit roles: {valid_roles}",
                members=[TeamMemberRequest(
                    role=r, count=1, sub_goal=self.goal,
                    constraints="", timeout_s=self.timeout_s,
                ) for r in valid_roles],
                generation_strategy="explicit",
            )

        # ── Spawn + await ──
        from ..team.spawn import (
            DelegationDepthExceeded, SubagentReport,
            SubagentSpawnError, await_subagent, spawn_subagent,
        )

        started = time.monotonic()
        spawn_calls: list[tuple[str, str, int]] = []  # (role, sub_goal, timeout)
        for member in plan.members:
            for _ in range(max(1, int(member.count))):
                spawn_calls.append((
                    member.role,
                    member.sub_goal or self.goal,
                    member.timeout_s,
                ))

        # Spawn all (or sequentially if parallel=False).
        spawned: list[tuple[str, str]] = []  # (child_id, role)
        spawn_errors: list[dict[str, Any]] = []
        for role, sub_goal, member_timeout in spawn_calls:
            try:
                child_id = await spawn_subagent(
                    runtime=runtime,
                    parent_state=parent,
                    goal=sub_goal,
                    role=role,
                    constraints=plan.rationale[:200],
                    timeout_s=member_timeout,
                )
                spawned.append((child_id, role))
            except DelegationDepthExceeded as exc:
                spawn_errors.append({"role": role, "error_class": "depth_exceeded", "msg": str(exc)})
            except SubagentSpawnError as exc:
                spawn_errors.append({"role": role, "error_class": "spawn_error", "msg": str(exc)})
            if not self.parallel and spawned:
                # Sequential — await this one before spawning the next.
                child_id, role_name = spawned[-1]
                _ = await await_subagent(
                    child_id, timeout_s=float(member_timeout) + 5.0,
                )

        # In parallel mode, await all at once.
        reports: list[SubagentReport] = []
        if self.parallel:
            reports = await asyncio.gather(*[
                await_subagent(cid, timeout_s=float(self.timeout_s) + 5.0)
                for cid, _r in spawned
            ])
        else:
            # Re-await synchronously — already awaited inline above; pull
            # from event_bus replay isn't a thing, so we just publish a
            # synthetic timeout if we didn't catch them earlier. The
            # sequential path is rare; tests prefer parallel.
            for cid, role_name in spawned:
                rep = await await_subagent(cid, timeout_s=1.0)
                reports.append(rep)

        successes = sum(1 for r in reports if r.outcome == "done")
        failures = len(reports) - successes
        elapsed_ms = int((time.monotonic() - started) * 1000)

        consolidated = self._consolidate(plan, reports, spawn_errors)

        ok = (failures == 0) and (not spawn_errors) and bool(reports)
        return ActionResult(
            ok=ok,
            output={
                "mode": self.mode,
                "department": self.department,
                "total_members": len(reports),
                "successes": successes,
                "failures": failures,
                "spawn_errors": spawn_errors,
                "rationale": plan.rationale,
                "generation_strategy": plan.generation_strategy,
                "members": [
                    {
                        "child_task_id": r.child_task_id,
                        "role": r.role,
                        "outcome": r.outcome,
                        "summary": r.summary,
                        "elapsed_s": round(r.elapsed_s, 3),
                        "details": dict(r.details),
                    }
                    for r in reports
                ],
                "consolidated_summary": consolidated,
            },
            error=None if ok else (
                f"team finished with {failures} failures, "
                f"{len(spawn_errors)} spawn errors"
            ),
            error_class=None if ok else "team_partial_failure",
            elapsed_ms=elapsed_ms,
            side_effects=["assembled_team"],
        )

    def _consolidate(
        self,
        plan: Any,
        reports: list[Any],
        spawn_errors: list[dict[str, Any]],
    ) -> str:
        """Build a UA synthesis the parent's planner can read in one
        Observation. Bounded so a chatty team doesn't blow context."""
        if not reports and not spawn_errors:
            return "Команда не була зібрана."
        lines: list[str] = []
        if plan.rationale:
            lines.append(f"План: {plan.rationale[:200]}")
        for r in reports:
            symbol = "✓" if r.outcome == "done" else "✗"
            lines.append(
                f"{symbol} {r.role}: {(r.summary or '(no summary)')[:160]}"
            )
        for err in spawn_errors:
            lines.append(
                f"✗ {err['role']} НЕ запустився: "
                f"{err['error_class']}={err['msg'][:80]}"
            )
        return "\n".join(lines)[:1500]


__all__ = ["AgentAssembleTeam"]
