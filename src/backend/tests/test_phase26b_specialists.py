"""
Phase 26-B — Specialist registry + LLM/heuristic picker.

The catalog is the source-of-truth for "who can the planner spawn".
The picker is the autonomous decision-maker that says "given THIS
goal, here's WHO + HOW MANY".

Tests cover:
  • All 18 roles registered, organised across 5 departments
  • Each Specialist has goal_template + risk_ceiling + tool_filter
  • shape_goal interpolates {{task}} OR appends as a "ЗАВДАННЯ:" block
  • specialist_catalog is JSON-safe (for LLM prompt injection)
  • Picker disabled path returns empty plan
  • Picker LLM happy path parses JSON + maps to TeamPlan
  • Picker LLM JSON parse failure falls back to heuristic
  • Picker rejects unknown roles
  • Picker caps total spawns at budget
  • Picker clamps count + timeout to safe ranges
  • Heuristic matches keywords (security → senior_security + pen_tester)
  • Heuristic returns empty when nothing matches
"""
from __future__ import annotations

import os

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase26b")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


# ─── 1. Registry ────────────────────────────────────────────────────────────


class TestRegistry:
    def test_eighteen_specialists(self) -> None:
        from agent.team.specialists import all_specialists
        roles = all_specialists()
        assert len(roles) == 18, (
            "Phase 26-B regression: specialist count drifted from 18. "
            "If you added/removed roles, update this test alongside the "
            "departments distribution."
        )

    def test_five_departments(self) -> None:
        from agent.team.specialists import departments
        depts = set(departments())
        assert depts == {
            "engineering", "product", "qa", "research", "operations",
        }

    def test_each_role_unique_name(self) -> None:
        from agent.team.specialists import all_specialists
        names = [s.name for s in all_specialists()]
        assert len(names) == len(set(names))

    def test_each_role_has_goal_template_with_task_or_appendable(self) -> None:
        from agent.team.specialists import all_specialists
        for s in all_specialists():
            assert s.goal_template.strip(), f"{s.name} empty goal_template"
            # Either a {{task}} placeholder OR appendable preamble — both
            # work via shape_goal. We just need one or the other.
            assert "{{task}}" in s.goal_template or len(s.goal_template) > 30

    def test_risk_ceilings_in_valid_range(self) -> None:
        """Risk ceiling must map to a real RiskLevel value (1/3/5/7)."""
        from agent.team.specialists import all_specialists
        from agent.schemas import RiskLevel
        valid = {int(r) for r in RiskLevel}
        for s in all_specialists():
            assert s.risk_ceiling in valid, (
                f"{s.name}: risk_ceiling {s.risk_ceiling} not in {valid}"
            )

    def test_security_roles_are_safe_only(self) -> None:
        """senior_security + senior_architect + pm + ux + designer +
        researchers are advisors — they should NOT execute prod code.
        Risk ceiling SAFE (1)."""
        from agent.team.specialists import get_specialist
        for safe_role in (
            "senior_security", "senior_architect",
            "product_manager", "ux_researcher", "designer",
            "domain_researcher", "osint",
        ):
            s = get_specialist(safe_role)
            assert s is not None, safe_role
            assert s.risk_ceiling == 1, (
                f"{safe_role}: expected SAFE (1), got {s.risk_ceiling}"
            )

    def test_engineering_roles_can_write(self) -> None:
        """senior_backend / senior_frontend / senior_devops can fs.write."""
        from agent.team.specialists import get_specialist
        for role in ("senior_backend", "senior_frontend", "senior_devops"):
            s = get_specialist(role)
            assert s.risk_ceiling >= 5, role


# ─── 2. shape_goal helper ────────────────────────────────────────────────────


class TestShapeGoal:
    def test_placeholder_substituted(self) -> None:
        from agent.team.specialists import get_specialist
        s = get_specialist("senior_backend")
        out = s.shape_goal("write a /metrics endpoint")
        assert "{{task}}" not in out
        assert "write a /metrics endpoint" in out
        assert "Python 3.11" in out  # role preamble survived

    def test_no_placeholder_appends_task_block(self) -> None:
        """If a goal_template has no {{task}}, shape_goal appends as
        'ЗАВДАННЯ: <task>'. Only relevant if a future role drops the
        placeholder."""
        from agent.team.specialists import Specialist
        s = Specialist(
            name="x", department="x", description="x",
            goal_template="just a preamble without placeholder",
        )
        out = s.shape_goal("the actual task")
        assert "ЗАВДАННЯ: the actual task" in out


# ─── 3. specialist_catalog (LLM prompt-safe) ────────────────────────────────


class TestCatalog:
    def test_catalog_is_json_safe(self) -> None:
        import json
        from agent.team.specialists import specialist_catalog
        # round-trip through json so we know the LLM prompt builder
        # can safely render it without escaping issues.
        rows = specialist_catalog()
        text = json.dumps(rows, ensure_ascii=False)
        loaded = json.loads(text)
        assert len(loaded) == 18
        for row in loaded:
            assert {"name", "department", "description",
                    "risk_ceiling", "tool_count", "personality"} <= row.keys()


# ─── 4. Picker — disabled / heuristic ──────────────────────────────────────


class TestPickerDisabled:
    @pytest.mark.asyncio
    async def test_returns_empty_when_team_disabled(self, monkeypatch) -> None:
        from agent.team.picker import pick_specialists
        from config import config
        monkeypatch.setattr(config, "agent_team_enabled", False)
        plan = await pick_specialists(goal="anything")
        assert plan.members == []
        assert plan.generation_strategy == "deterministic"


class TestHeuristic:
    def test_security_keywords_pull_security_team(self) -> None:
        from agent.team.picker import heuristic_pick
        plan = heuristic_pick(
            goal="audit the auth module for OWASP top 10 vulnerabilities",
            budget=8,
        )
        roles = {m.role for m in plan.members}
        assert "senior_security" in roles
        assert "pen_tester" in roles
        assert plan.generation_strategy == "deterministic"

    def test_test_keywords_pull_test_engineer(self) -> None:
        from agent.team.picker import heuristic_pick
        plan = heuristic_pick(
            goal="write coverage for the new pytest fixtures", budget=8,
        )
        assert any(m.role == "senior_test" for m in plan.members)

    def test_no_match_yields_empty_plan(self) -> None:
        from agent.team.picker import heuristic_pick
        plan = heuristic_pick(goal="hello world", budget=8)
        assert plan.members == []

    def test_budget_caps_member_count(self) -> None:
        from agent.team.picker import heuristic_pick
        plan = heuristic_pick(
            # Goal mentions enough to trigger MANY rules
            goal=(
                "audit security backend frontend tests docs incident perf "
                "deploy design ux architecture data research translate"
            ),
            budget=3,
        )
        assert plan.total_spawns() <= 3


# ─── 5. Picker LLM happy path with mocked router ────────────────────────────


class _FakeResponse:
    def __init__(self, content: str) -> None:
        self.content = content


class _FakeRouter:
    def __init__(self, content: str) -> None:
        self._content = content

    async def generate(self, **_kw):
        return _FakeResponse(self._content)


class TestPickerLLM:
    @pytest.mark.asyncio
    async def test_parses_valid_json_into_team_plan(self, monkeypatch) -> None:
        from agent.team.picker import pick_specialists
        valid = (
            '{"rationale":"need security + tests",'
            '"members":['
            '  {"role":"senior_security","count":1,"sub_goal":"audit auth.py","constraints":"","timeout_s":300},'
            '  {"role":"senior_test","count":2,"sub_goal":"write regression tests","constraints":"","timeout_s":600}'
            ']}'
        )
        monkeypatch.setattr("ai.provider.ai_router", _FakeRouter(valid))
        plan = await pick_specialists(goal="audit + harden auth", budget=8)
        assert plan.generation_strategy == "llm"
        assert len(plan.members) == 2
        assert plan.members[0].role == "senior_security"
        assert plan.members[1].count == 2
        assert plan.total_spawns() == 3

    @pytest.mark.asyncio
    async def test_strips_markdown_fences(self, monkeypatch) -> None:
        from agent.team.picker import pick_specialists
        wrapped = (
            "```json\n"
            '{"rationale":"x","members":[{"role":"documentation_writer",'
            '"count":1,"sub_goal":"draft README","constraints":"",'
            '"timeout_s":300}]}\n```'
        )
        monkeypatch.setattr("ai.provider.ai_router", _FakeRouter(wrapped))
        plan = await pick_specialists(goal="write README", budget=8)
        assert plan.generation_strategy == "llm"
        assert plan.members[0].role == "documentation_writer"

    @pytest.mark.asyncio
    async def test_unknown_role_silently_dropped(self, monkeypatch) -> None:
        """LLM hallucinates a role that isn't in the registry — the
        coercer drops it instead of crashing the picker."""
        from agent.team.picker import pick_specialists
        bad = (
            '{"rationale":"bad","members":['
            '{"role":"made_up_role","count":1,"sub_goal":"x","constraints":"","timeout_s":300},'
            '{"role":"senior_backend","count":1,"sub_goal":"valid","constraints":"","timeout_s":300}'
            ']}'
        )
        monkeypatch.setattr("ai.provider.ai_router", _FakeRouter(bad))
        plan = await pick_specialists(goal="x", budget=8)
        roles = {m.role for m in plan.members}
        assert "made_up_role" not in roles
        assert "senior_backend" in roles

    @pytest.mark.asyncio
    async def test_budget_cap_enforced(self, monkeypatch) -> None:
        from agent.team.picker import pick_specialists
        bad = (
            '{"rationale":"too greedy","members":['
            '{"role":"senior_backend","count":5,"sub_goal":"x","constraints":"","timeout_s":300},'
            '{"role":"senior_test","count":5,"sub_goal":"x","constraints":"","timeout_s":300}'
            ']}'
        )
        monkeypatch.setattr("ai.provider.ai_router", _FakeRouter(bad))
        plan = await pick_specialists(goal="x", budget=4)
        assert plan.total_spawns() <= 4

    @pytest.mark.asyncio
    async def test_count_clamped_to_one_to_five(self, monkeypatch) -> None:
        from agent.team.picker import pick_specialists
        bad = (
            '{"rationale":"x","members":['
            '{"role":"senior_backend","count":99,"sub_goal":"x","constraints":"","timeout_s":300}'
            ']}'
        )
        monkeypatch.setattr("ai.provider.ai_router", _FakeRouter(bad))
        plan = await pick_specialists(goal="x", budget=8)
        assert plan.members[0].count == 5

    @pytest.mark.asyncio
    async def test_timeout_clamped(self, monkeypatch) -> None:
        from agent.team.picker import pick_specialists
        bad = (
            '{"rationale":"x","members":['
            '{"role":"senior_backend","count":1,"sub_goal":"x","constraints":"","timeout_s":99999}'
            ']}'
        )
        monkeypatch.setattr("ai.provider.ai_router", _FakeRouter(bad))
        plan = await pick_specialists(goal="x", budget=8)
        assert plan.members[0].timeout_s == 1800

    @pytest.mark.asyncio
    async def test_invalid_json_falls_back_to_heuristic(self, monkeypatch) -> None:
        from agent.team.picker import pick_specialists
        monkeypatch.setattr(
            "ai.provider.ai_router",
            _FakeRouter("not even json"),
        )
        plan = await pick_specialists(
            goal="audit security of auth", budget=8,
        )
        # Heuristic still finds security keywords.
        assert plan.generation_strategy == "deterministic"
        assert any(m.role == "senior_security" for m in plan.members)

    @pytest.mark.asyncio
    async def test_router_exception_falls_back_to_heuristic(self, monkeypatch) -> None:
        from agent.team.picker import pick_specialists

        class _BoomRouter:
            async def generate(self, **_kw):
                raise RuntimeError("offline")

        monkeypatch.setattr("ai.provider.ai_router", _BoomRouter())
        plan = await pick_specialists(
            goal="write regression tests for the new endpoint", budget=8,
        )
        assert plan.generation_strategy == "deterministic"
        assert any(m.role == "senior_test" for m in plan.members)


# ─── 6. Public surface ──────────────────────────────────────────────────────


class TestPublicSurface:
    def test_team_module_re_exports(self) -> None:
        from agent.team import (
            Specialist,
            TeamMemberRequest,
            TeamPlan,
            all_specialists,
            departments,
            get_specialist,
            heuristic_pick,
            pick_specialists,
            specialist_catalog,
            specialists_by_department,
        )
        assert callable(pick_specialists)
        assert callable(heuristic_pick)
        assert get_specialist("senior_backend") is not None
