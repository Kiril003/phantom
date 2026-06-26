import os
import tempfile
import importlib

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-will-mig")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


@pytest.mark.asyncio
async def test_create_all_makes_will_tables_and_goal_source():
    import db.database as dbm
    import db.models as dm  # noqa: F401
    if not dbm.Base.metadata.tables:
        importlib.reload(dm)
    fd, tmp = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    eng = create_async_engine(f"sqlite+aiosqlite:///{tmp}", echo=False)
    async with eng.begin() as conn:
        await conn.run_sync(dbm.Base.metadata.create_all)
    async with eng.begin() as conn:
        tabs = (await conn.execute(text(
            "select name from sqlite_master where type='table'"))).scalars().all()
        cols = [r[1] for r in (await conn.execute(text(
            "pragma table_info(goals_persistent)"))).all()]
    assert "will_budget_ledger" in tabs
    assert "will_journal" in tabs
    assert "source" in cols
    await eng.dispose()
    os.unlink(tmp)
