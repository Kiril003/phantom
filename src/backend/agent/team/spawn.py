"""
Phase 26-A — Sub-agent spawn primitive.

Bypasses the foreground/background slot machinery so a parent task
can fan out N parallel specialist sub-agents without contending
for the operator's slot.

Concurrency model:
  • Each sub-agent runs as a standalone asyncio.Task with its own
    `TaskState` (linked back to parent via `parent_task_id` +
    `delegation_depth`).
  • A global semaphore (`team_semaphore`) caps how many sub-agents
    can run at once across the entire runtime — prevents fork-bombs.
  • A recursion guard (`agent_max_delegation_depth`) caps how deep
    a delegation chain may go (root → team_lead → senior → ad-hoc).

Completion model:
  • The runtime's `_finalize_persist` calls `notify_subagent_completed`
    when a task with `parent_task_id` finishes — that emits a
    `SubagentReport` over the in-process EventBus channel
    `team.subagent_completed:<child_task_id>`.
  • `await_subagent(child_id, timeout_s)` subscribes to that channel
    and blocks the parent until the child reports OR the timeout
    expires (returns `SubagentReport(outcome="timeout")`).

What does NOT happen here:
  • No DB row schema migration — `agent_tasks` already has a
    nullable `metadata_json` column where the spawn helper records
    `{parent_task_id, role, depth}` so audit walk-up works.
  • No FSM transition — sub-agents do NOT enter OPERATOR state;
    only the root foreground task does.
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Optional

from config import config
from core.event_bus import event_bus

if TYPE_CHECKING:
    from agent.kernel.runtime import AgentRuntime, TaskState

logger = logging.getLogger(__name__)


# ─── Errors ─────────────────────────────────────────────────────────────────


class SubagentSpawnError(Exception):
    """Base for spawn failures so callers can catch one type."""


class DelegationDepthExceeded(SubagentSpawnError):
    """Raised when a parent at depth N tries to spawn a child that
    would exceed `agent_max_delegation_depth`."""


class TeamConcurrencyExceeded(SubagentSpawnError):
    """Raised when the global team semaphore is at its cap and the
    caller asked for non-blocking spawn (timeout=0)."""


# ─── Data ────────────────────────────────────────────────────────────────────


@dataclass
class SubagentReport:
    """One sub-agent's outcome, delivered to the parent via event_bus.

    `outcome` is one of:
        done | failed | timeout | stopped | depth_exceeded |
        concurrency_timeout | spawn_error
    `summary` — short UA-friendly string the parent's planner can
        re-inject as an Observation.
    `details` — structured payload (action_counts, key observations,
        artefact ref). Bounded so a chatty child doesn't blow the
        parent's context budget.
    """
    child_task_id: str
    role: str
    outcome: str
    summary: str = ""
    details: dict[str, Any] = field(default_factory=dict)
    started_at: float = 0.0
    elapsed_s: float = 0.0


# ─── Module-level state ──────────────────────────────────────────────────────


# Global team semaphore — created lazily so tests can monkeypatch
# `config.agent_max_team_concurrency` before first acquire.
_TEAM_SEM: Optional[asyncio.Semaphore] = None


def team_semaphore() -> asyncio.Semaphore:
    """Return (and lazily build) the global team-concurrency semaphore."""
    global _TEAM_SEM
    if _TEAM_SEM is None:
        cap = max(1, int(getattr(config, "agent_max_team_concurrency", 8)))
        _TEAM_SEM = asyncio.Semaphore(cap)
    return _TEAM_SEM


def _reset_team_semaphore_for_tests() -> None:
    """Test hook — reset module state so tests can pin a different cap."""
    global _TEAM_SEM
    _TEAM_SEM = None


# In-flight sub-agents (by id) — used by tests + status endpoints.
_inflight: dict[str, asyncio.Task] = {}


def _channel(child_task_id: str) -> str:
    return f"team.subagent_completed:{child_task_id}"


# ─── Agent-to-agent traffic ─────────────────────────────────────────────────
#
# Wire convention consumers rely on: `task_id` is the RECEIVING task,
# `parent_task_id` the SENDING one — in both directions.

_NAME_CAP = 64
_MESSAGE_CAP = 2000


def _party_name(state: "TaskState | None") -> str:
    if state is None:
        return "operator"
    return (getattr(state, "subagent_role", None) or "operator")[:_NAME_CAP]


async def _emit_team_message(
    *,
    to_task_id: str,
    from_task_id: str,
    sender: str,
    receiver: str,
    message: str,
    message_type: str,
) -> None:
    try:
        from agent.kernel.audit import write_team_message
        await write_team_message(
            task_id=to_task_id,
            parent_task_id=from_task_id,
            sender=sender[:_NAME_CAP],
            receiver=receiver[:_NAME_CAP],
            message=message[:_MESSAGE_CAP],
            message_type=message_type,
        )
    except Exception as exc:
        logger.debug("team.message emit failed (%s): %s", message_type, exc)


async def announce_subagent_report(
    *,
    parent_state: "TaskState",
    report: SubagentReport,
) -> None:
    # role="unknown" is the report await_subagent mints for itself on timeout;
    # the child never sent anything, so it is not traffic.
    if report.role == "unknown":
        return
    await _emit_team_message(
        to_task_id=parent_state.id,
        from_task_id=report.child_task_id,
        sender=report.role,
        receiver=_party_name(parent_state),
        message=f"{report.outcome}: {report.summary}".strip(),
        message_type="report",
    )


# ─── Public API ──────────────────────────────────────────────────────────────


async def spawn_subagent(
    *,
    runtime: "AgentRuntime",
    parent_state: "TaskState",
    goal: str,
    role: str,
    constraints: str = "",
    timeout_s: int | None = None,
    extra_origin: str = "delegate",
    branch: str | None = None,
) -> str:
    """Spawn a child sub-agent and return its task_id.

    Does NOT block the parent — the caller awaits completion via
    `await_subagent(child_id, timeout_s)`. Two failure modes are
    raised synchronously (before any state is created):

      * DelegationDepthExceeded — parent already at the deepest
        level allowed; the planner must do the work itself.
      * TeamConcurrencyExceeded — global cap hit AND the caller
        asked for non-blocking spawn. (The default IS blocking; this
        only fires when the caller passes a `wait_for_slot=False`
        flavour, which we don't expose yet — kept for future.)
    """
    if not bool(getattr(config, "agent_team_enabled", True)):
        raise SubagentSpawnError("agent_team_enabled is False")

    max_depth = int(getattr(config, "agent_max_delegation_depth", 3))
    next_depth = int(parent_state.delegation_depth) + 1
    if next_depth > max_depth:
        raise DelegationDepthExceeded(
            f"delegation depth {next_depth} exceeds cap {max_depth} "
            f"(parent={parent_state.id[:8]}, role={role!r})"
        )

    timeout_s = int(
        timeout_s
        if timeout_s is not None
        else getattr(config, "agent_default_subagent_timeout_s", 300)
    )

    child_id = str(uuid.uuid4())
    # Block-and-wait for a free team slot. The semaphore RELEASES inside
    # the runner coroutine, after the loop returns and the completion
    # event has been emitted — that way the parent's await_subagent
    # call can land on the event before the slot reopens.
    sem = team_semaphore()
    await sem.acquire()
    try:
        runner = asyncio.create_task(
            _run_subagent(
                runtime=runtime,
                child_id=child_id,
                goal=goal,
                role=role,
                constraints=constraints,
                timeout_s=timeout_s,
                parent_task_id=parent_state.id,
                depth=next_depth,
                origin=extra_origin,
            ),
            name=f"subagent_{role}_{child_id[:8]}",
        )
        _inflight[child_id] = runner
        runner.add_done_callback(lambda _t: _inflight.pop(child_id, None))
        await _emit_team_message(
            to_task_id=child_id,
            from_task_id=parent_state.id,
            sender=_party_name(parent_state),
            receiver=role,
            message=goal,
            message_type="delegate",
        )
        return child_id
    except Exception:
        # If we couldn't even schedule the runner, release the slot.
        sem.release()
        raise


async def await_subagent(
    child_task_id: str,
    *,
    timeout_s: float | None = None,
) -> SubagentReport:
    """Block until the sub-agent completes (or the timeout fires).

    Returns a SubagentReport — never raises on child failure; the
    `outcome` field carries the verdict so the parent's planner can
    decide what to do next.
    """
    fut: asyncio.Future[SubagentReport] = asyncio.get_event_loop().create_future()

    def _on_complete(report: SubagentReport) -> None:
        if not fut.done():
            fut.set_result(report)

    unsub = event_bus.subscribe(_channel(child_task_id), _on_complete)
    try:
        if timeout_s is None or timeout_s <= 0:
            return await fut
        try:
            return await asyncio.wait_for(fut, timeout=timeout_s)
        except asyncio.TimeoutError:
            return SubagentReport(
                child_task_id=child_task_id,
                role="unknown",
                outcome="timeout",
                summary=f"sub-agent did not finish within {timeout_s:.0f}s",
            )
    finally:
        unsub()


def notify_subagent_completed(
    *,
    child_state: "TaskState",
    outcome_kind: str,
    summary: str,
    action_counts: dict[str, int] | None = None,
) -> None:
    """Emit the completion event from `runtime._finalize_persist`.

    Called UNCONDITIONALLY for every finalising task; parents that
    aren't waiting (no subscribers) get a noop. Bounded payload so
    the parent's context isn't blown by a chatty child.
    """
    if child_state.parent_task_id is None:
        return
    last_obs = ""
    try:
        if child_state.observations:
            last_obs = (child_state.observations[-1].content or "")[:300]
    except Exception:
        pass
    report = SubagentReport(
        child_task_id=child_state.id,
        role=child_state.subagent_role or "unknown",
        outcome=outcome_kind,
        summary=summary[:500],
        details={
            "action_counts": dict(action_counts or {}),
            "step_idx": child_state.step_idx,
            "sub_goals_done": sum(
                1 for sg in child_state.sub_goals if sg.status == "done"
            ),
            "last_observation": last_obs,
            "depth": child_state.delegation_depth,
        },
        started_at=child_state.started_at,
        elapsed_s=max(0.0, time.monotonic() - child_state.started_at),
    )
    event_bus.emit(_channel(child_state.id), report)


# ─── Internal runner ────────────────────────────────────────────────────────


def _build_subagent_goal(*, role: str, constraints: str, base_goal: str) -> str:
    """Decorate the bare goal with role + constraints so the strategic
    planner reads them as part of the prompt. Keeps the goal field
    self-describing — no hidden state needed."""
    parts = [f"[role={role}]"]
    if constraints:
        parts.append(f"[constraints={constraints}]")
    parts.append(base_goal)
    return " ".join(parts)


async def _run_subagent(
    *,
    runtime: "AgentRuntime",
    child_id: str,
    goal: str,
    role: str,
    constraints: str,
    timeout_s: int,
    parent_task_id: str,
    depth: int,
    origin: str,
    branch: str | None = None,
) -> None:
    """Coroutine body for one sub-agent. Owns:
      • TaskState build with parent linkage + role
      • DB row creation
      • Loop dispatch with bounded wall-clock (asyncio.wait_for)
      • Emergency completion event on uncaught exception so the
        parent's await never hangs
      • Semaphore release in finally so a crashing child still frees
        the slot
    """
    from ..kernel.audit import create_task_row, update_task_status
    from agent.kernel.loop import run_task_loop
    from agent.kernel.runtime import TaskState
    # self_model lives under agent.cognition, not agent.
    from ..cognition.self_model import build_self_model
    from ..actions.registry import registry as default_registry

    sem = team_semaphore()
    state: "TaskState | None" = None
    try:
        # Phase 30 — Inject role_id (subagent_role) into self-model builder
        # This loads standing_orders and prompt extensions for the specialist.
        self_model = await build_self_model(default_registry, role_id=role)
        
        decorated = _build_subagent_goal(
            role=role, constraints=constraints, base_goal=goal,
        )
        state = TaskState(
            id=child_id,
            goal=decorated,
            track="background",
            status="planning",
            self_model=self_model,
            origin=origin,
            timeout_s=timeout_s,
            parent_task_id=parent_task_id,
            subagent_role=role,
            delegation_depth=depth,
            branch_isolation=branch,
        )
        await create_task_row(child_id, decorated, "background")
        try:
            await asyncio.wait_for(
                run_task_loop(runtime, state),
                timeout=timeout_s,
            )
        except asyncio.TimeoutError:
            # finalize_task wasn't called by the loop; persist the
            # timeout outcome and emit completion ourselves.
            try:
                await update_task_status(
                    child_id, "timeout", error="subagent_timeout",
                    finished=True,
                )
            except Exception as exc:
                logger.warning("subagent timeout finalize failed: %s", exc)
            notify_subagent_completed(
                child_state=state,
                outcome_kind="timeout",
                summary=(
                    f"sub-agent {role}({child_id[:8]}) hit "
                    f"{timeout_s}s timeout"
                ),
                action_counts={
                    e["action"]: 1
                    for e in state.actions_log
                },
            )
    except Exception as exc:
        logger.exception("subagent runner crashed: role=%s id=%s", role, child_id)
        # Emit a synthetic completion so the parent's await never hangs.
        if state is not None:
            notify_subagent_completed(
                child_state=state,
                outcome_kind="failed",
                summary=f"sub-agent crashed: {type(exc).__name__}: {exc}",
            )
        else:
            # State never built — emit a minimal report anyway so the
            # parent's await fires.
            event_bus.emit(_channel(child_id), SubagentReport(
                child_task_id=child_id,
                role=role,
                outcome="spawn_error",
                summary=f"runner aborted before TaskState: {exc}",
            ))
    finally:
        sem.release()
