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
from dataclasses import dataclass
from enum import Enum
from typing import TYPE_CHECKING

from config import config

from agent.kernel.audit import persist_task_state, save_checkpoint, snapshot_task_state, update_task_status, write_auto_approval
from agent.kernel.checkpoints import build as build_checkpoint
from agent.kernel.errors import BackgroundTimeoutError
from agent.kernel.executor import StepCancelled, TaskStopped, execute as execute_action
from agent.actions.base import ActionContext as Ctx
from agent.cognition.observations import (
    build_from_action_result,
    build_reflection,
    build_system,
    build_user,
)
from agent.cognition.planner import reflector as reflector_mod
from agent.cognition.planner import strategic, tactical
from agent.cognition.planner._llm import BlockedQuotaError, PlannerLLMError
from agent.cognition.planner.phase import plan_phase
from agent.operations.safety.circuit_breakers import TaskBudget, evaluate as evaluate_breaker
from agent.schemas import (
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
from agent.operations.orchestrator import maybe_consult_council
from agent.operations.orchestrator.quality_gate import GateDraft
from agent.operations.orchestrator.runtime_hooks import run_quality_gate_for

if TYPE_CHECKING:
    from agent.kernel.runtime import AgentRuntime, TaskState

logger = logging.getLogger(__name__)


_TERMINAL_DONE_TASK = "DONE_TASK"
_TERMINAL_DONE_SUBGOAL = "DONE_SUBGOAL"


class RevisionLoopGuard:
    """Per-task counter that detects identical revise_strategy verdicts on
    the same step_idx. Used by the main loop to auto-pause a task that
    cannot make forward progress (commonly: provider returns 400 on every
    tool call, reflector keeps recommending revise_strategy).

    The guard observes ``(step_idx, verdict)`` tuples. When the same
    ``revise_strategy`` is observed on the same ``step_idx`` ``threshold``
    times in a row, ``should_pause()`` returns True and the loop is
    expected to call ``runtime.pause(task_id, reason='auto_reflect_loop')``.
    """

    def __init__(self, threshold: int = 3) -> None:
        self.threshold = threshold
        self._count = 0
        self._last_step: int | None = None
        self._last_verdict: str | None = None

    def observe(self, *, step_idx: int, verdict: str) -> int:
        """Record a verdict. Returns current consecutive-count (0 if reset)."""
        if (
            verdict == "revise_strategy"
            and step_idx == self._last_step
            and verdict == self._last_verdict
        ):
            self._count += 1
        elif verdict == "revise_strategy":
            self._count = 1
        else:
            self._count = 0
        self._last_step = step_idx
        self._last_verdict = verdict
        return self._count

    def should_pause(self, count: int) -> bool:
        return count >= self.threshold

    def reset(self) -> None:
        self._count = 0
        self._last_step = None
        self._last_verdict = None


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
    cp_id = await save_checkpoint(state.user_id, cp)
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
                user_id=state.user_id,
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
    # Phase 28-IDEAL — broadcast architectural decisions and requirements.
    await runtime._broadcast("plan.architectural_decision", {
        "task_id": state.id,
        "rationale": plan.architectural_rationale,
        "required_capabilities": plan.required_capabilities,
    })
    if plan.architectural_rationale:
        state.observations.append(build_system(
            state.step_idx, "architect", f"ARCHITECTURAL_DECISION: {plan.architectural_rationale}"
        ))

    # Phase 32.1 — Surface the plan to the user in the activity stream
    plan_text = "СТРАТЕГІЧНИЙ ПЛАН ВИКОНАННЯ:\n"
    for i, sg in enumerate(plan.sub_goals, 1):
        plan_text += f"{i}. {sg.description}\n"
    state.observations.append(build_system(
        state.step_idx, "planner", plan_text
    ))

    state.sub_goals = plan.sub_goals

    state.thought_budget = ThoughtBudget(
        estimated_actions=max(plan.estimated_total_actions, sum(sg.expected_actions for sg in plan.sub_goals)),
        actions_used=state.thought_budget.actions_used,
        force_reflect_ratio=config.agent_thought_budget_force_reflect_ratio,
        reflections_done=state.thought_budget.reflections_done,
    )

    # Phase 28-IDEAL — Extreme Professionalism: ADR and Dependencies.
    await _proactive_operational_setup(runtime, state, plan)

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


async def _prune_and_compress_state(runtime: "AgentRuntime", state: "TaskState") -> None:
    """Phase 28-IDEAL — Compress oldest observations into a single summary.
    
    Keeps the last 15 observations intact; summarizes everything before that.
    """
    if len(state.observations) <= 25:
        return

    to_compress = state.observations[:-15]
    remaining = state.observations[-15:]
    
    logger.info("agent-kernel: compressing %d observations for task %s", len(to_compress), state.id)
    
    try:
        from ai.provider import ai_router
        from agent.cognition.observations import format_for_llm, build_system
        
        obs_text = format_for_llm(to_compress, limit=100)
        prompt = (
            "Ти — архіватор пам'яті PHANTOM. Нижче наведено хронологічний лог дій та результатів. "
            "Стисни його у 2-3 речення: що було зроблено, які ключові результати досягнуто, "
            "і які помилки були виявлені. Збережи технічні деталі (шляхи, команди) якщо вони критичні.\n\n"
            f"ЛОГ ДЛЯ СТИСНЕННЯ:\n{obs_text}\n\n"
            "ПОВЕРНИ ЛИШЕ СТИСЛИЙ ПІДСУМОК (без вступу)."
        )
        
        response = await ai_router.generate(
            user_message=prompt,
            system_prompt="Ти стискаєш історію спостережень агента для економії контексту.",
            history=[],
            task_id=state.id,
        )
        
        summary = response.content.strip()
        if not summary:
            summary = "(стиснення не вдалося — порожня відповідь)"
            
        historical_obs = build_system(
            to_compress[-1].step_idx, 
            "HISTORICAL_MEMORY", 
            f"АРХІВНА ДОВІДКА (кроки 0-{to_compress[-1].step_idx}): {summary}"
        )
        
        # Replace old obs with the compressed one
        state.observations = [historical_obs] + remaining
        
        await runtime._broadcast("system.memory_compressed", {
            "task_id": state.id,
            "compressed_count": len(to_compress),
            "summary_excerpt": summary[:120],
        })
        
    except Exception as exc:
        logger.error("agent-kernel: state compression failed: %s", exc)


async def _proactive_operational_setup(runtime: "AgentRuntime", state: "TaskState", plan: StrategicPlan) -> None:
    """Phase 28-IDEAL — Extreme Professionalism.
    
    1. Fulfill technical dependencies (apt/pip).
    2. Commit ADR (Architectural Decision Record) to Git.
    """
    if plan.required_capabilities:
        await _fulfill_dependencies(runtime, state, plan.required_capabilities)
        
    if plan.architectural_rationale:
        await _commit_architectural_decision(runtime, state, plan)


async def _fulfill_dependencies(runtime: "AgentRuntime", state: "TaskState", caps: list[str]) -> None:
    """Check and install missing tools/libraries."""
    from agent.actions.bash import BashRun

    for cap in caps:
        logger.info("agent-kernel: fulfilling capability: %s", cap)
        # 1. Check if it's a binary
        # `unsafe_mode` reads from the task, never a literal: this path runs
        # `sudo apt-get install` below, so hardcoding True here silently
        # ignored an operator who had the shield ON for this very task.
        ctx = Ctx(task_id=state.id, step_idx=state.step_idx, workspace_dir=config.agent_workspace_dir, runtime=runtime, unsafe_mode=state.unsafe_mode)
        res = await BashRun(cmd=f"which {cap} || pip show {cap}").execute(ctx)
        
        if res.output and res.output.get("command_success"):
            logger.debug("agent-kernel: capability %s already satisfied", cap)
            continue
            
        # 2. Attempt install
        install_cmd = f"sudo apt-get install -y {cap} || pip install {cap}"
        logger.info("agent-kernel: installing missing capability: %s", cap)
        await runtime._broadcast("system.install_dependency", {"task_id": state.id, "dependency": cap})
        
        res = await BashRun(cmd=install_cmd).execute(ctx)
        if res.output and res.output.get("command_success"):
            state.observations.append(build_system(state.step_idx, "setup", f"Installed missing capability: {cap}"))
        else:
            state.observations.append(build_system(
                state.step_idx, "setup", 
                f"WARNING: Failed to install capability {cap}. Stderr: {res.output.get('stderr') if res.output else 'unknown'}"
            ))


async def _commit_architectural_decision(runtime: "AgentRuntime", state: "TaskState", plan: StrategicPlan) -> None:
    """Document and commit the architectural rationale to docs/adr/."""
    from agent.actions.fs import FsWrite
    from agent.actions.bash import BashRun
    import os
    
    adr_dir = "docs/adr"
    adr_path = f"{adr_dir}/task_{state.id[:8]}.md"
    
    content = f"# Architectural Decision: {state.goal[:100]}\n\n"
    content += f"- **Task ID:** {state.id}\n"
    content += f"- **Date:** {getattr(state, 'started_at_iso', 'unknown')}\n\n"
    content += "## Rationale\n"
    content += f"{plan.architectural_rationale}\n\n"
    content += "## Required Capabilities\n"
    for cap in plan.required_capabilities:
        content += f"- {cap}\n"
        
    ctx = Ctx(task_id=state.id, step_idx=state.step_idx, workspace_dir=config.agent_workspace_dir, runtime=runtime, unsafe_mode=state.unsafe_mode)

    # 1. Create dir and write file
    await BashRun(cmd=f"mkdir -p {adr_dir}").execute(ctx)
    await FsWrite(path=adr_path, content=content).execute(ctx)
    
    # 2. Commit to git
    commit_cmd = f"git add {adr_path} && git commit -m \"docs(adr): document strategy for {state.id[:8]}\""
    await BashRun(cmd=commit_cmd).execute(ctx)
    
    logger.info("agent-kernel: committed ADR to %s", adr_path)


class _GateVerdict(str, Enum):
    ACCEPT = "accept"
    REOPEN = "reopen"
    FINISHED = "finished"


@dataclass(slots=True)
class _GateOutcome:
    verdict: _GateVerdict
    summary: str = ""
    reset_actions: bool = False


async def _revise_draft(
    state: "TaskState",
    *,
    artefact: str,
    artefact_kind: str,
    summary: str,
    step_idx: int,
    prev: GateDraft | None,
    crit,
) -> GateDraft:
    """Regenerate the draft against the critic's blockers; code kinds fall
    through to the reflection-driven retry instead."""
    if prev is None or crit is None or not getattr(crit, "has_blockers", False):
        return GateDraft(text=artefact, metadata={"step_idx": step_idx, "summary": summary})
    if artefact_kind == "code":
        return GateDraft(text=prev.text, metadata={"skipped_revise": "code_kind"})
    try:
        from ai.provider import ai_router as _ar
        blocker_lines = "\n".join(
            f"- {i.message}" for i in crit.issues if i.severity == "blocker"
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
                    "Ти асистент який виправляє чернетку згідно зауважень "
                    "рецензента. Поверни лише виправлений текст."
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
            return GateDraft(text=prev.text, metadata={"regen_failed": "empty"})
        return GateDraft(
            text=new_text,
            metadata={
                "regenerated": True,
                "critique_addressed": sum(
                    1 for i in crit.issues if i.severity == "blocker"
                ),
            },
        )
    except Exception as exc:
        logger.debug("quality_gate revise failed: %s", exc)
        return GateDraft(text=prev.text, metadata={"regen_failed": str(exc)[:120]})


async def _run_completion_gate(
    runtime: "AgentRuntime",
    state: "TaskState",
    step,
    *,
    check_revise_loop,
) -> _GateOutcome:
    """Decide whether a DONE_TASK may finish the task.

    ACCEPT carries the summary to finalise with, REOPEN drops this DONE_TASK
    and keeps looping, FINISHED means the task is already finalised.
    """
    summary = str(step.args.get("summary") or "task complete")
    artefact = str(step.args.get("artefact") or summary)
    artefact_kind = str(step.args.get("artefact_kind") or "text")
    if artefact_kind not in {"text", "code", "document", "plan", "message"}:
        artefact_kind = "text"
    acceptance = "\n".join(
        sg.acceptance_criteria for sg in state.sub_goals if sg.acceptance_criteria
    ).strip() or state.goal

    async def producer(prev: GateDraft | None, crit) -> GateDraft:
        return await _revise_draft(
            state,
            artefact=artefact,
            artefact_kind=artefact_kind,
            summary=summary,
            step_idx=step.step_idx,
            prev=prev,
            crit=crit,
        )

    try:
        # 3 rounds x the producer's 20s timeout = ~60s worst case.
        gate_result = await run_quality_gate_for(
            intent=state.goal,
            acceptance_criteria=acceptance,
            producer=producer,
            runtime=runtime,
            artefact_kind=artefact_kind,
            task_id=state.id,
            max_revisions=3,
        )
    except Exception as exc:
        # Never block finalisation on the gate's own bug.
        logger.debug("quality_gate errored, accepting draft: %s", exc)
        gate_result = None

    # Ship what the revise loop produced, not the original draft.
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
        if artefact == summary:
            summary = new_text
        artefact = new_text

    blocked = (
        gate_result is not None
        and not gate_result.passed
        and gate_result.final_critique.has_blockers
    )
    if not blocked:
        return _GateOutcome(_GateVerdict.ACCEPT, summary=summary)

    state.quality_gate_failures += 1
    blocker_msgs = [
        i.message for i in gate_result.final_critique.issues if i.severity == "blocker"
    ]
    crit_msg = (
        "Quality gate blocked task completion ("
        f"strike {state.quality_gate_failures}/{_QUALITY_GATE_MAX_FAILURES}):\n- "
        + "\n- ".join(blocker_msgs)
    )
    state.observations.append(build_system(state.step_idx, "quality_gate", crit_msg))
    await runtime._broadcast(
        "quality_gate.blocked",
        {
            "task_id": state.id,
            "blockers": blocker_msgs,
            "strike": state.quality_gate_failures,
            "max_strikes": _QUALITY_GATE_MAX_FAILURES,
        },
    )

    if state.quality_gate_failures >= _QUALITY_GATE_MAX_FAILURES:
        # Cap reached — finalise with a caveat.
        await runtime._broadcast(
            "warning.issued",
            {
                "task_id": state.id,
                "category": "quality_gate_exhausted",
                "message": (
                    f"Quality gate failed {state.quality_gate_failures} times — "
                    "finalising with caveat."
                ),
            },
        )
        summary = f"{summary}\n\n⚠ quality gate caveat: " + "; ".join(blocker_msgs)
        return _GateOutcome(_GateVerdict.ACCEPT, summary=summary)

    revise_note = await _council_note_on_critique(
        runtime, state, crit_msg=crit_msg, blocker_msgs=blocker_msgs,
        summary=summary, artefact=artefact,
    )

    ref = await _run_reflection(runtime, state, "quality_gate_failed")
    if ref.verdict == "abandon_task":
        await runtime.finalize_task(
            state, "failed", summary=ref.summary, error="quality_gate_abandon",
        )
        return _GateOutcome(_GateVerdict.FINISHED)

    reset_actions = False
    if ref.verdict == "revise_strategy":
        if await check_revise_loop(ref.verdict):
            return _GateOutcome(_GateVerdict.FINISHED)
        if not await _ensure_strategic_plan(runtime, state, revise_note=revise_note):
            return _GateOutcome(_GateVerdict.FINISHED)
        reset_actions = True

    state.step_idx += 1
    return _GateOutcome(_GateVerdict.REOPEN, reset_actions=reset_actions)


async def _council_note_on_critique(
    runtime: "AgentRuntime",
    state: "TaskState",
    *,
    crit_msg: str,
    blocker_msgs: list[str],
    summary: str,
    artefact: str,
) -> str:
    """Let the Council shape the revise note."""
    revise_note = crit_msg
    try:
        with contextlib.suppress(Exception):
            await snapshot_task_state(state)
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
        if council_decision is not None and council_decision.consensus_summary:
            revise_note = (
                revise_note + "\n\nConsensus: "
                + council_decision.consensus_summary[:300]
            ).strip()
    except Exception as exc:
        logger.debug("council on quality_gate failed: %s", exc)
    return revise_note


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
                self_model=state.self_model, # Pass SelfModel
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
    
    if result.verdict == "revise_strategy":
        # Phase 28-STABILITY — record this dead end.
        dead_end_summary = f"Reflector identified strategy failure: {result.summary}"
        if result.recurring_errors:
            dead_end_summary += f" Recurring errors: {', '.join(result.recurring_errors)}"
        if dead_end_summary not in state.self_model.dead_ends:
            state.self_model.dead_ends.append(dead_end_summary)
            state.self_model.dead_ends = state.self_model.dead_ends[-10:]

    state.thought_budget = ThoughtBudget(
        estimated_actions=state.thought_budget.estimated_actions,
        actions_used=state.thought_budget.actions_used,
        force_reflect_ratio=state.thought_budget.force_reflect_ratio,
        reflections_done=state.thought_budget.reflections_done + 1,
    )
    
    # Phase 28-STABILITY — include recommendations in the observation so the 
    # planner can actually follow them.
    obs_text = f"РЕФЛЕКСІЯ: {result.summary or '(reflection)'}"
    if result.recommendations:
        obs_text += f"\nПОРАДИ: {result.recommendations}"
    
    state.observations.append(build_reflection(state.step_idx, obs_text))

    await runtime._broadcast("reflection.completed", {
        "task_id": state.id,
        "verdict": result.verdict,
        "summary": result.summary,
        "new_confidence": result.new_confidence,
    })
    # Phase 9.3b — emit inner monologue on reflection completion.
    try:
        from agent.cognition.monologue_emitter import MonologueEvent, emit_monologue
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
    from agent.kernel.runtime import current_task_id as _task_cv, current_track as _track_cv
    token = _track_cv.set(state.track)
    id_token = _task_cv.set(state.id)
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
        # `reset()` raises ValueError when the token came from a different
        # Context. That happens here because the background branch wraps the
        # body in `asyncio.wait_for`, which runs it in a child Task with a
        # *copy* of the context. The raise escaped this `finally`, so
        # `run_task_loop` never returned normally and the task sat pending
        # forever — the runtime's `task_runner` was never cleared.
        # These vars are context-local; an unreset value dies with its context.
        for _var, _tok in ((_track_cv, token), (_task_cv, id_token)):
            try:
                _var.reset(_tok)
            except ValueError:
                pass


async def _run_task_loop_impl(runtime: "AgentRuntime", state: "TaskState", *, resumed: bool = False) -> None:
    """Actual ReAct + Reflect + Checkpoint orchestration. Extracted from
    run_task_loop so the background-track timeout can wrap it cleanly.

    Block C-2 — Mission guard (LOW-RISK approach):
    When state.mission_id is set, delegate IMMEDIATELY to run_mission_loop().
    The legacy path below is entirely untouched for non-mission tasks.
    """
    logger.debug(
        "loop entry: task_id=%s goal=%r resumed=%s mission=%s",
        state.id, state.goal, resumed, getattr(state, "mission_id", None),
    )
    # ── Block C-2 mission path ─────────────────────────────────────────────────
    if getattr(state, "mission_id", None) is not None:
        await run_mission_loop(runtime, state)
        return
    # ── Legacy flat-task path (unchanged) ────────────────────────────────────
    budget = TaskBudget()
    state.status = "running"
    await update_task_status(state.id, "running")
    await runtime._broadcast("task.started", {
        "task_id": state.id, "goal": state.goal, "track": state.track,
        "self_model": state.self_model.model_dump(mode="json"),
        "resumed": resumed,
        "parent_task_id": state.parent_task_id,
        "subagent_role": state.subagent_role,
        "delegation_depth": state.delegation_depth,
    })

    try:
        # ── Strategic plan (skip on resume if we already have one) ────────────
        if not state.sub_goals:
            if not await _ensure_strategic_plan(runtime, state):
                return

        actions_in_subgoal = 0
        # Phase 32-TEST — the "you changed code but ran no tests" nudge fires
        # at most once per task; see the terminal-marker block below.
        test_hint_injected = False
        # Phase v3 — auto-pause guard for runaway revise_strategy loops
        # (e.g. provider 400 INVALID_ARGUMENT burning quota).
        revise_guard = RevisionLoopGuard(threshold=3)

        async def _check_revise_loop(verdict: str) -> bool:
            """Observe a reflection verdict; pause+return True if loop detected."""
            count = revise_guard.observe(step_idx=actions_in_subgoal, verdict=verdict)
            if revise_guard.should_pause(count):
                logger.warning(
                    "agent.loop: auto-pause after %d consecutive revise_strategy "
                    "at step %d for task %s — likely provider error loop",
                    count, actions_in_subgoal, state.id,
                )
                await runtime.pause(state.id, reason="auto_reflect_loop")
                await runtime._broadcast("task.paused", {
                    "task_id": state.id,
                    "reason": "auto_reflect_loop",
                    "count": count,
                })
                return True
            return False

        while True:
            # Pause gate
            if runtime.controls.pause_event.is_set():
                pause_reason = state.paused_reason or "user_paused"
                state.status = "paused"
                await update_task_status(state.id, "paused", paused_reason=pause_reason)
                await runtime.set_substate("paused")
                await runtime._broadcast("task.paused", {
                    "task_id": state.id, "reason": pause_reason,
                })
                await _checkpoint_now(runtime, state, "pause")
                await runtime.controls.wait_until_resumed()
                if runtime.controls.emergency_stop.is_set():
                    raise TaskStopped()
                state.status = "running"
                state.paused_reason = None
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
                    if await _check_revise_loop(ref.verdict):
                        return
                    # Phase 17 — consult the Council before re-planning so the
                    # revise_note carries cross-perspective input. The hook is
                    # no-op when mode picker says 'single' or LLM is offline
                    # (deterministic personas still produce a usable consensus).
                    # Block A-1 — snapshot before Council so a crash mid-deliberation
                    # restarts at the snapshot, not at the prior step.
                    with contextlib.suppress(Exception):
                        await snapshot_task_state(state)
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
                else:
                    # Verdict ≠ revise_strategy → reset the guard so the
                    # counter doesn't accumulate across unrelated cycles.
                    revise_guard.reset()
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
                    if await _check_revise_loop(ref.verdict):
                        return
                    if not await _ensure_strategic_plan(runtime, state, revise_note=ref.recommendations or ""):
                        return
                    actions_in_subgoal = 0
                    continue

            # Pick / advance to current sub-goal
            current_sg = _next_pending_subgoal(state)
            if current_sg is None:
                # All sub-goals done. We need the agent to formulate the final summary using DONE_TASK.
                if not any(sg.description.startswith("Сформувати фінальний звіт") for sg in state.sub_goals):
                    from agent.schemas import SubGoal
                    final_sg = SubGoal(
                        description="Сформувати фінальний звіт (DONE_TASK)",
                        rationale="Всі попередні кроки завершено. Надай користувачу фінальну відповідь з результатами виконання за допомогою дії DONE_TASK.",
                        expected_actions=1,
                        acceptance_criteria="Використана дія DONE_TASK з детальним summary.",
                        status="pending"
                    )
                    state.sub_goals.append(final_sg)
                    current_sg = final_sg
                else:
                    # Fallback if agent failed to use DONE_TASK on the final virtual subgoal
                    # If it used DONE_SUBGOAL instead, the last observation has the text.
                    summary = None
                    if state.observations and state.observations[-1].type == "sub_goal":
                        summary = state.observations[-1].content
                    
                    if not summary:
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

            # Phase 28-IDEAL — Semantic State Pruning.
            # Every 20 steps, compress old observations to keep context lean.
            if len(state.observations) > 30 and state.step_idx % 20 == 0:
                await _prune_and_compress_state(runtime, state)

            # Tactical planner — single next step
            await runtime.set_substate("thinking")
            await runtime._broadcast("thinking.started", {
                "task_id": state.id, "planner": "tactical", "step_idx": state.step_idx,
            })
            
            # Phase 28-STABILITY — if we just reflected, force the planner to read the advice.
            stricter_note = ""
            if state.last_reflection and state.last_reflection.recommendations:
                stricter_note = (
                    f"STRICT: Попередня рефлексія надала поради: {state.last_reflection.recommendations}. "
                    "ТИ МАЄШ СЛІДУВАТИ ЦИМ ПОРАДАМ ПОВНІСТЮ. НЕ ПОВТОРЮЙ ПОМИЛОК."
                )

            # Phase 28-STABILITY — small retry loop for tactical planner
            _tactical_retries = 0
            _max_tactical_retries = 2
            step = None
            
            while _tactical_retries <= _max_tactical_retries:
                try:
                    step = await tactical.plan(
                        step_idx=state.step_idx,
                        sub_goal=current_sg,
                        self_model=state.self_model,
                        observations=state.observations,
                        actions_in_sub_goal=actions_in_subgoal,
                        task_id=state.id,
                        user_id=state.user_id,
                        # Pass stricter note if available
                        stricter_note=stricter_note,
                        task_state=state,
                    )
                    break
                except BlockedQuotaError as exc:
                    # Phase 9.2.1 — both LLM providers are quota-exhausted.
                    # Park the task in `blocked_quota` and let the runtime
                    # probe poll for recovery; resume on success.
                    resumed = await runtime.enter_blocked_quota(state, str(exc))
                    if not resumed:
                        return
                    continue
                except PlannerLLMError as exc:
                    _tactical_retries += 1
                    if _tactical_retries <= _max_tactical_retries:
                        delay = 1.0 * _tactical_retries
                        logger.warning("tactical.plan transient failure (attempt %d/%d): %s. Retrying in %.1fs...", 
                                       _tactical_retries, _max_tactical_retries + 1, exc, delay)
                        await asyncio.sleep(delay)
                        continue
                        
                    # tactical bombed — observation + reflection
                    msg = str(exc)
                    is_technical = "INVALID_ARGUMENT" in msg or "400" in msg or "schema" in msg.lower()
                    
                    obs_text = f"tactical_failed: {msg}"
                    if is_technical:
                        obs_text = (
                            f"CRITICAL SYSTEM ERROR: The AI provider rejected the tool schema (400 INVALID_ARGUMENT). "
                            f"Technical details: {msg}. This is NOT a strategic failure, but a technical one."
                        )
                    
                    state.observations.append(build_system(state.step_idx, "tactical", obs_text))
                    
                    # Phase v3 — feed verdict to RevisionLoopGuard. tactical_parse_failure
                    # is the dominant loop site when the LLM provider returns
                    # 400 INVALID_ARGUMENT on every tool call (e.g. Gemini Pro 2.5
                    # tool-schema mismatch), and without this hook the guard
                    # never observes the spam.
                    ref = await _run_reflection(runtime, state, "tactical_parse_failure")
                    
                    if ref.verdict == "abandon_task":
                        await runtime.finalize_task(state, "failed", summary=ref.summary, error=str(exc))
                        return

                    if ref.verdict == "revise_strategy":
                        if await _check_revise_loop(ref.verdict):
                            # The guard will pause the task if this repeats too much
                            return
                        if not await _ensure_strategic_plan(runtime, state, revise_note=ref.recommendations or ""):
                            return
                        actions_in_subgoal = 0
                        break # exit retry loop to restart main loop
                    break # exit retry loop and continue main loop (replan next iteration)

            if step is None:
                continue

            await runtime._broadcast("thinking.completed", {
                "task_id": state.id, "planner": "tactical", "step_idx": state.step_idx,
            })
            await runtime._broadcast("plan.step_created", {
                "task_id": state.id, "step": step.model_dump(mode="json"),
            })
            # Phase 9.3b — emit inner monologue for the step's thinking.
            try:
                from agent.cognition.monologue_emitter import MonologueEvent, emit_monologue
                await emit_monologue(MonologueEvent(
                    kind="plan",
                    source="tactical",
                    monologue=step.monologue.model_dump(mode="json"),
                    task_id=state.id,
                ))
            except Exception as exc:
                logger.debug("monologue emit (tactical) failed: %s", exc)

            # Terminal markers ───────────────────────────────────────────────────
            if step.action in {_TERMINAL_DONE_TASK, _TERMINAL_DONE_SUBGOAL}:
                # Phase 32-LSP: Hard block if the last file operation had LSP errors.
                # We check the most recent observations.
                last_fs_obs = next((obs for obs in reversed(state.observations) if obs.source in {"fs.write", "fs.patch_hash"}), None)
                if last_fs_obs and "lsp_validation_failed" in last_fs_obs.content:
                    logger.warning("Agent tried to finish with unresolved LSP errors. Blocking.")
                    rej_obs = build_from_action_result(step, ActionResult(
                        ok=False,
                        error="БЛОКУВАННЯ: Ти не можеш завершити завдання (DONE), поки в твоєму коді є помилки LSP. Використай lsp.diagnostics, щоб побачити помилки, і виправ їх через fs.patch_hash.",
                        error_class="lsp_blocker"
                    ))
                    state.observations.append(rej_obs)
                    # The repeat guard below deliberately exempts terminal
                    # markers, so a model that keeps answering DONE_TASK is
                    # bounded by NOTHING here unless the block is charged to
                    # the breaker: `errors_repeating` escalates to a forced
                    # reflection after 3 identical rejections, and
                    # `actions_exceeded` ends the task instead of letting it
                    # burn planner calls until the 600s wall clock.
                    budget.record_action()
                    budget.record_result(False, "lsp_blocker")
                    state.step_idx += 1
                    continue

                # Phase 32-TEST: Suggest tests if not run yet after modification
                if step.action == _TERMINAL_DONE_TASK:
                    has_mod = any(obs.source in {"fs.write", "fs.patch_hash"} for obs in state.observations)
                    has_test = any(obs.source == "test.run" for obs in state.observations)
                    # Once per task. This is a *hint* ("Рекомендується"), not a
                    # gate — but it was implemented as an unconditional
                    # `continue`, so an agent that answered DONE_TASK again
                    # (the honest response to advice it has chosen not to take)
                    # got the identical hint re-injected forever. Say it once,
                    # then respect the agent's decision.
                    if has_mod and not has_test and not test_hint_injected:
                         logger.warning("Agent tried to finish without running tests. Injecting hint.")
                         rej_obs = build_from_action_result(step, ActionResult(
                            ok=False,
                            error="ЯКІСТЬ: Ти змінив код, але не запустив тести. Рекомендується виконати `test.run` (suite='backend' або 'frontend') для верифікації змін перед завершенням.",
                            error_class="test_missing_hint"
                         ))
                         state.observations.append(rej_obs)
                         test_hint_injected = True
                         budget.record_action()
                         state.step_idx += 1
                         continue

            if step.action == _TERMINAL_DONE_TASK:
                outcome = await _run_completion_gate(
                    runtime, state, step, check_revise_loop=_check_revise_loop,
                )
                if outcome.verdict is _GateVerdict.FINISHED:
                    return
                if outcome.verdict is _GateVerdict.REOPEN:
                    if outcome.reset_actions:
                        actions_in_subgoal = 0
                    continue
                for sg in state.sub_goals:
                    if sg.status in {"pending", "active"}:
                        sg.status = "done"
                await runtime.finalize_task(state, "done", summary=outcome.summary)
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
                if ref.verdict == "revise_strategy" and await _check_revise_loop(ref.verdict):
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
                    # Phase 28-STABILITY — instead of immediate abandonment, trigger
                    # a CRITICAL WORKAROUND reflection.
                    state.observations.append(build_system(
                        state.step_idx, "repeat_guard",
                        f"CRITICAL: action {step.action} repeated {prior_failures + 1} "
                        f"times with no progress. Triggering workaround reflection.",
                    ))
                    ref = await _run_reflection(runtime, state, "repeated_action_workaround_needed")
                    
                    # Phase 28-STABILITY — record this dead end.
                    state.self_model.dead_ends.append(f"Action '{step.action}' repeated {prior_failures + 1} times.")
                    state.self_model.dead_ends = state.self_model.dead_ends[-10:]
                    
                    if ref.verdict == "abandon_task":
                        await runtime.finalize_task(state, "failed", summary=ref.summary, error="repeated_action_no_progress")
                        return
                    if ref.verdict == "revise_strategy":
                        if await _check_revise_loop(ref.verdict):
                            return
                        if not await _ensure_strategic_plan(runtime, state, revise_note=ref.recommendations or ""):
                            return
                        actions_in_subgoal = 0
                        state.step_idx += 1
                        continue
                    
                    # If reflector didn't explicitly rescue, fall back to legacy abandonment.
                    state.observations.append(build_system(
                        state.step_idx, "repeat_guard",
                        f"abandoning sub-goal: workaround reflection failed to find alternative for {step.action}",
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
                    if ref.verdict == "revise_strategy" and await _check_revise_loop(ref.verdict):
                        return
                    state.step_idx += 1
                    continue
            else:
                step_repeat_key = None

            # Phase 28-STABILITY — Semantic Loop Breaker.
            # If the last 3 observations have identical content, the agent is stuck
            # in a semantic loop (e.g. trying different tools that all return same error).
            if len(state.observations) >= 3:
                last_3 = state.observations[-3:]
                if (all(obs.content == last_3[0].content for obs in last_3) 
                    and last_3[0].type in {"error", "result"}
                    and step.action not in {"REFLECT", _TERMINAL_DONE_TASK, _TERMINAL_DONE_SUBGOAL}):
                    
                    state.observations.append(build_system(
                        state.step_idx, "loop_breaker",
                        f"CRITICAL: Semantic loop detected (3 identical observations). "
                        f"Observation content: '{last_3[0].content[:100]}'. Forcing strategy revision.",
                    ))
                    # Record as a dead end
                    state.self_model.dead_ends.append(f"Semantic loop on observation: {last_3[0].content[:100]}")
                    state.self_model.dead_ends = state.self_model.dead_ends[-10:]
                    
                    ref = await _run_reflection(runtime, state, "semantic_loop_detected")
                    if ref.verdict == "abandon_task":
                        await runtime.finalize_task(state, "failed", summary=ref.summary, error="semantic_loop_no_progress")
                        return
                    if not await _ensure_strategic_plan(runtime, state, revise_note=ref.recommendations or "STOP REPEATING THE SAME FAILURES."):
                        return
                    actions_in_subgoal = 0
                    state.step_idx += 1
                    continue
                    ref = await _run_reflection(runtime, state, "repeated_action_no_progress")
                    if ref.verdict == "abandon_task":
                        await runtime.finalize_task(state, "failed", summary=ref.summary, error="repeated_action_no_progress")
                        return
                    if ref.verdict == "revise_strategy" and await _check_revise_loop(ref.verdict):
                        return
                    # Drop the planner's (likely-repeat) step and replan next iteration.
                    state.step_idx += 1
                    continue
            else:
                step_repeat_key = None

            # Risk-tolerance preview — let the loop block before executor wastes
            # the action attempt + audit row when the LLM picked too risky.
            from agent.actions.registry import registry as _reg
            cls = _reg.get(step.action)

            # Day-NN — Council *pre-deliberation* for any MEDIUM+ action
            # even when it would pass the risk-tolerance gate. The existing
            # block below already engages Council on tolerance-exceeding
            # risk; this parallel check covers the case where tolerance is
            # high (e.g. 7) but the action is still meaningful enough that
            # cross-perspective debate prevents a sloppy mistake. External
            # audit explicitly flagged that Council never auto-engaged on
            # MEDIUM. `unsafe_mode` skips this — operator chose raw mode.
            if (
                (not state.unsafe_mode)
                and cls
                and int(cls.risk_level) >= 5  # MEDIUM (5) or higher
                and int(cls.risk_level) <= int(config.agent_risk_tolerance)
                and bool(getattr(config, "agent_council_for_high_risk", True))
            ):
                try:
                    pre_action_args = getattr(step, "args", {}) or {}
                    pre_decision = await maybe_consult_council(
                        CouncilSituation(
                            kind="medium_risk_action",
                            task_id=state.id,
                            summary=(
                                f"Medium-risk action '{step.action}' "
                                f"(risk {int(cls.risk_level)} within tolerance "
                                f"{int(config.agent_risk_tolerance)}). "
                                f"Intent: {(step.intent or '')[:200]}"
                            ),
                            proposed_action={
                                "action": step.action,
                                "args": pre_action_args,
                                "risk_level": int(cls.risk_level),
                            },
                            step_idx=state.step_idx,
                        ),
                        runtime=runtime,
                    )
                except Exception as exc:
                    logger.debug("council pre-check on medium_risk failed: %s", exc)
                    pre_decision = None
                if pre_decision is not None and pre_decision.verdict in {"abort", "revise"}:
                    consensus = (pre_decision.consensus_summary or "").strip()
                    state.observations.append(build_system(
                        state.step_idx, "council_block",
                        f"Council {pre_decision.verdict}ed medium-risk action "
                        f"{step.action}"
                        + (f": {consensus[:240]}" if consensus else ""),
                    ))
                    await runtime._broadcast("warning.issued", {
                        "task_id": state.id,
                        "category": "council_blocked_medium",
                        "message": (
                            f"Council {pre_decision.verdict}ed {step.action}"
                        ),
                    })
                    state.status = "running"
                    await update_task_status(state.id, "running")
                    state.step_idx += 1
                    continue

            if (not state.unsafe_mode) and cls and int(cls.risk_level) > int(config.agent_risk_tolerance):
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
                phone_error: str | None = None
                try:
                    from agent.operations.approve_on_phone import request_phone_approval

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
                    # Distinct from "nobody is paired": the trail must not
                    # report a crashed lookup as an absent companion.
                    phone_error = f"{type(exc).__name__}: {exc}"[:200]
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
                    # 2026-05-13 — autonomy switch. When the operator has
                    # explicitly turned on `agent_auto_approve_when_no_companion`
                    # AND there is genuinely no paired phone (verdict =
                    # 'no_device'), auto-approve immediately instead of
                    # hanging the loop on the desktop intervene queue. The
                    # 'timeout' branch is intentionally NOT auto-approved —
                    # if a phone IS paired but the operator just didn't tap,
                    # that silence carries meaning and we still fall through
                    # to the desktop queue so a sitting-at-the-desk operator
                    # can intervene.
                    if (
                        phone_verdict == "no_device"
                        and bool(getattr(
                            config,
                            "agent_auto_approve_when_no_companion",
                            False,
                        ))
                    ):
                        auto_reason = phone_error or (
                            "no paired companion carries the approvals "
                            "capability"
                        )
                        # build_system, not build_user: the loop approved this,
                        # not the operator, and the task's own memory is read
                        # back by the reflector and the audit UI.
                        state.observations.append(build_system(
                            state.step_idx, "consent_auto",
                            f"auto-approved {step.action}: no human was asked "
                            f"({auto_reason})",
                        ))
                        try:
                            await write_auto_approval(
                                user_id=state.user_id,
                                task_id=state.id,
                                step=step,
                                risk_level=int(cls.risk_level),
                                reason=auto_reason,
                            )
                        except Exception as exc:
                            logger.warning(
                                "auto-approval audit row failed for %s: %s",
                                step.action, exc,
                            )
                        await runtime._broadcast("warning.issued", {
                            "task_id": state.id,
                            "category": "auto_approve_no_companion",
                            "message": (
                                f"auto-approved risky action {step.action} "
                                f"(risk {int(cls.risk_level)}): {auto_reason}"
                            ),
                        })
                        state.status = "running"
                        await update_task_status(state.id, "running")
                        # Fall through to execution.
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

            # ── Auto-Checkpoint for high risk ───────────────────────────────────
            if cls and int(cls.risk_level) >= 5:  # MEDIUM (5) or HIGH (7)
                try:
                    from agent.actions.git_checkpoint import GitCheckpoint
                    from agent.actions.base import ActionContext as Ctx
                    logger.info("Executing auto-checkpoint for risky action %s", step.action)
                    checkpoint_act = GitCheckpoint(message=f"Pre-action: {step.action}")
                    await checkpoint_act.execute(
                        Ctx(task_id=state.id, step_idx=state.step_idx, workspace_dir=config.agent_workspace_dir, runtime=runtime)
                    )
                except Exception as exc:
                    logger.warning("Failed to auto-checkpoint before risky action: %s", exc)

            # ── Execute ─────────────────────────────────────────────────────────
            await runtime.set_substate("acting")
            await runtime._broadcast("tool.selected", {
                "task_id": state.id, "step_idx": step.step_idx,
                "action": step.action, "risk_level": int(cls.risk_level) if cls else 1,
            })
            await runtime._broadcast("action.started", {
                "task_id": state.id, "step_idx": step.step_idx, "action": step.action,
            })

            # Phase 28-STABILITY — internal retry for the executor. Transient
            # failures (timeouts, network glitches in browser, etc.) are
            # retried once before we feed the failure to the observations.
            _exec_retries = 0
            _max_exec_retries = 1
            result = None
            audit_id = None

            while _exec_retries <= _max_exec_retries:
                try:
                    result, audit_id = await execute_action(
                        user_id=state.user_id,
                        task_id=state.id,
                        step=step,
                        runtime=runtime,
                        workspace_dir=config.agent_workspace_dir,
                        unsafe_mode=state.unsafe_mode,
                    )
                    
                    # If it's a timeout or a known flaky error class, retry.
                    # We only retry IF result.ok is False.
                    if (not result.ok) and result.error_class in {"action_timeout", "timeout", "NetworkError", "CanceledError"}:
                        if _exec_retries < _max_exec_retries:
                            _exec_retries += 1
                            delay = 2.0 * _exec_retries
                            logger.warning("action %s transient failure (attempt %d/%d): %s. Retrying in %.1fs...", 
                                           step.action, _exec_retries, _max_exec_retries + 1, result.error, delay)
                            await asyncio.sleep(delay)
                            continue
                    break # exit retry loop on success or non-retryable failure
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
                    result = None # signal that we already handled it
                    break
                except Exception as exc:
                    # Generic executor crash — retry once
                    _exec_retries += 1
                    if _exec_retries <= _max_exec_retries:
                        logger.error("executor crash (attempt %d/%d): %s. Retrying...", 
                                     _exec_retries, _max_exec_retries + 1, exc)
                        await asyncio.sleep(1.0)
                        continue
                    
                    # Phase 28-IDEAL — Self-Healing.
                    # If a synthesized tool crashed, try to fix it before giving up.
                    if step.action.startswith("synth."):
                        state.observations.append(build_system(
                            state.step_idx, "error", 
                            f"CRITICAL: Synthesized tool {step.action} crashed with {type(exc).__name__}: {exc}. "
                            "Triggering autonomous repair."
                        ))
                        # We inject a synthetic step to fix the tool
                        from agent.actions.optimize_capability import OptimizeCapability
                        fix_act = OptimizeCapability(
                            action_name=step.action,
                            optimization_goal=f"Fix crash: {type(exc).__name__}: {exc}"
                        )
                        await fix_act.execute(
                            Ctx(task_id=state.id, step_idx=state.step_idx, workspace_dir=config.agent_workspace_dir, runtime=runtime, unsafe_mode=state.unsafe_mode)
                        )
                        # Re-try the main loop iteration to pick a new step (or retry the fixed tool)
                        state.step_idx += 1
                        result = None
                        break

                    raise

            if result is None:
                # Handled by StepCancelled or similar
                continue

            budget.record_action()
            budget.record_result(result.ok, result.error_class)
            
            # Phase 28-IDEAL — Performance Profiling.
            # Record latency in history and tag outliers.
            perf_history = state.self_model.performance_history
            if step.action not in perf_history:
                perf_history[step.action] = []
            perf_history[step.action].append(result.elapsed_ms)
            perf_history[step.action] = perf_history[step.action][-5:] # Last 5
            
            est_ms = getattr(cls, "estimated_wall_seconds", 10) * 1000
            if result.elapsed_ms > est_ms * 2:
                result.performance_warning = f"Latency {result.elapsed_ms}ms significantly exceeded estimate {est_ms}ms"
                logger.warning("agent-kernel: action %s performance warning: %s", step.action, result.performance_warning)

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
            # Block A-1 — snapshot TaskState after each completed step so a
            # crash between steps loses at most one step's worth of progress.
            with contextlib.suppress(Exception):
                await snapshot_task_state(state)
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
                    if ref.verdict == "revise_strategy" and await _check_revise_loop(ref.verdict):
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
                    if await _check_revise_loop(ref.verdict):
                        return
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


# ── Block C-2 — Mission Loop ───────────────────────────────────────────────────
#
# Design choice: LOW-RISK wrapping approach.
#
# run_mission_loop() drives the phase iteration. For each phase it:
#   1. Plans the phase sub-goals via plan_phase() → StrategicPlan.
#   2. Mutates state to point at this phase's sub-goals + fresh observations.
#   3. Calls _run_task_loop_impl() for the sub-goal driving — the SAME
#      implementation used by legacy flat tasks, so all reflection / council /
#      quality-gate / risk-gate logic is inherited without duplication.
#   4. After _run_task_loop_impl returns, inspects state.status to decide
#      whether the phase succeeded or failed.
#
# The guard at the top of _run_task_loop_impl redirects mission tasks here,
# so the call graph is:
#   run_task_loop → _run_task_loop_impl → [mission guard] → run_mission_loop
#                                                          → _run_task_loop_impl (per phase, no guard re-fires)
#
# The re-entry into _run_task_loop_impl per phase is safe because by the time
# we call it the mission_id guard check is *still* set — but _run_task_loop_impl
# is called with a fresh state snapshot inside _run_phase_subgoals(), which
# clears mission_id so the guard doesn't fire again.  See _run_phase_subgoals.

import contextlib as _contextlib  # already imported above, aliased to avoid shadowing


async def _run_phase_subgoals(
    runtime: "AgentRuntime",
    state: "TaskState",
) -> None:
    """Drive state.sub_goals to exhaustion using the legacy ReAct loop.

    Temporarily clears state.mission_id so the guard at the top of
    _run_task_loop_impl does NOT fire recursively. Restores it afterwards.

    This gives the mission loop access to the full flat-task machinery
    (reflection, council, quality gate, pause/resume, etc.) without
    copying any of that code.
    """
    saved_mission_id = state.mission_id
    saved_phase_id = state.current_phase_id
    try:
        # Clear mission bindings so _run_task_loop_impl runs the legacy path.
        state.mission_id = None
        state.current_phase_id = None
        # Run the legacy sub-goal driver directly (without the background
        # timeout wrapper — mission tasks are always foreground).
        await _run_task_loop_impl(runtime, state, resumed=False)
    finally:
        # Restore bindings so the phase loop can inspect state.status cleanly.
        state.mission_id = saved_mission_id
        state.current_phase_id = saved_phase_id


async def run_mission_loop(
    runtime: "AgentRuntime",
    state: "TaskState",
) -> None:
    """Phase-driven mission execution loop.

    Iterates over all phases in order, planning each phase's sub-goals and
    driving them to completion. Writes phase events to the mission ledger.
    On any phase failure the mission is marked failed and the loop exits
    (Block D will add revise/retry logic).

    Args:
        runtime: The AgentRuntime singleton.
        state: TaskState with state.mission_id set to the Mission UUID.
    """
    from datetime import datetime, timezone

    from agent.missions.store import (
        get_mission,
        list_phases,
        update_mission_status,
        update_phase_status,
    )
    from agent.missions.ledger import LedgerWriter

    mission_id: str = state.mission_id  # type: ignore[assignment]
    user_id: str = state.user_id

    # Load mission + phases from DB.
    try:
        mission = await get_mission(user_id, mission_id)
    except Exception as exc:
        logger.error("run_mission_loop: get_mission failed (%s)", exc)
        await runtime.finalize_task(
            state, "failed",
            summary=f"mission load failed: {exc}",
            error=str(exc),
        )
        return

    if mission is None:
        logger.error("run_mission_loop: mission %s not found", mission_id)
        await runtime.finalize_task(
            state, "failed",
            summary="mission not found",
            error="mission_not_found",
        )
        return

    phases = await list_phases(mission_id)
    if not phases:
        logger.error("run_mission_loop: no phases for mission %s", mission_id)
        await update_mission_status(user_id, mission_id, "failed")
        await runtime.finalize_task(
            state, "failed",
            summary="mission has no phases",
            error="no_phases",
        )
        return

    ledger = LedgerWriter(mission_id, mission.ledger_path)

    # Broadcast that the mission loop has started executing.
    await runtime._broadcast("task.started", {
        "task_id": state.id,
        "goal": state.goal,
        "track": state.track,
        "self_model": state.self_model.model_dump(mode="json"),
        "resumed": False,
        "mission_id": mission_id,
        "phase_count": len(phases),
    })
    state.status = "running"
    from agent.kernel.audit import update_task_status as _upd_task
    await _upd_task(state.id, "running")

    # Block A-1 — determine the resume starting point.
    # If state.current_phase_id is set (from rehydrate), skip phases before it
    # in addition to already-terminal phases.  This avoids re-executing phases
    # that completed before the crash.
    resume_phase_id: str | None = getattr(state, "current_phase_id", None)
    _resumed_from_crash = getattr(state, "_resumed_from_crash_marker_written", False)

    for phase in phases:
        # Skip phases that already reached a terminal state (restart resilience).
        if phase.status in ("done", "failed", "abandoned"):
            logger.info(
                "run_mission_loop: skipping phase %s (status=%s)",
                phase.id, phase.status,
            )
            continue

        # Block A-1 — skip phases before the resume point when rehydrating.
        if resume_phase_id is not None and phase.id != resume_phase_id:
            # Only skip phases whose idx is BEFORE the current_phase_id's idx.
            # We can't easily compare idx here without loading it, so we compare
            # against the phase id directly.  Once we hit the target phase, we
            # clear resume_phase_id so subsequent phases run normally.
            # Edge case: if current_phase_id refers to a completed phase already
            # handled by the status check above, resume_phase_id gets cleared
            # when we pass through it below.
            logger.debug(
                "run_mission_loop: skipping phase %s (not yet at resume point %s)",
                phase.id, resume_phase_id,
            )
            continue

        if resume_phase_id is not None and phase.id == resume_phase_id:
            # We reached the target phase — clear the guard so the rest run normally.
            resume_phase_id = None
            # Append a crash-resume marker to the ledger so the operator's read
            # of the ledger reflects reality.
            if not _resumed_from_crash:
                try:
                    from datetime import datetime as _dt, timezone as _tz
                    _ts = _dt.now(_tz.utc).isoformat()
                    await ledger.append_phase_lesson(
                        phase.id,
                        f"**RESUMED after crash @ wall-clock {_ts}**",
                    )
                    state._resumed_from_crash_marker_written = True  # type: ignore[attr-defined]
                except Exception as _exc:
                    logger.debug("run_mission_loop: crash resume marker write failed: %s", _exc)

        # ── Phase start ──────────────────────────────────────────────────────
        state.current_phase_id = phase.id
        phase_start_ts = datetime.now(timezone.utc)
        verification_attempts = 0
        max_verification_attempts = 2  # Block D-1: Try up to 2 times (initial + 1 retry)
        revise_note = ""

        while verification_attempts < max_verification_attempts:
            await update_phase_status(mission_id, phase.id, "running")
            await ledger.append_phase_start(phase)
            if revise_note:
                await ledger.append_phase_lesson(
                    phase.id, f"**RETRY ATTEMPT {verification_attempts}** — Reason: {revise_note[:200]}..."
                )

            await runtime._broadcast("mission.phase_started", {
                "mission_id": mission_id,
                "task_id": state.id,
                "phase_id": phase.id,
                "phase_idx": phase.idx,
                "description": phase.description,
                "attempt": verification_attempts + 1,
            })

            # ── Plan this phase's sub-goals ──────────────────────────────────────
            logger.info(
                "run_mission_loop: planning phase %d/%d (%s), attempt %d",
                phase.idx + 1, len(phases), phase.description, verification_attempts + 1,
            )
            try:
                strategic_plan = await plan_phase(
                    user_id=user_id,
                    mission=mission,
                    phase=phase,
                    self_model=state.self_model,
                    task_id=state.id,
                    revise_note=revise_note,
                )
            except Exception as exc:
                logger.error(
                    "run_mission_loop: plan_phase failed for phase %s: %s",
                    phase.id, exc,
                )
                await update_phase_status(mission_id, phase.id, "failed")
                await ledger.append_phase_lesson(
                    phase.id, f"Phase planning failed: {exc}"
                )
                await update_mission_status(user_id, mission_id, "failed")
                await runtime._broadcast("mission.failed", {
                    "mission_id": mission_id,
                    "task_id": state.id,
                    "reason": f"phase_planning_failed: {exc}",
                })
                await runtime.finalize_task(
                    state, "failed",
                    summary=f"phase planning failed: {exc}",
                    error=str(exc),
                )
                return

            # Install this phase's plan into state — fresh observation window.
            from agent.schemas import ThoughtBudget as _ThoughtBudget
            state.strategic_plan = strategic_plan
            state.sub_goals = list(strategic_plan.sub_goals)
            state.observations = []
            state.step_idx = 0
            state.thought_budget = _ThoughtBudget(
                estimated_actions=max(
                    strategic_plan.estimated_total_actions,
                    sum(sg.expected_actions for sg in strategic_plan.sub_goals),
                ),
                actions_used=0,
                force_reflect_ratio=config.agent_thought_budget_force_reflect_ratio,
                reflections_done=0,
            )

            # Broadcast the strategic plan so the FE can show phase sub-goals.
            await runtime._broadcast("strategic_plan.created", {
                "task_id": state.id,
                "sub_goals": [sg.model_dump(mode="json") for sg in strategic_plan.sub_goals],
                "estimated_total_actions": strategic_plan.estimated_total_actions,
                "risk_assessment": strategic_plan.risk_assessment,
                "mission_id": mission_id,
                "phase_id": phase.id,
            })

            # ── Drive sub-goals to completion ───────────────────────────────────
            await _run_phase_subgoals(runtime, state)

            # ── Check phase outcome (technical failure) ────────────────────────
            if state.status in ("failed", "stopped", "timeout"):
                wall_s = (datetime.now(timezone.utc) - phase_start_ts).total_seconds()
                await update_phase_status(
                    mission_id, phase.id, state.status,
                    finished_at=datetime.now(timezone.utc),
                )
                await ledger.append_phase_lesson(
                    phase.id,
                    f"Phase exited with status={state.status} after {int(wall_s)}s",
                )
                await update_mission_status(user_id, mission_id, "failed")
                await runtime._broadcast("mission.failed", {
                    "mission_id": mission_id,
                    "task_id": state.id,
                    "phase_id": phase.id,
                    "reason": f"phase_status={state.status}",
                })
                return

            # ── Block D-1: Acceptance Criteria verification ───────────────────
            logger.info("run_mission_loop: verifying phase %d criteria...", phase.idx + 1)
            try:
                from agent.missions.ledger import LedgerReader
                from agent.missions.verify import verify_phase
                from agent.schemas import MissionBrief as _MB, PhaseSpec as _PS

                reader = LedgerReader(mission.ledger_path)
                ledger_section = await reader.current_phase_section()

                # Duck-type conversion to schemas for the judge.
                brief_schema = _MB(
                    brief=mission.brief,
                    quality_bar=mission.quality_bar,
                    budget_constraints=None,  # Not needed for judge
                )
                phase_schema = _PS(
                    description=phase.description,
                    success_criteria=phase.success_criteria,
                    rationale=phase.rationale,
                )

                v_result = await verify_phase(
                    mission_brief=brief_schema,
                    phase=phase_schema,
                    ledger_section=ledger_section,
                    task_id=state.id,
                )

                if v_result.passed:
                    logger.info("run_mission_loop: phase %d PASSED verification", phase.idx + 1)
                    await ledger.append_phase_lesson(
                        phase.id, f"**VERIFICATION PASSED**: {v_result.critique}"
                    )
                    break  # Success! Exit attempt loop
                else:
                    verification_attempts += 1
                    logger.warning(
                        "run_mission_loop: phase %d FAILED verification (attempt %d/%d)",
                        phase.idx + 1, verification_attempts, max_verification_attempts
                    )
                    
                    critique_msg = f"**VERIFICATION FAILED**: {v_result.critique}\nSuggestions: {v_result.suggestions}"
                    await ledger.append_phase_lesson(phase.id, critique_msg)
                    
                    await runtime._broadcast("warning.issued", {
                        "task_id": state.id,
                        "category": "phase_verification_failed",
                        "message": f"Phase {phase.idx + 1} didn't meet success criteria. Retrying...",
                        "mission_id": mission_id,
                        "phase_id": phase.id,
                    })

                    if verification_attempts < max_verification_attempts:
                        # Prepare for retry
                        revise_note = (
                            f"Phase verification failed. Judge critique:\n{v_result.critique}\n\n"
                            f"Suggestions for retry:\n{v_result.suggestions}"
                        )
                        # Reset sub-goals to pending so they can be re-planned
                        # Actually plan_phase will return a fresh set anyway.
                        continue
                    else:
                        # Max attempts reached — mission fails.
                        await update_phase_status(mission_id, phase.id, "failed")
                        await update_mission_status(user_id, mission_id, "failed")
                        await runtime._broadcast("mission.failed", {
                            "mission_id": mission_id,
                            "task_id": state.id,
                            "phase_id": phase.id,
                            "reason": "max_verification_attempts_reached",
                        })
                        await runtime.finalize_task(
                            state, "failed",
                            summary=f"Phase {phase.idx + 1} failed verification after {max_verification_attempts} attempts.",
                            error="verification_failed",
                        )
                        return

            except Exception as v_exc:
                logger.error("run_mission_loop: verification failed unexpectedly: %s", v_exc)
                # Fallback: proceed to avoid stalling the whole system.
                await ledger.append_phase_lesson(
                    phase.id, f"Verification system error: {v_exc}. Proceeding by default."
                )
                break

        # ── Phase completed ─────────────────────────────────────────────────
        wall_s = (datetime.now(timezone.utc) - phase_start_ts).total_seconds()
        await update_phase_status(
            mission_id, phase.id, "done",
            finished_at=datetime.now(timezone.utc),
        )
        await ledger.mark_phase_done(phase, state.step_idx, wall_s)

        await runtime._broadcast("mission.phase_completed", {
            "mission_id": mission_id,
            "task_id": state.id,
            "phase_id": phase.id,
            "phase_idx": phase.idx,
            "steps_used": state.step_idx,
            "wall_s": wall_s,
        })
        logger.info(
            "run_mission_loop: phase %d done in %.0fs (%d steps)",
            phase.idx + 1, wall_s, state.step_idx,
        )

    # ── All phases complete ──────────────────────────────────────────────────
    await update_mission_status(user_id, mission_id, "done")
    await runtime._broadcast("mission.completed", {
        "mission_id": mission_id,
        "task_id": state.id,
        "phases_completed": len(phases),
    })

    summary = f"Mission complete: {mission.brief[:200]}"
    await runtime.finalize_task(state, "done", summary=summary)
    logger.info("run_mission_loop: mission %s complete", mission_id)
