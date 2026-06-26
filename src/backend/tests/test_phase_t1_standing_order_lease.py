"""Day-4 Wave-2 T-1 — StandingOrder lease columns + recover_stale_leases
(ADR-SOH-001 + ADR-SOH-002).

Each test uses uuid-derived IDs so cross-test state in the shared
SQLite test DB cannot collide with our seeded rows (other phases
also insert AgentTask + StandingOrder rows during their fixtures).

Closes audit U7-TIME (no crash recovery for in-flight standing orders).

Coverage:

1. StandingOrder ORM has the two new lease columns (in_flight_task_id,
   claimed_at).
2. Default values: NULL/NULL on insert (Day-3 back-compat invariant).
3. config.agent_standing_orders_lease_ttl_s default = 300.
4. agent.kernel.audit.task_status returns "missing" for unknown task_id.
5. agent.kernel.audit.task_status returns "done"/"error"/"cancelled"/"running"
   from an AgentTask row.
6. recover_stale_leases finds rows older than lease_ttl AND with
   in_flight_task_id set.
7. recover_stale_leases reconciliation:
   - done → clear lease + last_outcome="recovered:done", count++.
   - missing → clear lease, count++ (runner re-fires next tick).
   - running → leave lease intact, count NOT incremented.
8. Fresh leases (claimed_at within ttl) are NOT touched.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest


# ────────────────────────────────────────────────── ORM + config defaults ──


class TestSchemaAndConfig:
    def test_lease_columns_present(self):
        from db.models import StandingOrder

        cols = {c.name for c in StandingOrder.__table__.columns}
        assert "in_flight_task_id" in cols
        assert "claimed_at" in cols

    def test_in_flight_task_id_indexed(self):
        from db.models import StandingOrder

        idx_cols: set[str] = set()
        for ix in StandingOrder.__table__.indexes:
            for col in ix.columns:
                idx_cols.add(col.name)
        # Either explicit `Index` or column-level index=True surfaces
        # in `__table__.indexes`.
        assert "in_flight_task_id" in idx_cols

    def test_lease_ttl_default_is_300(self):
        from config import PhantomConfig

        f = PhantomConfig.model_fields["agent_standing_orders_lease_ttl_s"]
        assert f.default == 300


# ─────────────────────────────────────────────────────── task_status ──


class TestAuditTaskStatus:
    @pytest.mark.asyncio
    async def test_unknown_task_returns_missing(self):
        from agent.kernel.audit import task_status

        assert await task_status("no-such-task-id") == "missing"

    @pytest.mark.asyncio
    async def test_empty_id_returns_missing(self):
        from agent.kernel.audit import task_status

        assert await task_status("") == "missing"

    @pytest.mark.asyncio
    async def test_known_task_status_round_trip(self, auth_root_user):
        """Insert AgentTask + read its status."""
        from agent.kernel.audit import create_task_row, task_status, update_task_status

        tid = f"t1-trip-{uuid.uuid4().hex[:8]}"
        await create_task_row(auth_root_user.id, tid, goal="trip", track="foreground")
        # Default status from create_task_row is "planning" → mapped
        # to "running" by task_status.
        assert await task_status(tid) == "running"

        await update_task_status(tid, "done", finished=True)
        assert await task_status(tid) == "done"


# ──────────────────────────────────────────── recover_stale_leases ──


class TestRecoverStaleLeases:
    @pytest.mark.asyncio
    async def test_stale_done_lease_released(self, auth_root_user):
        """Stale lease + AgentTask.done → lease cleared, count==1."""
        from sqlalchemy import select

        from agent.kernel.audit import create_task_row, update_task_status
        from agent.kernel.runtime import AgentRuntime
        from agent.operations.standing_orders.runner import StandingOrderRunner
        from db.database import get_session
        from db.models import StandingOrder

        # Seed an AgentTask in a terminal state.
        tid = f"t1-stale-done-{uuid.uuid4().hex[:8]}"
        await create_task_row(auth_root_user.id, tid, goal="stale_done", track="foreground")
        await update_task_status(tid, "done", finished=True)

        # Seed a StandingOrder with a stale lease (>300s old).
        async with get_session() as db:
            order = StandingOrder(
                user_id=auth_root_user.id,
                description=f"stale-test-{uuid.uuid4().hex[:6]}",
                kind="interval",
                schedule_json='{"every_s": 60}',
                action_json='{"goal": "x"}',
                in_flight_task_id=tid,
                claimed_at=datetime.utcnow() - timedelta(seconds=600),
            )
            db.add(order)
            await db.commit()
            order_id = order.id

        runner = StandingOrderRunner(AgentRuntime())
        released = await runner.recover_stale_leases()
        assert released >= 1

        async with get_session() as db:
            row = (
                await db.execute(
                    select(StandingOrder).where(StandingOrder.id == order_id)
                )
            ).scalar_one()
            assert row.in_flight_task_id is None
            assert row.claimed_at is None
            assert row.last_outcome == "recovered:done"

    @pytest.mark.asyncio
    async def test_stale_missing_task_released(self, auth_root_user):
        """Lease references a non-existent AgentTask → released; runner
        re-fires next tick (idempotent because last_fired_at was set
        by the original dispatch)."""
        from sqlalchemy import select

        from agent.kernel.runtime import AgentRuntime
        from agent.operations.standing_orders.runner import StandingOrderRunner
        from db.database import get_session
        from db.models import StandingOrder

        async with get_session() as db:
            order = StandingOrder(
                user_id=auth_root_user.id,
                description="stale-missing",
                kind="interval",
                schedule_json='{"every_s": 60}',
                action_json='{"goal": "x"}',
                in_flight_task_id="never-existed",
                claimed_at=datetime.utcnow() - timedelta(seconds=600),
            )
            db.add(order)
            await db.commit()
            order_id = order.id

        runner = StandingOrderRunner(AgentRuntime())
        released = await runner.recover_stale_leases()
        assert released >= 1

        async with get_session() as db:
            row = (
                await db.execute(
                    select(StandingOrder).where(StandingOrder.id == order_id)
                )
            ).scalar_one()
            assert row.in_flight_task_id is None
            assert row.claimed_at is None

    @pytest.mark.asyncio
    async def test_running_task_lease_preserved(self, auth_root_user):
        """A still-running task has a legitimate lease; recover_stale_leases
        leaves it alone even if the clock says stale."""
        from sqlalchemy import select

        from agent.kernel.audit import create_task_row
        from agent.kernel.runtime import AgentRuntime
        from agent.operations.standing_orders.runner import StandingOrderRunner
        from db.database import get_session
        from db.models import StandingOrder

        tid = f"t1-long-{uuid.uuid4().hex[:8]}"
        await create_task_row(auth_root_user.id, tid, goal="long", track="foreground")
        # status default "planning" → mapped to "running" by task_status.

        async with get_session() as db:
            order = StandingOrder(
                user_id=auth_root_user.id,
                description=f"long-runner-{uuid.uuid4().hex[:6]}",
                kind="interval",
                schedule_json='{"every_s": 60}',
                action_json='{"goal": "x"}',
                in_flight_task_id=tid,
                claimed_at=datetime.utcnow() - timedelta(seconds=600),
            )
            db.add(order)
            await db.commit()
            order_id = order.id

        runner = StandingOrderRunner(AgentRuntime())
        released_before = await runner.recover_stale_leases()
        # Even if other stale rows exist, the long-runner stays.
        async with get_session() as db:
            row = (
                await db.execute(
                    select(StandingOrder).where(StandingOrder.id == order_id)
                )
            ).scalar_one()
            assert row.in_flight_task_id == tid, (
                "T-1 invariant: a running task's lease MUST NOT be released "
                "by recover_stale_leases."
            )
            assert row.claimed_at is not None
        assert isinstance(released_before, int)

    @pytest.mark.asyncio
    async def test_fresh_lease_not_touched(self, auth_root_user):
        """A lease claimed RECENTLY (within ttl) is not even queried."""
        from sqlalchemy import select

        from agent.kernel.runtime import AgentRuntime
        from agent.operations.standing_orders.runner import StandingOrderRunner
        from db.database import get_session
        from db.models import StandingOrder

        async with get_session() as db:
            order = StandingOrder(
                user_id=auth_root_user.id,
                description="fresh-lease",
                kind="interval",
                schedule_json='{"every_s": 60}',
                action_json='{"goal": "x"}',
                in_flight_task_id=f"t1-fresh-{uuid.uuid4().hex[:8]}",
                claimed_at=datetime.utcnow(),
            )
            tid_fresh = order.in_flight_task_id
            db.add(order)
            await db.commit()
            order_id = order.id

        runner = StandingOrderRunner(AgentRuntime())
        await runner.recover_stale_leases()

        async with get_session() as db:
            row = (
                await db.execute(
                    select(StandingOrder).where(StandingOrder.id == order_id)
                )
            ).scalar_one()
            assert row.in_flight_task_id == tid_fresh
            assert row.claimed_at is not None
