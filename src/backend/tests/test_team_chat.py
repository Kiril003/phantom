"""Unit tests for Team Chat database models, migrations, helpers, and API endpoints."""
from __future__ import annotations

import os
import tempfile
import pytest
import pytest_asyncio
import uuid
import json
from datetime import datetime, timezone
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-team-chat")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


@pytest_asyncio.fixture
async def db_engine():
    import db.models as _dm  # noqa: F401
    import db.database as _dbm

    fd, path = tempfile.mkstemp(suffix=".db", prefix="phantom_team_")
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
async def test_team_chat_table_exists(db_engine):
    async with db_engine.begin() as conn:
        res = await conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='team_chat_messages'")
        )
        assert res.first() is not None, "team_chat_messages table not created"


@pytest.mark.asyncio
async def test_team_chat_migration_idempotent(db_engine):
    import importlib
    mod = importlib.import_module("db.migrations.020_team_chat_table")
    async with db_engine.begin() as conn:
        await mod.apply(conn)
        await mod.apply(conn)


@pytest.mark.asyncio
async def test_team_chat_insert_and_retrieve(db_engine):
    async with db_engine.begin() as conn:
        tid = str(uuid.uuid4())
        mid = str(uuid.uuid4())
        await conn.execute(text(
            "INSERT INTO team_chat_messages(id, task_id, sender, receiver, message, message_type, media_json, created_at) "
            "VALUES (:id, :tid, :sender, :receiver, :message, :message_type, :media_json, :ts)"
        ), {
            "id": mid,
            "tid": tid,
            "sender": "CEO",
            "receiver": "Developer",
            "message": "Привіт розробнику",
            "message_type": "text",
            "media_json": json.dumps([{"type": "file", "path": "/foo.txt", "name": "foo.txt"}]),
            "ts": datetime.now(tz=timezone.utc)
        })
        res = await conn.execute(
            text("SELECT sender, receiver, message, media_json FROM team_chat_messages WHERE task_id=:tid"),
            {"tid": tid},
        )
        row = res.first()
    assert row is not None
    assert row[0] == "CEO"
    assert row[1] == "Developer"
    assert row[2] == "Привіт розробнику"
    media = json.loads(row[3])
    assert len(media) == 1
    assert media[0]["path"] == "/foo.txt"


@pytest.mark.asyncio
async def test_write_team_message_helper(monkeypatch, db_engine):
    # Mock database session to use our test engine
    from db import database
    # Hand-roll a session manager yielding sessions bound to db_engine
    from sqlalchemy.ext.asyncio import async_sessionmaker
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    
    class FakeSessionContext:
        async def __aenter__(self):
            self.session = session_factory()
            return self.session
        async def __aexit__(self, exc_type, exc_val, exc_tb):
            if exc_type is not None:
                await self.session.rollback()
            else:
                await self.session.commit()
            await self.session.close()

    # audit binds get_session at import time, so patching db.database alone
    # only works when no earlier test imported audit.
    import agent.kernel.audit as audit_mod
    monkeypatch.setattr(database, "get_session", lambda: FakeSessionContext())
    monkeypatch.setattr(audit_mod, "get_session", lambda: FakeSessionContext())

    # Mock agent_runtime._broadcast so it doesn't crash on uninitialized runtime
    broadcast_events = []
    class FakeRuntime:
        async def _broadcast(self, event, payload):
            broadcast_events.append((event, payload))
            
    from agent.kernel import runtime
    monkeypatch.setattr(runtime, "agent_runtime", FakeRuntime())

    from agent.kernel.audit import write_team_message
    tid = str(uuid.uuid4())
    await write_team_message(
        task_id=tid,
        sender="Product Manager",
        receiver="QA",
        message="Почни тестування",
        message_type="delegate",
        media=[{"type": "image", "path": "/screenshot.png", "name": "screenshot.png"}]
    )

    # Verify database entry
    async with db_engine.begin() as conn:
        res = await conn.execute(
            text("SELECT sender, receiver, message, message_type, media_json FROM team_chat_messages WHERE task_id=:tid"),
            {"tid": tid},
        )
        row = res.first()
    assert row is not None
    assert row[0] == "Product Manager"
    assert row[1] == "QA"
    assert row[2] == "Почни тестування"
    assert row[3] == "delegate"
    media = json.loads(row[4])
    assert media[0]["name"] == "screenshot.png"

    # Verify WS broadcast
    assert len(broadcast_events) == 1
    assert broadcast_events[0][0] == "team.message"
    assert broadcast_events[0][1]["sender"] == "Product Manager"
    assert broadcast_events[0][1]["message"] == "Почни тестування"
