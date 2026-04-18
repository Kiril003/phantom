"""
ReAct + Reflect + Checkpoint orchestration loop.

One task per loop. Driven by AgentRuntime, broadcasts every state change to
the agent.stream WS channel via runtime._broadcast(), and persists checkpoints
+ audit entries as it goes.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from typing import TYPE_CHECKING

from config import config

from .audit import persist_task_state, save_checkpoint, update_task_status
from .checkpoints import build as build_checkpoint
from .executor import StepCancelled, TaskStopped, execute as execute_action
from .observations import (
    build_from_action_result,
    build_reflection,
    build_system,
    build_user,
)
from .planner import reflector as reflector_mod
from .planner import strategic, tactical
from .planner._llm import BlockedQuotaError, PlannerLLMError
from .safety.circuit_breakers import TaskBudget, evaluate as evaluate_breaker
from .schemas import (
    ActionResult,
    Observation,
    PlanStep,
    ReflectionResult,
    StrategicPlan,
    SubGoal,
    SubGoalStatus,
    ThoughtBudget,
)

if TYPE_CHECKING:
    from .runtime import AgentRuntime, TaskState

logger = logging.getLogger(__name__)


_TERMINAL_DONE_TASK = "DONE_TASK"
_TERMINAL_DONE_SUBGOAL = "DONE_SUBGOAL"


def _summarize_recent_actions(state: "TaskState", limit: int = 8) -> str:
    if not state.actions_log:
        return "(no actions yet)"
    recent = state.actions_log[-limit:]
    lines = []
    for entry in recent:
        ok = "OK" if entry.get("ok") else "FAIL"
        lines.append(
            f"[{entry['step_idx']}] {entry['action']} {ok} "
            f"({entry.get('error_class') or 'ok'})"
        )
    return "\n".join(lines)


async def _drain_intervention(runtime: "AgentRuntime") -> str | None:
    """Pull the most recent intervention text, draining the queue."""
    text: str | None = None
    while True:
        try:
            text = runtime.controls.intervention_queue.get_nowait()
        except asyncio.QueueEmpty:
            break
    return text


async def _checkpoint_now(runtime: "AgentRuntime", state: "TaskState", reason) -> int:
    cp = build_checkpoint(
        task_id=state.id,
        reason=reason,
        self_model=state.self_model,
        goal=state.goal,
        sub_goals=state.sub_goals,
        active_sub_goal_id=state.active_sub_goal_id,
        observations=state.observations,
        thought_budget=state.thought_budget,
        last_reflection=state.last_reflection,
        step_idx=state.step_idx,
    )
    cp_id = await save_checkpoint(cp)
    await runtime._broadcast("checkpoint.created", {
        "task_id": state.id, "checkpoint_id": cp_id, "reason": reason,
    })
    return cp_id


async def _persist_partial_state(state: "TaskState") -> None:
    with contextlib.suppress(Exception):
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


def _next_pending_subgoal(state: "TaskState") -> SubGoal | None:
    for sg in state.sub_goals:
        if sg.status in {"pending", "active"}:
            return sg
    return None


async def _ensure_strategic_plan(runtime: "AgentRuntime", state: "TaskState",
                                 revise_note: str = "") -> bool:
    """Run strategic planner and update state. Returns True on success."""
    await runtime.set_substate("thinking")
    await runtime._broadcast("thinking.started", {
        "task_id": state.id, "planner": "strategic", "step_idx": state.step_idx,
    })
    try:
        plan = await strategic.plan(
            goal=state.goal,
            self_model=state.self_model,
            memory_seeds_summary=state.self_model.recent_task_summary or "",
            revise_note=revise_note,
        )
    except (RuntimeError, PlannerLLMError) as exc:
        logger.error("strategic planner failed: %s", exc)
        await runtime._broadcast("warning.issued", {
            "task_id": state.id,
            "category": "strategic_planner",
            "message": str(exc),
        })
        await runtime.finalize_task(state, "failed", summary="strategic planner could not produce a plan",
                                    error=str(exc))
        return False

    await runtime._broadcast("thinking.completed", {
        "task_id": state.id, "planner": "strategic", "step_idx": state.step_idx,
    })

    state.strategic_plan = plan
    state.sub_goals = list(plan.sub_goals)
    state.thought_budget = ThoughtBudget(
        estimated_actions=max(plan.estimated_total_actions, sum(sg.expected_actions for sg in plan.sub_goals)),
        actions_used=state.thought_budget.actions_used,
        force_reflect_ratio=config.agent_thought_budget_force_reflect_ratio,
        reflections_done=state.thought_budget.reflections_done,
    )

    await runtime._broadcast("strategic_plan.created", {
        "task_id": state.id,
        "sub_goals": [sg.model_dump(mode="json") for sg in plan.sub_goals],
        "estimated_total_actions": plan.estimated_total_actions,
        "risk_assessment": plan.risk_assessment,
    })

    if plan.estimated_total_actions > config.agent_strategic_warn_actions:
        await runtime._broadcast("warning.issued", {
            "task_id": state.id,
            "category": "estimated_total_actions_high",
            "message": (
                f"strategic planner estimates {plan.estimated_total_actions} actions, "
                f"above warning threshold {config.agent_strategic_warn_actions}"
            ),
        })

    await _persist_partial_state(state)
    return True


async def _run_reflection(
    runtime: "AgentRuntime",
    state: "TaskState",
    reason: str,
    intervention: str | None = None,
) -> ReflectionResult:
    sub = _next_pending_subgoal(state) or (state.sub_goals[0] if state.sub_goals else None)
    if sub is None:
        sub = SubGoal(description=state.goal, rationale="(synthetic)", expected_actions=1, acceptance_criteria="")

    await runtime.set_substate("reflecting")
    await runtime._broadcast("reflection.started", {
        "task_id": state.id, "reason": reason,
    })
    result = await reflector_mod.reflect(
        active_sub_goal=sub,
        observations=state.observations,
        recent_actions_summary=_summarize_recent_actions(state),
        thought_budget=state.thought_budget,
        intervention=intervention,
    )
    state.last_reflection = result
    state.thought_budget = ThoughtBudget(
        estimated_actions=state.thought_budget.estimated_actions,
        actions_used=state.thought_budget.actions_used,
        force_reflect_ratio=state.thought_budget.force_reflect_ratio,
        reflections_done=state.thought_budget.reflections_done + 1,
    )
    state.observations.append(build_reflection(state.step_idx, result.summary or "(reflection)"))

    await runtime._broadcast("reflection.completed", {
        "task_id": state.id,
        "verdict": result.verdict,
        "summary": result.summary,
        "new_confidence": result.new_confidence,
    })

    # Auto-checkpoint after every reflection
    await _checkpoint_now(runtime, state, "auto_reflect")
    return result


async def run_task_loop(runtime: "AgentRuntime", state: "TaskState", *, resumed: bool = False) -> None:
    """Drive a single foreground task to completion."""
    budget = TaskBudget()
    state.status = "running"
    await update_task_status(state.id, "running")
    await runtime._broadcast("task.started", {
        "task_id": state.id, "goal": state.goal,
        "self_model": state.self_model.model_dump(mode="json"),
        "resumed": resumed,
    })

    try:
        # ── Strategic plan (skip on resume if we already have one) ────────────
        if not state.sub_goals:
            if not await _ensure_strategic_plan(runtime, state):
                return

        actions_in_subgoal = 0

        while True:
            # Pause gate
            if runtime.controls.pause_event.is_set():
                state.status = "paused"
                await update_task_status(state.id, "paused", paused_reason="user_paused")
                await runtime.set_substate("paused")
                await runtime._broadcast("task.paused", {
                    "task_id": state.id, "reason": "user_paused",
                })
                await _checkpoint_now(runtime, state, "pause")
                await runtime.controls.wait_until_resumed()
                if runtime.controls.emergency_stop.is_set():
                    raise TaskStopped()
                state.status = "running"
                await update_task_status(state.id, "running", paused_reason=None)
                await runtime._broadcast("task.resumed", {"task_id": state.id})

            # Stop gate
            if runtime.controls.emergency_stop.is_set():
                raise TaskStopped()

            # Drain interventions BEFORE planning so the next reflection sees them
            inter_text = await _drain_intervention(runtime)
            if inter_text is not None:
                state.observations.append(build_user(state.step_idx, inter_text))
                await runtime._broadcast("task.intervention_received", {
                    "task_id": state.id, "instruction_summary": inter_text[:120],
                })
                ref = await _run_reflection(runtime, state, "user_intervention", intervention=inter_text)
                if ref.verdict == "abandon_task":
                    await runtime.finalize_task(state, "failed", summary=ref.summary, error="reflector_abandon")
                    return
                if ref.verdict == "wait_user":
                    state.status = "awaiting_user"
                    await update_task_status(state.id, "awaiting_user")
                    await runtime.set_substate("waiting_user")
                    await runtime._broadcast("task.waiting_user", {
                        "task_id": state.id, "prompt_to_user": ref.recommendations or ref.summary,
                    })
                    await asyncio.sleep(0.5)
                    continue
                if ref.verdict == "revise_strategy":
                    if not await _ensure_strategic_plan(runtime, state, revise_note=ref.recommendations or ""):
                        return
                    actions_in_subgoal = 0
                    continue
                # 'continue' or 'revise_subgoal' both fall through to tactical

            # Circuit breakers
            verdict = evaluate_breaker(budget)
            if verdict.fail_now:
                await runtime.finalize_task(state, "failed", summary=f"circuit_breaker:{verdict.reason}",
                                            error=verdict.reason)
                return
            if verdict.force_reflect:
                ref = await _run_reflection(runtime, state, "errors")
                if ref.verdict == "abandon_task":
                    await runtime.finalize_task(state, "failed", summary=ref.summary, error="reflector_abandon")
                    return
                # reset the streak so reflection has a chance to redirect
                budget.consecutive_identical_errors = 0
                budget.last_error_class = None
                if ref.verdict == "revise_strategy":
                    if not await _ensure_strategic_plan(runtime, state, revise_note=ref.recommendations or ""):
                        return
                    actions_in_subgoal = 0
                    continue

            # Pick / advance to current sub-goal
            current_sg = _next_pending_subgoal(state)
            if current_sg is None:
                # All sub-goals done
                summary = "; ".join(sg.description for sg in state.sub_goals if sg.status == "done")
                await runtime.finalize_task(state, "done", summary=summary or "all sub-goals complete")
                return

            if current_sg.status == "pending":
                current_sg.status = "active"
                state.active_sub_goal_id = current_sg.id
                actions_in_subgoal = 0
                await runtime._broadcast("sub_goal.started", {
                    "task_id": state.id, "sub_goal_id": current_sg.id,
                    "description": current_sg.description,
                })

            # Tactical planner — single next step
            await runtime.set_substate("thinking")
            await runtime._broadcast("thinking.started", {
                "task_id": state.id, "planner": "tactical", "step_idx": state.step_idx,
            })
            try:
                step = await tactical.plan(
                    step_idx=state.step_idx,
                    sub_goal=current_sg,
                    self_model=state.self_model,
                    observations=state.observations,
                    actions_in_sub_goal=actions_in_subgoal,
                )
            except BlockedQuotaError as exc:
                # Phase 9.2.1 — both LLM providers are quota-exhausted.
                # Park the task in `blocked_quota` and let the runtime
                # probe poll for recovery; resume on success.
                resumed = await runtime.enter_blocked_quota(state, str(exc))
                if not resumed:
                    return
                continue
            except PlannerLLMError as exc:
                # tactical bombed — observation + reflection
                state.observations.append(build_system(state.step_idx, "tactical", f"tactical_failed: {exc}"))
                ref = await _run_reflection(runtime, state, "tactical_parse_failure")
                if ref.verdict == "abandon_task":
                    await runtime.finalize_task(state, "failed", summary=ref.summary, error=str(exc))
                    return
                continue

            await runtime._broadcast("thinking.completed", {
                "task_id": state.id, "planner": "tactical", "step_idx": state.step_idx,
            })
            await runtime._broadcast("plan.step_created", {
                "task_id": state.id, "step": step.model_dump(mode="json"),
            })

            # Terminal markers ───────────────────────────────────────────────────
            if step.action == _TERMINAL_DONE_TASK:
                summary = str(step.args.get("summary") or "task complete")
                # Mark all sub-goals done
                for sg in state.sub_goals:
                    if sg.status in {"pending", "active"}:
                        sg.status = "done"
                await runtime.finalize_task(state, "done", summary=summary)
                return

            if step.action == _TERMINAL_DONE_SUBGOAL:
                summary = str(step.args.get("summary") or "sub-goal done")
                current_sg.status = "done"
                state.observations.append(build_system(state.step_idx, "sub_goal", summary))
                await runtime._broadcast("sub_goal.done", {
                    "task_id": state.id, "sub_goal_id": current_sg.id, "summary": summary,
                })
                actions_in_subgoal = 0
                state.step_idx += 1
                continue

            if step.action == "REFLECT":
                ref = await _run_reflection(runtime, state, "tactical_requested")
                state.step_idx += 1
                if ref.verdict == "abandon_task":
                    await runtime.finalize_task(state, "failed", summary=ref.summary, error="reflector_abandon")
                    return
                continue

            # Risk-tolerance preview — let the loop block before executor wastes
            # the action attempt + audit row when the LLM picked too risky.
            from .actions.registry import registry as _reg
            cls = _reg.get(step.action)
            if cls and int(cls.risk_level) > int(config.agent_risk_tolerance):
                state.status = "awaiting_user"
                await update_task_status(state.id, "awaiting_user")
                await runtime.set_substate("waiting_user")
                await runtime._broadcast("task.waiting_user", {
                    "task_id": state.id,
                    "prompt_to_user": (
                        f"Action '{step.action}' has risk level {int(cls.risk_level)} "
                        f"above tolerance {config.agent_risk_tolerance}. "
                        f"Reply with intervene 'approve' or 'reject'."
                    ),
                })
                # Wait for an intervention
                inter = await runtime.controls.intervention_queue.get()
                state.observations.append(build_user(state.step_idx, inter))
                approved = inter.strip().lower() in {"approve", "yes", "ok", "approved"}
                if not approved:
                    state.observations.append(build_system(
                        state.step_idx, "consent", f"user rejected risky action {step.action}",
                    ))
                    state.status = "running"
                    await update_task_status(state.id, "running")
                    state.step_idx += 1
                    continue
                # else fall through and allow execution

            # ── Execute ─────────────────────────────────────────────────────────
            await runtime.set_substate("acting")
            await runtime._broadcast("tool.selected", {
                "task_id": state.id, "step_idx": step.step_idx,
                "action": step.action, "risk_level": int(cls.risk_level) if cls else 1,
            })
            await runtime._broadcast("action.started", {
                "task_id": state.id, "step_idx": step.step_idx, "action": step.action,
            })

            try:
                result, audit_id = await execute_action(
                    task_id=state.id,
                    step=step,
                    runtime=runtime,
                    workspace_dir=config.agent_workspace_dir,
                )
            except TaskStopped:
                raise
            except StepCancelled:
                state.observations.append(build_system(
                    state.step_idx, "cancel_step", f"user cancelled step {step.action}",
                ))
                state.actions_log.append({
                    "step_idx": step.step_idx, "action": step.action,
                    "ok": False, "error_class": "cancelled_by_user",
                })
                state.step_idx += 1
                continue

            budget.record_action()
            budget.record_result(result.ok, result.error_class)
            state.thought_budget = ThoughtBudget(
                estimated_actions=state.thought_budget.estimated_actions,
                actions_used=state.thought_budget.actions_used + 1,
                force_reflect_ratio=state.thought_budget.force_reflect_ratio,
                reflections_done=state.thought_budget.reflections_done,
            )
            current_sg.actions_used = current_sg.actions_used + 1
            actions_in_subgoal += 1
            state.actions_log.append({
                "step_idx": step.step_idx, "action": step.action,
                "ok": result.ok, "error_class": result.error_class,
            })
            obs = build_from_action_result(step, result)
            state.observations.append(obs)

            await runtime._broadcast(
                "action.completed" if result.ok else "action.failed",
                {
                    "task_id": state.id, "step_idx": step.step_idx,
                    "result": result.model_dump(mode="json"),
                    "error": result.error,
                    "elapsed_ms": result.elapsed_ms,
                },
            )
            await runtime._broadcast("observation.added", {
                "task_id": state.id, "observation": obs.model_dump(mode="json"),
            })

            # Honour precondition failure_mode hints returned in result.output
            if (not result.ok) and isinstance(result.output, dict):
                fm = result.output.get("failure_mode")
                if fm == "reflect":
                    ref = await _run_reflection(runtime, state, "precondition_reflect")
                    if ref.verdict == "abandon_task":
                        await runtime.finalize_task(state, "failed", summary=ref.summary, error=str(result.error))
                        return
                if fm == "ask_user":
                    state.status = "awaiting_user"
                    await update_task_status(state.id, "awaiting_user")
                    await runtime.set_substate("waiting_user")
                    await runtime._broadcast("task.waiting_user", {
                        "task_id": state.id, "prompt_to_user": str(result.error),
                    })
                    inter = await runtime.controls.intervention_queue.get()
                    state.observations.append(build_user(state.step_idx, inter))
                    state.status = "running"
                    await update_task_status(state.id, "running")

            state.step_idx += 1

            # Scheduled reflection — every N actions
            if (state.thought_budget.actions_used % max(1, config.agent_reflection_every_n_actions)) == 0:
                ref = await _run_reflection(runtime, state, "scheduled")
                if ref.verdict == "abandon_task":
                    await runtime.finalize_task(state, "failed", summary=ref.summary, error="reflector_abandon")
                    return
                if ref.verdict == "revise_strategy":
                    if not await _ensure_strategic_plan(runtime, state, revise_note=ref.recommendations or ""):
                        return
                    actions_in_subgoal = 0

            # Thought-budget force-reflect
            tb = state.thought_budget
            if tb.estimated_actions > 0 and tb.actions_used >= tb.estimated_actions * tb.force_reflect_ratio:
                ref = await _run_reflection(runtime, state, "budget")
                if ref.verdict == "abandon_task":
                    await runtime.finalize_task(state, "failed", summary=ref.summary, error="thought_budget_exhausted")
                    return

    except TaskStopped:
        await runtime.finalize_task(state, "stopped", summary="emergency_stop", error=None)
    except asyncio.CancelledError:
        await runtime.finalize_task(state, "stopped", summary="cancelled", error=None)
        raise
    except Exception as exc:
        logger.exception("agent loop crash for task %s", state.id)
        await runtime.finalize_task(state, "failed", summary=str(exc), error=str(exc))
