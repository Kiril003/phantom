"""T4 — GET /agent/chat/thread hydration + WS broadcast events."""
from __future__ import annotations

import os
import tempfile
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-v2-t4")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


@pytest_asyncio.fixture
async def isolated_db(monkeypatch):
    import db.models as _dm  # noqa: F401
    import db.database as _dbm

    fd, path = tempfile.mkstemp(suffix=".db", prefix="phantom_t4_")
    os.close(fd)
    url = f"sqlite+aiosqlite:///{path}"
    engine = create_async_engine(url, echo=False, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.run_sync(_dbm.Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(_dbm, "engine", engine)
    monkeypatch.setattr(_dbm, "AsyncSessionLocal", factory)
    yield factory
    await engine.dispose()
    try:
        os.unlink(path)
    except OSError:
        pass


def _token(uid: str):
    from security.jwt_manager import TokenPayload
    return TokenPayload(user_id=uid, username=uid, role="ROOT", exp=9999999999, iat=1)


def _make_ai_response(text: str = "ок"):
    from ai.provider import AIResponse
    return AIResponse(content=text, provider="stub")


def _mock_runtime():
    rt = MagicMock()
    rt.foreground_slot = None
    rt.foreground_substate = "idle"
    rt._broadcast = AsyncMock()
    return rt


@pytest.mark.asyncio
async def test_get_thread_empty(isolated_db):
    """Empty thread returns empty list (no crash)."""
    rt = _mock_runtime()
    with patch("api.routes_agent.agent_runtime", rt):
        from api.routes_agent import get_chat_thread
        result = await get_chat_thread(task_id="no-such", limit=20, token=_token("u1"))
    assert result["messages"] == []
    assert result["task_id"] == "no-such"


@pytest.mark.asyncio
async def test_get_thread_returns_persisted_turns(isolated_db):
    """After a chat call, GET returns the stored turns in order."""
    tid = f"t4-{uuid.uuid4().hex[:8]}"
    fake_ai = _make_ai_response("відповідь агента")

    with patch("api.routes_agent.agent_runtime", _mock_runtime()), \
         patch("ai.chat_pipeline.run", new=AsyncMock(return_value=fake_ai)), \
         patch("agent.cognition.memory.recall.recall", new=AsyncMock(return_value=[])), \
         patch("agent.cognition.memory.lessons.recall_lessons", new=AsyncMock(return_value=[])):

        from api.routes_agent import parallel_chat, ParallelChatRequest, get_chat_thread
        await parallel_chat(ParallelChatRequest(message="запит", task_id=tid), _token("u2"))
        result = await get_chat_thread(task_id=tid, limit=20, token=_token("u2"))

    assert len(result["messages"]) == 2
    assert result["messages"][0]["role"] == "user"
    assert result["messages"][1]["role"] == "assistant"
    assert "created_at" in result["messages"][0]


@pytest.mark.asyncio
async def test_ws_broadcast_called_on_chat(isolated_db):
    """Each chat call broadcasts user_message and reply events."""
    tid = f"t4-ws-{uuid.uuid4().hex[:8]}"
    fake_ai = _make_ai_response("pong")
    rt = _mock_runtime()

    # Patch at the routes_agent module level (where agent_runtime is used)
    # AND at the source module so both reference paths resolve.
    with patch("api.routes_agent.agent_runtime", rt), \
         patch("ai.chat_pipeline.run", new=AsyncMock(return_value=fake_ai)), \
         patch("agent.cognition.memory.recall.recall", new=AsyncMock(return_value=[])), \
         patch("agent.cognition.memory.lessons.recall_lessons", new=AsyncMock(return_value=[])):

        from api.routes_agent import parallel_chat, ParallelChatRequest
        await parallel_chat(ParallelChatRequest(message="ping", task_id=tid), _token("u3"))

    broadcast_types = [call.args[0] for call in rt._broadcast.call_args_list]
    assert "agent.chat.user_message" in broadcast_types
    assert "agent.chat.reply" in broadcast_types


@pytest.mark.asyncio
async def test_get_thread_falls_back_to_user_scope(isolated_db):
    """When task_id is absent and no active task, uses chat:{user_id}."""
    rt = _mock_runtime()
    with patch("api.routes_agent.agent_runtime", rt):
        from api.routes_agent import get_chat_thread
        result = await get_chat_thread(task_id=None, limit=20, token=_token("u99"))
    assert result["task_id"] == "chat:u99"
