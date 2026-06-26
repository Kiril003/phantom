"""
Phase 9.4c — proactive loop scene emission tests.
"""
from __future__ import annotations

import asyncio
import os
import json
from datetime import datetime, timezone

import pytest
from agent.cognition.proactive.loop import ProactiveLoop

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase094c-scene")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")

def _build_runtime():
    from agent.kernel.runtime import AgentRuntime
    return AgentRuntime()

@pytest.mark.asyncio
async def test_proactive_scene_emitted(monkeypatch, isolated_db):
    """When decide returns kind=scene, _maybe_speak calls _emit_scene."""
    from config import config
    monkeypatch.setattr(config, "chat_artifacts_enabled", True)
    
    runtime = _build_runtime()
    loop = ProactiveLoop(runtime)
    
    # Mock context
    async def fake_build_ctx():
        return {"minutes_since_user": 10.0, "emotion": None}
    monkeypatch.setattr(loop, "_build_context", fake_build_ctx)
    monkeypatch.setattr(loop, "_should_consider_speaking", lambda ctx: True)
    
    # Mock decide
    async def fake_decide(ctx):
        return {
            "kind": "scene",
            "scene_brief": "dashboard",
            "message": "here is your dashboard",
            "reason": "test",
            "priority": 5,
        }
    monkeypatch.setattr(loop, "_decide", fake_decide)
    
    # Mock ArtifactStudio and response_formatter
    async def fake_build_artifact(brief, **kwargs):
        return (brief.title, "<html>test</html>")
    monkeypatch.setattr("ai.artifact_studio.build_artifact", fake_build_artifact)
    
    # Mock DB seed
    from db.database import get_session
    from db.models import ChatSession, User
    async with get_session() as db:
        db.add(User(id="u1", username="u1", role="ROOT"))
        db.add(ChatSession(id="s1", user_id="u1"))
        await db.commit()

    # Capture WS broadcast
    from api.websocket_hub import hub
    captured_ws: list[tuple[str, str, dict]] = []
    async def fake_broadcast(channel, type_, payload):
        captured_ws.append((channel, type_, payload))
    monkeypatch.setattr(hub, "broadcast", fake_broadcast)
    
    await loop._maybe_speak()
    
    # Verify WS broadcast
    assert any(c[1] == "message.proactive" for c in captured_ws)
    payload = [c[2] for c in captured_ws if c[1] == "message.proactive"][0]
    assert payload["message"]["response_form"] == "react_artifact"
    assert "here is your dashboard" in payload["message"]["content"]
    assert any(a["type"] == "artifact_data" for a in payload["message"]["attachments"])

# Fixture from test_phase09_3b_proactive.py
@pytest.fixture
async def isolated_db(monkeypatch):
    import db.database as _dbm
    import db.models as _dm
    import tempfile
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    import importlib
    if not _dbm.Base.metadata.tables:
        importlib.reload(_dm)
    fd, tmp_file = tempfile.mkstemp(suffix=".db", prefix="phantom_p94c_scene_")
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
