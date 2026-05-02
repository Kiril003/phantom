"""
Action executor — preconditions, dispatch, audit-write wrapper.

The contract: every call returns an ActionResult AND writes an audit row even
when the action raises. Loop never sees a "the action just disappeared" case.
"""
from __future__ import annotations

import asyncio
import logging
import time

from config import config

from .actions.base import ActionContext
from .actions.registry import ActionRegistry, registry as default_registry
from .audit import write_audit_entry
from .long_running import ProgressTracker, should_promote
from .safety.preconditions import check_preconditions
from .schemas import ActionResult, PlanStep, RiskLevel

logger = logging.getLogger(__name__)


class TaskStopped(Exception):
    """Raised when emergency_stop has been signalled mid-action."""


class StepCancelled(Exception):
    """Raised when cancel_step has been signalled mid-action."""


async def execute(
    *,
    task_id: str,
    step: PlanStep,
    runtime,
    workspace_dir: str,
    registry_: ActionRegistry | None = None,
) -> tuple[ActionResult, int]:
    """
    Run a planned step and return (result, audit_entry_id).

    Returns ActionResult even on internal failure (KeyError on unknown action,
    Pydantic ValidationError on bad args, etc.) so the loop can feed the
    failure back into observations.
    """
    reg = registry_ or default_registry
    cls = reg.get(step.action)

    risk_level = int(cls.risk_level) if cls else int(RiskLevel.SAFE)

    if cls is None:
        valid = ", ".join(sorted(reg.names()))
        result = ActionResult(
            ok=False,
            error=(
                f"unknown_action: '{step.action}' is NOT in the catalog. "
                f"Valid action names are exactly: {valid}. "
                f"For summarize/present/explain/respond sub-goals you MUST use "
                f"DONE_SUBGOAL or DONE_TASK with the answer text in args.summary "
                f"— there is no respond_text / summarize / answer action."
            ),
            error_class="unknown_action",
            elapsed_ms=0,
        )
        audit_id = await write_audit_entry(
            task_id=task_id, step=step, result=result, risk_level=risk_level,
        )
        return (result, audit_id)

    # Risk-tolerance gate ─ fail closed when the LLM picks a risk above the cap.
    if risk_level > int(config.agent_risk_tolerance):
        result = ActionResult(
            ok=False,
            error=(
                f"risk_above_tolerance: {step.action} risk={risk_level} > "
                f"tolerance={config.agent_risk_tolerance}"
            ),
            error_class="risk_above_tolerance",
            elapsed_ms=0,
        )
        audit_id = await write_audit_entry(
            task_id=task_id, step=step, result=result, risk_level=risk_level,
        )
        return (result, audit_id)

    # Build the action instance — Pydantic validation catches bad args.
    try:
        action = reg.build(step.action, step.args or {})
    except (ValueError, TypeError) as exc:
        result = ActionResult(
            ok=False,
            error=f"bad_args: {exc}",
            error_class="bad_args",
            elapsed_ms=0,
        )
        audit_id = await write_audit_entry(
            task_id=task_id, step=step, result=result, risk_level=risk_level,
        )
        return (result, audit_id)

    # Preconditions
    pc_result = await check_preconditions(action.preconditions())
    if not pc_result.ok:
        first = pc_result.failures[0]
        result = ActionResult(
            ok=False,
            error=f"precondition_failed:{first.key}: {first.detail}",
            error_class=f"precondition_failed:{first.key}",
            elapsed_ms=0,
        )
        # Tag the requested failure_mode so loop can choose how to react.
        result.output = {
            "failure_mode": first.failure_mode,
            "failed_keys": [f.key for f in pc_result.failures],
        }
        audit_id = await write_audit_entry(
            task_id=task_id, step=step, result=result, risk_level=risk_level,
        )
        return (result, audit_id)

    ctx = ActionContext(
        task_id=task_id,
        step_idx=step.step_idx,
        workspace_dir=workspace_dir,
        runtime=runtime,
    )

    # Phase 18-COMPLETE — promote long-running actions onto the background
    # track BEFORE we await execute(), so the operator UI is freed the
    # moment we know the action will take a while. We also spawn a
    # ProgressTracker that broadcasts heartbeats while the action runs;
    # cancelled in the finally block below.
    long_spec = None
    progress_tracker: ProgressTracker | None = None
    try:
        long_spec = action.long_running_spec()
    except Exception:
        logger.exception("executor: long_running_spec() failed for %s", step.action)

    if long_spec is not None and runtime is not None:
        state = runtime._state_for_task(task_id) if hasattr(runtime, "_state_for_task") else None
        if state is not None:
            if should_promote(long_spec, state.track):
                try:
                    await runtime.promote_to_background(state, reason="long_running_action")
                except Exception:
                    logger.exception("executor: promote_to_background failed")
            progress_tracker = ProgressTracker(
                runtime=runtime, task_id=task_id, spec=long_spec, action_name=step.action,
            )
            progress_tracker.start()

    # Per-action ceiling. Ceiling kept slightly above the action's own internal
    # timeout so well-behaved actions don't get aborted on a normal long path.
    ceiling = int(config.agent_max_elapsed_s_per_action)
    # If the action declares a long-running spec, raise the per-action ceiling
    # to its estimated duration (with a small safety margin) — otherwise the
    # generic ceiling would kill BlenderRun(timeout_s=1800) at 5 min.
    if long_spec is not None:
        ceiling = max(ceiling, int(long_spec.estimated_duration_s) + 30)

    t0 = time.monotonic()
    cancelled_by_user = False
    cancelled_by_stop = False
    # Phase 9.2.3 (F-09): wrap action.execute() in an explicit Task so
    # runtime.cancel_step can cancel it directly. The previous implementation
    # only set a flag that no bundled action actually polled, so the UI button
    # was a no-op until the action finished naturally.
    exec_task = asyncio.ensure_future(action.execute(ctx))
    if runtime is not None:
        runtime._current_action_task = exec_task
    try:
        try:
            result = await asyncio.wait_for(exec_task, timeout=ceiling)
        except asyncio.TimeoutError:
            result = ActionResult(
                ok=False,
                error=f"action_timeout: {ceiling}s",
                error_class="action_timeout",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )
        except asyncio.CancelledError:
            # Could be cancel_step from user OR an emergency_stop teardown.
            if runtime is not None and runtime.controls.cancel_step.is_set():
                cancelled_by_user = True
                runtime.controls.cancel_step.clear()
                result = ActionResult(
                    ok=False,
                    error="cancelled_by_user",
                    error_class="cancelled_by_user",
                    elapsed_ms=int((time.monotonic() - t0) * 1000),
                )
            elif runtime is not None and runtime.controls.emergency_stop.is_set():
                cancelled_by_stop = True
                result = ActionResult(
                    ok=False,
                    error="cancelled_by_stop",
                    error_class="cancelled_by_stop",
                    elapsed_ms=int((time.monotonic() - t0) * 1000),
                )
            else:
                raise
        except Exception as exc:
            logger.exception("executor: action %s raised", step.action)
            result = ActionResult(
                ok=False,
                error=f"exception: {exc}",
                error_class=type(exc).__name__,
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )
    finally:
        if runtime is not None and runtime._current_action_task is exec_task:
            runtime._current_action_task = None
        if progress_tracker is not None:
            await progress_tracker.stop()

    audit_id = await write_audit_entry(
        task_id=task_id, step=step, result=result, risk_level=risk_level,
    )

    # Phase 9.3a (AD-01) — clear the browser-session-reset caveat from
    # SelfModel once the agent actually re-navigates after a checkpoint
    # resume. Without this the caveat would linger across the rest of the
    # task even after the navigate succeeded, confusing subsequent planning.
    if (
        result.ok
        and step.action == "browser.navigate"
        and runtime is not None
        and runtime.current_task is not None
    ):
        sm = runtime.current_task.self_model
        if sm.active_caveats:
            sm.active_caveats = [
                c for c in sm.active_caveats
                if not c.startswith("browser_session_reset")
            ]

    if cancelled_by_stop:
        raise TaskStopped()
    if cancelled_by_user:
        raise StepCancelled()

    return (result, audit_id)
