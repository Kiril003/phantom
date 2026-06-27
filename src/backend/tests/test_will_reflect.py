import os
import tempfile
import importlib

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "t")
os.environ.setdefault("AI_GEMINI_API_KEY", "k")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")

from agent.will.types import Goal
from agent.will.reflect import propose_goals


def _g(desc, lvl):
    return Goal(id="x", user_id="u1", parent_id=None, horizon_level=lvl,
                description=desc, status="pending", kpi=None, deadline=None,
                blockers=[], source="seeded")


@pytest.mark.asyncio
async def test_propose_parses_array_and_clamps_horizon():
    async def fake_llm(prompt, system):
        return '[{"description":"Вивчити користувача","horizon_level":9,"rationale":"r"},' \
               '{"description":"Денний ритуал","horizon_level":5}]'
    out = await propose_goals("спостереження", [], dispatch_llm=fake_llm)
    assert len(out) == 2
    assert out[0]["horizon_level"] == 6  # clamped from 9
    assert out[1]["description"] == "Денний ритуал"


@pytest.mark.asyncio
async def test_propose_empty_on_garbage():
    async def fake_llm(prompt, system):
        return "no json"
    assert await propose_goals("x", [], dispatch_llm=fake_llm) == []


@pytest.mark.asyncio
async def test_propose_respects_max_new():
    async def fake_llm(prompt, system):
        return '[{"description":"a","horizon_level":0},{"description":"b","horizon_level":0},' \
               '{"description":"c","horizon_level":0},{"description":"d","horizon_level":0}]'
    out = await propose_goals("x", [], dispatch_llm=fake_llm, max_new=3)
    assert len(out) == 3


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
async def test_reflect_and_seed_persists_self_generated(db_factory):
    from agent.will.reflect import reflect_and_seed
    from agent.will import goals

    async def fake_llm(prompt, system):
        return '[{"description":"Самопороджена ціль","horizon_level":3}]'
    async with db_factory() as db:
        created = await reflect_and_seed(db, "u1", dispatch_llm=fake_llm,
                                         observations="користувач втомлений")
        await db.commit()
    assert len(created) == 1
    async with db_factory() as db:
        active = await goals.list_active(db, "u1")
    assert len(active) == 1
    assert active[0].source == "self_generated"
    assert active[0].description == "Самопороджена ціль"


@pytest.mark.asyncio
async def test_gather_observations_includes_values_and_drives(db_factory):
    """Self-generated goals must serve the entity's values + needs, so the
    reflection context carries the doctrine and the dominant drive."""
    from agent.will.reflect import _gather_observations
    async with db_factory() as db:
        obs = await _gather_observations(db, "u1")
    assert "ЦІННОСТІ" in obs
    assert "Україна понад усе" in obs
    assert "ДОМІНАНТНИЙ ДРАЙВ" in obs
