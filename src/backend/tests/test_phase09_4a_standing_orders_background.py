"""
Phase 9.4a — standing orders fire on the *background* track.

These complement the 9.3b runner tests (which already cover schedule/
condition/one-shot semantics) by verifying the new multi-track wiring:
  * runner invokes start_task(track="background", origin="standing_order",
    order_id=<uuid>)
  * a busy foreground slot no longer suppresses firing
  * TrackBusyError on a full background queue → soft skip, no
    last_fired_at update, retry next tick
  * queued (not yet started) fires still record as success outcomes
  * conditional orders respect the same background wiring
"""
from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase094a-so")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


@pytest_asyncio.fixture
async def isolated_db(monkeypatch):
    import db.database as _dbm
    import db.models as _dm  # noqa: F401
    import importlib
    if not _dbm.Base.metadata.tables:
        importlib.reload(_dm)
    fd, tmp_file = tempfile.mkstemp(suffix=".db", prefix="phantom_p94a_so_")
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


async def _seed_user(db_session_factory, user_id: str = "u1") -> None:
    from db.models import User
    async with db_session_factory() as db:
        db.add(User(id=user_id, username=user_id, role="ROOT"))
        await db.commit()


async def _seed_interval_order(
    db_session_factory,
    *,
    user_id: str = "u1",
    goal: str = "check disk",
    every_s: int = 10,
    minutes_overdue: int = 5,
) -> str:
    from db.models import StandingOrder
    async with db_session_factory() as db:
        row = StandingOrder(
            user_id=user_id,
            description="bg order",
            kind="interval",
            schedule_json=json.dumps({"kind": "interval", "every_s": every_s}),
            action_json=json.dumps({"goal": goal}),
            enabled=True,
            last_fired_at=datetime.now(tz=timezone.utc) - timedelta(minutes=minutes_overdue),
        )
        db.add(row)
        await db.commit()
        return row.id


# ── 1. fires on background track ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_standing_order_fires_on_background_track(isolated_db, monkeypatch):
    from agent.kernel.runtime import AgentRuntime
    from agent.operations.standing_orders.runner import StandingOrderRunner

    await _seed_user(isolated_db)
    order_id = await _seed_interval_order(isolated_db)

    runtime = AgentRuntime()
    captured: list[dict] = []

    async def fake_start(goal, **kwargs):
        captured.append({"goal": goal, **kwargs})
        return ("tid-fg-quiet", True)

    monkeypatch.setattr(runtime, "start_task", fake_start)
    runner = StandingOrderRunner(runtime)
    fired = await runner.check_and_fire_due_orders()

    assert fired == [order_id]
    assert len(captured) == 1
    call = captured[0]
    assert call["goal"] == "check disk"
    assert call["track"] == "background"
    assert call["origin"] == "standing_order"
    assert call["order_id"] == order_id


# ── 2. active user task does NOT block a background fire ───────────────────


@pytest.mark.asyncio
async def test_order_fires_even_when_foreground_task_active(isolated_db, monkeypatch):
    from agent.kernel.runtime import AgentRuntime, TaskState
    from agent.schemas import SelfModel
    from agent.operations.standing_orders.runner import StandingOrderRunner

    await _seed_user(isolated_db)
    await _seed_interval_order(isolated_db, goal="bg while fg busy")

    runtime = AgentRuntime()
    runtime.foreground_slot = TaskState(
        id="fg-active", goal="user-chat", track="foreground",
        status="running", self_model=SelfModel(),
    )
    captured: list[dict] = []

    async def fake_start(goal, **kwargs):
        captured.append({"goal": goal, **kwargs})
        return ("tid", True)

    monkeypatch.setattr(runtime, "start_task", fake_start)
    runner = StandingOrderRunner(runtime)
    fired = await runner.check_and_fire_due_orders()

    assert len(fired) == 1
    assert captured[0]["track"] == "background"


# ── 3. full queue → soft skip, no last_fired_at update ─────────────────────


@pytest.mark.asyncio
async def test_order_defers_on_track_busy_error(isolated_db, monkeypatch):
    from agent.kernel.errors import TrackBusyError
    from agent.kernel.runtime import AgentRuntime
    from agent.operations.standing_orders.runner import StandingOrderRunner
    from db.database import get_session
    from db.models import StandingOrder

    await _seed_user(isolated_db)
    order_id = await _seed_interval_order(isolated_db)

    # Capture the BEFORE state so we can prove last_fired_at didn't change.
    async with get_session() as db:
        pre = (await db.execute(select(StandingOrder).where(StandingOrder.id == order_id))).scalar_one()
        pre_last_fired = pre.last_fired_at
        pre_count = pre.fire_count

    runtime = AgentRuntime()
    async def refusing_start(goal, **kwargs):
        raise TrackBusyError("background", 20)
    monkeypatch.setattr(runtime, "start_task", refusing_start)

    runner = StandingOrderRunner(runtime)
    fired = await runner.check_and_fire_due_orders()
    assert fired == []

    # Prove the order's fire stats are unchanged so a retry on the next tick
    # will still see it as due.
    async with get_session() as db:
        post = (await db.execute(select(StandingOrder).where(StandingOrder.id == order_id))).scalar_one()
        assert post.last_fired_at == pre_last_fired
        assert post.fire_count == pre_count


# ── 4. queued (started=False) still records as fired ───────────────────────


@pytest.mark.asyncio
async def test_queued_fire_still_records_success(isolated_db, monkeypatch):
    """A fire that lands in the background queue (rather than directly on
    the slot) is still a legitimate fire — fire_count++ and last_outcome
    records the queued task_id."""
    from agent.kernel.runtime import AgentRuntime
    from agent.operations.standing_orders.runner import StandingOrderRunner
    from db.database import get_session
    from db.models import StandingOrder

    await _seed_user(isolated_db)
    order_id = await _seed_interval_order(isolated_db, goal="queued goal")

    runtime = AgentRuntime()
    async def fake_start(goal, **kwargs):
        return ("queued-tid", False)  # queued, not yet running
    monkeypatch.setattr(runtime, "start_task", fake_start)

    runner = StandingOrderRunner(runtime)
    fired = await runner.check_and_fire_due_orders()
    assert fired == [order_id]

    async with get_session() as db:
        row = (await db.execute(select(StandingOrder).where(StandingOrder.id == order_id))).scalar_one()
    assert row.fire_count == 1
    assert row.last_outcome is not None
    assert "queued-tid" in row.last_outcome


# ── 5. conditional order fires on background when condition met ────────────


@pytest.mark.asyncio
async def test_conditional_order_fires_on_background(isolated_db, monkeypatch):
    from agent.kernel.runtime import AgentRuntime
    from agent.operations.standing_orders import conditions as cond_mod
    from agent.operations.standing_orders.runner import StandingOrderRunner
    from db.database import get_session
    from db.models import StandingOrder, User

    async with get_session() as db:
        db.add(User(id="u1", username="u1", role="ROOT"))
        db.add(StandingOrder(
            user_id="u1",
            description="cpu sentinel",
            kind="conditional",
            schedule_json=json.dumps({
                "kind": "conditional",
                "check_every_s": 60,
                "condition": "cpu_percent > 80",
                "cooldown_s": 600,
            }),
            action_json=json.dumps({"goal": "diagnose cpu"}),
            enabled=True,
        ))
        await db.commit()

    monkeypatch.setitem(cond_mod.KNOWN_CONDITIONS, "cpu_percent", lambda: 95.0)

    runtime = AgentRuntime()
    captured: list[dict] = []
    async def fake_start(goal, **kwargs):
        captured.append({"goal": goal, **kwargs})
        return ("t", True)
    monkeypatch.setattr(runtime, "start_task", fake_start)

    runner = StandingOrderRunner(runtime)
    fired = await runner.check_and_fire_due_orders()
    assert len(fired) == 1
    assert captured[0]["track"] == "background"
    assert captured[0]["goal"] == "diagnose cpu"
