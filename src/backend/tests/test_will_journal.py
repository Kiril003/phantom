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
    yield factory
    await eng.dispose()
    os.unlink(tmp)


@pytest.mark.asyncio
async def test_record_and_recent(db_factory):
    from agent.will.journal import WillJournalWriter
    from agent.will.types import WillDecision
    w = WillJournalWriter()
    async with db_factory() as db:
        await w.record(db, "u1", WillDecision(kind="start_task", goal_id="g1",
                       action_text="підготувати маршрут", rationale="бо deadline"),
                       task_id="t1", outcome="dispatched", budget_delta={"calls": 1})
        await db.commit()
    async with db_factory() as db:
        rows = await w.recent(db, "u1", n=5)
    assert len(rows) == 1
    assert rows[0]["action"] == "start_task"
    assert rows[0]["task_id"] == "t1"
    assert "маршрут" in rows[0]["decision"]["action_text"]
