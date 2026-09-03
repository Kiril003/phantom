"""
AgentRuntime singleton — owns active task state, broadcasts substates,
exposes the control surface that routes_agent.py + websocket_hub use.

Phase 9.4a — multi-track execution:
  * Foreground slot (user conversation / OPERATOR tasks) keeps all prior
    broadcast + UI semantics.
  * Background slot (standing orders, proactive actions) runs in parallel
    with reduced broadcast, stricter LLM budget, and a wall-clock timeout.
  * Backround task lifecycle boundaries (started/completed/failed/timeout)
    are emitted on a separate `background_events` WS channel so the main
    agent.stream feed stays focused on the user.

Track routing is carried via a ContextVar set at the top of each task loop;
`_broadcast` / `set_substate` consult it instead of threading an extra arg
through every call site.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import time
import uuid
from collections import deque
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any

from config import config

from agent.kernel.audit import (
    create_task_row,
    persist_task_state,
    save_checkpoint,
    snapshot_task_state,
    update_task_status,
    write_memory_seed,
)
from agent.kernel.checkpoints import build as build_checkpoint
from agent.kernel.controls import ControlBus
from agent.kernel.errors import TrackBusyError
from agent.schemas import (
    Observation,
    PlanStep,
    ReflectionResult,
    SelfModel,
    StrategicPlan,
    SubGoal,
    Substate,
    TaskStatus,
    ThoughtBudget,
    Track,
)

logger = logging.getLogger(__name__)


# Phase 9.2.1 — interval between provider-recovery probes when a task is
# parked on `blocked_quota`. Default of 60s matches Gemini's free-tier
# per-minute rate-limit window. Phase 9.2.2 (F-03): now configurable via
# `agent_blocked_quota_probe_s` and adaptive — probe interval grows
# exponentially up to `agent_blocked_quota_probe_max_s` after consecutive
# failures so we don't burn quota during a long Google outage.
_BLOCKED_QUOTA_PROBE_S = 60.0
_PROBE_BACKOFF_AFTER_FAILS = 3   # extend probe interval after 3 consecutive Falses


# Phase 9.4a — the current "which track am I running on" signal.
# The loop sets it at entry; broadcast/substate/budget helpers read it so
# they route to the right WS channel without every call site passing
# `track=` explicitly.
current_track: ContextVar[Track] = ContextVar("agent_current_track", default="foreground")

# Sub-agents never occupy the background slot, so slot-derived identity is
# wrong for them.
current_task_id: ContextVar[str | None] = ContextVar("agent_current_task_id", default=None)


# Lifecycle events that must still surface to UI for background tasks. Never
# rate-limited.
_BACKGROUND_ALLOWED_EVENTS = frozenset({
    "task.started",
    "task.completed",
    "task.failed",
    "task.stopped",
    "task.timeout",
    "warning.issued",
})

_LIFECYCLE_FIELDS: dict[str, tuple[str, ...]] = {
    "task.started": (
        "task_id", "goal", "track", "resumed",
        "parent_task_id", "subagent_role", "delegation_depth",
        "mission_id", "phase_count",
    ),
    "task.completed": ("task_id", "track", "summary", "error"),
    "task.failed": ("task_id", "track", "summary", "error"),
    "task.stopped": ("task_id", "track", "summary", "error"),
    "task.timeout": ("task_id", "track", "summary", "error"),
    "warning.issued": ("task_id", "category", "message", "step_idx"),
}

# `background_events` is subscribed independently of `agent.stream`, so the
# anti-spam argument for the operator's stream does not apply here. Projected
# to identity + state and rate-limited; unbounded-content events stay out.
_BACKGROUND_OBSERVER_EVENTS = frozenset({
    "substate.changed",
    "thinking.started",
    "thinking.completed",
    "action.started",
    "tool.selected",
    "sub_goal.started",
    "sub_goal.done",
    "sub_goal.abandoned",
    "reflection.started",
    "reflection.completed",
    "task.paused",
    "task.resumed",
    "task.waiting_user",
    "task.blocked_quota",
    "task.blocked_quota_backoff",
    "mission.started",
    "mission.phase_started",
    "mission.phase_completed",
    "mission.completed",
    "mission.failed",
    "team.message",
})

_OBSERVER_FIELDS: dict[str, tuple[str, ...]] = {
    "substate.changed": ("task_id", "substate"),
    "thinking.started": ("task_id", "planner", "step_idx"),
    "thinking.completed": ("task_id", "planner", "step_idx"),
    "action.started": ("task_id", "step_idx", "action"),
    "tool.selected": ("task_id", "step_idx", "action", "risk_level"),
    "sub_goal.started": ("task_id", "sub_goal_id", "description"),
    "sub_goal.done": ("task_id", "sub_goal_id", "summary"),
    "sub_goal.abandoned": ("task_id", "sub_goal_id", "reason"),
    "reflection.started": ("task_id", "reason"),
    "reflection.completed": ("task_id", "verdict", "new_confidence"),
    "task.paused": ("task_id", "reason"),
    "task.resumed": ("task_id", "reason"),
    "task.waiting_user": ("task_id", "prompt_to_user"),
    "task.blocked_quota": ("task_id", "reason", "probe_interval_s"),
    "task.blocked_quota_backoff": ("task_id", "consecutive_failures", "next_interval_s"),
    "mission.started": ("task_id", "mission_id", "brief", "phase_count"),
    "mission.phase_started": ("task_id", "mission_id", "phase_id", "phase_idx", "description"),
    "mission.phase_completed": ("task_id", "mission_id", "phase_id", "phase_idx"),
    "mission.completed": ("task_id", "mission_id"),
    "mission.failed": ("task_id", "mission_id", "phase_id", "reason"),
    "team.message": (
        "id", "task_id", "parent_task_id", "sender", "receiver",
        "message", "message_type", "created_at",
    ),
}

_OBSERVER_TEXT_CAP = 200
# Only engages on a task stuck in a tight retry cycle; a healthy loop is
# paced by its LLM round-trips.
_OBSERVER_RATE_PER_S = 20.0
_OBSERVER_BURST = 40.0
_OBSERVER_BUCKETS_MAX = 128
_OBSERVER_BUCKET_TTL_S = 300.0


def _project_payload(
    payload: dict, keep: tuple[str, ...], cap: int | None,
) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key in keep:
        if key not in payload:
            continue
        value = payload[key]
        out[key] = value[:cap] if cap and isinstance(value, str) else value
    return out


@dataclass
class TaskState:
    id: str
    user_id: str
    goal: str
    track: Track
    status: TaskStatus
    self_model: SelfModel
    strategic_plan: StrategicPlan | None = None
    sub_goals: list[SubGoal] = field(default_factory=list)
    active_sub_goal_id: str | None = None
    observations: list[Observation] = field(default_factory=list)
    thought_budget: ThoughtBudget = field(default_factory=ThoughtBudget)
    last_reflection: ReflectionResult | None = None
    step_idx: int = 0
    started_at: float = field(default_factory=time.monotonic)
    paused_reason: str | None = None
    error: str | None = None
    actions_log: list[dict[str, Any]] = field(default_factory=list)
    # Phase 9.2.1 — per-task LLM call counter (incremented by AIRouter via
    # the runtime callback in agent_runtime.note_llm_call).
    llm_calls_this_task: int = 0
    llm_call_warned: bool = False
    # Phase 17a.6 — count of failed Quality-Gate rounds on this task. The
    # loop bounds re-attempts so a stubborn critic never wedges the agent;
    # after N strikes it accepts the artefact with a logged caveat.
    quality_gate_failures: int = 0
    # Phase 9.4a — metadata for background tasks (origin of dispatch, tie-back
    # to a standing order, per-task timeout override). None for foreground.
    origin: str = "user"
    order_id: str | None = None
    timeout_s: int | None = None
    # Phase 18-COMPLETE — periodic progress heartbeats from long-running
    # actions. Populated by ProgressTracker; replayed by
    # `GET /tasks/{id}/progress` for UI hydration after reconnect. Bounded
    # to ~240 entries by the tracker's _record method.
    progress_checkpoints: list[Any] = field(default_factory=list)
    promoted_to_background_at: float | None = None
    # Phase 26-A — Agent delegation (sub-agent fan-out).
    # Set when this task was spawned by another task via agent.delegate.
    # `parent_task_id` lets the audit trail walk up to the dispatcher;
    # `subagent_role` carries the specialist label (e.g. "senior_backend",
    # "reviewer", "researcher") so the planner can adapt prompts;
    # `delegation_depth` is incremented per spawn level (0 for top-level
    # operator-driven tasks; capped by agent_max_delegation_depth so a
    # planner that loops on agent.delegate cannot fork-bomb the runtime).
    parent_task_id: str | None = None
    subagent_role: str | None = None
    delegation_depth: int = 0
    # Day-NN "no-leash" — per-task safety override. When True the
    # operator has explicitly waived the standard guards for THIS task:
    #   * bash.run / process.run / fs.* skip the bwrap sandbox
    #   * the risk-tolerance gate auto-approves every step
    #   * the Council high-risk auto-engage is bypassed
    # Defaults False (current behaviour). Toggled per-task via the UI
    # shield switch or the POST /agent/task/{id}/safety endpoint.
    unsafe_mode: bool = False
    # Phase 32 — Premium Isolation.
    # Tracks the git branch this task is isolated in.
    branch_isolation: str | None = None
    # Block C-2 — Mission / Phase bindings.
    # Both default None so every non-mission TaskState is backward-compatible.
    # When mission_id is set the task loop enters run_mission_loop() instead
    # of the flat run_task_loop() path.
    mission_id: str | None = None
    current_phase_id: str | None = None


@dataclass
class QueuedTask:
    """Background task that couldn't start immediately because the slot was
    busy. The runtime dequeues and spawns these in FIFO order as the slot
    frees up. task_id is pre-minted so the caller of start_task() gets back
    a stable ID even though no DB row exists until actual dispatch."""
    task_id: str
    goal: str
    origin: str
    track: Track
    user_id: str = ""
    order_id: str | None = None
    timeout_s: int | None = None
    unsafe_mode: bool = False
    queued_at: float = field(default_factory=time.monotonic)


def expanded_workspace() -> str:
    return os.path.abspath(os.path.expanduser(config.agent_workspace_dir))


def ensure_workspace() -> str:
    path = expanded_workspace()
    os.makedirs(path, exist_ok=True)
    return path


def _llm_cap_for(*, background: bool) -> int:
    """Per-task LLM-call cap. `0` means UNBOUND (V1 limitless) — the
    note_llm_call gate treats `cap <= 0` as never reached. Pre-V1 the
    inline `or 50/10` coerced a configured 0 back to the default; now
    0 is honoured as 'no cap'."""
    if background:
        raw = getattr(config, "agent_max_llm_calls_per_background_task", 10)
    else:
        raw = getattr(config, "agent_max_llm_calls_per_task", 50)
    raw = int(raw)
    return raw if raw > 0 else 0


class AgentRuntime:
    """Multi-track runtime — one foreground slot + one background slot.

    The foreground slot preserves the Phase 9.1 contract: refuse to start a
    second task while one is running (callers get back a tuple indicating
    'already busy'). The background slot accepts overflow into a bounded
    queue; when full, start_task raises TrackBusyError so callers can log
    + defer instead of silently dropping work.
    """

    def __init__(self) -> None:
        self.controls = ControlBus()
        self.foreground_slot: TaskState | None = None
        self.background_slot: TaskState | None = None
        # Phase 9.4a — per-track substate. The public `substate` property
        # keeps pointing at foreground so FSM + legacy readers don't need
        # to change.
        self.foreground_substate: Substate = "idle"
        self.background_substate: Substate = "idle"
        self.task_runner: asyncio.Task | None = None           # foreground
        self.background_runner: asyncio.Task | None = None     # Phase 9.4a
        # Queues are track-scoped. Foreground exists for symmetry but is
        # never populated (foreground refuses when busy, to preserve the
        # Phase 9.1 contract). Both deques are bounded so a hypothetical
        # future code path that enqueues can't blow memory (audit E1).
        bg_max = int(getattr(config, "agent_background_queue_max", 20) or 20)
        fg_max = int(getattr(config, "agent_foreground_queue_max", 50) or 50)
        self._track_queues: dict[Track, deque[QueuedTask]] = {
            "foreground": deque(maxlen=fg_max),
            "background": deque(maxlen=bg_max),
        }
        # Phase 9.2.3 (F-09): handle on the currently in-flight Action.execute()
        # coroutine so `cancel_step` can cancel it immediately instead of waiting
        # for the action to return. Set by the executor before dispatch, cleared
        # in its finally block.
        self._current_action_task: asyncio.Task | None = None

        # Browser state shared across actions during a task
        self.browser = None
        self.browser_context = None
        self.browser_page = None
        self._playwright = None

        # Phase 16 — report-ready handoff. After a foreground task finalizes we
        # compose a TaskReport, emit task.report_ready, and HOLD the OPERATOR
        # state-machine transition until the operator acknowledges (close /
        # continue-as-conversation). The slot itself is released immediately so
        # the next task can run; only the layout-exit is deferred.
        # Keys are task_ids; values: {report, outcome, to_safe}.
        self.pending_reports: dict[str, dict[str, Any]] = {}

        # Per task, because sub-agents share the background track concurrently
        # and the single `background_substate` field cannot dedupe for them.
        self._bg_substates: dict[str, Substate] = {}
        self._bg_observer_bucket: dict[str, tuple[float, float]] = {}
        self._bg_observer_pending: dict[str, tuple[str, dict[str, Any]]] = {}

    # ── Helpers ──────────────────────────────────────────────────────────────

    @property
    def current_task(self) -> TaskState | None:
        """Legacy accessor — returns whichever task the caller's ContextVar
        track points at. Defaults to foreground so most call sites are
        unchanged."""
        track = current_track.get()
        if track == "background":
            return self.background_slot
        return self.foreground_slot

    @property
    def self_model(self) -> SelfModel | None:
        # Prefer foreground self-model — SelfModel is shared semantics-wise,
        # but the foreground task's copy is canonical when both exist.
        if self.foreground_slot is not None:
            return self.foreground_slot.self_model
        if self.background_slot is not None:
            return self.background_slot.self_model
        return None

    @property
    def substate(self) -> Substate:
        """Foreground substate — kept for FSM + StatusBar compatibility."""
        return self.foreground_substate

    @substate.setter
    def substate(self, value: Substate) -> None:
        # Legacy surface — test fixtures assign directly; the real path is
        # `await set_substate(...)`. Plain assignment never broadcasts.
        self.foreground_substate = value

    def _slot_for(self, track: Track) -> TaskState | None:
        return self.background_slot if track == "background" else self.foreground_slot

    def _set_slot(self, track: Track, state: TaskState | None) -> None:
        if track == "background":
            self.background_slot = state
        else:
            self.foreground_slot = state

    async def promote_to_background(
        self,
        state: TaskState,
        *,
        reason: str = "long_running",
    ) -> bool:
        """Phase 18-COMPLETE — flip a running foreground task onto the
        background track so the operator regains the foreground while
        the long-running action keeps making progress.

        Returns True on success. Refuses (returns False) when:
          * `state` is not currently the foreground slot
          * the background slot is already occupied by an active task

        The asyncio.Task handle is migrated alongside the slot pointer
        so cancel / status paths still find the right runner.
        """
        if self.foreground_slot is not state or state.track != "foreground":
            logger.debug("promote_to_background: state mismatch, no-op")
            return False
        if self.background_slot is not None and self.background_slot.status in {
            "running", "waiting_for_user", "blocked_quota", "queued",
        }:
            logger.info(
                "promote_to_background: bg slot busy (%s), staying foreground",
                self.background_slot.status,
            )
            return False

        state.track = "background"
        state.promoted_to_background_at = time.time()
        self.foreground_slot = None
        self.background_slot = state
        # Inherit substate so the FE doesn't see a "thinking…" pulse stop
        # the moment we promote.
        self.background_substate = self.foreground_substate
        self._bg_substates[state.id] = self.foreground_substate
        self.foreground_substate = "idle"
        self.background_runner = self.task_runner
        self.task_runner = None

        try:
            from core.state_machine import state_machine
            # Foreground is now free — drop OPERATOR substate cleanly so the
            # state-machine doesn't keep advertising "agent is here".
            state_machine.set_operator_substate("idle")
        except Exception:  # noqa: BLE001
            pass

        await self._broadcast("task.promoted_to_background", {
            "task_id": state.id,
            "reason": reason,
            "promoted_at": state.promoted_to_background_at,
            "goal": (state.goal or "")[:500],
        })
        # Switch the ContextVar so subsequent broadcasts from the running
        # coroutine route on the background_events channel.
        try:
            current_track.set("background")
        except Exception:  # noqa: BLE001
            pass
        # A queued foreground task can now start, if any. Foreground queue is
        # never populated today (Phase 9.1 contract) but we wire the drain
        # for symmetry.
        if self._track_queues["foreground"]:
            asyncio.create_task(self._drain_queue("foreground"))
        return True

    def queue_size(self, track: Track) -> int:
        return len(self._track_queues.get(track, ()))

    async def set_substate(self, sub: Substate) -> None:
        track = current_track.get()
        if track == "background":
            task_id = current_task_id.get() or (
                self.background_slot.id if self.background_slot else None
            )
            if task_id is not None:
                if self._bg_substates.get(task_id) == sub:
                    return
                self._bg_substates[task_id] = sub
            elif self.background_substate == sub:
                return
            self.background_substate = sub
            logger.debug("bg substate -> %s (task=%s)", sub,
                         task_id[:8] if task_id else "-")
            await self._broadcast("substate.changed", {
                "task_id": task_id,
                "substate": sub,
            })
            # Block A-1 — snapshot on pause/block transitions (background).
            if sub in ("paused", "waiting_user", "blocked_quota", "awaiting_user"):
                slot = self.background_slot
                if slot is not None:
                    with contextlib.suppress(Exception):
                        await snapshot_task_state(slot)
            return
        if self.foreground_substate == sub:
            return
        self.foreground_substate = sub
        # Mirror into FSM so context broadcasts include substate alongside state.
        try:
            from core.state_machine import state_machine
            state_machine.set_operator_substate(sub)
        except Exception:
            pass
        await self._broadcast("substate.changed", {
            "task_id": self.foreground_slot.id if self.foreground_slot else None,
            "substate": sub,
        })
        # Block A-1 — snapshot on pause/block transitions (foreground).
        if sub in ("paused", "waiting_user", "blocked_quota", "awaiting_user"):
            slot = self.foreground_slot
            if slot is not None:
                with contextlib.suppress(Exception):
                    await snapshot_task_state(slot)

    def _observer_allowance(self, task_id: str) -> bool:
        now = time.monotonic()
        tokens, last = self._bg_observer_bucket.get(task_id, (_OBSERVER_BURST, now))
        tokens = min(_OBSERVER_BURST, tokens + (now - last) * _OBSERVER_RATE_PER_S)
        if tokens < 1.0:
            self._bg_observer_bucket[task_id] = (tokens, now)
            return False
        self._bg_observer_bucket[task_id] = (tokens - 1.0, now)
        if len(self._bg_observer_bucket) > _OBSERVER_BUCKETS_MAX:
            for stale in [
                k for k, (_t, seen) in self._bg_observer_bucket.items()
                if now - seen > _OBSERVER_BUCKET_TTL_S
            ]:
                self._bg_observer_bucket.pop(stale, None)
                self._bg_observer_pending.pop(stale, None)
                self._bg_substates.pop(stale, None)
        return True

    async def _emit_background(
        self, type_: str, payload: dict[str, Any], *, task_id: str,
    ) -> None:
        withheld = self._bg_observer_pending.pop(task_id, None) if task_id else None
        try:
            from api.websocket_hub import hub
            if withheld is not None:
                await hub.broadcast("background_events", withheld[0], withheld[1])
            await hub.broadcast("background_events", type_, payload)
        except Exception as exc:
            logger.debug("bg broadcast failed: %s", exc)

    async def _broadcast_background(self, type_: str, payload: dict) -> None:
        if type_ in _BACKGROUND_ALLOWED_EVENTS:
            await self._emit_background(
                type_,
                _project_payload(payload, _LIFECYCLE_FIELDS[type_], None),
                task_id=str(payload.get("task_id") or ""),
            )
            return
        if type_ not in _BACKGROUND_OBSERVER_EVENTS:
            logger.debug("bg event suppressed: %s", type_)
            return
        small = _project_payload(payload, _OBSERVER_FIELDS[type_], _OBSERVER_TEXT_CAP)
        task_id = str(small.get("task_id") or "")
        if task_id and not self._observer_allowance(task_id):
            self._bg_observer_pending[task_id] = (type_, small)
            return
        await self._emit_background(type_, small, task_id=task_id)

    async def _broadcast(self, type_: str, payload: dict) -> None:
        track = current_track.get()
        if track == "background":
            await self._broadcast_background(type_, payload)
            # Emotion handler still runs for background events it cares
            # about; the handler itself ignores unrelated types.
            try:
                from agent.cognition.emotion import update_emotion_on_event
                await update_emotion_on_event(self, type_, payload)
            except Exception as exc:
                logger.debug("emotion update for bg %s failed: %s", type_, exc)
            return

        # Foreground — original behavior.
        try:
            from api.websocket_hub import hub
            await hub.broadcast("agent.stream", type_, payload)
        except Exception as exc:
            logger.debug("agent runtime broadcast failed: %s", exc)
        # Phase 9.3a — emotion vector reacts to lifecycle events. The update
        # is fire-and-forget: a crashing emotion handler must not swallow a
        # broadcast that already landed on WS clients.
        try:
            from agent.cognition.emotion import update_emotion_on_event
            await update_emotion_on_event(self, type_, payload)
        except Exception as exc:
            logger.debug("emotion update for %s failed: %s", type_, exc)

    # ── Task lifecycle ───────────────────────────────────────────────────────

    async def start_task(
        self,
        user_id: str,
        goal: str,
        origin: str = "user",
        track: Track = "foreground",
        order_id: str | None = None,
        timeout_s: int | None = None,
        unsafe_mode: bool = False,
        subagent_role: str | None = None,
        parent_task_id: str | None = None,
        delegation_depth: int = 0,
    ) -> tuple[str, bool]:
        """Start a task on the specified track."""
        if track not in ("foreground", "background"):
            raise ValueError(f"invalid track {track!r}")

        if track == "foreground":
            if self.foreground_slot is not None and self.foreground_slot.status in {
                "planning", "running", "paused", "awaiting_user", "blocked_quota",
            }:
                return (self.foreground_slot.id, False)
            return await self._spawn_task(
                user_id=user_id, goal=goal, track="foreground", origin=origin,
                order_id=order_id, timeout_s=timeout_s,
                unsafe_mode=unsafe_mode,
                subagent_role=subagent_role,
                parent_task_id=parent_task_id,
                delegation_depth=delegation_depth,
            )

        # Background path.
        bg = self.background_slot
        if bg is not None and bg.status in {
            "planning", "running", "paused", "awaiting_user", "blocked_quota",
        }:
            queue = self._track_queues["background"]
            if queue.maxlen is not None and len(queue) >= queue.maxlen:
                raise TrackBusyError("background", len(queue))
            task_id = str(uuid.uuid4())
            queue.append(QueuedTask(
                user_id=user_id,
                task_id=task_id, goal=goal, origin=origin, track="background",
                order_id=order_id, timeout_s=timeout_s,
                unsafe_mode=unsafe_mode,
            ))
            logger.info(
                "background task queued (id=%s queue_depth=%d goal=%r)",
                task_id[:8], len(queue), goal[:60],
            )
            return (task_id, False)
        return await self._spawn_task(
            user_id=user_id, goal=goal, track="background", origin=origin,
            order_id=order_id, timeout_s=timeout_s,
            unsafe_mode=unsafe_mode,
            subagent_role=subagent_role,
            parent_task_id=parent_task_id,
            delegation_depth=delegation_depth,
        )

    async def _spawn_task(
        self,
        *,
        user_id: str,
        goal: str,
        track: Track,
        origin: str,
        order_id: str | None,
        timeout_s: int | None,
        task_id: str | None = None,
        unsafe_mode: bool = False,
        subagent_role: str | None = None,
        parent_task_id: str | None = None,
        delegation_depth: int = 0,
    ) -> tuple[str, bool]:
        """Internal: actually create the TaskState + DB row and start the loop."""
        from agent.cognition.self_model import build_self_model
        from agent.actions.registry import registry as default_registry

        ensure_workspace()
        if track == "foreground":
            self.controls.reset()

        task_id = task_id or str(uuid.uuid4())
        # Phase 30 — Inject role_id (subagent_role) into self-model builder
        self_model = await build_self_model(default_registry, role_id=subagent_role)
        
        # Phase 32-CONTEXT — Pull recent chat history to maintain continuity
        # even when a new task is started in the Workspace.
        initial_observations = []
        try:
            from db.database import AsyncSessionLocal
            from db.models import AgentChatThread
            from sqlalchemy import select
            async with AsyncSessionLocal() as db:
                # Find most recent thread for this user (last 1 hour)
                cutoff = datetime.now(tz=timezone.utc) - timedelta(hours=1)
                stmt = (
                    select(AgentChatThread)
                    .where(AgentChatThread.user_id == user_id)
                    .where(AgentChatThread.created_at >= cutoff)
                    .order_by(AgentChatThread.created_at.desc())
                    .limit(10)
                )
                res = await db.execute(stmt)
                rows = list(res.scalars().all())
                if rows:
                    rows.reverse() # chronological
                    chat_context = "\n".join([f"{r.role}: {r.content}" for r in rows])
                    from agent.cognition.observations import build_system
                    obs = build_system(
                        0, "conversation_context",
                        f"ОСТАННІ ПОВІДОМЛЕННЯ В ЧАТІ (ДЛЯ КОНТЕКСТУ):\n{chat_context}"
                    )
                    initial_observations.append(obs)
                    logger.info("Injected %d chat messages as context for task %s", len(rows), task_id[:8])
        except Exception as exc:
            logger.debug("Chat context injection failed: %s", exc)

        state = TaskState(
            id=task_id,
            user_id=user_id,
            goal=goal,
            track=track,
            status="planning",
            self_model=self_model,
            origin=origin,
            order_id=order_id,
            timeout_s=timeout_s,
            unsafe_mode=unsafe_mode,
            observations=initial_observations,
            subagent_role=subagent_role,
            parent_task_id=parent_task_id,
            delegation_depth=delegation_depth,
        )
        self._set_slot(track, state)
        await create_task_row(user_id, task_id, goal, track)

        # Foreground drives the OPERATOR FSM transition; background does
        # not touch FSM so the main UI state (SHADOW/FOCUS/etc.) is stable
        # while PHANTOM watches the system in the background.
        if track == "foreground":
            with contextlib.suppress(Exception):
                from core.state_machine import state_machine
                transition = state_machine.enter_operator(f"agent_task:{task_id[:8]}")
                from api.websocket_hub import hub
                await hub.broadcast("state", "transition", {
                    "from": transition.from_state,
                    "to": transition.to_state,
                    "trigger": transition.trigger,
                    "timestamp": transition.timestamp,
                    "auto": transition.auto,
                })

        from agent.kernel.loop import run_task_loop
        runner = asyncio.create_task(
            run_task_loop(self, state),
            name=f"agent_task_{task_id}",
        )
        if track == "foreground":
            self.task_runner = runner
        else:
            self.background_runner = runner
        return (task_id, True)

    # ── Block C-2 — Mission entry point ─────────────────────────────────────

    async def start_mission(
        self,
        *,
        user_id: str,
        brief: "MissionBrief",
        unsafe_mode: bool = False,
    ) -> tuple[str, str]:
        """Start a long-horizon mission — plan phases, spawn foreground task loop.

        Behaviour:
          1. Refuse if the foreground slot is already busy (same semantics as
             start_task — caller gets back a 409 / busy indication).
          2. Create the Mission DB row (status="planning") and initialise the
             markdown ledger with the header.
          3. Call plan_mission() to get a MissionPlan from the LLM.
          4. Persist each PhaseSpec as a Phase row (idx in order).
          5. Spawn a foreground task that drives run_mission_loop().
          6. Update Mission.status → "running".
          7. Return (mission_id, task_id).

        On plan_mission failure: marks Mission status "failed", appends a
        failure note to the ledger, and raises RuntimeError so the REST
        endpoint can return a 503.

        Args:
            user_id: Authenticated operator user id.
            brief: MissionBrief containing the operator's prompt + optional
                   quality_bar, deadline_at, budget_constraints.
            unsafe_mode: When True, per-task safety guards are bypassed.

        Returns:
            (mission_id, task_id) — both are stable UUIDs the caller can
            surface to the operator immediately.

        Raises:
            RuntimeError: When the foreground slot is busy or planning fails.
        """
        # Guard — foreground slot busy.
        if self.foreground_slot is not None and self.foreground_slot.status in {
            "planning", "running", "paused", "awaiting_user", "blocked_quota",
        }:
            raise RuntimeError(
                f"foreground_busy:{self.foreground_slot.id}"
            )

        from agent.missions.store import (
            create_mission,
            create_phase,
            update_mission_status,
        )
        from agent.missions.ledger import LedgerWriter
        from agent.cognition.planner.mission import plan_mission
        from agent.cognition.self_model import build_self_model
        from agent.actions.registry import registry as default_registry

        ensure_workspace()
        self.controls.reset()

        task_id = str(uuid.uuid4())

        # Step 1 — create the Mission row (status="planning").
        mission = await create_mission(user_id, brief)
        mission_id = mission.id

        ledger = LedgerWriter(mission_id, mission.ledger_path)
        await ledger.init(mission)

        # Step 2 — call plan_mission().
        self_model = await build_self_model(default_registry)
        try:
            mission_plan = await plan_mission(
                user_id=user_id,
                brief=brief,
                self_model=self_model,
                task_id=task_id,
            )
        except Exception as exc:
            err_msg = f"Mission planning failed: {exc}"
            logger.error("start_mission: %s (mission=%s)", err_msg, mission_id)
            try:
                await update_mission_status(user_id, mission_id, "failed")
                await ledger.append_phase_lesson(mission_id, err_msg)
            except Exception:
                pass
            raise RuntimeError(err_msg) from exc

        # Step 3 — persist PhaseSpecs as Phase rows (idx ordered).
        for idx, phase_spec in enumerate(mission_plan.phases):
            await create_phase(mission_id, phase_spec, idx=idx)

        # Step 4 — update Mission with the planner's success_criteria + status.
        await update_mission_status(
            user_id,
            mission_id,
            "running",
            success_criteria=mission_plan.success_criteria,
        )

        # Step 5 — create TaskState with mission bindings and spawn loop.
        state = TaskState(
            id=task_id,
            user_id=user_id,
            goal=brief.brief,
            track="foreground",
            status="planning",
            self_model=self_model,
            origin="user",
            unsafe_mode=unsafe_mode,
            mission_id=mission_id,
        )
        self._set_slot("foreground", state)
        from agent.kernel.audit import create_task_row
        await create_task_row(user_id, task_id, brief.brief, "foreground")

        # FSM transition: enter OPERATOR state.
        with contextlib.suppress(Exception):
            from core.state_machine import state_machine
            transition = state_machine.enter_operator(f"mission:{mission_id[:8]}")
            from api.websocket_hub import hub
            await hub.broadcast("state", "transition", {
                "from": transition.from_state,
                "to": transition.to_state,
                "trigger": transition.trigger,
                "timestamp": transition.timestamp,
                "auto": transition.auto,
            })

        # Broadcast mission.started event.
        await self._broadcast("mission.started", {
            "mission_id": mission_id,
            "task_id": task_id,
            "brief": brief.brief[:300],
            "phase_count": len(mission_plan.phases),
            "success_criteria": mission_plan.success_criteria[:300],
        })

        from agent.kernel.loop import run_task_loop
        runner = asyncio.create_task(
            run_task_loop(self, state),
            name=f"agent_mission_{mission_id[:8]}",
        )
        self.task_runner = runner

        logger.info(
            "mission started: mission=%s task=%s phases=%d user=%s",
            mission_id, task_id, len(mission_plan.phases), user_id,
        )
        return (mission_id, task_id)

    async def _drain_queue(self, track: Track) -> None:
        """Pop the next queued task for a track and spawn it. Called after
        finalize_task frees the slot. Foreground queue is never populated
        so this is effectively a background-only operation."""
        queue = self._track_queues.get(track)
        if not queue:
            return
        if self._slot_for(track) is not None:
            # Race guard — another coroutine already repopulated the slot.
            return
        nxt = queue.popleft()
        try:
            await self._spawn_task(
                user_id=nxt.user_id,
                goal=nxt.goal, track=nxt.track, origin=nxt.origin,
                order_id=nxt.order_id, timeout_s=nxt.timeout_s,
                task_id=nxt.task_id,
                unsafe_mode=nxt.unsafe_mode,
            )
        except Exception as exc:
            logger.exception("queue drain spawn failed for %s: %s", nxt.task_id[:8], exc)

    async def pause(self, task_id: str, *, reason: str | None = None) -> bool:
        """Request the loop to pause the task at its next gate.

        ``reason`` is stashed on the task state so the loop's pause-gate
        can write it through to ``paused_reason`` instead of always
        recording the default ``user_paused``. Used by auto-pause guards
        such as :class:`agent.loop.RevisionLoopGuard`.
        """
        tgt = self._find_active(task_id)
        if tgt is None:
            return False
        if reason:
            tgt.paused_reason = reason[:128]
        self.controls.pause_event.set()
        self.controls.resume_event.clear()
        return True

    async def resume(self, task_id: str) -> bool:
        tgt = self._find_active(task_id)
        if tgt is None:
            return False
        self.controls.pause_event.clear()
        self.controls.resume_event.set()
        await update_task_status(task_id, "running", paused_reason=None)
        return True

    async def intervene(self, task_id: str, instruction: str) -> bool:
        tgt = self._find_active(task_id)
        if tgt is None:
            return False
        await self.controls.intervention_queue.put(instruction)
        return True

    async def cancel_step(self, task_id: str) -> bool:
        tgt = self._find_active(task_id)
        if tgt is None:
            return False
        self.controls.cancel_step.set()
        # Phase 9.2.3 (F-09): cancel the in-flight Action.execute() task so the
        # cancel arrives now instead of at the action's next yield point.
        # Executor's CancelledError handler sees cancel_step.is_set() and
        # writes a `cancelled_by_user` audit row, then raises StepCancelled
        # which loop.py catches and advances step_idx cleanly.
        t = self._current_action_task
        if t is not None and not t.done():
            t.cancel()
        return True

    async def set_unsafe_mode(self, task_id: str, enabled: bool) -> bool:
        """Flip the per-task `unsafe_mode` flag at runtime.

        When enabled=True, subsequent action steps for this task skip the
        bwrap sandbox and the risk-tolerance gate (Day-NN "no-leash"
        switch). When False, default guards re-engage on the *next* step
        — actions already in flight continue under whatever mode they
        started with. Idempotent. Returns True iff a known task got
        updated.
        """
        tgt = self._find_active(task_id)
        if tgt is None:
            return False
        if tgt.unsafe_mode == enabled:
            # No-op flip: still broadcast so phone + secondary surfaces
            # don't drift if they missed the previous event.
            pass
        tgt.unsafe_mode = enabled
        with contextlib.suppress(Exception):
            await self._broadcast("task.safety_changed", {
                "task_id": task_id,
                "unsafe_mode": enabled,
            })
        logger.warning(
            "unsafe_mode flipped task=%s enabled=%s — sandbox + risk gate %s",
            task_id[:8], enabled,
            "BYPASSED" if enabled else "RE-ENGAGED",
        )
        return True

    def _find_active(self, task_id: str) -> TaskState | None:
        if self.foreground_slot is not None and self.foreground_slot.id == task_id:
            return self.foreground_slot
        if self.background_slot is not None and self.background_slot.id == task_id:
            return self.background_slot
        return None

    async def note_llm_call(self, task_id: str | None) -> bool:
        """
        Phase 9.2.1 — invoked by AIRouter on every successful or attempted
        tool-use / generate call. Returns False once the per-task hard cap
        has been hit so callers can short-circuit; True otherwise.

        Phase 9.4a — background tasks use the stricter
        `agent_max_llm_calls_per_background_task` cap (default 10 vs 50).
        """
        if not task_id:
            return True
        state = self._find_active(task_id)
        if state is None:
            return True
        state.llm_calls_this_task += 1
        if state.track == "background":
            warn_at = int(getattr(config, "agent_warn_llm_calls_per_background_task", 6) or 6)
        else:
            warn_at = int(getattr(config, "agent_warn_llm_calls_per_task", 30) or 30)
        cap_at = _llm_cap_for(background=state.track == "background")

        if state.llm_calls_this_task >= warn_at and not state.llm_call_warned:
            state.llm_call_warned = True
            await self._broadcast("agent.budget.warning", {
                "task_id": state.id,
                "track": state.track,
                "llm_calls_used": state.llm_calls_this_task,
                "warn_at": warn_at,
                "cap_at": cap_at,
            })

        if cap_at > 0 and state.llm_calls_this_task >= cap_at:
            return False
        return True

    async def enter_blocked_quota(self, state: TaskState, reason: str) -> bool:
        """
        Phase 9.2.1 — park a task on `blocked_quota` and probe for provider
        recovery. Returns True when the loop should resume (probe succeeded),
        False on emergency stop.

        Phase 9.2.2 (F-03): probe interval is now configurable
        (`agent_blocked_quota_probe_s`, default 60s) and grows exponentially
        up to `agent_blocked_quota_probe_max_s` (default 600s) after three
        consecutive failures so we don't burn quota during a long outage.
        """
        state.status = "blocked_quota"
        state.paused_reason = reason[:128]
        await update_task_status(state.id, "blocked_quota", paused_reason=state.paused_reason)
        # Phase 9.2.3 (F-14): distinct substate so the operator can tell
        # "parked on quota exhaustion" apart from "waiting for human input".
        await self.set_substate("blocked_quota")
        base_interval = float(getattr(config, "agent_blocked_quota_probe_s", 60) or 60)
        max_interval = float(getattr(config, "agent_blocked_quota_probe_max_s", 600) or 600)
        await self._broadcast("task.blocked_quota", {
            "task_id": state.id, "reason": reason, "probe_interval_s": base_interval,
        })

        consecutive_failures = 0
        while True:
            if self.controls.emergency_stop.is_set():
                return False
            if consecutive_failures >= _PROBE_BACKOFF_AFTER_FAILS:
                grown = base_interval * (2 ** (consecutive_failures - _PROBE_BACKOFF_AFTER_FAILS + 1))
                interval = min(grown, max_interval)
            else:
                interval = base_interval
            try:
                await asyncio.wait_for(
                    self.controls.emergency_stop.wait(),
                    timeout=interval,
                )
                return False
            except asyncio.TimeoutError:
                pass
            if self.controls.emergency_stop.is_set():
                return False
            if await self._probe_provider_recovered():
                state.status = "running"
                state.paused_reason = None
                await update_task_status(state.id, "running", paused_reason=None)
                await self.set_substate("thinking")
                await self._broadcast("task.resumed", {"task_id": state.id, "reason": "quota_recovered"})
                # Phase 9.3b — let the proactive loop know a stuck task is
                # unblocked. The loop decides separately whether to tell
                # the user.
                with contextlib.suppress(Exception):
                    from agent.cognition.proactive.loop import get_loop
                    from agent.cognition.proactive.triggers import ProactiveTrigger, ProactiveTriggerKind
                    loop = get_loop()
                    if loop is not None:
                        loop.push_trigger(ProactiveTrigger(
                            kind=ProactiveTriggerKind.RESUMED_TASK,
                            context={"task_id": state.id, "reason": "quota_recovered"},
                            priority=5,
                        ))
                return True
            consecutive_failures += 1
            if consecutive_failures == _PROBE_BACKOFF_AFTER_FAILS:
                await self._broadcast("task.blocked_quota_backoff", {
                    "task_id": state.id,
                    "consecutive_failures": consecutive_failures,
                    "next_interval_s": min(base_interval * 2, max_interval),
                })

    async def _probe_provider_recovered(self) -> bool:
        """
        Phase 9.2.2 (F-03): probe the PRIMARY provider directly, bypassing
        the router. The previous implementation went through `ai_router.generate`
        which fell through to Ollama (always healthy locally) and reported
        success even when Gemini was still 429-ed — quota recovery was
        fictional.

        Returns True only when the primary really replies. A QUOTA_EXHAUSTED
        classifier outcome means "still blocked" (False); other transient
        errors get the benefit of the doubt and return True so we don't
        deadlock on a flaky network.
        """
        from ai.provider import ai_router, _classify_provider_exception
        from ai.tool_use import ToolErrorKind

        primary_name = config.ai_primary_provider
        provider = ai_router.get_provider(primary_name)
        if provider is None:
            logger.warning("blocked_quota probe: primary '%s' not registered", primary_name)
            return False
        try:
            await asyncio.wait_for(
                provider.generate(
                    "ping",
                    "Reply with one word: OK.",
                    [],
                ),
                timeout=10.0,
            )
            ai_router.clear_provider_cooling(primary_name)
            return True
        except Exception as exc:
            kind, _retr, _ra = _classify_provider_exception(primary_name, exc)
            logger.debug("blocked_quota probe failing (kind=%s): %s", kind, exc)
            if kind == ToolErrorKind.QUOTA_EXHAUSTED:
                return False
            return True

    async def stop(self, task_id: str | None = None) -> bool:
        """Panic stop. With task_id, stops the matching slot; without, stops
        the foreground slot (legacy behavior)."""
        if task_id is None:
            target = self.foreground_slot
            runner = self.task_runner
        else:
            target = self._find_active(task_id)
            runner = (
                self.task_runner if target is self.foreground_slot
                else self.background_runner
            )
        if target is None:
            return False
        self.controls.emergency_stop.set()
        if runner is not None and not runner.done():
            runner.cancel()
        await self._teardown_browser()
        return True

    async def checkpoint_now(self, task_id: str) -> int | None:
        target = self._find_active(task_id)
        if target is None:
            return None
        cp = build_checkpoint(
            task_id=task_id,
            reason="manual",
            self_model=target.self_model,
            goal=target.goal,
            sub_goals=target.sub_goals,
            active_sub_goal_id=target.active_sub_goal_id,
            observations=target.observations,
            thought_budget=target.thought_budget,
            last_reflection=target.last_reflection,
            step_idx=target.step_idx,
        )
        cp_id = await save_checkpoint(target.user_id, cp)
        await self._broadcast("checkpoint.created", {
            "task_id": task_id, "checkpoint_id": cp_id, "reason": "manual",
        })
        return cp_id

    async def resume_from_checkpoint(self, user_id: str, task_id: str, checkpoint_id: int) -> bool:
        from agent.kernel.audit import fetch_audit, fetch_checkpoint
        from agent.cognition.observations import build_system

        cp = await fetch_checkpoint(user_id, checkpoint_id)
        if cp is None or cp.task_id != task_id:
            return False
        # Hydrate a TaskState from the checkpoint and start the loop fresh.
        # Resume only targets the foreground slot (there is no "resume a
        # background standing order" semantic in this phase).
        if self.foreground_slot is not None and self.foreground_slot.status in {
            "planning", "running", "paused", "awaiting_user",
        }:
            return False
        state = TaskState(
            id=cp.task_id,
            user_id=user_id,
            goal=cp.goal,
            track="foreground",
            status="running",
            self_model=cp.self_model,
            sub_goals=list(cp.sub_goals),
            active_sub_goal_id=cp.active_sub_goal_id,
            observations=list(cp.observations),
            thought_budget=cp.thought_budget,
            last_reflection=cp.last_reflection,
            step_idx=cp.step_idx,
        )
        if cp.sub_goals:
            state.strategic_plan = StrategicPlan(
                sub_goals=list(cp.sub_goals),
                estimated_total_actions=cp.thought_budget.estimated_actions,
                risk_assessment="(restored from checkpoint)",
            )

        last_browser_url: str | None = None
        try:
            audit_rows = await fetch_audit(user_id, task_id, limit=200)
            browser_rows = [r for r in audit_rows if (r.action_name or "").startswith("browser.")]
            if browser_rows:
                for r in browser_rows:
                    if r.action_name == "browser.navigate":
                        url = (r.args or {}).get("url") or (r.args or {}).get("href")
                        if url:
                            last_browser_url = str(url)
                            break
                hint_msg = (
                    "Browser session not preserved across checkpoint resume. "
                    "If the task requires a specific page, navigate there first."
                )
                if last_browser_url:
                    hint_msg += f" Last known URL: {last_browser_url}"
                obs = build_system(state.step_idx, "checkpoint_restore", hint_msg)
                obs.entities = ["hint:browser_reset_after_resume"]
                state.observations.append(obs)
                caveat = "browser_session_reset — re-navigate if the task needs a specific page"
                if last_browser_url:
                    caveat += f" (last known URL: {last_browser_url})"
                if caveat not in state.self_model.active_caveats:
                    state.self_model.active_caveats.append(caveat)
        except Exception as exc:
            logger.debug("resume_from_checkpoint: browser-history scan failed: %s", exc)

        self.foreground_slot = state
        await update_task_status(task_id, "running", paused_reason=None)
        self.controls.reset()
        if last_browser_url is not None:
            await self._broadcast("agent.resumed_with_caveat", {
                "task_id": task_id,
                "caveat": "browser_session_lost",
                "last_known_url": last_browser_url,
            })
        from agent.kernel.loop import run_task_loop
        self.task_runner = asyncio.create_task(
            run_task_loop(self, state, resumed=True),
            name=f"agent_task_{task_id}",
        )
        return True

    # ── Browser lifecycle ────────────────────────────────────────────────────

    async def _teardown_browser(self) -> None:
        try:
            if self.browser_page is not None:
                with contextlib.suppress(Exception):
                    await self.browser_page.close()
            if self.browser_context is not None:
                with contextlib.suppress(Exception):
                    await self.browser_context.close()
            if self.browser is not None:
                with contextlib.suppress(Exception):
                    await self.browser.close()
            if self._playwright is not None:
                with contextlib.suppress(Exception):
                    await self._playwright.stop()
        finally:
            self.browser_page = None
            self.browser_context = None
            self.browser = None
            self._playwright = None

    # ── Cleanup ──────────────────────────────────────────────────────────────

    async def finalize_task(
        self,
        state: TaskState,
        outcome: TaskStatus,
        summary: str,
        error: str | None = None,
    ) -> None:
        # Ensure every downstream event (broadcast / set_substate) routes to
        # the correct track even when finalize is invoked from stop() on a
        # different asyncio task that never set the ContextVar.
        token = current_track.set(state.track)
        id_token = current_task_id.set(state.id)
        try:
            await self._finalize_task_impl(state, outcome, summary, error)
        finally:
            current_track.reset(token)
            current_task_id.reset(id_token)
            self._bg_substates.pop(state.id, None)
            self._bg_observer_bucket.pop(state.id, None)
            self._bg_observer_pending.pop(state.id, None)

    async def _finalize_task_impl(
        self,
        state: TaskState,
        outcome: TaskStatus,
        summary: str,
        error: str | None,
    ) -> None:
        """Phase 9.4c audit C1 — orchestrator. Semantics unchanged; the
        heavy lifting lives in three focused helpers so each concern is
        testable and greppable on its own.
        """
        state.status = outcome
        state.error = error
        episode_summary = await self._finalize_persist(state, outcome, summary)
        await self._finalize_broadcast(state, outcome, summary, error)
        self._finalize_release_slot(state)
        await self._finalize_reward_drives(state, outcome)
        # Keep episode_summary accessible for any future caller-level logging.
        _ = episode_summary

    async def _finalize_reward_drives(self, state: TaskState, outcome: TaskStatus) -> None:
        """Close the will loop: a self-initiated goal that completed lowers the
        pressure of the drives it served (autonomy + achievement). Best-effort —
        a broken drive subsystem must never fail task finalisation."""
        if outcome != "done" or getattr(state, "origin", "user") != "will":
            return
        with contextlib.suppress(Exception):
            from agent.cognition.will.drives import drive_system
            await drive_system.reward({"autonomy": 0.12, "achievement": 0.12})

    async def _finalize_persist(
        self,
        state: TaskState,
        outcome: TaskStatus,
        summary: str,
    ) -> str:
        """Write task status, observation buffer, self-model, thought budget,
        and the memory seed/episode to storage. Returns the composed
        ``episode_summary`` so the caller can reuse it for downstream
        logging without re-composing."""
        await update_task_status(
            state.id, outcome,
            error=state.error,
            paused_reason=state.paused_reason,
            finished=True,
        )

        await persist_task_state(
            state.id,
            sub_goals=state.sub_goals,
            observations_json=json.dumps(
                [o.model_dump(mode="json") for o in state.observations[-50:]],
                default=str,
            ),
            self_model_json=json.dumps(state.self_model.model_dump(mode="json")),
            thought_budget_json=json.dumps(state.thought_budget.model_dump(mode="json")),
        )

        outcome_kind = (
            "done" if outcome == "done"
            else "failed" if outcome == "failed"
            else "timeout" if outcome == "timeout"
            else "stopped"
        )
        action_counts: dict[str, int] = {}
        for entry in state.actions_log:
            action_counts[entry["action"]] = action_counts.get(entry["action"], 0) + 1
        key_actions = sorted(action_counts.items(), key=lambda x: -x[1])[:5]

        episode_summary = summary[:500]
        with contextlib.suppress(Exception):
            from agent.cognition.memory.seeds import compose_summary, write_episode
            last_obs = state.observations[-1].content if state.observations else ""
            episode_summary = await compose_summary(
                goal=state.goal,
                outcome=outcome_kind,
                action_counts=action_counts,
                last_observation=last_obs,
                task_id=state.id,
            )
            duration_s = max(0.0, time.monotonic() - state.started_at)
            await write_episode(
                task_id=state.id,
                goal=state.goal,
                outcome=outcome_kind,
                summary=episode_summary,
                action_counts=action_counts,
                duration_s=duration_s,
                user_id=state.user_id,
            )

        # Phase 26-A — notify the parent task (if any) that this sub-agent
        # has finished. Always fires; await_subagent on the parent side
        # silently ignores when no subscriber exists. The semaphore
        # release lives in the spawn runner's finally block — we ONLY
        # publish the report here so the parent unblocks.
        if state.parent_task_id is not None:
            with contextlib.suppress(Exception):
                from agent.team.spawn import notify_subagent_completed
                notify_subagent_completed(
                    child_state=state,
                    outcome_kind=outcome_kind,
                    summary=episode_summary,
                    action_counts=action_counts,
                )

        # Phase 23-G — distil + persist a TRANSFERABLE lesson alongside the
        # episode. Episodes capture "what happened in task X"; lessons
        # capture "what to do/avoid for goals like Y" and are injected
        # into future strategic + tactical prompts. Best-effort: any
        # failure here MUST NOT prevent finalisation.
        #
        # Phase 28-STABILITY — Enable for failed/stopped tasks too.
        if outcome in {"done", "failed", "stopped", "timeout"}:
            with contextlib.suppress(Exception):
                from agent.cognition.memory.lessons import distill_lesson, write_lesson
                last_obs_for_lesson = (
                    state.observations[-1].content if state.observations else ""
                )
                lesson = await distill_lesson(
                    goal=state.goal,
                    outcome=outcome_kind,
                    action_counts=action_counts,
                    last_observation=last_obs_for_lesson,
                    task_id=state.id,
                )
                if lesson:
                    await write_lesson(
                        task_id=state.id,
                        goal=state.goal,
                        outcome=outcome_kind,
                        lesson=lesson,
                        user_id=state.user_id,
                    )

        with contextlib.suppress(Exception):
            await write_memory_seed(
                user_id=state.user_id,
                task_id=state.id,
                goal=state.goal,
                outcome=outcome_kind,
                summary=episode_summary[:500],
                key_actions=key_actions,
            )

        # Phase 9.3a — log successful tasks into SelfModel.recent_successes.
        # Track matters: a background watchdog succeeding is a different
        # signal from a user conversation succeeding. We record both so the
        # proactive loop can still "feel" a streak, but streak dedup is
        # foreground-only to prevent background spam from triggering
        # proactive speech.
        if outcome == "done":
            with contextlib.suppress(Exception):
                from agent.cognition.self_model import record_success
                record_success(state.self_model, episode_summary)
            if state.track == "foreground":
                with contextlib.suppress(Exception):
                    from agent.cognition.proactive.loop import get_loop
                    from agent.cognition.proactive.triggers import ProactiveTrigger, ProactiveTriggerKind
                    loop = get_loop()
                    if loop is not None and loop.record_success_for_streak():
                        loop.push_trigger(ProactiveTrigger(
                            kind=ProactiveTriggerKind.STREAK_SUCCESS,
                            context={"streak": loop._success_streak,
                                     "last_summary": episode_summary[:120]},
                            priority=4,
                        ))
        elif outcome in ("failed", "stopped", "timeout") and state.track == "foreground":
            with contextlib.suppress(Exception):
                from agent.cognition.proactive.loop import get_loop
                loop = get_loop()
                if loop is not None:
                    loop.reset_streak()

        return episode_summary

    async def _finalize_broadcast(
        self,
        state: TaskState,
        outcome: TaskStatus,
        summary: str,
        error: str | None,
    ) -> None:
        """Tear down the browser (foreground only), emit the terminal WS
        event, flip substate back to idle, and, for foreground tasks,
        exit OPERATOR → previous system state with a state.transition
        broadcast."""
        # Browser teardown is global — both foreground and background share the
        # Playwright instance in this phase.
        if state.track == "foreground":
            await self._teardown_browser()

        await self._broadcast(
            "task.completed" if outcome == "done"
            else "task.timeout" if outcome == "timeout"
            else "task.stopped" if outcome == "stopped"
            else "task.failed",
            {"task_id": state.id, "track": state.track,
             "summary": summary, "error": error},
        )

        await self.set_substate("idle")

        # Phase 16 — for foreground tasks we compose a TaskReport and emit a
        # `task.report_ready` event, but defer the OPERATOR-state exit until
        # the operator explicitly acknowledges (close / continue-as-conversation
        # / start a new task). The slot itself is already released by
        # `_finalize_release_slot`, so the next task can still run; only the
        # layout swap is held back so the user actually gets to see the report.
        # The legacy auto-exit fires only for background tasks (which have no
        # report screen).
        if state.track != "foreground":
            return

        report_payload: dict[str, Any] | None = None
        with contextlib.suppress(Exception):
            from agent.missions.reports import compose_task_report
            # Compose with a tight LLM timeout so quota issues / network hangs
            # never delay the report screen — deterministic fallback always
            # produces a usable report.
            report = await compose_task_report(
                state.user_id, state.id, prefer_llm=True, llm_timeout_s=8.0,
            )
            if report is not None:
                report_payload = report.model_dump(mode="json")
                self.pending_reports[state.id] = {
                    "report": report_payload,
                    "outcome": outcome,
                    "to_safe": (outcome == "stopped"),
                }

        if report_payload is not None:
            await self._broadcast("task.report_ready", {
                "task_id": state.id,
                "track": state.track,
                "report": report_payload,
            })
        else:
            # Composer failed for some unforeseen reason; fall back to legacy
            # auto-exit so we never leave the operator stranded in OPERATOR.
            await self._exit_operator_now(state.id, outcome)

    async def _exit_operator_now(self, task_id: str, outcome: TaskStatus) -> bool:
        """Run the deferred OPERATOR → previous-state transition.

        Phase 16 split out from `_finalize_broadcast` so the same code path
        runs both:
          • automatically when no report could be composed (failsafe), and
          • on demand from `acknowledge_report` when the operator dismisses
            the report screen.

        Returns True iff a transition was actually emitted.
        """
        try:
            from core.state_machine import state_machine
        except Exception:
            return False
        try:
            transition = state_machine.exit_operator(
                f"agent_task_{outcome}",
                to_safe=(outcome == "stopped"),
            )
        except Exception as exc:
            logger.debug("exit_operator raised: %s", exc)
            return False
        if transition is None:
            return False
        with contextlib.suppress(Exception):
            from api.websocket_hub import hub
            await hub.broadcast("state", "transition", {
                "from": transition.from_state,
                "to": transition.to_state,
                "trigger": transition.trigger,
                "timestamp": transition.timestamp,
                "auto": transition.auto,
            })
        # Telemetry-friendly trace.
        logger.info(
            "operator-state exit emitted task=%s trigger=%s",
            task_id[:8], transition.trigger,
        )
        return True

    async def acknowledge_report(
        self,
        task_id: str,
        *,
        also_broadcast: bool = True,
    ) -> bool:
        """Operator-driven dismissal of a pending TaskReport.

        Pops the cached report, runs the deferred OPERATOR exit, and
        optionally broadcasts a `task.report_acknowledged` event so any
        secondary surface (mobile companion, tactical map) can drop the
        screen too.

        Idempotent: extra calls after the first return False without
        side-effects (the second tap of "Close" should be a no-op).
        """
        pending = self.pending_reports.pop(task_id, None)
        if pending is None:
            return False
        outcome = pending.get("outcome", "done")
        ok = await self._exit_operator_now(task_id, outcome)  # type: ignore[arg-type]
        if also_broadcast:
            with contextlib.suppress(Exception):
                from api.websocket_hub import hub
                await hub.broadcast("agent.stream", "task.report_acknowledged", {
                    "task_id": task_id,
                    "outcome": outcome,
                })
        return ok

    def get_pending_report(self, task_id: str) -> dict[str, Any] | None:
        """Read a still-pending TaskReport without dismissing it."""
        entry = self.pending_reports.get(task_id)
        if entry is None:
            return None
        return entry.get("report")

    # ── Phase 17a — Live plan editing ───────────────────────────────────────

    def _state_for_task(self, task_id: str) -> "TaskState | None":
        if self.foreground_slot is not None and self.foreground_slot.id == task_id:
            return self.foreground_slot
        if self.background_slot is not None and self.background_slot.id == task_id:
            return self.background_slot
        return None

    async def inject_subgoal(
        self,
        task_id: str,
        *,
        description: str,
        rationale: str = "",
        position: int | None = None,
        expected_actions: int = 3,
        acceptance_criteria: str = "",
    ) -> dict[str, Any] | None:
        """Insert a new pending sub-goal at `position` (or at the end).

        Requires the task to be paused — the caller (route) is responsible for
        pausing it first if necessary. Audits the change and broadcasts
        `plan.user_edited` so the FE can refresh.
        """
        state = self._state_for_task(task_id)
        if state is None:
            return None
        if state.status not in {"paused", "awaiting_user", "blocked_quota"}:
            # Liveness guard: don't mutate the plan tree while the loop is
            # mid-step, otherwise next_pending_subgoal() can race with the
            # action executor. The route surfaces a 409.
            return {"error": "task must be paused to edit the plan"}

        new_sg = SubGoal(
            description=description.strip()[:500] or "Без назви",
            rationale=rationale.strip()[:500],
            expected_actions=max(1, int(expected_actions or 3)),
            acceptance_criteria=acceptance_criteria.strip()[:500],
        )
        if position is None or position < 0 or position > len(state.sub_goals):
            state.sub_goals.append(new_sg)
            position = len(state.sub_goals) - 1
        else:
            state.sub_goals.insert(position, new_sg)

        with contextlib.suppress(Exception):
            await persist_task_state(state.id, sub_goals=state.sub_goals)

        await self._broadcast("plan.user_edited", {
            "task_id": state.id,
            "kind": "inject",
            "sub_goal_id": new_sg.id,
            "position": position,
            "description": new_sg.description,
        })
        return {"sub_goal": new_sg.model_dump(mode="json"), "position": position}

    async def delete_subgoal(
        self,
        task_id: str,
        *,
        sub_goal_id: str,
        skip_only: bool = False,
    ) -> dict[str, Any] | None:
        state = self._state_for_task(task_id)
        if state is None:
            return None
        if state.status not in {"paused", "awaiting_user", "blocked_quota"}:
            return {"error": "task must be paused to edit the plan"}
        for idx, sg in enumerate(state.sub_goals):
            if sg.id == sub_goal_id:
                if skip_only:
                    sg.status = "skipped"
                else:
                    state.sub_goals.pop(idx)
                with contextlib.suppress(Exception):
                    await persist_task_state(state.id, sub_goals=state.sub_goals)
                await self._broadcast("plan.user_edited", {
                    "task_id": state.id,
                    "kind": "skip" if skip_only else "delete",
                    "sub_goal_id": sub_goal_id,
                })
                return {"removed": True, "skip_only": skip_only}
        return {"removed": False, "reason": "not found"}

    async def patch_plan(
        self,
        task_id: str,
        *,
        diffs: list[dict[str, Any]],
    ) -> dict[str, Any] | None:
        """Apply a batch of plan-diff entries.

        Each diff item looks like one of:
          {"op": "edit", "id": <sg_id>, "description"?: "...", "rationale"?: "...",
           "expected_actions"?: 3, "acceptance_criteria"?: "..."}
          {"op": "reorder", "ids": [<sg_id_in_new_order>...]}
          {"op": "skip", "id": <sg_id>}
          {"op": "delete", "id": <sg_id>}
          {"op": "inject", "description": "...", "position"?: int, ...}
        """
        state = self._state_for_task(task_id)
        if state is None:
            return None
        if state.status not in {"paused", "awaiting_user", "blocked_quota"}:
            return {"error": "task must be paused to edit the plan"}

        applied: list[dict[str, Any]] = []
        by_id = {sg.id: sg for sg in state.sub_goals}
        for d in diffs:
            op = (d.get("op") or "").lower()
            if op == "edit":
                sg = by_id.get(d.get("id"))
                if sg is None:
                    continue
                desc = d.get("description")
                if isinstance(desc, str) and desc.strip():
                    sg.description = desc.strip()[:500]
                rat = d.get("rationale")
                if isinstance(rat, str):
                    sg.rationale = rat.strip()[:500]
                ea = d.get("expected_actions")
                if isinstance(ea, int) and ea >= 1:
                    sg.expected_actions = ea
                ac = d.get("acceptance_criteria")
                if isinstance(ac, str):
                    sg.acceptance_criteria = ac.strip()[:500]
                applied.append({"op": "edit", "id": sg.id})
            elif op == "skip":
                sg = by_id.get(d.get("id"))
                if sg is not None:
                    sg.status = "skipped"
                    applied.append({"op": "skip", "id": sg.id})
            elif op == "delete":
                sgid = d.get("id")
                state.sub_goals = [sg for sg in state.sub_goals if sg.id != sgid]
                by_id = {sg.id: sg for sg in state.sub_goals}
                applied.append({"op": "delete", "id": sgid})
            elif op == "reorder":
                ids = d.get("ids") or []
                if isinstance(ids, list):
                    ordered: list[SubGoal] = []
                    for sgid in ids:
                        sg = by_id.get(sgid)
                        if sg is not None:
                            ordered.append(sg)
                    # Append any that weren't named at the end.
                    named = {sg.id for sg in ordered}
                    for sg in state.sub_goals:
                        if sg.id not in named:
                            ordered.append(sg)
                    state.sub_goals = ordered
                    by_id = {sg.id: sg for sg in state.sub_goals}
                    applied.append({"op": "reorder", "count": len(ordered)})
            elif op == "inject":
                desc = str(d.get("description") or "").strip()
                if not desc:
                    continue
                pos = d.get("position")
                pos = int(pos) if isinstance(pos, int) else None
                rat = str(d.get("rationale") or "")
                ea = int(d.get("expected_actions") or 3)
                ac = str(d.get("acceptance_criteria") or "")
                new_sg = SubGoal(
                    description=desc[:500],
                    rationale=rat.strip()[:500],
                    expected_actions=max(1, ea),
                    acceptance_criteria=ac.strip()[:500],
                )
                if pos is None or pos < 0 or pos > len(state.sub_goals):
                    state.sub_goals.append(new_sg)
                else:
                    state.sub_goals.insert(pos, new_sg)
                by_id[new_sg.id] = new_sg
                applied.append({"op": "inject", "id": new_sg.id})

        with contextlib.suppress(Exception):
            await persist_task_state(state.id, sub_goals=state.sub_goals)

        await self._broadcast("plan.user_edited", {
            "task_id": state.id,
            "kind": "batch",
            "applied": applied,
        })
        return {
            "applied": applied,
            "sub_goals": [sg.model_dump(mode="json") for sg in state.sub_goals],
        }

    # ── Block A-1 — Crash recovery ───────────────────────────────────────────

    async def resume_live_tasks_on_boot(self) -> dict[str, int]:
        """At daemon startup: find every task in resumable status across all
        users, rehydrate, mount into slot, spawn its loop.

        Returns a count dict {'foreground': N, 'background': M, 'mission_resumes': K}
        for the log.

        Constraint: foreground slot has capacity 1, background slot has capacity 1.
        If multiple tasks are in `running` status from a crash, the most-recently-
        progressing one wins the slot; the rest become `paused_by_crash_recovery`
        in DB so the operator can manually resume.
        """
        from agent.kernel.rehydrate import resume_live_tasks_on_boot as _resume
        return await _resume(self)

    # ── Cleanup ──────────────────────────────────────────────────────────────

    def _finalize_release_slot(self, state: TaskState) -> None:
        """Clear the track's slot + runner handle and kick off a queue
        drain coroutine so the next task's planning phase can start
        without the caller awaiting it here."""
        if state.track == "foreground":
            if self.foreground_slot is state:
                self.foreground_slot = None
            self.task_runner = None
        else:
            if self.background_slot is state:
                self.background_slot = None
            self.background_runner = None

        # Drain any queued work for this track. Spawn happens in a separate
        # coroutine so finalize_task returns promptly — callers (loop.py,
        # stop(), timeout wrapper) can continue unwinding without waiting
        # for the next task's planning phase.
        if self._track_queues[state.track]:
            asyncio.create_task(
                self._drain_queue(state.track),
                name=f"agent_queue_drain_{state.track}",
            )


# Singleton
agent_runtime = AgentRuntime()
