"""
AgentRuntime singleton — owns active task state, broadcasts substates,
exposes the control surface that routes_agent.py + websocket_hub use.

Only the foreground slot is actively executed in Phase 9.1; the background
slot is reserved as a None placeholder so future phases can plug in without
re-shaping the data model.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import time
import uuid
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


def expanded_workspace() -> str:
    return os.path.abspath(os.path.expanduser(config.agent_workspace_dir))


def ensure_workspace() -> str:
    path = expanded_workspace()
    os.makedirs(path, exist_ok=True)
    return path


class AgentRuntime:
    """Singleton — Phase 9.1 has exactly one foreground task at a time."""

    def __init__(self) -> None:
        self.controls = ControlBus()
        self.foreground_slot: TaskState | None = None
        self.background_slot: TaskState | None = None  # always None in this phase
        self.substate: Substate = "idle"
        self.task_runner: asyncio.Task | None = None
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
        return self.foreground_slot

    @property
    def self_model(self) -> SelfModel | None:
        return self.foreground_slot.self_model if self.foreground_slot else None

    async def set_substate(self, sub: Substate) -> None:
        if self.substate == sub:
            return
        self.substate = sub
        # Mirror into FSM so context broadcasts include substate alongside state.
        try:
            from core.state_machine import state_machine
            state_machine.set_operator_substate(sub)
        except Exception:
            pass
        await self._broadcast("substate.changed", {
            "task_id": self.current_task.id if self.current_task else None,
            "substate": sub,
        })

    async def _broadcast(self, type_: str, payload: dict) -> None:
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

    async def start_task(self, goal: str) -> tuple[str, bool]:
        """Start a foreground task. Returns (task_id, started).

        If a task is already running: returns (existing_task_id, False).
        """
        if self.foreground_slot is not None and self.foreground_slot.status in {
            "planning", "running", "paused", "awaiting_user",
        }:
            return (self.foreground_slot.id, False)

        from .self_model import build_self_model
        from .actions.registry import registry as default_registry

        ensure_workspace()
        self.controls.reset()

        task_id = str(uuid.uuid4())
        self_model = await build_self_model(default_registry)
        state = TaskState(
            id=task_id,
            goal=goal,
            track="foreground",
            status="planning",
            self_model=self_model,
        )
        self.foreground_slot = state
        await create_task_row(task_id, goal, "foreground")

        # FSM transition into OPERATOR — saves the previous state for restore.
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

        # Run loop as a separate task so /agent/task POST returns immediately.
        from .loop import run_task_loop
        self.task_runner = asyncio.create_task(run_task_loop(self, state), name=f"agent_task_{task_id}")
        return (task_id, True)

    async def pause(self, task_id: str) -> bool:
        if not self.current_task or self.current_task.id != task_id:
            return False
        self.controls.pause_event.set()
        self.controls.resume_event.clear()
        return True

    async def resume(self, task_id: str) -> bool:
        if not self.current_task or self.current_task.id != task_id:
            return False
        self.controls.pause_event.clear()
        self.controls.resume_event.set()
        await update_task_status(task_id, "running", paused_reason=None)
        return True

    async def intervene(self, task_id: str, instruction: str) -> bool:
        if not self.current_task or self.current_task.id != task_id:
            return False
        await self.controls.intervention_queue.put(instruction)
        return True

    async def cancel_step(self, task_id: str) -> bool:
        if not self.current_task or self.current_task.id != task_id:
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

    async def note_llm_call(self, task_id: str | None) -> bool:
        """
        Phase 9.2.1 — invoked by AIRouter on every successful or attempted
        tool-use / generate call. Returns False once the per-task hard cap
        has been hit so callers can short-circuit; True otherwise.

        Emits one agent.budget.warning WS event when the soft warn threshold
        is first crossed (latched via TaskState.llm_call_warned).
        """
        if not task_id or self.foreground_slot is None or self.foreground_slot.id != task_id:
            return True
        state = self.foreground_slot
        state.llm_calls_this_task += 1
        warn_at = int(getattr(config, "agent_warn_llm_calls_per_task", 30) or 30)
        cap_at = int(getattr(config, "agent_max_llm_calls_per_task", 50) or 50)

        if state.llm_calls_this_task >= warn_at and not state.llm_call_warned:
            state.llm_call_warned = True
            await self._broadcast("agent.budget.warning", {
                "task_id": state.id,
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
            # Adaptive interval: base for the first 3 failures, then double up
            # to max_interval. Reset on any success.
            if consecutive_failures >= _PROBE_BACKOFF_AFTER_FAILS:
                grown = base_interval * (2 ** (consecutive_failures - _PROBE_BACKOFF_AFTER_FAILS + 1))
                interval = min(grown, max_interval)
            else:
                interval = base_interval
            # Phase 9.3a (AD-05) — interruptible sleep. Previously
            # `asyncio.sleep(interval)` blocked for up to `max_interval` (600s)
            # even when the operator hit STOP mid-sleep. wait_for on the
            # event short-circuits the instant emergency_stop is set.
            try:
                await asyncio.wait_for(
                    self.controls.emergency_stop.wait(),
                    timeout=interval,
                )
                # emergency_stop was set during the sleep — exit immediately.
                return False
            except asyncio.TimeoutError:
                # Normal probe cadence — fall through to probe.
                pass
            if self.controls.emergency_stop.is_set():
                return False
            if await self._probe_provider_recovered():
                state.status = "running"
                state.paused_reason = None
                await update_task_status(state.id, "running", paused_reason=None)
                await self.set_substate("thinking")
                await self._broadcast("task.resumed", {"task_id": state.id, "reason": "quota_recovered"})
                return True
            consecutive_failures += 1
            if consecutive_failures == _PROBE_BACKOFF_AFTER_FAILS:
                # First time we extend the interval — surface to UI/logs.
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
            # Transient (network, timeout, 5xx) — the probe itself is fragile,
            # don't keep the task locked because of a single hiccup. Caller
            # will continue probing.
            return True

    async def stop(self, task_id: str | None = None) -> bool:
        target = self.current_task
        if target is None:
            return False
        if task_id is not None and target.id != task_id:
            return False
        self.controls.emergency_stop.set()
        if self.task_runner and not self.task_runner.done():
            self.task_runner.cancel()
        await self._teardown_browser()
        return True

    async def checkpoint_now(self, task_id: str) -> int | None:
        target = self.current_task
        if target is None or target.id != task_id:
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

        # Phase 9.2.2 (F-05): browser context is NOT preserved across resume
        # (Playwright lifecycle is per-process). If the task touched a browser
        # before the checkpoint, surface a hint so tactical knows to re-navigate
        # rather than expect the prior page to still be there.
        last_browser_url: str | None = None
        try:
            audit_rows = await fetch_audit(task_id, limit=200)
            browser_rows = [r for r in audit_rows if (r.action_name or "").startswith("browser.")]
            if browser_rows:
                # Newest first → walk for the latest navigate URL we can find.
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
                # Phase 9.3a (AD-01) — the observation slides off the
                # tactical 10-item window on long tasks. Put the caveat on
                # SelfModel too so it stays in every prompt until cleared
                # by a successful browser.navigate.
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
        state.status = outcome
        state.error = error
        await update_task_status(
            state.id, outcome,
            error=error,
            paused_reason=state.paused_reason,
            finished=True,
        )

        # Persist final per-task state blob too
        await persist_task_state(
            state.id,
            sub_goals=state.sub_goals,
            observations_json=json.dumps([o.model_dump(mode="json") for o in state.observations[-50:]], default=str),
            self_model_json=json.dumps(state.self_model.model_dump(mode="json")),
            thought_budget_json=json.dumps(state.thought_budget.model_dump(mode="json")),
        )

        # Memory seed — outcome is one of done/failed/stopped
        outcome_kind = (
            "done" if outcome == "done"
            else "failed" if outcome == "failed"
            else "stopped"
        )
        action_counts: dict[str, int] = {}
        for entry in state.actions_log:
            action_counts[entry["action"]] = action_counts.get(entry["action"], 0) + 1
        key_actions = sorted(action_counts.items(), key=lambda x: -x[1])[:5]

        # Phase 9.2 — compose UA summary via LLM, embed into ChromaDB,
        # and dual-write the SQL row so legacy lookups still work.
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

        # Phase 9.3a — log successful tasks into SelfModel.recent_successes
        # so 9.3b proactive decisions can read "we've been on a roll lately"
        # as a signal. Failures don't go on this list by design.
        if outcome == "done":
            with contextlib.suppress(Exception):
                from .self_model import record_success
                record_success(state.self_model, episode_summary)

        await self._teardown_browser()

        await self._broadcast(
            "task.completed" if outcome == "done"
            else "task.stopped" if outcome == "stopped"
            else "task.failed",
            {"task_id": state.id, "summary": summary, "error": error},
        )

        await self.set_substate("idle")

        # Exit FSM OPERATOR — restore previous state, except panic stop which
        # routes to SHADOW (safety default).
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
        if self.foreground_slot is state:
            self.foreground_slot = None
        self.task_runner = None


# Singleton
agent_runtime = AgentRuntime()
