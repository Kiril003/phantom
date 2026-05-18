"""T2 — memory-backed chat prompt builder unit tests."""
from __future__ import annotations

import os
import tempfile
import asyncio
from unittest.mock import AsyncMock, patch, MagicMock

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-v2-t2")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


@pytest_asyncio.fixture
async def db_session():
    import db.models as _dm  # noqa: F401
    import db.database as _dbm

    fd, path = tempfile.mkstemp(suffix=".db", prefix="phantom_t2_")
    os.close(fd)
    url = f"sqlite+aiosqlite:///{path}"
    engine = create_async_engine(url, echo=False, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.run_sync(_dbm.Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()
    try:
        os.unlink(path)
    except OSError:
        pass


@pytest.mark.asyncio
async def test_persist_and_load_thread(db_session):
    from agent.cognition.chat_prompt import persist_turn, load_thread
    tid = "task-abc"
    await persist_turn(db_session, tid, "user", "привіт")
    await persist_turn(db_session, tid, "assistant", "слухаю")
    thread = await load_thread(db_session, tid)
    assert len(thread) == 2
    assert thread[0]["role"] == "user"
    assert thread[1]["role"] == "assistant"


@pytest.mark.asyncio
async def test_load_thread_empty(db_session):
    from agent.cognition.chat_prompt import load_thread
    thread = await load_thread(db_session, "no-such-task")
    assert thread == []


@pytest.mark.asyncio
async def test_build_prompt_includes_task_context(db_session):
    from agent.cognition.chat_prompt import build_agent_chat_prompt

    slot = MagicMock()
    slot.goal = "написати скрипт"
    slot.status = "running"
    slot.observations = []

    with patch("agent.cognition.memory.recall.recall", new=AsyncMock(return_value=[])), \
         patch("agent.cognition.memory.lessons.recall_lessons", new=AsyncMock(return_value=[])):
        system, history = await build_agent_chat_prompt(
            user_message="як справи?",
            task_id="t1",
            db=db_session,
            foreground_slot=slot,
            foreground_substate="thinking",
        )

    assert "написати скрипт" in system
    assert "thinking" in system
    assert history == []


@pytest.mark.asyncio
async def test_build_prompt_injects_recall(db_session):
    from agent.cognition.chat_prompt import build_agent_chat_prompt

    fake_episode = [{
        "task_id": "old-1",
        "goal": "зробити API",
        "outcome": "done",
        "summary": "використав FastAPI + SQLite",
        "created_at": "2026-05-01T10:00:00",
        "duration_s": 120.0,
        "action_counts": {},
        "relevance": 0.9,
    }]

    with patch("agent.cognition.memory.recall.recall", new=AsyncMock(return_value=fake_episode)), \
         patch("agent.cognition.memory.lessons.recall_lessons", new=AsyncMock(return_value=[])):
        system, _ = await build_agent_chat_prompt(
            user_message="зроби API",
            task_id="t2",
            db=db_session,
            foreground_slot=None,
            foreground_substate="idle",
        )

    assert "зробити API" in system


@pytest.mark.asyncio
async def test_thread_window_limit(db_session):
    from agent.cognition.chat_prompt import persist_turn, load_thread
    tid = "task-window"
    for i in range(25):
        await persist_turn(db_session, tid, "user", f"msg {i}")
    thread = await load_thread(db_session, tid, limit=20)
    assert len(thread) == 20
    # last 20 messages (msg 5..24)
    assert thread[-1]["content"] == "msg 24"
