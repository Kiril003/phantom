"""
Phase 09.1 — agent API endpoints. Auth is bypassed via dependency override.
"""
from __future__ import annotations

import json
import os
import tempfile

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase09-api")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


@pytest_asyncio.fixture
async def client(monkeypatch, tmp_path):
    # Isolated DB
    import db.database as _dbm
    import db.models as _dm  # noqa: F401
    import importlib
    if not _dbm.Base.metadata.tables:
        importlib.reload(_dm)
    fd, tmp_file = tempfile.mkstemp(suffix=".db", prefix="phantom_p9api_")
    os.close(fd)
    url = f"sqlite+aiosqlite:///{tmp_file}"
    engine = create_async_engine(url, echo=False, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.run_sync(_dbm.Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(_dbm, "engine", engine)
    monkeypatch.setattr(_dbm, "AsyncSessionLocal", factory)

    from config import config
    monkeypatch.setattr(config, "agent_workspace_dir", str(tmp_path))

    # Reset runtime
    from agent.runtime import agent_runtime
    agent_runtime.foreground_slot = None
    agent_runtime.task_runner = None
    agent_runtime.controls.reset()
    agent_runtime.substate = "idle"

    # Build app + override require_auth
    from main import create_app
    from security.auth import require_auth
    from security.jwt_manager import TokenPayload
    app = create_app()

    def _fake_auth() -> TokenPayload:
        return TokenPayload(user_id="u1", username="tester", role="ROOT",
                            exp=9_999_999_999, iat=0)

    app.dependency_overrides[require_auth] = _fake_auth

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    # Await any in-flight runner so DB handles don't leak into the next test
    if agent_runtime.task_runner and not agent_runtime.task_runner.done():
        agent_runtime.controls.emergency_stop.set()
        try:
            import asyncio as _aio
            await _aio.wait_for(agent_runtime.task_runner, timeout=3.0)
        except Exception:
            pass
    agent_runtime.foreground_slot = None
    agent_runtime.task_runner = None
    agent_runtime.controls.reset()

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
            return json.dumps({
                "action": "DONE_TASK", "args": {"summary": "exit"}, "intent": "exit",
                "monologue": {"what_i_see": "", "what_i_plan": "", "why_this_works": "",
                              "what_could_fail": "", "objection": None, "confidence": 1.0},
            })
        return queue.pop(0)

    from agent.planner import _llm
    monkeypatch.setattr(_llm, "_call", fake_call)
    return queue


# ═══════════════════════════════════════════════════════════════════════════════

class TestAPI:
    @pytest.mark.asyncio
    async def test_self_model_endpoint_returns_capabilities(self, client):
        resp = await client.get("/api/v1/agent/self_model")
        assert resp.status_code == 200
        body = resp.json()
        assert "self_model" in body
        assert "capabilities" in body["self_model"]
        assert "fs.read" in body["self_model"]["capabilities"]

    @pytest.mark.asyncio
    async def test_start_task_409_when_already_running(self, client, monkeypatch):
        """Double-start while the runtime slot is busy returns 409 with the
        existing task_id. We bypass the LLM entirely by pre-occupying the
        foreground slot — no real planner call is needed to exercise the
        conflict code path."""
        from agent.runtime import agent_runtime, TaskState
        from agent.schemas import SelfModel

        agent_runtime.foreground_slot = TaskState(
            id="preoccupied",
            goal="placeholder",
            track="foreground",
            status="running",
            self_model=SelfModel(),
        )

        r2 = await client.post("/api/v1/agent/task", json={"goal": "second"})
        assert r2.status_code == 409
        body2 = r2.json()
        assert body2["task_id"] == "preoccupied"
        assert body2["started"] is False

        # Clear for teardown
        agent_runtime.foreground_slot = None

    @pytest.mark.asyncio
    async def test_list_tasks_filtered(self, client):
        # Seed two tasks directly via the audit helper
        from agent.audit import create_task_row, update_task_status
        await create_task_row("done-1", "g1")
        await update_task_status("done-1", "done", finished=True)
        await create_task_row("paused-1", "g2")
        await update_task_status("paused-1", "paused", paused_reason="uvicorn_restart")

        r = await client.get("/api/v1/agent/tasks?status=paused")
        assert r.status_code == 200
        body = r.json()
        ids = [t["id"] for t in body["tasks"]]
        assert "paused-1" in ids and "done-1" not in ids

    @pytest.mark.asyncio
    async def test_audit_endpoint_returns_entries(self, client):
        from agent.audit import create_task_row, write_audit_entry
        from agent.schemas import ActionResult, InnerMonologue, PlanStep
        await create_task_row("Tapi", "goal")
        for i in range(3):
            step = PlanStep(step_idx=i, action="fs.read", args={"path": f"p{i}"},
                            intent="i", monologue=InnerMonologue(confidence=1.0))
            await write_audit_entry(task_id="Tapi", step=step,
                                    result=ActionResult(ok=True, elapsed_ms=1), risk_level=1)
        r = await client.get("/api/v1/agent/audit?task_id=Tapi&limit=10")
        assert r.status_code == 200
        rows = r.json()["audit"]
        assert len(rows) == 3

    @pytest.mark.asyncio
    async def test_feedback_persists(self, client):
        from agent.audit import create_task_row, write_audit_entry
        from agent.schemas import ActionResult, InnerMonologue, PlanStep
        await create_task_row("Tfb", "goal")
        step = PlanStep(step_idx=0, action="fs.read", args={"path": "x"},
                        intent="i", monologue=InnerMonologue())
        aid = await write_audit_entry(task_id="Tfb", step=step,
                                      result=ActionResult(ok=True, elapsed_ms=1), risk_level=1)
        r = await client.post("/api/v1/agent/feedback",
                              json={"audit_entry_id": aid, "rating": "up", "comment": None})
        assert r.status_code == 200 and r.json()["id"] > 0

    @pytest.mark.asyncio
    async def test_resume_from_checkpoint_404_for_unknown(self, client):
        r = await client.post("/api/v1/agent/task/whatever/resume_from_checkpoint",
                              json={"checkpoint_id": 99999})
        assert r.status_code == 404
