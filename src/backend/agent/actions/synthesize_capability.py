"""agent.capability.synthesize — V4 flagship action.

When the planner identifies a capability gap (no registered action fits a
step), it can emit a ``synthesize_capability`` step. This action:

  1. Checks the per-task SynthCounter against config.agent_synth_max_per_task.
  2. Calls the LLM (generate_raw) to draft a complete Action subclass.
  3. Runs the draft inside the EXISTING bwrap sandbox (smoke test).
  4. On green: registers the new action into the live ActionRegistry and
     persists the source to agent/actions/_synth/<slug>.py + writes a lesson.
  5. On failure: writes a failure lesson, does NOT register, does NOT
     increment the counter (failed attempt ≠ successful synthesis).

The synthesized action is immediately pickable by the planner in subsequent
steps of the SAME task (ActionRegistry is a shared mutable object within
the process lifetime) and persists across restarts (registry._load_synth_actions
scans _synth/ at boot).
"""
from __future__ import annotations

import logging
import re
from typing import ClassVar

from pydantic import Field

from ..schemas import ActionResult, RiskLevel
from .base import Action, ActionContext

logger = logging.getLogger(__name__)


class SynthesizeCapability(Action):
    """author → sandbox-test → register a new Action subclass at runtime."""

    name: ClassVar[str] = "synthesize_capability"
    risk_level: ClassVar[RiskLevel] = RiskLevel.MEDIUM
    requires_consent: ClassVar[bool] = False
    reversible: ClassVar[bool] = False
    estimated_peak_ram_mb: ClassVar[int] = 200
    estimated_wall_seconds: ClassVar[int] = 60

    spec: str = Field(
        ...,
        description=(
            "Capability gap description: what the action must do, expected inputs, "
            "expected output shape, risk level, any stdlib constraints."
        ),
    )
    # Optional override — planner can pin a slug; defaults to spec-derived.
    slug: str = Field(
        default="",
        description="Filesystem slug for the generated file (auto-derived from spec if empty).",
    )

    async def execute(self, ctx: ActionContext) -> ActionResult:
        import time
        t0 = time.monotonic()

        from agent.actions._synth.synthesizer import (
            SynthCounter,
            _slugify,
            draft_action_source,
            record_synth_lesson,
            register_synth,
            run_smoke_test,
        )

        counter = SynthCounter.from_ctx(ctx.extras)

        if counter.cap_reached():
            return ActionResult(
                ok=False,
                error="synth_cap_reached",
                error_class="synth_cap_reached",
                output={
                    "message": (
                        f"Ліміт синтезу вичерпано ({counter.count} / "
                        f"agent_synth_max_per_task). Перевикористай наявні дії."
                    ),
                },
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        slug = self.slug.strip() or _slugify(self.spec)
        if not slug:
            slug = "custom"

        # Ensure uniqueness
        registry = self._get_registry(ctx)
        base_slug = slug
        suffix = 1
        while (tmp_name := f"synth.{slug}") and registry.get(tmp_name) is not None:
            slug = f"{base_slug}_{suffix}"
            suffix += 1

        # Phase 28-IDEAL — Repair Loop.
        # If the smoke test fails, we don't just give up. We feed the error
        # back and ask for a fix. Max 2 repairs (3 attempts total).
        attempts = 0
        max_attempts = 3
        source = ""
        last_error = ""

        while attempts < max_attempts:
            attempts += 1
            try:
                # 1. Draft/Fix via LLM.
                source = await draft_action_source(
                    self.spec, slug, 
                    repair_error=last_error if last_error else None,
                    previous_source=source if last_error else None
                )
            except Exception as exc:
                reason = f"draft_failed (attempt {attempts}): {exc}"
                if attempts == max_attempts:
                    await record_synth_lesson(
                        task_id=ctx.task_id, goal_class=self.spec[:120],
                        action_name=f"synth.{slug}", success=False, failure_reason=reason,
                        user_id=ctx.user_id,
                    )
                    return ActionResult(
                        ok=False, error=reason, error_class="synth_draft_failed",
                        elapsed_ms=int((time.monotonic() - t0) * 1000),
                    )
                last_error = str(exc)
                continue

            # 2. Smoke test inside sandbox.
            passed, smoke_reason = await run_smoke_test(
                slug, source, workspace_dir=ctx.workspace_dir, unsafe_mode=ctx.unsafe_mode,
            )

            if passed:
                # Success!
                break
            else:
                last_error = smoke_reason
                logger.warning("synth smoke test failed (attempt %d/%d): %s", attempts, max_attempts, smoke_reason)
                if attempts == max_attempts:
                    await record_synth_lesson(
                        task_id=ctx.task_id, goal_class=self.spec[:120],
                        action_name=f"synth.{slug}", success=False, failure_reason=smoke_reason,
                        user_id=ctx.user_id,
                    )
                    return ActionResult(
                        ok=False, error=f"smoke_failed: {smoke_reason}",
                        error_class="synth_smoke_failed",
                        output={"slug": slug, "smoke_reason": smoke_reason, "attempts": attempts},
                        elapsed_ms=int((time.monotonic() - t0) * 1000),
                    )

        # 3. Register
        try:
            action_name = register_synth(slug, source, registry)
        except Exception as exc:
            reason = f"register_failed: {exc}"
            await record_synth_lesson(
                task_id=ctx.task_id, goal_class=self.spec[:120],
                action_name=f"synth.{slug}", success=False, failure_reason=reason,
                user_id=ctx.user_id,
            )
            return ActionResult(
                ok=False, error=reason, error_class="synth_register_failed",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        # 4. Success
        counter.increment()
        await record_synth_lesson(
            task_id=ctx.task_id, goal_class=self.spec[:120],
            action_name=action_name, success=True,
            user_id=ctx.user_id,
        )

        return ActionResult(
            ok=True,
            output={
                "action_name": action_name,
                "slug": slug,
                "attempts": attempts,
                "synth_count": counter.count,
                "message": (
                    f"Нова дія '{action_name}' синтезована успішно (спроб: {attempts}). "
                    f"Вона перевірена у sandbox і готова до використання."
                ),
            },
            side_effects=[f"registered new action: {action_name} (after {attempts} attempts)"],
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )

    @staticmethod
    def _get_registry(ctx: ActionContext):
        """Resolve the live ActionRegistry from runtime or fall back to the
        module-level singleton. This keeps the action testable without a full
        runtime while ensuring production uses the shared live registry."""
        if ctx.runtime is not None:
            reg = getattr(ctx.runtime, "registry", None)
            if reg is not None:
                return reg
        from agent.actions.registry import registry as _singleton
        return _singleton
