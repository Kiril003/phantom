"""Where a will decision actually lands.

Measured 12.09 on the live DB: will_journal held 11 rows, every one
action="proactive_seed" outcome="dispatched". Nothing was dispatched. The
seed went into a process-local dict (agent/consciousness_stream.py:43) whose
only reader is the chat route (api/routes_chat.py:454-461), so the thought
surfaced only if the owner happened to type. These tests pin what each
decision kind does with its thought, and refuse the word "dispatched" to
anything that did not reach a durable reader.
"""
import importlib
import os
import tempfile

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "t")
os.environ.setdefault("AI_GEMINI_API_KEY", "k")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


@pytest_asyncio.fixture
async def db_factory():
    import db.database as dbm
    import db.models as dm  # noqa: F401
    if not dbm.Base.metadata.tables:
        importlib.reload(dm)
    fd, tmp = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    eng = create_async_engine(f"sqlite+aiosqlite:///{tmp}", echo=False)
    async with eng.begin() as conn:
        await conn.run_sync(dbm.Base.metadata.create_all)
    factory = async_sessionmaker(eng, expire_on_commit=False)
    from db.models import User
    async with factory() as s:
        s.add(User(id="u1", username="u1"))
        await s.commit()
    yield factory
    await eng.dispose()
    os.unlink(tmp)


def _engine_with(decision_json: str):
    from agent.will.engine import WillEngine
    eng = WillEngine()

    async def fake_llm(prompt, system):
        return decision_json

    async def fake_values(action_text):
        return type("V", (), {"aligned": True, "confidence": 1.0, "conflicts": []})()

    eng.dispatch_llm = fake_llm
    eng.evaluate_values = fake_values
    return eng


async def _one_goal(db_factory):
    from agent.will import goals
    async with db_factory() as db:
        gid = await goals.seed(db, "u1", "ціль", 6)
        await db.commit()
    return gid


async def _journal(db_factory):
    from agent.will.journal import WillJournalWriter
    async with db_factory() as db:
        return await WillJournalWriter().recent(db, "u1")


# ── proactive_seed — the branch that claimed delivery ────────────────────────

@pytest.mark.asyncio
async def test_proactive_seed_is_not_reported_as_dispatched(db_factory, monkeypatch):
    from config import config
    monkeypatch.setattr(config, "will_enabled", True, raising=False)
    await _one_goal(db_factory)
    eng = _engine_with(
        '{"kind":"proactive_seed","goal_id":null,"action_text":"думка","rationale":"r"}')

    async with db_factory() as db:
        res = await eng.run_once(db, "u1", snapshot={})
        await db.commit()

    assert res.dispatched is False, "a RAM queue only the chat window reads is not a dispatch"
    assert res.note == "seeded_for_next_chat_turn"
    rows = await _journal(db_factory)
    assert rows[0]["outcome"] == "seeded_for_next_chat_turn"
    assert rows[0]["outcome"] != "dispatched"


@pytest.mark.asyncio
async def test_proactive_seed_uses_the_public_queue_api(db_factory, monkeypatch):
    """engine.py:193 used to reach into consciousness_stream._pending_insights
    directly, bypassing push_insight's dedup and backlog cap."""
    from config import config
    from agent.consciousness_stream import consciousness_stream
    monkeypatch.setattr(config, "will_enabled", True, raising=False)
    consciousness_stream._pending_insights.pop("u1", None)
    await _one_goal(db_factory)
    eng = _engine_with(
        '{"kind":"proactive_seed","goal_id":null,"action_text":"та сама думка","rationale":"r"}')

    for _ in range(3):
        async with db_factory() as db:
            await eng.run_once(db, "u1", snapshot={})
            await db.commit()

    queue = consciousness_stream._pending_insights.get("u1", [])
    assert queue == ["та сама думка"], f"dedup did not apply: {queue}"
    consciousness_stream._pending_insights.pop("u1", None)


# ── standing_order — a durable destination that exists and was unused ────────

@pytest.mark.asyncio
async def test_standing_order_with_schedule_lands_in_the_table(db_factory, monkeypatch):
    from config import config
    from db.models import StandingOrder
    monkeypatch.setattr(config, "will_enabled", True, raising=False)
    monkeypatch.setattr(config, "agent_standing_orders_enabled", True, raising=False)
    gid = await _one_goal(db_factory)
    eng = _engine_with(
        '{"kind":"standing_order","goal_id":"%s","action_text":"щоранку зводити пошту",'
        '"rationale":"r","schedule":{"kind":"interval","every_s":3600}}' % gid)

    async with db_factory() as db:
        res = await eng.run_once(db, "u1", snapshot={})
        await db.commit()

    assert res.dispatched is True
    assert res.note.startswith("standing_order_filed:")

    async with db_factory() as db:
        rows = (await db.execute(select(StandingOrder))).scalars().all()
    assert len(rows) == 1
    row = rows[0]
    assert row.user_id == "u1"
    assert row.kind == "interval"
    assert row.enabled is True
    assert row.action_kind == "task"
    # The runner must be able to parse back what the will wrote.
    from agent.operations.standing_orders.schedules import parse_schedule
    from agent.operations.standing_orders.actions import parse_action
    import json
    assert parse_schedule(json.loads(row.schedule_json)).every_s == 3600
    assert parse_action(json.loads(row.action_json)).goal == "щоранку зводити пошту"


@pytest.mark.asyncio
async def test_standing_order_without_schedule_is_refused_not_faked(db_factory, monkeypatch):
    """A rule with no cadence is not a rule. Guessing one would schedule work
    the will never asked for, so the engine refuses and says so."""
    from config import config
    from db.models import StandingOrder
    monkeypatch.setattr(config, "will_enabled", True, raising=False)
    monkeypatch.setattr(config, "agent_standing_orders_enabled", True, raising=False)
    await _one_goal(db_factory)
    eng = _engine_with(
        '{"kind":"standing_order","goal_id":null,"action_text":"щось робити","rationale":"r"}')

    async with db_factory() as db:
        res = await eng.run_once(db, "u1", snapshot={})
        await db.commit()

    assert res.dispatched is False
    assert res.note == "standing_order_refused:no_schedule"
    async with db_factory() as db:
        rows = (await db.execute(select(StandingOrder))).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_standing_order_with_junk_schedule_is_refused(db_factory, monkeypatch):
    from config import config
    from db.models import StandingOrder
    monkeypatch.setattr(config, "will_enabled", True, raising=False)
    monkeypatch.setattr(config, "agent_standing_orders_enabled", True, raising=False)
    await _one_goal(db_factory)
    eng = _engine_with(
        '{"kind":"standing_order","goal_id":null,"action_text":"x","rationale":"r",'
        '"schedule":{"kind":"interval","every_s":-5}}')

    async with db_factory() as db:
        res = await eng.run_once(db, "u1", snapshot={})
        await db.commit()

    assert res.dispatched is False
    assert res.note == "standing_order_refused:invalid_schedule"
    async with db_factory() as db:
        assert (await db.execute(select(StandingOrder))).scalars().all() == []


@pytest.mark.asyncio
async def test_standing_order_refused_when_runner_is_off(db_factory, monkeypatch):
    """Filing into a table nobody polls would be the same lie one layer down."""
    from config import config
    from db.models import StandingOrder
    monkeypatch.setattr(config, "will_enabled", True, raising=False)
    monkeypatch.setattr(config, "agent_standing_orders_enabled", False, raising=False)
    await _one_goal(db_factory)
    eng = _engine_with(
        '{"kind":"standing_order","goal_id":null,"action_text":"x","rationale":"r",'
        '"schedule":{"kind":"interval","every_s":60}}')

    async with db_factory() as db:
        res = await eng.run_once(db, "u1", snapshot={})
        await db.commit()

    assert res.dispatched is False
    assert res.note == "standing_order_refused:runner_disabled"
    async with db_factory() as db:
        assert (await db.execute(select(StandingOrder))).scalars().all() == []


# ── start_task — queued in RAM is not started ────────────────────────────────

@pytest.mark.asyncio
async def test_queued_task_is_not_called_dispatched(db_factory, monkeypatch):
    """runtime.start_task returns (id, False) when it only appended to an
    in-memory deque (runtime.py:622-633) — no agent_tasks row, nothing survives
    a restart. The old `bool(started or task_id)` called that dispatched."""
    from config import config
    from agent.will import goals
    monkeypatch.setattr(config, "will_enabled", True, raising=False)
    gid = await _one_goal(db_factory)
    eng = _engine_with(
        '{"kind":"start_task","goal_id":"%s","action_text":"робота","rationale":"r"}' % gid)

    async def queued_start_task(**kwargs):
        return ("queued-1", False)

    eng.start_task = queued_start_task

    async with db_factory() as db:
        res = await eng.run_once(db, "u1", snapshot={})
        await db.commit()

    assert res.dispatched is False
    assert res.note == "queued_in_memory:queued-1"
    # And the goal must NOT be marked running for a task that never ran —
    # that is what pinned 20 goals at the ceiling.
    async with db_factory() as db:
        active = await goals.list_active(db, "u1")
    assert [g.status for g in active] == ["pending"]


@pytest.mark.asyncio
async def test_really_started_task_marks_goal_running(db_factory, monkeypatch):
    from config import config
    from agent.will import goals
    monkeypatch.setattr(config, "will_enabled", True, raising=False)
    gid = await _one_goal(db_factory)
    eng = _engine_with(
        '{"kind":"start_task","goal_id":"%s","action_text":"робота","rationale":"r"}' % gid)

    async def real_start_task(**kwargs):
        return ("task-9", True)

    eng.start_task = real_start_task

    async with db_factory() as db:
        res = await eng.run_once(db, "u1", snapshot={})
        await db.commit()

    assert res.dispatched is True
    assert res.note == "dispatched"
    async with db_factory() as db:
        active = await goals.list_active(db, "u1")
    assert [g.status for g in active] == ["running"]
