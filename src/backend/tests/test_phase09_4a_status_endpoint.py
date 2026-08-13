"""
Phase 9.4a — GET /agent/status endpoint shape test.
"""
from __future__ import annotations

import os
import tempfile

import pytest

_TEST_USER = "test-user-phase09-4a-status-endpoint"
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase094a-status")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


@pytest_asyncio.fixture
async def client(monkeypatch, tmp_path):
    import db.database as _dbm
    import db.models as _dm  # noqa: F401
    import importlib
    if not _dbm.Base.metadata.tables:
        importlib.reload(_dm)
    fd, tmp_file = tempfile.mkstemp(suffix=".db", prefix="phantom_p94a_status_")
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

    from agent.kernel.runtime import agent_runtime
    agent_runtime.foreground_slot = None
    agent_runtime.background_slot = None
    agent_runtime._track_queues["foreground"].clear()
    agent_runtime._track_queues["background"].clear()
    agent_runtime.controls.reset()
    agent_runtime.foreground_substate = "idle"
    agent_runtime.background_substate = "idle"

    from main import create_app
    from security.auth import require_auth
    from security.jwt_manager import TokenPayload
    app = create_app()

    def _fake_auth():
        return TokenPayload(user_id="u1", username="tester", role="ROOT",
                            exp=9_999_999_999, iat=0)
    app.dependency_overrides[require_auth] = _fake_auth

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()

    agent_runtime.foreground_slot = None
    agent_runtime.background_slot = None
    await engine.dispose()
    try:
        os.unlink(tmp_file)
    except OSError:
        pass


@pytest.mark.asyncio
async def test_status_idle_returns_both_slots_inactive(client):
    resp = await client.get("/api/v1/agent/status")
    assert resp.status_code == 200
    data = resp.json()
    assert "foreground" in data and "background" in data
    assert data["foreground"]["active"] is False
    assert data["background"]["active"] is False
    assert data["foreground"]["queue_size"] == 0
    assert data["background"]["queue_size"] == 0


@pytest.mark.asyncio
async def test_status_reflects_active_background_slot(client):
    """Plant a task directly on the background slot and verify the endpoint
    surfaces it with the right origin/goal."""
    from agent.kernel.runtime import agent_runtime, TaskState
    from agent.schemas import SelfModel

    agent_runtime.background_slot = TaskState(
        user_id=_TEST_USER,
        id="bg-abc", goal="check disk space", track="background",
        status="running", self_model=SelfModel(),
        origin="standing_order",
    )
    agent_runtime.background_substate = "acting"

    resp = await client.get("/api/v1/agent/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["background"]["active"] is True
    assert data["background"]["task_id"] == "bg-abc"
    assert data["background"]["substate"] == "acting"
    assert data["background"]["goal"] == "check disk space"
    assert data["background"]["origin"] == "standing_order"
    # Foreground is still idle.
    assert data["foreground"]["active"] is False
