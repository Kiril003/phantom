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
async def test_seed_and_pick_next_action(db_factory):
    from agent.will import goals
    async with db_factory() as db:
        vid = await goals.seed(db, "u1", "Стати незрівнянним", 0)
        aid = await goals.seed(db, "u1", "Написати модуль", 6, parent_id=vid)
        await db.commit()
    async with db_factory() as db:
        nxt = await goals.pick_next_action(db, "u1")
        assert nxt is not None
        assert nxt.id == aid
        assert nxt.horizon_level == 6


@pytest.mark.asyncio
async def test_set_status_removes_from_active(db_factory):
    from agent.will import goals
    async with db_factory() as db:
        gid = await goals.seed(db, "u1", "ціль", 6)
        await db.commit()
    async with db_factory() as db:
        await goals.set_status(db, gid, "done")
        await db.commit()
    async with db_factory() as db:
        assert await goals.pick_next_action(db, "u1") is None
