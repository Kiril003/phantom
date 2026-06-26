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
async def test_seed_goal_action_persists(db_factory):
    from agent.actions.will_seed import seed_goal
    async with db_factory() as db:
        out = await seed_goal(db, "u1", description="Стати незрівнянним", horizon_level=0)
        await db.commit()
    assert out["ok"] is True
    from agent.will import goals
    async with db_factory() as db:
        active = await goals.list_active(db, "u1")
    assert any(g.description == "Стати незрівнянним" for g in active)


@pytest.mark.asyncio
async def test_status_action_reads_tree_and_journal(db_factory):
    from agent.actions.will_status import will_status
    from agent.will import goals
    async with db_factory() as db:
        await goals.seed(db, "u1", "ціль дня", 5)
        await db.commit()
    async with db_factory() as db:
        out = await will_status(db, "u1")
    assert out["ok"] is True
    assert out["active_goals"] >= 1


def test_actions_registered():
    from agent.actions.registry import _REGISTERED
    names = {cls.name for cls in _REGISTERED}
    assert "will.seed_goal" in names
    assert "will.status" in names
