import os
import tempfile
import importlib

import pytest
import pytest_asyncio
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


@pytest.mark.asyncio
async def test_tick_dispatches_start_task_and_journals(db_factory, monkeypatch):
    from agent.will.engine import WillEngine
    from agent.will import goals
    from config import config
    monkeypatch.setattr(config, "will_enabled", True, raising=False)
    async with db_factory() as db:
        await goals.seed(db, "u1", "написати модуль", 6)
        await db.commit()

    eng = WillEngine()

    async def fake_llm(prompt, system):
        gid = None
        for line in prompt.splitlines():
            if "id=" in line:
                gid = line.split("id=")[1].split(",")[0]
        return f'{{"kind":"start_task","goal_id":"{gid}","action_text":"крок","rationale":"r"}}'

    started = {}

    async def fake_start_task(**kwargs):
        started.update(kwargs)
        return ("task-123", True)

    eng.dispatch_llm = fake_llm
    eng.start_task = fake_start_task

    async with db_factory() as db:
        res = await eng.run_once(db, "u1", snapshot={"when": {"time": "10:00"}})
        await db.commit()
    assert res.dispatched is True
    assert res.task_id == "task-123"
    assert started["origin"] == "will"
    assert started["track"] == "background"

    from agent.will.journal import WillJournalWriter
    async with db_factory() as db:
        rows = await WillJournalWriter().recent(db, "u1")
    assert rows and rows[0]["action"] == "start_task"


@pytest.mark.asyncio
async def test_tick_noops_when_disabled(db_factory, monkeypatch):
    from agent.will.engine import WillEngine
    from config import config
    monkeypatch.setattr(config, "will_enabled", False, raising=False)
    eng = WillEngine()
    async with db_factory() as db:
        res = await eng.run_once(db, "u1", snapshot={})
    assert res.dispatched is False
    assert res.note == "disabled"


@pytest.mark.asyncio
async def test_tick_stops_when_budget_spent(db_factory, monkeypatch):
    from agent.will.engine import WillEngine
    from agent.will import goals
    from agent.will.budget import BudgetGovernor
    from config import config
    monkeypatch.setattr(config, "will_enabled", True, raising=False)
    async with db_factory() as db:
        await goals.seed(db, "u1", "ціль", 6)
        await BudgetGovernor().note_spend(db, "u1", calls=config.will_daily_llm_calls, tokens=0)
        await db.commit()
    eng = WillEngine()
    async with db_factory() as db:
        res = await eng.run_once(db, "u1", snapshot={})
    assert res.dispatched is False
    assert res.note == "budget_exhausted"
