"""Audit writers must actually persist — not just fail quietly.

`agent_audit.user_id` became a NOT NULL FK when the tables went multi-user.
Several writers were never updated, so every INSERT violated the constraint and
each one's broad `except` downgraded the failure to a log line. The audit trail
looked healthy and was empty.

These tests assert the row is *readable back*, which is the only claim that
matters for an audit log. Asserting "the call didn't raise" would have passed
throughout the entire outage.
"""
from __future__ import annotations

import json
import uuid
from unittest.mock import patch

import pytest
from sqlalchemy import select

from db.database import get_session
from db.models import AgentAuditEntry


@pytest.mark.asyncio
async def test_record_tool_invocation_persists_a_readable_row(auth_root_user):
    from tools.audit_service import record_tool_invocation

    entry_id = await record_tool_invocation(
        actor_user_id=auth_root_user.id,
        tool_name="get_system_metrics",
        args_snippet="{}",
        intent="probe",
        duration_ms=12,
        outcome="ok",
    )

    assert entry_id > 0, (
        "record_tool_invocation returned the -1 sentinel — the insert was "
        "rejected and swallowed, exactly the silent-audit-gap regression."
    )

    async with get_session() as db:
        row = (await db.execute(
            select(AgentAuditEntry).where(AgentAuditEntry.id == entry_id)
        )).scalar_one_or_none()

    assert row is not None, "audit row is not readable back"
    assert row.user_id == auth_root_user.id, "audit row must attribute the actor"
    assert row.action_name == "get_system_metrics"
    assert row.task_id == "chat-tool"


@pytest.mark.asyncio
async def test_failed_tool_invocation_is_still_audited(auth_root_user):
    """A failing tool is precisely what an operator needs in the trail."""
    from tools.audit_service import record_tool_invocation

    entry_id = await record_tool_invocation(
        actor_user_id=auth_root_user.id,
        tool_name="recall_memory_facts",
        args_snippet='{"q": "x"}',
        intent=None,
        duration_ms=3,
        outcome="fail",
        error="boom",
    )

    assert entry_id > 0

    async with get_session() as db:
        row = (await db.execute(
            select(AgentAuditEntry).where(AgentAuditEntry.id == entry_id)
        )).scalar_one_or_none()

    assert row is not None
    assert row.risk_level == 3, "outcome=fail must map to the fail risk level"
    assert "boom" in row.result_json


# ── Resource-gate deferrals ──────────────────────────────────────────────────
#
# The gate used to attempt its own audit row under user_id="__system__" /
# task_id="__resource_gate__". It was unconstructible (wrong kwargs) and
# un-insertable (no such user, FK enforcement ON), and the failure was
# swallowed at debug. That write is gone; the deferral is recorded by the
# executor under the real actor. These tests pin BOTH halves of that: the row
# exists and is attributed, and no phantom system row is created.


def _red_ram_snapshot():
    """Pressure=red with RAM far below what vision.see_screen declares."""
    from core.system_monitor import ResourceSnapshot
    import time

    return ResourceSnapshot(
        ts=time.monotonic(),
        captured_at_iso="2026-01-01T00:00:00+00:00",
        ram_total_mb=8192,
        ram_available_mb=100,      # < 600 MB * 1.2 safety margin
        ram_used_pct=95.0,
        swap_used_pct=0.0,
        cpu_pct=80.0,
        cpu_load_1m=6.0,
        cpu_temp_c=70.0,
        cpu_throttling=False,
        disk_free_gb=20.0,
        disk_used_pct=30.0,
        network_up=True,
        pressure_label="red",
    )


@pytest.mark.asyncio
async def test_resource_gate_deferral_persists_a_readable_row(auth_root_user):
    """A deferred action must leave a readable, attributed audit row."""
    from agent.kernel.executor import execute
    from agent.schemas import PlanStep

    task_id = f"gate-{uuid.uuid4().hex[:8]}"
    step = PlanStep(
        step_idx=3,
        action="vision.see_screen",
        args={},
        intent="look at the screen",
    )

    with patch("core.system_monitor.system_monitor") as mock_sm:
        mock_sm.current.return_value = _red_ram_snapshot()
        result, audit_id = await execute(
            user_id=auth_root_user.id,
            task_id=task_id,
            step=step,
            runtime=None,
            workspace_dir="/tmp",
            unsafe_mode=True,
        )

    assert result.ok is False
    assert result.error_class == "resource_unavailable", (
        "the red-RAM snapshot should have deferred the action"
    )
    assert audit_id > 0

    async with get_session() as db:
        row = (await db.execute(
            select(AgentAuditEntry).where(AgentAuditEntry.id == audit_id)
        )).scalar_one_or_none()

    assert row is not None, "resource-gate deferral is not readable back"
    assert row.user_id == auth_root_user.id, (
        "the deferral must be attributed to the real actor, never to a "
        "synthetic '__system__' user"
    )
    assert row.task_id == task_id
    assert row.step_idx == 3
    assert row.action_name == "vision.see_screen"

    payload = json.loads(row.result_json)
    output = payload.get("output") or {}
    assert output.get("gate") == "resource_gate", (
        "the operator's documented grep handle must survive in the row that "
        "actually persists"
    )
    assert output.get("pressure") == "red"
    assert "ram_unavailable" in payload.get("error", "")


@pytest.mark.asyncio
async def test_resource_gate_writes_no_phantom_system_row(auth_root_user):
    """The gate must not write audit rows of its own under a fake user."""
    from agent.operations.safety.resource_gate import check_resources
    from agent.actions.vision import SeeScreen

    with patch("core.system_monitor.system_monitor") as mock_sm:
        mock_sm.current.return_value = _red_ram_snapshot()
        verdict = await check_resources(SeeScreen(), unsafe_mode=False)

    assert verdict.proceed is False
    assert verdict.reason == "ram_unavailable"

    # The old fire-and-forget write was scheduled on the running loop, so let
    # any stray task get its turn before we check the table.
    import asyncio
    await asyncio.sleep(0)

    async with get_session() as db:
        orphans = (await db.execute(
            select(AgentAuditEntry).where(
                AgentAuditEntry.task_id == "__resource_gate__"
            )
        )).scalars().all()
        system_rows = (await db.execute(
            select(AgentAuditEntry).where(AgentAuditEntry.user_id == "__system__")
        )).scalars().all()

    assert not orphans, (
        "check_resources wrote its own audit row — deferrals are audited by "
        "the executor under the real actor, not here"
    )
    assert not system_rows, (
        "an audit row was attributed to the non-existent '__system__' user"
    )


def test_user_fact_mutation_persists_a_readable_audit_row(
    auth_root_client, auth_root_user
):
    """ROOT editing a user's facts must leave a trail that survives a read.

    Same regression as the other writers: this one passed `ok=True` (not a
    column) and omitted user_id/task_id/step_idx, so it never inserted once.
    """
    r = auth_root_client.post(
        f"/api/v1/users/{auth_root_user.id}/facts",
        json={"category": "email", "value": "audit-probe@phantom"},
    )
    assert r.status_code == 201, r.text
    fact_id = r.json()["id"]

    # Sync test (TestClient drives its own loop), so read back on a fresh
    # one — the same `asyncio.run` + `get_session` pattern conftest uses.
    import asyncio

    async def _read_back():
        async with get_session() as db:
            return list((await db.execute(
                select(AgentAuditEntry)
                .where(AgentAuditEntry.task_id == "user-facts")
                .where(AgentAuditEntry.user_id == auth_root_user.id)
                .order_by(AgentAuditEntry.id.desc())
            )).scalars().all())

    rows = asyncio.run(_read_back())

    assert rows, "no facts audit row is readable back — the writer is silent again"
    match = [r_ for r_ in rows if fact_id in (r_.args_json or "")]
    assert match, f"no audit row references fact {fact_id}"
    row = match[0]
    assert row.action_name == "user_fact"
    assert row.user_id == auth_root_user.id, "must attribute the acting ROOT"
    payload = json.loads(row.args_json)
    assert payload["operation"] == "fact.created"
    assert payload["target_user_id"] == auth_root_user.id


@pytest.mark.asyncio
async def test_write_memory_seed_requires_an_explicit_user():
    """The `__system__` default is gone — user_id is now a required kwarg."""
    import inspect
    from agent.kernel.audit import write_memory_seed

    param = inspect.signature(write_memory_seed).parameters["user_id"]
    assert param.default is inspect.Parameter.empty, (
        "write_memory_seed must not default user_id — agent_memory_seeds"
        ".user_id is a NOT NULL FK and no '__system__' user exists"
    )
