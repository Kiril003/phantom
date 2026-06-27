import os
import tempfile
import importlib
from datetime import datetime

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
async def test_orient_bootstrap_reflects_when_no_goals(db_factory, monkeypatch):
    from agent.will.engine import WillEngine
    from agent.will import goals
    from config import config
    monkeypatch.setattr(config, "will_enabled", True, raising=False)

    async def fake_llm(prompt, system):
        return '[{"description":"Перша самопороджена ціль","horizon_level":1}]'
    eng = WillEngine()
    eng.dispatch_llm = fake_llm
    async with db_factory() as db:
        note = await eng.orient(db, "u1", [], now=datetime(2026, 6, 27, 12, 0))
        await db.commit()
    assert "reflected:1" in note
    async with db_factory() as db:
        active = await goals.list_active(db, "u1")
    assert any(g.source == "self_generated" for g in active)


@pytest.mark.asyncio
async def test_orient_decomposes_high_horizon_childless_goal(db_factory):
    from agent.will.engine import WillEngine
    from agent.will import goals

    async def fake_llm(prompt, system):
        return '["рік-крок 1", "рік-крок 2"]'
    eng = WillEngine()
    eng.dispatch_llm = fake_llm
    async with db_factory() as db:
        vid = await goals.seed(db, "u1", "VISION", 0)
        await db.commit()
    async with db_factory() as db:
        active = await goals.list_active(db, "u1")
        note = await eng.orient(db, "u1", active, now=datetime(2026, 6, 27, 12, 0))
        await db.commit()
    assert "decomposed:2" in note
    async with db_factory() as db:
        kids = await goals.children(db, "u1", vid)
    assert len(kids) == 2
    assert all(k.horizon_level == 1 for k in kids)


@pytest.mark.asyncio
async def test_orient_scheduled_reflect_only_once_per_day(db_factory, monkeypatch):
    from agent.will.engine import WillEngine
    from agent.will import goals
    from config import config
    monkeypatch.setattr(config, "will_reflect_hour_local", 4, raising=False)

    calls = {"n": 0}

    async def fake_llm(prompt, system):
        calls["n"] += 1
        return "[]"  # no new goals, but counts as a reflect attempt
    eng = WillEngine()
    eng.dispatch_llm = fake_llm
    async with db_factory() as db:
        await goals.seed(db, "u1", "наявна ціль", 6)
        await db.commit()
    at4 = datetime(2026, 6, 27, 4, 30)
    async with db_factory() as db:
        active = await goals.list_active(db, "u1")
        await eng.orient(db, "u1", active, now=at4)
        await db.commit()
    async with db_factory() as db:
        active = await goals.list_active(db, "u1")
        await eng.orient(db, "u1", active, now=at4)  # same day → no second reflect
        await db.commit()
    # ACTION-level goal has no decompose; reflect should fire exactly once.
    assert calls["n"] == 1
