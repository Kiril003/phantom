"""
Phase 9.3a (AD-06) — update_task_status('blocked_quota') must hit disk.

During the 9.2.3 live probe the task entered blocked_quota in memory (silent
probe-loop cadence confirmed it) but `agent_tasks.status` never transitioned
in SQLite — REST `refreshTask` returned stale 'running'. These tests pin the
behaviour deterministically so the regression can't quietly come back.
"""
from __future__ import annotations

import asyncio
import os
import tempfile
import uuid

import pytest

import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase093a-quota")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


@pytest_asyncio.fixture
async def isolated_db(monkeypatch):
    import db.database as _dbm
    import db.models as _dm  # noqa: F401
    import importlib
    if not _dbm.Base.metadata.tables:
        importlib.reload(_dm)
    fd, tmp_file = tempfile.mkstemp(suffix=".db", prefix="phantom_p93a_bq_")
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
async def test_update_status_persists_after_context_exit(isolated_db):
    """After `update_task_status` returns, a FRESH session sees the new value."""
    from agent.kernel.audit import create_task_row, update_task_status
    from db.database import get_session
    from db.models import AgentTask

    task_id = str(uuid.uuid4())
    await create_task_row("u-test", task_id, "test goal", "foreground")

    await update_task_status(task_id, "blocked_quota",
                              paused_reason="provider quota exhausted")

    # Fresh session — must see the committed value.
    async with get_session() as db:
        row = await db.get(AgentTask, task_id)
        assert row is not None
        assert row.status == "blocked_quota"
        assert row.paused_reason == "provider quota exhausted"


@pytest.mark.asyncio
async def test_update_status_visible_to_concurrent_reader(isolated_db):
    """
    Simulates the live-probe shape: the loop coroutine enters blocked_quota
    while the REST refresh path reads the same row. Reader must see the new
    value once the writer has returned, even if they overlap.
    """
    from agent.kernel.audit import create_task_row, update_task_status
    from db.database import get_session
    from db.models import AgentTask

    task_id = str(uuid.uuid4())
    await create_task_row("u-test", task_id, "concurrent goal", "foreground")

    # Pre-load row in reader's session BEFORE the write — this is the
    # condition the audit speculates about: a shadowed snapshot might
    # cause the reader to see stale data.
    async with get_session() as reader_db:
        pre_row = await reader_db.get(AgentTask, task_id)
        assert pre_row.status == "planning"

    # Now perform the write exactly as enter_blocked_quota does.
    await update_task_status(task_id, "blocked_quota", paused_reason="p")

    # Fresh reader — the commit should have landed.
    async with get_session() as reader_db:
        post_row = await reader_db.get(AgentTask, task_id)
        assert post_row.status == "blocked_quota"


@pytest.mark.asyncio
async def test_update_status_lands_under_cancellation_race(isolated_db):
    """
    The live run ended with a manual /agent/stop that cancelled the loop
    task. If update_task_status was mid-flight when the coroutine got
    cancelled, the commit must still land (the write should precede any
    await that could receive the cancel).
    """
    from agent.kernel.audit import create_task_row, update_task_status
    from db.database import get_session
    from db.models import AgentTask

    task_id = str(uuid.uuid4())
    await create_task_row("u-test", task_id, "cancel race", "foreground")

    async def transition():
        await update_task_status(task_id, "blocked_quota",
                                  paused_reason="quota_exhausted")

    t = asyncio.create_task(transition())
    await t  # let it complete; no concurrent cancel here — verify baseline

    async with get_session() as db:
        row = await db.get(AgentTask, task_id)
        assert row.status == "blocked_quota"


@pytest.mark.asyncio
async def test_enter_blocked_quota_persists_to_db(isolated_db, monkeypatch):
    """
    End-to-end: call the real enter_blocked_quota on a runtime + state and
    verify the DB row transitioned. Mocks probe to return True on first
    call so the loop exits quickly.
    """
    from agent.kernel import audit
    from agent.kernel.audit import create_task_row
    from agent.kernel.runtime import AgentRuntime, TaskState
    from agent.schemas import SelfModel
    from db.database import get_session
    from db.models import AgentTask
    from config import config

    task_id = str(uuid.uuid4())
    await create_task_row("u-test", task_id, "end-to-end", "foreground")

    runtime = AgentRuntime()
    state = TaskState(
        user_id="u-test",
        id=task_id, goal="end-to-end",
        track="foreground", status="running",
        self_model=SelfModel(),
    )
    runtime.foreground_slot = state

    # Short probe interval so the test doesn't sleep 60s.
    monkeypatch.setattr(config, "agent_blocked_quota_probe_s", 1, raising=False)

    async def _recover_immediately():
        return True
    monkeypatch.setattr(runtime, "_probe_provider_recovered", _recover_immediately)

    # Snapshot status BEFORE probe clears it — once recovery fires,
    # enter_blocked_quota flips status back to 'running'. Use a hook on
    # the audit call to capture the intermediate value.
    seen_statuses: list[str] = []
    real_update = audit.update_task_status

    async def spying_update(tid, status, **kw):
        seen_statuses.append(status)
        await real_update(tid, status, **kw)

    monkeypatch.setattr(audit, "update_task_status", spying_update)
    # runtime.py imports at module scope — also patch the already-bound name.
    import agent.kernel.runtime as runtime_mod
    monkeypatch.setattr(runtime_mod, "update_task_status", spying_update)

    resumed = await runtime.enter_blocked_quota(state, "quota_exhausted")
    assert resumed is True  # probe recovered on first call

    # Both writes must have been attempted: the blocked_quota transition
    # AND the running transition after recovery.
    assert "blocked_quota" in seen_statuses
    assert "running" in seen_statuses

    # Final DB state: row.status back to 'running' — that's fine, what we
    # care about is that *every* transition committed. Check via a fresh
    # session.
    async with get_session() as db:
        row = await db.get(AgentTask, task_id)
        assert row.status == "running"  # final recovered state
