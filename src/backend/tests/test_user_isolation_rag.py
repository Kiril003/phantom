"""
Test user isolation for episodic memory, lessons memory, backfill, and UserFacts chat tools.
"""
from __future__ import annotations

import asyncio
import os
import tempfile
import uuid
from datetime import datetime, timezone
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-user-isolation")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


@pytest_asyncio.fixture
async def isolated_db(monkeypatch):
    import db.database as _dbm
    import db.models as _dm
    import importlib
    if not _dbm.Base.metadata.tables:
        importlib.reload(_dm)
    fd, tmp_file = tempfile.mkstemp(suffix=".db", prefix="phantom_user_isolation_")
    os.close(fd)
    url = f"sqlite+aiosqlite:///{tmp_file}"
    engine = create_async_engine(url, echo=False, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.run_sync(_dbm.Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(_dbm, "engine", engine)
    monkeypatch.setattr(_dbm, "AsyncSessionLocal", factory)
    yield factory
    await engine.dispose()
    try:
        os.unlink(tmp_file)
    except OSError:
        pass


@pytest.mark.asyncio
async def test_chroma_collection_name_helpers():
    """Verify collection name sanitization and unique patterns."""
    from agent.cognition.memory.embedder import _collection_name as ep_col_name
    from agent.cognition.memory.lessons import _collection_name as les_col_name

    assert ep_col_name("alice") == "phantom_v1_episodes_alice"
    assert les_col_name("bob") == "phantom_v1_lessons_bob"

    # Fallback to default
    assert ep_col_name(None) == "phantom_v1_episodes_default"
    assert les_col_name(None) == "phantom_v1_lessons_default"

    # Sanitization and UUID length budgets
    uuid_uid = str(uuid.uuid4())
    assert ep_col_name(uuid_uid).startswith("phantom_v1_episodes_")
    assert les_col_name(uuid_uid).startswith("phantom_v1_lessons_")


@pytest.mark.asyncio
async def test_episodic_memory_user_isolation(monkeypatch):
    """Verify episodes are written and recalled strictly per-user."""
    from agent.cognition.memory.embedder import wipe, count
    from agent.cognition.memory.seeds import write_episode
    from agent.cognition.memory.recall import recall

    user_a = f"alice_{uuid.uuid4().hex[:6]}"
    user_b = f"bob_{uuid.uuid4().hex[:6]}"

    # Cleanup collections first
    await wipe(user_a)
    await wipe(user_b)

    try:
        # Write user A episode
        ep_id = await write_episode(
            task_id="task-a",
            goal="read server configuration",
            outcome="done",
            summary="прочитав конфігурацію сервера",
            action_counts={"fs.read": 1},
            user_id=user_a
        )
        assert ep_id == "episode_task-a"

        # Check counts
        assert await count(user_a) == 1
        assert await count(user_b) == 0

        # Recall should isolate
        hits_a = await recall("configuration", user_id=user_a)
        assert len(hits_a) == 1
        assert hits_a[0]["task_id"] == "task-a"
        assert hits_a[0]["user_id"] == user_a

        hits_b = await recall("configuration", user_id=user_b)
        assert len(hits_b) == 0

    finally:
        await wipe(user_a)
        await wipe(user_b)


@pytest.mark.asyncio
async def test_lessons_memory_user_isolation(monkeypatch):
    """Verify lessons are written and recalled strictly per-user."""
    from agent.cognition.memory.lessons import write_lesson, recall_lessons
    from memory.strategic_memory import _get_client
    from config import config

    monkeypatch.setattr(config, "agent_lessons_min_relevance", -1.0)

    user_a = f"alice_{uuid.uuid4().hex[:6]}"
    user_b = f"bob_{uuid.uuid4().hex[:6]}"

    client = _get_client()
    try:
        client.delete_collection(name=f"phantom_v1_lessons_{user_a}")
        client.delete_collection(name=f"phantom_v1_lessons_{user_b}")
    except Exception:
        pass

    try:
        lesson = {
            "what_worked": "use curl with -L",
            "what_avoid": "do not use wget without retry",
            "applicability": "downloading large files"
        }

        lesson_id = await write_lesson(
            task_id="task-l",
            goal="download package info",
            outcome="done",
            lesson=lesson,
            user_id=user_a
        )
        assert lesson_id == "lesson_task-l"

        # Recall should isolate
        hits_a = await recall_lessons("download package info", user_id=user_a)
        assert len(hits_a) == 1
        assert hits_a[0]["what_worked"] == "use curl with -L"

        hits_b = await recall_lessons("download package info", user_id=user_b)
        assert len(hits_b) == 0

    finally:
        try:
            client.delete_collection(name=f"phantom_v1_lessons_{user_a}")
            client.delete_collection(name=f"phantom_v1_lessons_{user_b}")
        except Exception:
            pass


@pytest.mark.asyncio
async def test_backfill_per_user(isolated_db, monkeypatch):
    """Verify backfill sync behaves per-user."""
    from agent.kernel.audit import write_memory_seed
    from agent.cognition.memory.backfill import backfill_if_behind, backfill_all
    from agent.cognition.memory.embedder import count, wipe

    user_a = f"alice_{uuid.uuid4().hex[:6]}"
    await wipe(user_a)

    try:
        # Create user A seeds in SQL database
        await write_memory_seed(
            task_id="seed-a1", goal="read file A", outcome="done",
            summary="read file successfully", key_actions=[("fs.read", 1)],
            user_id=user_a
        )

        # Trigger backfill check
        res = await backfill_if_behind()
        assert res is not None
        assert res["written"] >= 1

        # Check counts
        assert await count(user_a) == 1
    finally:
        await wipe(user_a)


@pytest.mark.asyncio
async def test_user_facts_chat_tools(isolated_db):
    """Test user_facts tool executor CRUD handlers."""
    from ai.tool_executor import execute_tool
    from db.models import User
    import db.database as _dbm

    user_id = f"user_{uuid.uuid4().hex[:6]}"

    # Seed the user row first so Foreign Key works
    async with _dbm.AsyncSessionLocal() as db:
        user = User(
            id=user_id,
            username=user_id,
            role="OPERATOR"
        )
        db.add(user)
        await db.commit()

    # 1. Create Fact
    res_create = await execute_tool(
        "create_user_fact",
        {"category": "telegram", "value": "@alice_tg", "label": "Personal"},
        user_id=user_id
    )
    assert res_create.get("ok") is True
    assert "fact" in res_create
    fact_id = res_create["fact"]["id"]
    assert res_create["fact"]["value"] == "@alice_tg"

    # 2. List Facts
    res_list = await execute_tool(
        "list_user_facts",
        {"category": "telegram"},
        user_id=user_id
    )
    assert res_list.get("ok") is True
    assert len(res_list.get("facts", [])) == 1
    assert res_list["facts"][0]["value"] == "@alice_tg"
    assert res_list["facts"][0]["label"] == "Personal"

    # 3. Delete Fact
    res_del = await execute_tool(
        "delete_user_fact",
        {"fact_id": fact_id},
        user_id=user_id
    )
    assert res_del.get("ok") is True

    # 4. Confirm Deleted
    res_list_after = await execute_tool(
        "list_user_facts",
        {"category": "telegram"},
        user_id=user_id
    )
    assert res_list_after.get("ok") is True
    assert len(res_list_after.get("facts", [])) == 0
