"""T1 — AgentChatThread ORM model + migration smoke test."""
from __future__ import annotations

import os
import tempfile

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-v2-t1")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


@pytest_asyncio.fixture
async def db_engine():
    import db.models as _dm  # noqa: F401
    import db.database as _dbm

    fd, path = tempfile.mkstemp(suffix=".db", prefix="phantom_t1_")
    os.close(fd)
    url = f"sqlite+aiosqlite:///{path}"
    engine = create_async_engine(url, echo=False, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.run_sync(_dbm.Base.metadata.create_all)
    yield engine
    await engine.dispose()
    try:
        os.unlink(path)
    except OSError:
        pass


@pytest.mark.asyncio
async def test_table_exists(db_engine):
    async with db_engine.begin() as conn:
        res = await conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_chat_threads'")
        )
        assert res.first() is not None, "agent_chat_threads table not created"


@pytest.mark.asyncio
async def test_insert_and_retrieve(db_engine):
    import uuid
    from datetime import datetime, timezone

    async with db_engine.begin() as conn:
        tid = str(uuid.uuid4())
        mid = str(uuid.uuid4())
        await conn.execute(text(
            "INSERT INTO agent_chat_threads(id, task_id, role, content, created_at) "
            "VALUES (:id, :tid, :role, :content, :ts)"
        ), {"id": mid, "tid": tid, "role": "user", "content": "привіт", "ts": datetime.now(tz=timezone.utc)})
        res = await conn.execute(
            text("SELECT role, content FROM agent_chat_threads WHERE task_id=:tid"),
            {"tid": tid},
        )
        row = res.first()
    assert row is not None
    assert row[0] == "user"
    assert row[1] == "привіт"


@pytest.mark.asyncio
async def test_migration_idempotent(db_engine):
    import importlib
    mod = importlib.import_module("db.migrations.016_agent_chat_thread")
    async with db_engine.begin() as conn:
        await mod.apply(conn)
        await mod.apply(conn)
