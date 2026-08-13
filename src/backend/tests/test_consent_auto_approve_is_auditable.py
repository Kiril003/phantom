"""An approval no human gave must not look like one a human gave.

When no paired phone carries the `approvals` capability the phone leg returns
`no_device`, and `agent_auto_approve_when_no_companion` then lets the action
through with nobody asked. The gate becomes permissive exactly when the human
is unreachable — while the *timeout* branch, ten lines below, correctly
rejects.

The default is not changed here; that is an owner decision. What these tests
pin is that the event is recorded, attributed to nobody, and carries its real
reason — so an operator reading the trail can tell the two apart.
"""
from __future__ import annotations

import asyncio
import json
import os
import tempfile

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-consent-audit")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")

RISKY_ACTION = "bash.run"        # RiskLevel.MEDIUM (5) > default tolerance 3
DESTRUCTIVE_ACTION = "git.rollback"  # RiskLevel.HIGH (7) — `reset --hard HEAD~1`


@pytest_asyncio.fixture
async def isolated_db(monkeypatch):
    import importlib

    import db.database as _dbm
    import db.models as _dm  # noqa: F401

    if not _dbm.Base.metadata.tables:
        importlib.reload(_dm)

    fd, tmp_file = tempfile.mkstemp(suffix=".db", prefix="phantom_consent_")
    os.close(fd)
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_file}",
        echo=False,
        connect_args={"check_same_thread": False},
    )
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


@pytest.fixture
def mock_llm(monkeypatch):
    queue: list[str] = []

    async def fake_call(prompt: str) -> str:
        if not queue:
            return _done_task("queue exhausted")
        return queue.pop(0)

    from config import config as _cfg
    from agent.cognition.memory import lessons as _lessons
    from agent.cognition.memory import recall as _recall_mod
    from agent.cognition.memory import seeds as _seeds
    from agent.cognition.planner import _llm
    from memory.brain import memory_brain as _brain

    monkeypatch.setattr(_llm, "_call", fake_call)
    monkeypatch.setattr(_cfg, "agent_use_native_tool_calling", False)

    async def _stub_summary(**kw):
        return "stub summary"

    async def _stub_recall(query, k=None):
        return []

    async def _stub_write_episode(**kw):
        return ""

    async def _stub_distill(**kw):
        return None

    async def _stub_recall_for_prompt(**kw):
        return []

    monkeypatch.setattr(_seeds, "compose_summary", _stub_summary)
    monkeypatch.setattr(_seeds, "write_episode", _stub_write_episode)
    monkeypatch.setattr(_recall_mod, "recall", _stub_recall)
    monkeypatch.setattr(_lessons, "distill_lesson", _stub_distill)
    monkeypatch.setattr(_lessons, "recall_lessons", _stub_recall)
    monkeypatch.setattr(_brain, "recall_for_prompt", _stub_recall_for_prompt)
    return queue


@pytest.fixture(autouse=True)
def isolate_runtime(monkeypatch, tmp_path):
    from config import config

    monkeypatch.setattr(config, "agent_workspace_dir", str(tmp_path))
    monkeypatch.setattr(config, "agent_max_actions_per_task", 12)
    monkeypatch.setattr(config, "agent_reflection_every_n_actions", 5)
    monkeypatch.setattr(config, "agent_risk_tolerance", 3)
    # Council would short-circuit the ask before the phone leg is reached.
    monkeypatch.setattr(config, "agent_council_for_high_risk", False)

    import agent.kernel.loop as loop_mod

    async def _fake_gate(**kwargs):
        from agent.operations.orchestrator.quality_gate import (
            CritiqueReport,
            GateDraft,
            GateResult,
        )

        return GateResult(
            final_draft=GateDraft(text=kwargs.get("intent", "ok")),
            revisions=[],
            critiques=[],
            final_critique=CritiqueReport(),
            passed=True,
            rounds_used=1,
        )

    monkeypatch.setattr(loop_mod, "run_quality_gate_for", _fake_gate)

    from agent.missions import reports as _reports

    async def _no_llm_narrative(self, *a, **kw):
        return None

    monkeypatch.setattr(_reports.ReportComposer, "_compose_llm", _no_llm_narrative)

    from agent.kernel.runtime import agent_runtime

    agent_runtime.foreground_slot = None
    agent_runtime.task_runner = None
    agent_runtime.controls.reset()
    agent_runtime.substate = "idle"
    yield
    agent_runtime.foreground_slot = None
    agent_runtime.task_runner = None
    agent_runtime.controls.reset()


def _strategic() -> str:
    return json.dumps({
        "sub_goals": [{
            "description": "sg0", "rationale": "r",
            "expected_actions": 1, "acceptance_criteria": "ok",
        }],
        "estimated_total_actions": 1,
        "risk_assessment": "high",
    })


def _tactical(action: str, args: dict) -> str:
    return json.dumps({
        "action": action, "args": args, "intent": "run the risky thing",
        "monologue": {
            "what_i_see": "x", "what_i_plan": "y", "why_this_works": "z",
            "what_could_fail": "f", "objection": None, "confidence": 0.9,
        },
    })


def _done_task(summary: str) -> str:
    return json.dumps({
        "action": "DONE_TASK", "args": {"summary": summary}, "intent": "exit",
        "monologue": {
            "what_i_see": "ok", "what_i_plan": "exit",
            "why_this_works": "done", "what_could_fail": "nothing",
            "objection": None, "confidence": 1.0,
        },
    })


async def _run_risky_task(
    mock_llm, action: str = RISKY_ACTION, args: dict | None = None
) -> str:
    from agent.kernel.runtime import agent_runtime

    if args is None:
        args = {"command": "echo consent-probe"} if action == RISKY_ACTION else {}
    mock_llm.append(_strategic())
    mock_llm.append(_tactical(action, args))
    mock_llm.append(_done_task("finished"))

    task_id, started = await agent_runtime.start_task("u-consent", "risky goal")
    assert started
    for _ in range(600):
        if agent_runtime.task_runner is None or agent_runtime.task_runner.done():
            break
        await asyncio.sleep(0.05)
    return task_id


async def _audit_rows(task_id: str):
    from db.database import get_session
    from db.models import AgentAuditEntry

    async with get_session() as db:
        return list((await db.execute(
            select(AgentAuditEntry)
            .where(AgentAuditEntry.task_id == task_id)
            .order_by(AgentAuditEntry.id)
        )).scalars().all())


def test_default_keeps_the_gate_armed():
    """Owner decision. Pinned so it cannot drift silently."""
    from config import PhantomConfig

    assert PhantomConfig.model_fields[
        "agent_auto_approve_when_no_companion"
    ].default is False


@pytest.mark.asyncio
async def test_auto_approval_is_recorded_as_a_machine_decision(
    isolated_db, mock_llm, monkeypatch
):
    from config import config

    monkeypatch.setattr(config, "agent_auto_approve_when_no_companion", True)

    task_id = await _run_risky_task(mock_llm)
    rows = await _audit_rows(task_id)

    consent = [r for r in rows if r.action_name == "consent.auto_approved"]
    assert consent, (
        "a risky action was approved with no human involved and left no audit "
        "row saying so — it is indistinguishable from a real approval. Rows "
        f"present: {[r.action_name for r in rows]}"
    )

    row = consent[0]
    result = json.loads(row.result_json)
    assert result["approved_by_human"] is False
    assert result["approver"] == "none"
    assert result["reason"], "the row must carry WHY no human was asked"
    assert json.loads(row.args_json)["action"] == RISKY_ACTION
    assert row.user_id == "u-consent", "the row must still name the task's owner"


@pytest.mark.asyncio
async def test_high_risk_is_never_auto_approved(
    isolated_db, mock_llm, monkeypatch
):
    """The case for auto-approve is availability — an unattended run should not
    die on its first MEDIUM action. That case does not reach the actions that
    destroy work, so HIGH is capped out regardless of the switch."""
    from config import config

    monkeypatch.setattr(config, "agent_auto_approve_when_no_companion", True)
    monkeypatch.setattr(config, "agent_user_consent_timeout_s", 1)

    task_id = await _run_risky_task(mock_llm, DESTRUCTIVE_ACTION)
    rows = await _audit_rows(task_id)

    approved = [r for r in rows if r.action_name == "consent.auto_approved"]
    assert not approved, (
        f"{DESTRUCTIVE_ACTION} (RiskLevel.HIGH) was auto-approved with no human "
        "asked — the cap does not hold"
    )
    assert not [r for r in rows if r.action_name == DESTRUCTIVE_ACTION], (
        "the destructive action executed anyway"
    )


@pytest.mark.asyncio
async def test_capped_decline_says_why(isolated_db, mock_llm, monkeypatch):
    """Otherwise an unattended run dies at the consent timeout and the trail
    blames the absent operator for a refusal the cap actually made."""
    from config import config

    monkeypatch.setattr(config, "agent_auto_approve_when_no_companion", True)
    monkeypatch.setattr(config, "agent_user_consent_timeout_s", 1)

    task_id = await _run_risky_task(mock_llm, DESTRUCTIVE_ACTION)
    rows = await _audit_rows(task_id)

    declined = [r for r in rows if r.action_name == "consent.auto_declined"]
    assert declined, (
        "the risk cap refused an auto-approval and left no trace of having "
        f"done so. Rows present: {[r.action_name for r in rows]}"
    )
    result = json.loads(declined[0].result_json)
    assert result["approved_by_human"] is False
    assert result["approved"] is False
    assert "risk" in result["reason"].lower()
    assert declined[0].risk_level == 7


@pytest.mark.asyncio
async def test_medium_risk_auto_approval_still_works(
    isolated_db, mock_llm, monkeypatch
):
    """The cap must not quietly become a total ban — that would take the
    availability benefit away without saying so."""
    from config import config

    monkeypatch.setattr(config, "agent_auto_approve_when_no_companion", True)

    task_id = await _run_risky_task(mock_llm, RISKY_ACTION)
    rows = await _audit_rows(task_id)

    assert [r for r in rows if r.action_name == "consent.auto_approved"], (
        "MEDIUM is no longer auto-approved — the cap over-corrected"
    )


@pytest.mark.asyncio
async def test_gate_armed_means_no_auto_approval_row(
    isolated_db, mock_llm, monkeypatch
):
    """With the switch off the loop must not manufacture an approval."""
    from config import config

    monkeypatch.setattr(config, "agent_auto_approve_when_no_companion", False)
    monkeypatch.setattr(config, "agent_user_consent_timeout_s", 1)

    task_id = await _run_risky_task(mock_llm)
    rows = await _audit_rows(task_id)

    assert not [r for r in rows if r.action_name == "consent.auto_approved"], (
        "the loop auto-approved while the switch was off"
    )


@pytest.mark.asyncio
async def test_the_approval_is_not_filed_as_a_user_utterance(
    isolated_db, mock_llm, monkeypatch
):
    """It used to append `build_user(...)`, so the task's own memory read as
    though the operator had typed 'approve'. A machine decision is a system
    event."""
    from config import config
    from agent.kernel.audit import get_task

    monkeypatch.setattr(config, "agent_auto_approve_when_no_companion", True)

    task_id = await _run_risky_task(mock_llm)
    row = await get_task("u-consent", task_id)

    observations = row.get("observations") or []
    user_inputs = [
        o for o in observations
        if (o.get("type") if isinstance(o, dict) else getattr(o, "type", None))
        == "user_input"
    ]
    for obs in user_inputs:
        content = obs.get("content") if isinstance(obs, dict) else obs.content
        assert "auto" not in (content or "").lower(), (
            f"machine approval recorded as a user_input observation: {content!r}"
        )


@pytest.mark.asyncio
async def test_a_crashed_phone_leg_is_not_reported_as_no_companion(
    isolated_db, mock_llm, monkeypatch
):
    """`no_device` is also what the loop substitutes when the phone leg
    *raises*. Auto-approving is one thing; recording the crash as 'no paired
    companion' would put a false reason in the audit trail."""
    from config import config
    import agent.operations.approve_on_phone as aop

    monkeypatch.setattr(config, "agent_auto_approve_when_no_companion", True)

    async def _boom(**kwargs):
        raise RuntimeError("pairing table unreachable")

    monkeypatch.setattr(aop, "request_phone_approval", _boom)

    task_id = await _run_risky_task(mock_llm)
    rows = await _audit_rows(task_id)

    consent = [r for r in rows if r.action_name == "consent.auto_approved"]
    assert consent, "no audit row for the auto-approval"

    reason = json.loads(consent[0].result_json)["reason"]
    assert "pairing table unreachable" in reason, (
        f"the audit row hides the real cause behind a generic reason: {reason!r}"
    )
