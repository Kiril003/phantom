import pytest

from agent.will.types import Goal, Budget
from agent.will.decide import decide_next


def _g(gid, lvl, desc):
    return Goal(id=gid, user_id="u1", parent_id=None, horizon_level=lvl,
                description=desc, status="pending", kpi=None, deadline=None,
                blockers=[], source="seeded")


@pytest.mark.asyncio
async def test_decide_returns_single_action():
    async def fake_llm(prompt, system):
        return '{"kind":"start_task","goal_id":"a1","action_text":"написати тест","rationale":"перший крок"}'
    d = await decide_next({"when": {"time": "10:00"}},
                          [_g("a1", 6, "написати тест")],
                          Budget(0, 0, 200, 300_000), dispatch_llm=fake_llm)
    assert d.kind == "start_task"
    assert d.goal_id == "a1"
    assert d.action_text == "написати тест"


@pytest.mark.asyncio
async def test_decide_noop_on_empty_goals():
    called = False

    async def fake_llm(prompt, system):
        nonlocal called
        called = True
        return "{}"
    d = await decide_next({}, [], Budget(0, 0, 200, 300_000), dispatch_llm=fake_llm)
    assert d.kind == "noop"
    assert called is False


@pytest.mark.asyncio
async def test_decide_tolerates_fenced_json():
    async def fake_llm(prompt, system):
        return '```json\n{"kind":"proactive_seed","action_text":"нагадати про воду"}\n```'
    d = await decide_next({}, [_g("a1", 5, "здоровʼя")], Budget(0, 0, 200, 300_000), dispatch_llm=fake_llm)
    assert d.kind == "proactive_seed"
    assert d.action_text == "нагадати про воду"


@pytest.mark.asyncio
async def test_decide_noop_on_garbage():
    async def fake_llm(prompt, system):
        return "not json at all"
    d = await decide_next({}, [_g("a1", 6, "x")], Budget(0, 0, 200, 300_000), dispatch_llm=fake_llm)
    assert d.kind == "noop"
