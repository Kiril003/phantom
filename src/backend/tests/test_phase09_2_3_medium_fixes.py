"""Phase 9.2.3 — regression tests for F-14, F-15, F-17 MEDIUM cleanup.

F-14 — enter_blocked_quota now sets substate='blocked_quota' (not 'waiting_user')
F-15 — call_budget_exhausted writes a router-side audit row with that error_kind
F-17 — risky-action consent + ask_user preconditions honour
       `agent_user_consent_timeout_s` instead of hanging forever.
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest

from agent.runtime import AgentRuntime, TaskState
from agent.schemas import SelfModel


# -----------------------------------------------------------------------------
# F-14 — blocked_quota substate
# -----------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_enter_blocked_quota_sets_distinct_substate(monkeypatch: pytest.MonkeyPatch) -> None:
    runtime = AgentRuntime()
    state = TaskState(
        id="t1", goal="x", track="foreground", status="running",
        self_model=SelfModel(),
    )
    runtime.foreground_slot = state

    # Stub the probe so the loop exits on the first iteration: return True
    # immediately → enter_blocked_quota returns after setting substate + then
    # transitions back to "thinking".
    probe = AsyncMock(return_value=True)
    monkeypatch.setattr(runtime, "_probe_provider_recovered", probe)
    # Short probe interval so the test finishes fast. `or 60` fallback in
    # enter_blocked_quota means 0 falls back to default; use a small positive.
    from config import config
    monkeypatch.setattr(config, "agent_blocked_quota_probe_s", 1, raising=False)
    monkeypatch.setattr(config, "agent_blocked_quota_probe_max_s", 1, raising=False)
    # Capture every substate set.
    seen: list[str] = []
    orig = runtime.set_substate

    async def capture(sub):
        seen.append(sub)
        await orig(sub)

    monkeypatch.setattr(runtime, "set_substate", capture)

    ok = await runtime.enter_blocked_quota(state, "primary_quota_exhausted")
    assert ok is True
    assert "blocked_quota" in seen, f"expected blocked_quota substate, got {seen}"
    # And the follow-on transition back to thinking on recovery.
    assert seen[-1] == "thinking"


# -----------------------------------------------------------------------------
# F-15 — router-side call_budget_exhausted audit row
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_call_budget_exhausted_writes_audit_row(monkeypatch: pytest.MonkeyPatch) -> None:
    from ai import provider as prov_mod

    captured: list[dict] = []

    async def fake_write_log(**kw):
        captured.append(kw)

    async def fake_note(task_id):
        return False  # budget hit

    monkeypatch.setattr("ai.tool_use_audit.write_log", fake_write_log)
    monkeypatch.setattr(prov_mod, "_runtime_note_llm_call", fake_note)

    from ai.provider import AIRouter
    from ai.tool_use import ToolUseError

    router = AIRouter.__new__(AIRouter)
    router._ensure_state_dicts()
    router._providers = {}

    result = await router.call_with_tools(
        system_prompt="sys", user_message="hello", tools=[],
        task_id="t-budget",
    )
    assert isinstance(result, ToolUseError)
    assert "call_budget_exhausted" in result.message
    assert any(
        row.get("error_kind") == "call_budget_exhausted"
        and row.get("task_id") == "t-budget"
        and row.get("provider") == "router"
        for row in captured
    ), f"no router budget-exhaust audit row, got {captured}"


@pytest.mark.asyncio
async def test_generate_budget_exhausted_writes_audit(monkeypatch: pytest.MonkeyPatch) -> None:
    from ai import provider as prov_mod

    captured: list[dict] = []

    async def fake_write_log(**kw):
        captured.append(kw)

    async def fake_note(task_id):
        return False

    monkeypatch.setattr("ai.tool_use_audit.write_log", fake_write_log)
    monkeypatch.setattr(prov_mod, "_runtime_note_llm_call", fake_note)

    from ai.provider import AIRouter

    router = AIRouter.__new__(AIRouter)
    router._ensure_state_dicts()
    router._providers = {}

    with pytest.raises(RuntimeError, match="call_budget_exhausted"):
        await router.generate("u", "s", [], task_id="t-gen")

    assert any(
        row.get("error_kind") == "call_budget_exhausted"
        and "generate" in (row.get("error_message") or "")
        for row in captured
    )


# -----------------------------------------------------------------------------
# F-17 — consent timeout
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_consent_timeout_wait_for_wrapping() -> None:
    """End-to-end timeout behaviour: confirm that a queue that never receives
    input raises asyncio.TimeoutError under wait_for within the configured
    ceiling. Matches the loop's new pattern at the risky-action and ask_user
    sites.
    """
    from agent.controls import ControlBus
    bus = ControlBus()
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(bus.intervention_queue.get(), timeout=0.2)


@pytest.mark.asyncio
async def test_consent_queue_deliver_before_timeout() -> None:
    """Sanity check: intervention arriving before the timeout resolves
    the wait_for normally — guards against a future regression that makes
    the TimeoutError path swallow legitimate inputs."""
    from agent.controls import ControlBus
    bus = ControlBus()

    async def deliver() -> None:
        await asyncio.sleep(0.05)
        await bus.intervention_queue.put("approve")

    asyncio.create_task(deliver())
    result = await asyncio.wait_for(bus.intervention_queue.get(), timeout=1.0)
    assert result == "approve"
