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
from agent.will.decompose import propose_children


def _g(gid, lvl, desc, source="seeded"):
    return Goal(id=gid, user_id="u1", parent_id=None, horizon_level=lvl,
                description=desc, status="pending", kpi=None, deadline=None,
                blockers=[], source=source)


@pytest.mark.asyncio
async def test_propose_children_parses_list():
    async def fake_llm(prompt, system):
        return '["крок А", "крок Б", "крок В"]'
    out = await propose_children(_g("g1", 0, "Стати незрівнянним"), dispatch_llm=fake_llm)
    assert out == ["крок А", "крок Б", "крок В"]


@pytest.mark.asyncio
async def test_action_level_goal_is_leaf():
    called = False

    async def fake_llm(prompt, system):
        nonlocal called
        called = True
        return "[]"
    out = await propose_children(_g("g1", 6, "дрібний крок"), dispatch_llm=fake_llm)
    assert out == []
    assert called is False


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
async def test_decompose_goal_seeds_children_under_parent(db_factory):
    from agent.will.decompose import decompose_goal
    from agent.will import goals

    async def fake_llm(prompt, system):
        return '["підціль 1", "підціль 2"]'
    async with db_factory() as db:
        pid = await goals.seed(db, "u1", "Велика ціль", 2, source="seeded")
        await db.commit()
    async with db_factory() as db:
        parent = (await goals.list_active(db, "u1"))[0]
        created = await decompose_goal(db, "u1", parent, dispatch_llm=fake_llm)
        await db.commit()
    assert len(created) == 2
    async with db_factory() as db:
        kids = await goals.children(db, "u1", pid)
    assert len(kids) == 2
    assert all(k.horizon_level == 3 for k in kids)
    assert all(k.parent_id == pid for k in kids)
