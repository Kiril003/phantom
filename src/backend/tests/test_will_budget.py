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
async def test_spend_accumulates_and_gate_closes(db_factory):
    from agent.will.budget import BudgetGovernor
    from config import config
    gov = BudgetGovernor()
    async with db_factory() as db:
        assert await gov.can_spend(db, "u1", today="2026-06-26") is True
        await gov.note_spend(db, "u1", calls=config.will_daily_llm_calls, tokens=0, today="2026-06-26")
        await db.commit()
    async with db_factory() as db:
        assert await gov.can_spend(db, "u1", today="2026-06-26") is False
        assert await gov.can_spend(db, "u1", today="2026-06-27") is True


@pytest.mark.asyncio
async def test_remaining_reports_caps(db_factory):
    from agent.will.budget import BudgetGovernor
    gov = BudgetGovernor()
    async with db_factory() as db:
        await gov.note_spend(db, "u1", calls=5, tokens=1000, today="2026-06-26")
        await db.commit()
    async with db_factory() as db:
        b = await gov.remaining(db, "u1", today="2026-06-26")
        assert b.calls_used == 5 and b.tokens_used == 1000
