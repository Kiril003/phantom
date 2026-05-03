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
from .errors import BackgroundTimeoutError
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
    CouncilSituation,
    Observation,
    PlanStep,
    ReflectionResult,
    StrategicPlan,
    SubGoal,
    SubGoalStatus,
    ThoughtBudget,
)
from .orchestrator import maybe_consult_council
from .orchestrator.quality_gate import GateDraft
from .orchestrator.runtime_hooks import run_quality_gate_for

if TYPE_CHECKING:
    from .runtime import AgentRuntime, TaskState

logger = logging.getLogger(__name__)


_TERMINAL_DONE_TASK = "DONE_TASK"
_TERMINAL_DONE_SUBGOAL = "DONE_SUBGOAL"


# Phase 9.2.1 — repeat-action detection. We canonicalise (action, args)
# into a hash so a second-of-second copy of the same FAILED step inside the
# 5-step lookback window forces a reflection; the third triggers
# sub-goal abandonment via the synthetic DONE_SUBGOAL marker. The
# canonicaliser ignores timestamps and case so "Selector"/"selector" or
# args containing { "ts": ... } don't dodge the check.
_REPEAT_LOOKBACK = 5
_REPEAT_FORCE_REFLECT_AT = 2
_REPEAT_ABANDON_AT = 3
_TIMESTAMP_KEYS = frozenset({"ts", "timestamp", "now", "_ts", "created_at"})

# Phase 17a.6 — Quality Gate strikes before we accept the artefact as-is.
# First failure → forced reflection (reflector either revises strategy or
# the next DONE_TASK ships a clean draft). Second failure → finalize with
# a caveat warning so the agent never wedges itself on a stubborn critic.
_QUALITY_GATE_MAX_FAILURES = 2


def _canonical_args_key(action: str, args: dict | None) -> str:
    import hashlib

    def _norm(v):
        if isinstance(v, str):
            return v.lower().strip()
        if isinstance(v, dict):
            return {k: _norm(vv) for k, vv in sorted(v.items()) if k not in _TIMESTAMP_KEYS}
        if isinstance(v, list):
            return [_norm(x) for x in v]
        return v

    payload = json.dumps([action.lower(), _norm(args or {})], sort_keys=True, default=str)
    return hashlib.sha1(payload.encode()).hexdigest()


def _count_recent_failed_repeats(state: "TaskState", key: str) -> int:
    log = state.actions_log[-_REPEAT_LOOKBACK:]
    return sum(1 for entry in log if entry.get("repeat_key") == key and not entry.get("ok"))


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
    """Run strategic planner and update state. Returns True on success.

    Phase 9.2.2 (F-02): wraps the call so a BlockedQuotaError raised by the
    router (both providers quota-exhausted) parks the task on `blocked_quota`
    and retries strategic.plan after recovery instead of crashing.
    """
    await runtime.set_substate("thinking")
    await runtime._broadcast("thinking.started", {
        "task_id": state.id, "planner": "strategic", "step_idx": state.step_idx,
    })
    while True:
        try:
            plan = await strategic.plan(
                goal=state.goal,
                self_model=state.self_model,
                memory_seeds_summary=state.self_model.recent_task_summary or "",
                revise_note=revise_note,
                task_id=state.id,
            )
            break
        except BlockedQuotaError as exc:
            resumed = await runtime.enter_blocked_quota(state, str(exc))
            if not resumed:
                return False
            # Retry strategic plan after provider recovers.
            continue
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
    while True:
        try:
            result = await reflector_mod.reflect(
                active_sub_goal=sub,
                observations=state.observations,
                recent_actions_summary=_summarize_recent_actions(state),
                thought_budget=state.thought_budget,
                intervention=intervention,
                task_id=state.id,
            )
            break
        except BlockedQuotaError as exc:
            # Phase 9.2.2 (F-02): both providers quota-exhausted during
            # reflection. Park the task; on recovery retry once. If the
            # runtime gives up (emergency stop), synthesise an abandon_task
            # verdict so the caller exits cleanly.
            resumed = await runtime.enter_blocked_quota(state, str(exc))
            if not resumed:
                result = ReflectionResult(
                    verdict="abandon_task",
                    summary="reflection_blocked_by_quota_recovery_failed",
                    progress_assessment="quota recovery aborted by emergency stop",
                    recurring_errors=[],
                    recommendations="",
                    new_confidence=0.0,
                )
                break
            # else retry once
            continue
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
    # Phase 9.3b — emit inner monologue on reflection completion.
    try:
        from .monologue_emitter import MonologueEvent, emit_monologue
        await emit_monologue(MonologueEvent(
            kind="reflection",
            source="reflector",
            monologue={
                "verdict": result.verdict,
                "summary": result.summary,
                "progress_assessment": result.progress_assessment,
                "recurring_errors": result.recurring_errors,
                "recommendations": result.recommendations,
                "new_confidence": result.new_confidence,
            },
            task_id=state.id,
        ))
    except Exception as exc:
        logger.debug("monologue emit (reflection) failed: %s", exc)

    # Auto-checkpoint after every reflection
    await _checkpoint_now(runtime, state, "auto_reflect")
    return result


async def run_task_loop(runtime: "AgentRuntime", state: "TaskState", *, resumed: bool = False) -> None:
    """Drive a single task (foreground or background) to completion.

    Phase 9.4a — sets the track ContextVar on entry so every
    `runtime._broadcast` / `set_substate` downstream routes correctly. For
    background tasks, wraps the core loop in a wall-clock timeout governed
    by `state.timeout_s` (per-task override) or
    `config.agent_background_task_timeout_s` (default 300s).
    """
    from config import config as _cfg
    from .runtime import current_track as _track_cv
    token = _track_cv.set(state.track)
    try:
        if state.track == "background":
            timeout_s = int(
                state.timeout_s
                if state.timeout_s is not None
                else getattr(_cfg, "agent_background_task_timeout_s", 300) or 300
            )
            try:
                await asyncio.wait_for(
                    _run_task_loop_impl(runtime, state, resumed=resumed),
                    timeout=timeout_s,
                )
            except asyncio.TimeoutError:
                logger.info(
                    "background task %s exceeded timeout_s=%d — finalizing",
                    state.id[:8], timeout_s,
                )
                with contextlib.suppress(Exception):
                    await runtime.finalize_task(
                        state, "timeout",
                        summary=f"background task exceeded {timeout_s}s timeout",
                        error="background_timeout",
                    )
        else:
            await _run_task_loop_impl(runtime, state, resumed=resumed)
    finally:
        _track_cv.reset(token)


async def _run_task_loop_impl(runtime: "AgentRuntime", state: "TaskState", *, resumed: bool = False) -> None:
    """Actual ReAct + Reflect + Checkpoint orchestration. Extracted from
    run_task_loop so the background-track timeout can wrap it cleanly."""
    budget = TaskBudget()
    state.status = "running"
    await update_task_status(state.id, "running")
    await runtime._broadcast("task.started", {
        "task_id": state.id, "goal": state.goal, "track": state.track,
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
                    # Phase 17 — consult the Council before re-planning so the
                    # revise_note carries cross-perspective input. The hook is
                    # no-op when mode picker says 'single' or LLM is offline
                    # (deterministic personas still produce a usable consensus).
                    council_decision = await maybe_consult_council(
                        CouncilSituation(
                            kind="strategic_revise",
                            task_id=state.id,
                            summary=(ref.summary or ref.recommendations or "Перегляд стратегії")[:600],
                            context={"recommendations": ref.recommendations or ""},
                        ),
                        runtime=runtime,
                    )
                    revise_note = ref.recommendations or ""
                    if council_decision is not None and council_decision.consensus_summary:
                        revise_note = (
                            (revise_note + "\n\nConsensus: " + council_decision.consensus_summary[:300]).strip()
                        )
                    if not await _ensure_strategic_plan(runtime, state, revise_note=revise_note):
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
                    task_id=state.id,
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
            # Phase 9.3b — emit inner monologue for the step's thinking.
            try:
                from .monologue_emitter import MonologueEvent, emit_monologue
                await emit_monologue(MonologueEvent(
                    kind="plan",
                    source="tactical",
                    monologue=step.monologue.model_dump(mode="json"),
                    task_id=state.id,
                ))
            except Exception as exc:
                logger.debug("monologue emit (tactical) failed: %s", exc)

            # Terminal markers ───────────────────────────────────────────────────
            if step.action == _TERMINAL_DONE_TASK:
                summary = str(step.args.get("summary") or "task complete")
                # Phase 17a.6 — Quality Gate before declaring done. Producer
                # is single-pass (returns the artefact as-is) — we use the
                # gate purely as a *checkpoint*: if blockers exist we record
                # the critique as an observation and force a reflection,
                # giving the reflector enough context to either revise the
                # strategy or ship a cleaner DONE_TASK on the next round.
                # This is what "довести до кінцевого результату" looks like
                # in practice: the agent never finalises on a draft that
                # fails its own checklist.
                #
                # Bounded by `_QUALITY_GATE_MAX_FAILURES` so a stubborn
                # critic never wedges the loop. After N strikes we accept
                # the artefact with a caveat WS warning.
                artefact = str(step.args.get("artefact") or summary)
                artefact_kind = str(step.args.get("artefact_kind") or "text")
                if artefact_kind not in {"text", "code", "document", "plan", "message"}:
                    artefact_kind = "text"
                acceptance = "\n".join(
                    sg.acceptance_criteria
                    for sg in state.sub_goals
                    if sg.acceptance_criteria
                ).strip() or state.goal

                # Producer with real revise loop. First call returns the
                # original draft; subsequent calls regenerate the artefact
                # via the LLM using the previous critique as feedback. This
                # is what "доводити до кінцевого результату" looks like at
                # the artefact level — not just "block on blockers", but
                # actively rewrite the draft to address them.
                #
                # Code artefacts need planner+actions to regenerate (that
                # path stays through the reflection cycle below); text /
                # document / message / plan kinds are pure-LLM rewrites.
                async def _gate_producer(
                    prev: GateDraft | None, crit
                ) -> GateDraft:
                    if prev is None or crit is None or not getattr(crit, "has_blockers", False):
                        return GateDraft(
                            text=artefact,
                            metadata={"step_idx": step.step_idx, "summary": summary},
                        )
                    if artefact_kind == "code":
                        # Code revisions need planner re-entry — skip LLM
                        # rewrite, fall through to reflection-driven retry.
                        return GateDraft(
                            text=prev.text,
                            metadata={"skipped_revise": "code_kind"},
                        )
                    try:
                        from ai.provider import ai_router as _ar
                        blocker_lines = "\n".join(
                            f"- {i.message}"
                            for i in crit.issues
                            if i.severity == "blocker"
                        )
                        revise_prompt = (
                            f"Чернетка артефакту для цілі '{state.goal[:300]}'. "
                            f"Рецензент знайшов блокери:\n{blocker_lines}\n\n"
                            f"ПОПЕРЕДНЯ ЧЕРНЕТКА:\n{prev.text[:3000]}\n\n"
                            "Перепиши повністю — виправ КОЖЕН блокер. "
                            "Поверни ЛИШЕ новий текст без коментарів і без "
                            "обгорток на кшталт '```'."
                        )
                        response = await asyncio.wait_for(
                            _ar.generate(
                                user_message=revise_prompt,
                                system_prompt=(
                                    "Ти асистент який виправляє чернетку "
                                    "згідно зауважень рецензента. Поверни "
                                    "лише виправлений текст."
                                ),
                                history=[],
                                task_id=state.id,
                            ),
                            timeout=20.0,
                        )
                        new_text = (response.content or "").strip()
                        if new_text.startswith("```"):
                            new_text = new_text.strip("` \n")
                        if not new_text:
                            return GateDraft(
                                text=prev.text,
                                metadata={"regen_failed": "empty"},
                            )
                        return GateDraft(
                            text=new_text,
                            metadata={
                                "regenerated": True,
                                "critique_addressed": sum(
                                    1
                                    for i in crit.issues
                                    if i.severity == "blocker"
                                ),
                            },
                        )
                    except Exception as exc:
                        logger.debug("quality_gate revise failed: %s", exc)
                        return GateDraft(
                            text=prev.text,
                            metadata={"regen_failed": str(exc)[:120]},
                        )

                try:
                    gate_result = await run_quality_gate_for(
                        intent=state.goal,
                        acceptance_criteria=acceptance,
                        producer=_gate_producer,
                        runtime=runtime,
                        artefact_kind=artefact_kind,
                        task_id=state.id,
                        # Up to 3 rounds: original → revised → re-revised.
                        # Each round of LLM revision is bounded above by
                        # the producer's own 20s timeout, so worst-case
                        # gate latency is ~60s for text artefacts.
                        max_revisions=3,
                    )
                except Exception as exc:
                    # Gate is best-effort — never block finalisation on its
                    # own bug. Log + proceed as if it passed.
                    logger.debug("quality_gate errored, accepting draft: %s", exc)
                    gate_result = None

                # If the producer revised the artefact and the final critique
                # is clean, ship the regenerated text — that's the whole
                # point of the revise loop. Without this, the gate could
                # spin three rounds, polish the draft, then `finalize_task`
                # would still ship the original sloppy version.
                if (
                    gate_result is not None
                    and gate_result.passed
                    and gate_result.final_draft.text
                    and gate_result.final_draft.text != artefact
                ):
                    new_text = gate_result.final_draft.text
                    await runtime._broadcast(
                        "quality_gate.regenerated",
                        {
                            "task_id": state.id,
                            "rounds": gate_result.rounds_used,
                            "artefact_kind": artefact_kind,
                            "excerpt": new_text[:240],
                        },
                    )
                    # If the planner didn't pass a separate artefact arg,
                    # the regenerated text IS the new summary the operator
                    # will see in the report. Otherwise we keep the short
                    # summary intact and surface the regenerated artefact
                    # via the broadcast above.
                    if artefact == summary:
                        summary = new_text
                    artefact = new_text

                if (
                    gate_result is not None
                    and not gate_result.passed
                    and gate_result.final_critique.has_blockers
                ):
                    state.quality_gate_failures += 1
                    blocker_msgs = [
                        i.message
                        for i in gate_result.final_critique.issues
                        if i.severity == "blocker"
                    ]
                    crit_msg = (
                        "Quality gate blocked task completion ("
                        f"strike {state.quality_gate_failures}/"
                        f"{_QUALITY_GATE_MAX_FAILURES}):\n- "
                        + "\n- ".join(blocker_msgs)
                    )
                    state.observations.append(
                        build_system(state.step_idx, "quality_gate", crit_msg)
                    )
                    await runtime._broadcast(
                        "quality_gate.blocked",
                        {
                            "task_id": state.id,
                            "blockers": blocker_msgs,
                            "strike": state.quality_gate_failures,
                            "max_strikes": _QUALITY_GATE_MAX_FAILURES,
                        },
                    )

                    if state.quality_gate_failures < _QUALITY_GATE_MAX_FAILURES:
                        # Phase 17 — consult Council on the critique so a
                        # second perspective shapes the revise_note. The
                        # mode picker stays the gate; offline → deterministic
                        # personas already produce a usable consensus.
                        revise_note = crit_msg
                        try:
                            council_decision = await maybe_consult_council(
                                CouncilSituation(
                                    kind="quality_gate",
                                    task_id=state.id,
                                    summary=crit_msg[:600],
                                    context={
                                        "blockers": blocker_msgs,
                                        "summary": summary,
                                        "artefact_excerpt": artefact[:1000],
                                    },
                                ),
                                runtime=runtime,
                            )
                            if (
                                council_decision is not None
                                and council_decision.consensus_summary
                            ):
                                revise_note = (
                                    revise_note
                                    + "\n\nConsensus: "
                                    + council_decision.consensus_summary[:300]
                                ).strip()
                        except Exception as exc:
                            logger.debug("council on quality_gate failed: %s", exc)

                        ref = await _run_reflection(
                            runtime, state, "quality_gate_failed"
                        )
                        if ref.verdict == "abandon_task":
                            await runtime.finalize_task(
                                state, "failed",
                                summary=ref.summary,
                                error="quality_gate_abandon",
                            )
                            return
                        if ref.verdict == "revise_strategy":
                            if not await _ensure_strategic_plan(
                                runtime, state, revise_note=revise_note,
                            ):
                                return
                            actions_in_subgoal = 0
                        # Re-open completion: drop the failed DONE_TASK,
                        # let the loop pick up where reflection left it.
                        state.step_idx += 1
                        continue

                    # Strike cap reached — finalise with a caveat warning so
                    # downstream reports surface that the gate didn't pass.
                    await runtime._broadcast(
                        "warning.issued",
                        {
                            "task_id": state.id,
                            "category": "quality_gate_exhausted",
                            "message": (
                                "Quality gate failed "
                                f"{state.quality_gate_failures} times — "
                                "finalising with caveat."
                            ),
                        },
                    )
                    summary = f"{summary}\n\n⚠ quality gate caveat: " + "; ".join(
                        blocker_msgs
                    )

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

            # Phase 9.2.1 — repeat-action detection.
            # Skip terminal markers (DONE_*/REFLECT) since their summary text
            # changes per call but their action name is constant.
            if step.action not in {_TERMINAL_DONE_TASK, _TERMINAL_DONE_SUBGOAL, "REFLECT"}:
                repeat_key = _canonical_args_key(step.action, step.args)
                step_repeat_key = repeat_key  # threaded into actions_log below
                prior_failures = _count_recent_failed_repeats(state, repeat_key)
                if prior_failures >= _REPEAT_ABANDON_AT - 1:  # 3rd attempt would be repeat
                    state.observations.append(build_system(
                        state.step_idx, "repeat_guard",
                        f"abandoning sub-goal: action {step.action} repeated {prior_failures + 1} "
                        f"times with no progress (repeated_action_no_progress)",
                    ))
                    current_sg.status = "failed"
                    actions_in_subgoal = 0
                    state.step_idx += 1
                    await runtime._broadcast("sub_goal.abandoned", {
                        "task_id": state.id, "sub_goal_id": current_sg.id,
                        "reason": "repeated_action_no_progress",
                    })
                    continue
                if prior_failures >= _REPEAT_FORCE_REFLECT_AT - 1:  # 2nd attempt about to repeat
                    state.observations.append(build_system(
                        state.step_idx, "repeat_guard",
                        f"forcing reflection: action {step.action} repeated "
                        f"{prior_failures + 1} times within last {_REPEAT_LOOKBACK} steps",
                    ))
                    ref = await _run_reflection(runtime, state, "repeated_action_no_progress")
                    if ref.verdict == "abandon_task":
                        await runtime.finalize_task(state, "failed", summary=ref.summary, error="repeated_action_no_progress")
                        return
                    # Drop the planner's (likely-repeat) step and replan next iteration.
                    state.step_idx += 1
                    continue
            else:
                step_repeat_key = None

            # Risk-tolerance preview — let the loop block before executor wastes
            # the action attempt + audit row when the LLM picked too risky.
            from .actions.registry import registry as _reg
            cls = _reg.get(step.action)
            if cls and int(cls.risk_level) > int(config.agent_risk_tolerance):
                # Phase 23-D — consult Council BEFORE the operator is asked.
                # The deliberation can refuse a destructive ask outright
                # ("abort"/"revise") so the operator never sees a prompt for
                # something cross-perspective review already rejected.
                # "ask_user"/"proceed" verdicts (or council disabled) fall
                # through to the existing phone/desktop approval path.
                if bool(getattr(config, "agent_council_for_high_risk", True)):
                    try:
                        action_args = getattr(step, "args", {}) or {}
                        council_decision = await maybe_consult_council(
                            CouncilSituation(
                                kind="high_risk_action",
                                task_id=state.id,
                                summary=(
                                    f"Risky action '{step.action}' (risk "
                                    f"{int(cls.risk_level)} > tolerance "
                                    f"{int(config.agent_risk_tolerance)}). "
                                    f"Intent: {(step.intent or '')[:200]}"
                                ),
                                proposed_action={
                                    "action": step.action,
                                    "args": action_args,
                                    "risk_level": int(cls.risk_level),
                                },
                                step_idx=state.step_idx,
                            ),
                            runtime=runtime,
                        )
                    except Exception as exc:
                        logger.debug("council on high_risk_action failed: %s", exc)
                        council_decision = None
                    if council_decision is not None and council_decision.verdict in {"abort", "revise"}:
                        consensus = (council_decision.consensus_summary or "").strip()
                        state.observations.append(build_system(
                            state.step_idx, "council_block",
                            f"Council {council_decision.verdict}ed risky action "
                            f"{step.action}"
                            + (f": {consensus[:240]}" if consensus else ""),
                        ))
                        await runtime._broadcast("warning.issued", {
                            "task_id": state.id,
                            "category": "council_blocked_risky",
                            "message": (
                                f"Council {council_decision.verdict}ed "
                                f"{step.action}"
                            ),
                        })
                        # Drop the offending step. "revise" lets the
                        # tactical planner pick a different action next
                        # iteration; "abort" is treated identically here
                        # (planner-level abort is handled by reflector).
                        state.status = "running"
                        await update_task_status(state.id, "running")
                        state.step_idx += 1
                        continue
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
                # Phase 19 — try the paired phone FIRST. The phone path is
                # the operator's intended approval surface (biometric +
                # signed verdict); the desktop intervene flow remains as a
                # fall-through when no phone is paired or the phone times
                # out / is offline. 'approved' / 'denied' from the phone
                # short-circuits the existing intervention_queue wait —
                # 'timeout' / 'no_device' lets execution continue to the
                # desktop loop below as if the phone never existed.
                phone_verdict = "no_device"
                try:
                    from .approve_on_phone import request_phone_approval

                    phone_timeout_s = float(
                        getattr(config, "agent_phone_approval_timeout_s", 90.0)
                        or 90.0
                    )
                    phone_verdict = await request_phone_approval(
                        task_id=state.id,
                        action_name=step.action,
                        risk_level=int(cls.risk_level),
                        summary=(
                            f"{step.action} above tolerance "
                            f"{config.agent_risk_tolerance}"
                        ),
                        payload={"args": getattr(step, "args", {})},
                        timeout_s=phone_timeout_s,
                        broadcast=runtime._broadcast,
                    )
                except Exception as exc:
                    # Approve-on-phone is best-effort: any failure here
                    # MUST NOT prevent the existing desktop intervene flow.
                    logger.debug("approve_on_phone errored, falling back: %s", exc)
                    phone_verdict = "no_device"
                if phone_verdict == "approved":
                    state.observations.append(build_user(
                        state.step_idx, "approve (phone)"
                    ))
                    state.status = "running"
                    await update_task_status(state.id, "running")
                    # Fall through to execution — skip desktop intervene wait.
                elif phone_verdict == "denied":
                    state.observations.append(build_system(
                        state.step_idx, "consent",
                        f"phone-rejected risky action {step.action}",
                    ))
                    state.status = "running"
                    await update_task_status(state.id, "running")
                    state.step_idx += 1
                    continue
                else:
                    # No paired device or phone timed out → fall back to the
                    # desktop intervene queue. Phase 9.2.3 (F-17) bounded so
                    # the task doesn't hang forever if the operator walks
                    # away from BOTH the phone and the desktop.
                    consent_timeout = float(getattr(config, "agent_user_consent_timeout_s", 300) or 300)
                    try:
                        inter = await asyncio.wait_for(
                            runtime.controls.intervention_queue.get(),
                            timeout=consent_timeout,
                        )
                    except asyncio.TimeoutError:
                        state.observations.append(build_system(
                            state.step_idx, "consent_timeout",
                            f"user did not respond within {int(consent_timeout)}s; "
                            f"rejecting risky action {step.action}",
                        ))
                        await runtime._broadcast("warning.issued", {
                            "task_id": state.id,
                            "category": "consent_timeout",
                            "message": f"consent request for {step.action} timed out",
                        })
                        state.status = "running"
                        await update_task_status(state.id, "running")
                        state.step_idx += 1
                        continue
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
                "repeat_key": step_repeat_key,
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
                    # Phase 9.2.3 (F-17): bounded wait — timing out surfaces a
                    # system observation and returns the loop to running so
                    # the planner can choose an alternative rather than hang.
                    consent_timeout = float(getattr(config, "agent_user_consent_timeout_s", 300) or 300)
                    try:
                        inter = await asyncio.wait_for(
                            runtime.controls.intervention_queue.get(),
                            timeout=consent_timeout,
                        )
                        state.observations.append(build_user(state.step_idx, inter))
                    except asyncio.TimeoutError:
                        state.observations.append(build_system(
                            state.step_idx, "consent_timeout",
                            f"precondition ask_user timed out after {int(consent_timeout)}s",
                        ))
                        await runtime._broadcast("warning.issued", {
                            "task_id": state.id,
                            "category": "consent_timeout",
                            "message": "ask_user precondition timed out",
                        })
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
