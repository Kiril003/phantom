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

from .audit import (
    create_task_row,
    persist_task_state,
    save_checkpoint,
    update_task_status,
    write_memory_seed,
)
from .checkpoints import build as build_checkpoint
from .controls import ControlBus
from .errors import TrackBusyError
from .schemas import (
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


# Lifecycle events that must still surface to UI for background tasks. Everything
# else (thinking/acting/observation/checkpoint spam) is silenced on background.
_BACKGROUND_ALLOWED_EVENTS = frozenset({
    "task.started",
    "task.completed",
    "task.failed",
    "task.stopped",
    "task.timeout",
    "warning.issued",
})


@dataclass
class TaskState:
    id: str
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
    # Phase 9.4a — metadata for background tasks (origin of dispatch, tie-back
    # to a standing order, per-task timeout override). None for foreground.
    origin: str = "user"
    order_id: str | None = None
    timeout_s: int | None = None


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
    order_id: str | None = None
    timeout_s: int | None = None
    queued_at: float = field(default_factory=time.monotonic)


def expanded_workspace() -> str:
    return os.path.abspath(os.path.expanduser(config.agent_workspace_dir))


def ensure_workspace() -> str:
    path = expanded_workspace()
    os.makedirs(path, exist_ok=True)
    return path


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
        # Phase 9.1 contract).
        bg_max = int(getattr(config, "agent_background_queue_max", 20) or 20)
        self._track_queues: dict[Track, deque[QueuedTask]] = {
            "foreground": deque(),
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

    def queue_size(self, track: Track) -> int:
        return len(self._track_queues.get(track, ()))

    async def set_substate(self, sub: Substate) -> None:
        track = current_track.get()
        if track == "background":
            if self.background_substate == sub:
                return
            self.background_substate = sub
            # Background substate is log-only — no FSM mutation, no WS emit.
            logger.debug("bg substate -> %s (task=%s)", sub,
                         self.background_slot.id[:8] if self.background_slot else "-")
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

    async def _broadcast(self, type_: str, payload: dict) -> None:
        track = current_track.get()
        if track == "background":
            if type_ not in _BACKGROUND_ALLOWED_EVENTS:
                # Silent — observation/thinking/action spam stays out of the
                # main stream. Log at debug so the audit trail is still
                # recoverable from server logs during incident analysis.
                logger.debug("bg event suppressed: %s", type_)
            else:
                try:
                    from api.websocket_hub import hub
                    # Map task.* events to dedicated background_events channel
                    # so the UI can subscribe independently from the main
                    # agent.stream feed.
                    await hub.broadcast("background_events", type_, payload)
                except Exception as exc:
                    logger.debug("bg broadcast failed: %s", exc)
            # Emotion handler still runs for background events it cares
            # about; the handler itself ignores unrelated types.
            try:
                from .emotion import update_emotion_on_event
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
            from .emotion import update_emotion_on_event
            await update_emotion_on_event(self, type_, payload)
        except Exception as exc:
            logger.debug("emotion update for %s failed: %s", type_, exc)

    # ── Task lifecycle ───────────────────────────────────────────────────────

    async def start_task(
        self,
        goal: str,
        origin: str = "user",
        track: Track = "foreground",
        order_id: str | None = None,
        timeout_s: int | None = None,
    ) -> tuple[str, bool]:
        """Start a task on the specified track.

        Foreground semantics (preserves Phase 9.1 contract):
          * If busy → return (existing_task_id, False) without queueing.
        Background semantics (Phase 9.4a):
          * If free → spawn loop, return (task_id, True).
          * If busy with queue space → enqueue, return (task_id, False).
          * If busy with queue full → raise TrackBusyError.
        """
        if track not in ("foreground", "background"):
            raise ValueError(f"invalid track {track!r}")

        if track == "foreground":
            if self.foreground_slot is not None and self.foreground_slot.status in {
                "planning", "running", "paused", "awaiting_user", "blocked_quota",
            }:
                return (self.foreground_slot.id, False)
            return await self._spawn_task(
                goal=goal, track="foreground", origin=origin,
                order_id=order_id, timeout_s=timeout_s,
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
                task_id=task_id, goal=goal, origin=origin, track="background",
                order_id=order_id, timeout_s=timeout_s,
            ))
            logger.info(
                "background task queued (id=%s queue_depth=%d goal=%r)",
                task_id[:8], len(queue), goal[:60],
            )
            return (task_id, False)
        return await self._spawn_task(
            goal=goal, track="background", origin=origin,
            order_id=order_id, timeout_s=timeout_s,
        )

    async def _spawn_task(
        self,
        *,
        goal: str,
        track: Track,
        origin: str,
        order_id: str | None,
        timeout_s: int | None,
        task_id: str | None = None,
    ) -> tuple[str, bool]:
        """Internal: actually create the TaskState + DB row and start the loop.

        Used by both start_task() and the post-finalize queue drain.
        """
        from .self_model import build_self_model
        from .actions.registry import registry as default_registry

        ensure_workspace()
        # Reset control bus only when this spawn begins a foreground session.
        # Background tasks share the bus's pause/stop semantics with foreground
        # — emergency_stop still halts everything — so we do NOT clear it
        # mid-flight; the bus is reset once at foreground entry.
        if track == "foreground":
            self.controls.reset()

        task_id = task_id or str(uuid.uuid4())
        self_model = await build_self_model(default_registry)
        state = TaskState(
            id=task_id,
            goal=goal,
            track=track,
            status="planning",
            self_model=self_model,
            origin=origin,
            order_id=order_id,
            timeout_s=timeout_s,
        )
        self._set_slot(track, state)
        await create_task_row(task_id, goal, track)

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

        from .loop import run_task_loop
        runner = asyncio.create_task(
            run_task_loop(self, state),
            name=f"agent_task_{task_id}",
        )
        if track == "foreground":
            self.task_runner = runner
        else:
            self.background_runner = runner
        return (task_id, True)

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
                goal=nxt.goal, track=nxt.track, origin=nxt.origin,
                order_id=nxt.order_id, timeout_s=nxt.timeout_s,
                task_id=nxt.task_id,
            )
        except Exception as exc:
            logger.exception("queue drain spawn failed for %s: %s", nxt.task_id[:8], exc)

    async def pause(self, task_id: str) -> bool:
        tgt = self._find_active(task_id)
        if tgt is None:
            return False
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
            cap_at = int(getattr(config, "agent_max_llm_calls_per_background_task", 10) or 10)
        else:
            warn_at = int(getattr(config, "agent_warn_llm_calls_per_task", 30) or 30)
            cap_at = int(getattr(config, "agent_max_llm_calls_per_task", 50) or 50)

        if state.llm_calls_this_task >= warn_at and not state.llm_call_warned:
            state.llm_call_warned = True
            await self._broadcast("agent.budget.warning", {
                "task_id": state.id,
                "track": state.track,
                "llm_calls_used": state.llm_calls_this_task,
                "warn_at": warn_at,
                "cap_at": cap_at,
            })

        if state.llm_calls_this_task >= cap_at:
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
                    from .proactive import get_loop
                    from .proactive_triggers import ProactiveTrigger, ProactiveTriggerKind
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
        cp_id = await save_checkpoint(cp)
        await self._broadcast("checkpoint.created", {
            "task_id": task_id, "checkpoint_id": cp_id, "reason": "manual",
        })
        return cp_id

    async def resume_from_checkpoint(self, task_id: str, checkpoint_id: int) -> bool:
        from .audit import fetch_audit, fetch_checkpoint
        from .observations import build_system

        cp = await fetch_checkpoint(checkpoint_id)
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
            audit_rows = await fetch_audit(task_id, limit=200)
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
        from .loop import run_task_loop
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
        try:
            await self._finalize_task_impl(state, outcome, summary, error)
        finally:
            current_track.reset(token)

    async def _finalize_task_impl(
        self,
        state: TaskState,
        outcome: TaskStatus,
        summary: str,
        error: str | None,
    ) -> None:
        state.status = outcome
        state.error = error
        await update_task_status(
            state.id, outcome,
            error=error,
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

        # Memory seed — outcome-kind string used by seed + memory subsystems.
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
            from .memory.seeds import compose_summary, write_episode
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
            )

        with contextlib.suppress(Exception):
            await write_memory_seed(
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
                from .self_model import record_success
                record_success(state.self_model, episode_summary)
            if state.track == "foreground":
                with contextlib.suppress(Exception):
                    from .proactive import get_loop
                    from .proactive_triggers import ProactiveTrigger, ProactiveTriggerKind
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
                from .proactive import get_loop
                loop = get_loop()
                if loop is not None:
                    loop.reset_streak()

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

        if state.track == "foreground":
            with contextlib.suppress(Exception):
                from core.state_machine import state_machine
                transition = state_machine.exit_operator(
                    f"agent_task_{outcome}",
                    to_safe=(outcome == "stopped"),
                )
                if transition is not None:
                    from api.websocket_hub import hub
                    await hub.broadcast("state", "transition", {
                        "from": transition.from_state,
                        "to": transition.to_state,
                        "trigger": transition.trigger,
                        "timestamp": transition.timestamp,
                        "auto": transition.auto,
                    })

        # Free the slot so the next task can start.
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
