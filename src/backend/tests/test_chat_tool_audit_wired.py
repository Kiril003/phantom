"""Chat tool invocations must reach the audit timeline, not just telemetry.

`audit_service`'s docstring claimed `tool_executor` calls
`record_tool_invocation`. It did not — the writer had no production caller, so
`agent_audit` held only kernel-executor actions. Chat tools were logged to
`ai_tool_use_log`, a different table `recent_audit` never reads.

Every assertion here reads the row back out of the database. "Did not raise" is
exactly how the previous audit-writer outage stayed invisible.
"""
from __future__ import annotations

import json

import pytest
from sqlalchemy import select

from db.database import get_session
from db.models import AgentAuditEntry


async def _rows_for(user_id: str, action_name: str) -> list[AgentAuditEntry]:
    async with get_session() as db:
        return list((await db.execute(
            select(AgentAuditEntry)
            .where(AgentAuditEntry.user_id == user_id)
            .where(AgentAuditEntry.task_id == "chat-tool")
            .where(AgentAuditEntry.action_name == action_name)
            .order_by(AgentAuditEntry.id.desc())
        )).scalars().all())


@pytest.mark.asyncio
async def test_execute_tool_lands_a_readable_audit_row(auth_root_user):
    from ai.tool_executor import execute_tool

    out = await execute_tool("get_system_metrics", {}, auth_root_user.id)
    assert out.get("ok") is True, out

    rows = await _rows_for(auth_root_user.id, "get_system_metrics")
    assert rows, (
        "no agent_audit row for a chat tool that ran — the audit timeline is "
        "still missing everything the chat path does"
    )
    row = rows[0]
    assert row.user_id == auth_root_user.id, "row must attribute the actor"
    assert row.elapsed_ms >= 0
    assert json.loads(row.result_json).get("ok") is True


@pytest.mark.asyncio
async def test_dispatcher_path_is_audited_too(auth_root_user):
    """`chat_pipeline` and `routes_chat` both go through `dispatch`."""
    from ai.chat_tool_dispatcher import dispatch

    out = await dispatch(
        "get_sensor_status", {}, user_id=auth_root_user.id, db=None
    )
    assert out["name"] == "get_sensor_status"

    rows = await _rows_for(auth_root_user.id, "get_sensor_status")
    assert rows, "dispatch() ran a tool that left no audit row"


@pytest.mark.asyncio
async def test_a_failing_tool_is_still_audited(auth_root_user):
    """The failures are the rows an operator actually needs."""
    from ai.tool_executor import execute_tool

    out = await execute_tool(
        "recall_memory_facts", {"limit": "not-an-int"}, auth_root_user.id
    )

    rows = await _rows_for(auth_root_user.id, "recall_memory_facts")
    assert rows, "a failing chat tool left no audit row"
    row = rows[0]
    if out.get("ok") is not True:
        assert row.risk_level == 3, "a failed invocation must map to the fail level"
        assert json.loads(row.result_json).get("ok") is False


@pytest.mark.asyncio
async def test_audit_failure_never_breaks_the_tool_call(auth_root_user, monkeypatch):
    """A broken audit writer must degrade to a gap, never to a failed tool."""
    import ai.tool_executor as te

    async def _explode(**kwargs):
        raise RuntimeError("audit backend down")

    monkeypatch.setattr(te, "record_tool_invocation", _explode, raising=False)

    out = await te.execute_tool("get_system_metrics", {}, auth_root_user.id)
    assert out.get("ok") is True, (
        "an audit-writer failure took down the tool call itself"
    )
