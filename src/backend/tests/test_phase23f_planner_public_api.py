"""
Phase 23-F — `agent.planner` package re-exports the canonical entry points
so consumers don't reach into submodules. The submodule path
(`agent.planner.strategic`, `.tactical`, `.reflector`, `._llm`) remains
supported for tests + advanced call sites, but the public surface is
the package level.
"""
from __future__ import annotations

import inspect
import os

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase23f")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


class TestPlannerPublicSurface:
    def test_strategic_plan_re_exported(self) -> None:
        from agent.cognition.planner import strategic_plan
        from agent.cognition.planner.strategic import plan as submodule_plan
        assert strategic_plan is submodule_plan
        assert inspect.iscoroutinefunction(strategic_plan)

    def test_tactical_plan_re_exported(self) -> None:
        from agent.cognition.planner import tactical_plan
        from agent.cognition.planner.tactical import plan as submodule_plan
        assert tactical_plan is submodule_plan
        assert inspect.iscoroutinefunction(tactical_plan)

    def test_tactical_plan_safe_re_exported(self) -> None:
        from agent.cognition.planner import tactical_plan_safe
        from agent.cognition.planner.tactical import plan_safe as submodule_safe
        assert tactical_plan_safe is submodule_safe
        assert inspect.iscoroutinefunction(tactical_plan_safe)

    def test_reflect_re_exported(self) -> None:
        from agent.cognition.planner import reflect
        from agent.cognition.planner.reflector import reflect as submodule_reflect
        assert reflect is submodule_reflect
        assert inspect.iscoroutinefunction(reflect)

    def test_planner_llm_error_re_exported(self) -> None:
        from agent.cognition.planner import PlannerLLMError
        from agent.cognition.planner._llm import PlannerLLMError as submodule_err
        assert PlannerLLMError is submodule_err
        # Subclass of the json_response error so callers that catch the
        # broader JsonResponseError still see planner failures.
        assert issubclass(PlannerLLMError, Exception)

    def test_blocked_quota_error_re_exported(self) -> None:
        from agent.cognition.planner import BlockedQuotaError
        from ai.provider import BlockedQuotaError as upstream_err
        # planner's _llm re-imports from ai.provider — public surface must
        # expose the same exception object so `try/except BlockedQuotaError`
        # works regardless of import path.
        assert BlockedQuotaError is upstream_err

    def test_dunder_all_lists_exact_public_surface(self) -> None:
        """Catch accidental drift — anything new must be added intentionally.

        Phase 23-G added the lesson loop helpers; both planner-execution and
        lesson-management names are part of the surface."""
        import agent.cognition.planner as planner_pkg
        assert sorted(planner_pkg.__all__) == sorted([
            "strategic_plan",
            "tactical_plan",
            "tactical_plan_safe",
            "reflect",
            "PlannerLLMError",
            "BlockedQuotaError",
            "distill_lesson",
            "write_lesson",
            "recall_lessons",
            "format_lessons_for_prompt",
        ])

    def test_submodule_imports_still_supported(self) -> None:
        """Phase 23-F must NOT break legacy callers that already import
        the submodules directly (tests, agent loop, MCP adapters)."""
        from agent.cognition.planner import strategic, tactical, reflector, _llm
        assert hasattr(strategic, "plan")
        assert hasattr(tactical, "plan")
        assert hasattr(tactical, "plan_safe")
        assert hasattr(reflector, "reflect")
        assert hasattr(_llm, "PlannerLLMError")


class TestAgentInternalsDocPresent:
    def test_doc_exists(self) -> None:
        from pathlib import Path
        doc = Path(__file__).resolve().parent.parent.parent.parent / "docs" / "AGENT_INTERNALS.md"
        assert doc.exists(), (
            "Phase 23-F regression: docs/AGENT_INTERNALS.md is missing — "
            "the public planner API has no narrative doc to anchor it."
        )
        text = doc.read_text(encoding="utf-8")
        # Sequence diagram must mention the canonical entry points so
        # someone reading the doc actually learns the public surface.
        for marker in (
            "strategic_plan",
            "tactical_plan",
            "reflect",
            "Council",
            "Quality Gate",
            "high_risk_action",
        ):
            assert marker in text, (
                f"AGENT_INTERNALS.md missing reference to {marker!r}"
            )
