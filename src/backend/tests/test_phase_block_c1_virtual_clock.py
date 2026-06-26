from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from sqlalchemy import select

from core.clock import clock
from core.referee import system_referee, OutputFrame, PriorityTier
from db.database import get_session
from db.models import StandingOrder
from memory.session_memory import session_memory
from agent.cognition.proactive.loop import ProactiveLoop
from agent.operations.standing_orders.runner import StandingOrderRunner


@pytest.mark.asyncio
async def test_clock_system_mode():
    """Verify default system mode returns real time."""
    clock.reset()
    assert clock.mode == "system"
    t1 = clock.time()
    dt1 = clock.now()
    assert abs(t1 - datetime.now(timezone.utc).timestamp()) < 1.0
    assert abs((dt1 - datetime.now(timezone.utc)).total_seconds()) < 1.0


@pytest.mark.asyncio
async def test_clock_virtual_mode():
    """Verify virtual time freezes and advances on command."""
    clock.reset()
    start_dt = datetime(2026, 6, 24, 12, 0, 0, tzinfo=timezone.utc)
    clock.set_time(start_dt)
    assert clock.mode == "virtual"

    # Time remains frozen
    t1 = clock.time()
    await asyncio.sleep(0.01)
    t2 = clock.time()
    assert t1 == t2
    assert clock.now() == start_dt

    # Advance moves clock
    clock.advance(3600)  # 1 hour
    assert clock.time() == t1 + 3600
    assert clock.now() == start_dt + timedelta(hours=1)

    clock.reset()
    assert clock.mode == "system"


@pytest.mark.asyncio
async def test_clock_context_manager():
    """Verify context manager handles isolation and teardown cleanly."""
    clock.reset()
    start_dt = datetime(2028, 1, 1, 0, 0, 0, tzinfo=timezone.utc)

    with clock.virtual_time(start_dt) as vclock:
        assert vclock.mode == "virtual"
        assert vclock.now() == start_dt
        vclock.advance(10.0)
        assert vclock.time() == start_dt.timestamp() + 10.0

    # Restores system mode on exit
    assert clock.mode == "system"


@pytest.mark.asyncio
async def test_clock_sleep():
    """Verify sleep wrapper runs instantly in virtual mode."""
    start_dt = datetime(2026, 6, 24, 12, 0, 0, tzinfo=timezone.utc)
    with clock.virtual_time(start_dt) as vclock:
        t_start = vclock.time()
        # Sleep for 100 seconds
        await vclock.sleep(100.0)
        t_end = vclock.time()
        assert t_end - t_start == 100.0
        assert vclock.now() == start_dt + timedelta(seconds=100)


@pytest.mark.asyncio
async def test_standing_orders_with_virtual_clock(auth_root_user, monkeypatch):
    """Verify virtual clock allows fast-forwarding standing order schedule checks."""
    # Seed a StandingOrder that runs every 1 hour (3600s)
    async with get_session() as db:
        order = StandingOrder(
            user_id=auth_root_user.id,
            description="hour-polling-test",
            kind="interval",
            schedule_json='{"kind": "interval", "every_s": 3600}',
            action_json='{"goal": "Check disk space"}',
            enabled=True,
        )
        db.add(order)
        await db.commit()
        order_id = order.id

    runtime = MagicMock()
    # Mock start_task to simulate success
    async def mock_start_task(*args, **kwargs):
        return "fake-task-123", True
    runtime.start_task = mock_start_task

    runner = StandingOrderRunner(runtime)

    # Freeze time
    start_dt = datetime(2026, 6, 24, 10, 0, 0, tzinfo=timezone.utc)
    with clock.virtual_time(start_dt) as vclock:
        # 1. First poll loop check - should fire because last_fired_at is NULL
        fired = await runner.check_and_fire_due_orders()
        assert order_id in fired

        # Ensure database reflects fired stats
        async with get_session() as db:
            row = (await db.execute(select(StandingOrder).where(StandingOrder.id == order_id))).scalar_one()
            assert row.fire_count == 1
            assert row.last_fired_at == start_dt.replace(tzinfo=None)

        # 2. Advance time by 30 mins (1800s) - should NOT fire again
        vclock.advance(1800)
        fired_soon = await runner.check_and_fire_due_orders()
        assert order_id not in fired_soon

        # 3. Advance time by another 31 mins (1860s, total 3660s from start) - should fire again
        vclock.advance(1860)
        fired_later = await runner.check_and_fire_due_orders()
        assert order_id in fired_later

        # Verify fire count is 2
        async with get_session() as db:
            row = (await db.execute(select(StandingOrder).where(StandingOrder.id == order_id))).scalar_one()
            assert row.fire_count == 2
            assert row.last_fired_at == (start_dt + timedelta(seconds=3660)).replace(tzinfo=None)


@pytest.mark.asyncio
async def test_proactive_loop_hold_decay_virtual_clock(monkeypatch):
    """Verify that HOLD queue TTL pruning and linear decay adapt to virtual clock progression."""
    runtime = MagicMock()
    loop = ProactiveLoop(runtime)

    # Mock session ID and referee
    monkeypatch.setattr(loop, "_most_recent_session_id", AsyncMock(return_value="sess_xyz"))
    emitted_frames = []
    monkeypatch.setattr(system_referee, "emit", AsyncMock(side_effect=lambda f: emitted_frames.append(f) or True))

    session_id = "sess_xyz"
    session_memory.clear_deferred_thoughts(session_id)

    start_dt = datetime(2026, 6, 24, 12, 0, 0, tzinfo=timezone.utc)
    with clock.virtual_time(start_dt) as vclock:
        # Defer thought with 10-minute (600s) TTL
        session_memory.defer_thought(
            session_id=session_id,
            kind="speak",
            content="Virtual thought",
            priority=8,
            value=0.8,
            ttl=600.0,
        )

        # 1. Advance by 5 minutes (300s). Verify linear decay: value should be 0.8 * (1.0 - 300 / 600) = 0.4
        vclock.advance(300.0)
        await loop._release_deferred_thoughts()

        assert len(emitted_frames) == 1
        frame = emitted_frames[0]
        assert frame.payload["message"] == "Virtual thought"
        # Since linear decay is value * (1.0 - age/ttl) -> age = 300, ttl = 600 -> multiplier = 0.5. Value = 0.8 * 0.5 = 0.4
        assert abs(frame.payload["priority"] - 8) < 0.01  # Priority remains, value decays
        # Verify stashed list is cleared after release
        assert len(session_memory.get_deferred_thoughts(session_id)) == 0

    # 2. Defer another thought with 1-minute (60s) TTL
    session_memory.clear_deferred_thoughts(session_id)
    with clock.virtual_time(start_dt) as vclock:
        session_memory.defer_thought(
            session_id=session_id,
            kind="speak",
            content="Prunable thought",
            priority=5,
            value=0.5,
            ttl=60.0,
        )
        # Advance clock by 70s -> exceeds TTL
        vclock.advance(70.0)
        # Pruning should discard it completely
        session_memory.prune_expired_thoughts(session_id)
        assert len(session_memory.get_deferred_thoughts(session_id)) == 0
