from agent.will.types import Goal, WillDecision, Budget, WillTickResult


def test_budget_ok_until_caps():
    b = Budget(calls_used=10, tokens_used=100, calls_cap=200, tokens_cap=300_000)
    assert b.ok is True
    spent = Budget(calls_used=200, tokens_used=0, calls_cap=200, tokens_cap=300_000)
    assert spent.ok is False
    toks = Budget(calls_used=0, tokens_used=300_000, calls_cap=200, tokens_cap=300_000)
    assert toks.ok is False


def test_decision_defaults_to_noop():
    d = WillDecision(kind="noop")
    assert d.kind == "noop"
    assert d.goal_id is None and d.rationale == ""


def test_goal_is_immutable():
    g = Goal(id="g1", user_id="u1", parent_id=None, horizon_level=0,
             description="vision", status="pending", kpi=None, deadline=None,
             blockers=[], source="seeded")
    import dataclasses
    import pytest
    with pytest.raises(dataclasses.FrozenInstanceError):
        g.status = "done"  # type: ignore[misc]
