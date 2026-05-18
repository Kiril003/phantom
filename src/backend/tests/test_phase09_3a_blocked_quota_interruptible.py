"""
Phase 9.3a (AD-05) — emergency_stop must interrupt the blocked_quota probe sleep.

The previous `asyncio.sleep(interval)` was a blocking cursor — setting
emergency_stop mid-sleep did not return control until the whole interval
elapsed (up to 600s in the adaptive-backoff case). Now the loop waits on
the event itself with wait_for, so STOP fires within one scheduler tick.
"""
from __future__ import annotations

import asyncio
import os
import tempfile
import time
import uuid

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase093a-int")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


@pytest_asyncio.fixture
async def isolated_db(monkeypatch):
    import db.database as _dbm
    import db.models as _dm  # noqa: F401
    import importlib
    if not _dbm.Base.metadata.tables:
        importlib.reload(_dm)
    fd, tmp_file = tempfile.mkstemp(suffix=".db", prefix="phantom_p93a_int_")
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
async def test_emergency_stop_interrupts_probe_sleep(isolated_db, monkeypatch):
    """
    Runtime enters blocked_quota with a long probe interval (10s), then a
    parallel coroutine sets emergency_stop after 100ms. enter_blocked_quota
    must return False within ~250ms total, not 10s.
    """
    from agent.kernel.audit import create_task_row
    from agent.kernel.runtime import AgentRuntime, TaskState
    from agent.schemas import SelfModel
    from config import config

    task_id = str(uuid.uuid4())
    await create_task_row("u-test", task_id, "interrupt test", "foreground")

    runtime = AgentRuntime()
    state = TaskState(
        id=task_id, user_id="u-test", goal="interrupt test",
        track="foreground", status="running",
        self_model=SelfModel(),
    )
    runtime.foreground_slot = state

    # Long probe interval so a naive asyncio.sleep would clearly dominate.
    monkeypatch.setattr(config, "agent_blocked_quota_probe_s", 10, raising=False)

    # Probe that says "still blocked" so the first sleep is the one that
    # must get interrupted.
    async def _never_recovers():
        return False
    monkeypatch.setattr(runtime, "_probe_provider_recovered", _never_recovers)

    async def _signal_stop():
        await asyncio.sleep(0.1)
        runtime.controls.emergency_stop.set()

    stopper = asyncio.create_task(_signal_stop())
    t0 = time.monotonic()
    resumed = await runtime.enter_blocked_quota(state, "quota_exhausted")
    elapsed = time.monotonic() - t0
    await stopper

    assert resumed is False
    # We set emergency_stop at 0.1s. enter_blocked_quota must have returned
    # well before the 10s timeout. Allow generous slack for CI.
    assert elapsed < 1.0, f"emergency_stop did not interrupt sleep: {elapsed:.2f}s"


@pytest.mark.asyncio
async def test_probe_recovers_after_full_interval(isolated_db, monkeypatch):
    """
    Happy path: probe fails once, waits for full interval, then recovers.
    Ensures the new wait_for logic still allows normal cadence.
    """
    from agent.kernel.audit import create_task_row
    from agent.kernel.runtime import AgentRuntime, TaskState
    from agent.schemas import SelfModel
    from config import config

    task_id = str(uuid.uuid4())
    await create_task_row("u-test", task_id, "cadence test", "foreground")

    runtime = AgentRuntime()
    state = TaskState(
        id=task_id, user_id="u-test", goal="cadence test",
        track="foreground", status="running",
        self_model=SelfModel(),
    )
    runtime.foreground_slot = state

    monkeypatch.setattr(config, "agent_blocked_quota_probe_s", 1, raising=False)

    calls = {"n": 0}

    async def _recovers_on_first_probe():
        calls["n"] += 1
        return True
    monkeypatch.setattr(runtime, "_probe_provider_recovered", _recovers_on_first_probe)

    t0 = time.monotonic()
    resumed = await runtime.enter_blocked_quota(state, "quota_exhausted")
    elapsed = time.monotonic() - t0

    assert resumed is True
    # First iteration: probe is called after one sleep interval.
    assert calls["n"] == 1
    # Full interval (1s) must have elapsed before the recovered probe.
    assert elapsed >= 0.9
