"""agent.capability.optimize — V4 autonomous optimization action.

When the agent detects performance degradation in a synthesized tool, it can
use this action to rewrite the tool's source code, optimizing for speed and
efficiency, and then hot-reload it into the registry.
"""
from __future__ import annotations

import logging
import time
import importlib.util
import sys
from pathlib import Path
from typing import ClassVar

from pydantic import Field

from ..schemas import ActionResult, RiskLevel
from .base import Action, ActionContext

logger = logging.getLogger(__name__)


class OptimizeCapability(Action):
    """Rewrite and hot-reload an existing synthesized action for better performance."""

    name: ClassVar[str] = "optimize_capability"
    risk_level: ClassVar[RiskLevel] = RiskLevel.MEDIUM
    requires_consent: ClassVar[bool] = False
    reversible: ClassVar[bool] = False
    estimated_wall_seconds: ClassVar[int] = 60

    action_name: str = Field(
        ...,
        description="The name of the synthesized action to optimize (e.g., 'synth.my_tool')."
    )
    optimization_goal: str = Field(
        ...,
        description="Specific instructions for the LLM on what to optimize (e.g., 'Use asyncio.gather instead of sequential awaits', 'Cache the regex compilation')."
    )

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        
        if not self.action_name.startswith("synth."):
            return ActionResult(
                ok=False, error="can only optimize synthesized actions (must start with 'synth.')",
                error_class="invalid_action_target",
                elapsed_ms=int((time.monotonic() - t0) * 1000)
            )
            
        slug = self.action_name[6:]
        from agent.actions._synth.synthesizer import _SYNTH_DIR
        source_file = _SYNTH_DIR / f"{slug}.py"
        
        if not source_file.exists():
            return ActionResult(
                ok=False, error=f"source file not found: {source_file}",
                error_class="file_not_found",
                elapsed_ms=int((time.monotonic() - t0) * 1000)
            )
            
        current_source = source_file.read_text(encoding="utf-8")

        from agent.actions._synth.synthesizer import draft_action_source, run_smoke_test, register_synth
        
        # 1. Draft optimized source
        try:
            # Reusing draft_action_source but feeding the optimization goal as the repair error
            # to force a rewrite based on the previous source.
            optimized_source = await draft_action_source(
                spec=f"Оптимізуй цю дію. Ціль: {self.optimization_goal}",
                slug=slug,
                repair_error=f"ПРОБЛЕМА ПРОДУКТИВНОСТІ: {self.optimization_goal}. Перепиши код для максимальної швидкодії.",
                previous_source=current_source
            )
        except Exception as exc:
            return ActionResult(
                ok=False, error=f"optimization draft failed: {exc}", error_class="optimize_draft_failed",
                elapsed_ms=int((time.monotonic() - t0) * 1000)
            )

        # 2. Smoke test
        passed, smoke_reason = await run_smoke_test(
            slug, optimized_source, workspace_dir=ctx.workspace_dir, unsafe_mode=ctx.unsafe_mode,
        )
        
        if not passed:
            return ActionResult(
                ok=False, error=f"optimized code failed smoke test: {smoke_reason}",
                error_class="optimize_smoke_failed",
                elapsed_ms=int((time.monotonic() - t0) * 1000)
            )
            
        # 3. Register & Hot Reload
        registry = self._get_registry(ctx)
        
        # Remove old instance from registry and sys.modules
        module_name = f"agent.actions._synth.{slug}"
        if module_name in sys.modules:
            del sys.modules[module_name]
            
        if self.action_name in registry._by_name:
            del registry._by_name[self.action_name]
            
        try:
            new_action_name = register_synth(slug, optimized_source, registry)
        except Exception as exc:
            # Attempt rollback
            register_synth(slug, current_source, registry)
            return ActionResult(
                ok=False, error=f"hot reload failed: {exc}. Rolled back.", error_class="optimize_register_failed",
                elapsed_ms=int((time.monotonic() - t0) * 1000)
            )

        return ActionResult(
            ok=True,
            output={
                "action_name": new_action_name,
                "message": "Action successfully optimized and hot-reloaded."
            },
            side_effects=[f"optimized and hot-reloaded {new_action_name}"],
            elapsed_ms=int((time.monotonic() - t0) * 1000)
        )
        
    @staticmethod
    def _get_registry(ctx: ActionContext):
        if ctx.runtime is not None:
            reg = getattr(ctx.runtime, "registry", None)
            if reg is not None:
                return reg
        from agent.actions.registry import registry as _singleton
        return _singleton
