"""
Phase 23-D — Council auto-engages on high-risk actions BEFORE phone/desktop
approval, so a cross-perspective "abort"/"revise" verdict can short-circuit
a destructive ask without ever surfacing a prompt to the operator.

Wiring under test:
  • CouncilSituationKind literal accepts "high_risk_action".
  • pick_orchestrator_mode returns "council" for the new kind.
  • _AUTO_COUNCIL_KINDS contains "high_risk_action".
  • config.agent_council_for_high_risk defaults to True.
  • Settings registry surfaces the new key with a label and treats it as a
    boolean.
  • agent/loop.py contains the new pre-approval council branch and routes
    "abort"/"revise" verdicts away from request_phone_approval.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest
from pydantic import ValidationError

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase23d")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


# ─── 1. Schema literal ───────────────────────────────────────────────────────


class TestCouncilSituationKind:
    def test_literal_accepts_high_risk_action(self) -> None:
        from agent.schemas import CouncilSituation
        sit = CouncilSituation(
            kind="high_risk_action",
            task_id="t-23d",
            summary="Risky bash.run rm -rf",
        )
        assert sit.kind == "high_risk_action"

    def test_literal_still_accepts_legacy_kinds(self) -> None:
        """The new variant must NOT replace the existing six — they remain
        the canonical entry points for council deliberation."""
        from agent.schemas import CouncilSituation
        for kind in (
            "strategic_revise",
            "before_destructive",
            "low_confidence",
            "info_need",
            "quality_gate",
            "user_invoked",
        ):
            sit = CouncilSituation(kind=kind, task_id="t", summary="s")
            assert sit.kind == kind

    def test_literal_rejects_unknown_kind(self) -> None:
        from agent.schemas import CouncilSituation
        with pytest.raises(ValidationError):
            CouncilSituation(
                kind="totally_unknown_kind",  # type: ignore[arg-type]
                task_id="t",
                summary="s",
            )


# ─── 2. Mode picker ──────────────────────────────────────────────────────────


class TestPickOrchestratorModeHighRisk:
    def test_high_risk_action_picks_council_in_auto(self) -> None:
        from agent.operations.orchestrator.modes import pick_orchestrator_mode
        from agent.schemas import CouncilSituation
        sit = CouncilSituation(kind="high_risk_action", task_id="t", summary="s")
        assert pick_orchestrator_mode(sit, user_setting="auto") == "council"

    def test_high_risk_action_in_auto_council_kinds_set(self) -> None:
        from agent.operations.orchestrator.modes import _AUTO_COUNCIL_KINDS
        assert "high_risk_action" in _AUTO_COUNCIL_KINDS, (
            "Phase 23-D regression: high_risk_action dropped out of the auto "
            "council set; the loop's risk gate would silently lose council "
            "consultation."
        )

    def test_user_setting_single_overrides_high_risk(self) -> None:
        """Operator's explicit `single` choice wins over the auto council
        path — they have signalled they want the cheap route even for risky
        asks (the existing risk-gate prompt + phone approval still runs)."""
        from agent.operations.orchestrator.modes import pick_orchestrator_mode
        from agent.schemas import CouncilSituation
        sit = CouncilSituation(kind="high_risk_action", task_id="t", summary="s")
        assert pick_orchestrator_mode(sit, user_setting="single") == "single"

    def test_other_kinds_unaffected_by_high_risk_addition(self) -> None:
        """Adding 'high_risk_action' must not perturb the other kinds'
        behaviour — confirm a 'low_confidence' situation without low
        confidence still yields 'single'."""
        from agent.operations.orchestrator.modes import pick_orchestrator_mode
        from agent.schemas import CouncilSituation, InnerMonologue
        sit = CouncilSituation(
            kind="low_confidence",
            task_id="t",
            summary="s",
            monologue=InnerMonologue(confidence=0.95),
        )
        assert pick_orchestrator_mode(sit, user_setting="auto") == "single"


# ─── 3. Config ───────────────────────────────────────────────────────────────


class TestAgentCouncilForHighRiskSetting:
    def test_default_is_true(self) -> None:
        """Default-on so the safer behaviour is the out-of-the-box one. An
        operator who explicitly wants the legacy direct-to-phone path must
        flip this off in Settings."""
        from config import PhantomConfig
        field = PhantomConfig.model_fields["agent_council_for_high_risk"]
        assert field.default is True
        assert field.annotation is bool

    def test_runtime_config_exposes_attribute(self) -> None:
        from config import config
        assert isinstance(config.agent_council_for_high_risk, bool)


# ─── 4. Settings registry ────────────────────────────────────────────────────


class TestSettingsRegistry:
    def test_agent_category_lists_council_for_high_risk(self) -> None:
        from api.routes_settings import CATEGORY_SPEC
        agent_cat = next(c for c in CATEGORY_SPEC if c["id"] == "agent")
        assert "agent_council_for_high_risk" in agent_cat["keys"], (
            "Phase 23-D regression: settings panel must surface the new "
            "council toggle in the agent category."
        )

    def test_label_override_present(self) -> None:
        from api.routes_settings import LABEL_OVERRIDES
        assert "agent_council_for_high_risk" in LABEL_OVERRIDES
        # Ukrainian-friendly label, non-empty, mentions Council so the
        # operator understands the toggle's semantics.
        label = LABEL_OVERRIDES["agent_council_for_high_risk"]
        assert "Council" in label or "council" in label
        assert len(label) > 5


# ─── 5. Loop integration (source-level + behavioural smoke) ──────────────────


_LOOP_PATH = (
    Path(__file__).resolve().parent.parent / "agent" / "loop.py"
)


class TestLoopIntegration:
    def test_loop_module_calls_maybe_consult_council_with_high_risk(self) -> None:
        """Source-level invariant: the loop.py risk gate carries a literal
        kind="high_risk_action" maybe_consult_council call. We assert on
        the source rather than running the loop because the loop requires
        a fully-wired runtime + planner + registry, none of which we want
        to mock for a wiring regression test."""
        src = _LOOP_PATH.read_text(encoding="utf-8")
        assert 'kind="high_risk_action"' in src, (
            "Phase 23-D regression: loop.py no longer constructs a "
            "CouncilSituation with kind='high_risk_action'. Risk gate "
            "council short-circuit is broken."
        )
        # And the call must use the existing maybe_consult_council adapter
        # (so it inherits broadcast + LLM-fallback semantics).
        assert "maybe_consult_council(" in src

    def test_council_short_circuit_runs_before_phone_approval(self) -> None:
        """Source ordering invariant: the council branch must precede the
        approve-on-phone import inside the risk-gate block. If somebody
        moves the approval first, the operator sees a prompt for an
        action council would otherwise abort."""
        src = _LOOP_PATH.read_text(encoding="utf-8")
        marker_council = 'kind="high_risk_action"'
        marker_phone = "from .approve_on_phone import request_phone_approval"
        idx_council = src.find(marker_council)
        idx_phone = src.find(marker_phone)
        assert idx_council > 0 and idx_phone > 0
        assert idx_council < idx_phone, (
            "Phase 23-D regression: council consult must fire BEFORE "
            "request_phone_approval, otherwise a silent approve-on-phone "
            "race could let a destructive action through."
        )

    def test_council_branch_is_gated_by_setting(self) -> None:
        """The council consult must check `agent_council_for_high_risk`
        so an operator that has flipped the toggle off goes straight to
        the phone/desktop approval path (legacy behaviour)."""
        src = _LOOP_PATH.read_text(encoding="utf-8")
        assert 'agent_council_for_high_risk' in src, (
            "Phase 23-D regression: settings toggle isn't consulted in the "
            "loop's risk gate — the new branch will always fire."
        )

    def test_abort_and_revise_verdicts_are_handled(self) -> None:
        """The blocking branch reacts to BOTH 'abort' and 'revise' — both
        outcomes mean the council does not want this action to execute."""
        src = _LOOP_PATH.read_text(encoding="utf-8")
        # Match the set-literal we wrote, regardless of ordering or quoting
        # style. We just need both verdicts referenced near each other.
        assert '"abort"' in src and '"revise"' in src
        # A council_blocked_risky broadcast category exists so the FE can
        # render a distinct toast/log line for this rejection path.
        assert "council_blocked_risky" in src
