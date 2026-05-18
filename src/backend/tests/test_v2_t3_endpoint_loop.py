"""T3 — parallel_chat endpoint loop: thread persistence, back-compat, tool path."""
from __future__ import annotations

import os
import tempfile
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-v2-t3")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


# ── DB fixture ───────────────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def isolated_db(monkeypatch):
    import db.models as _dm  # noqa: F401
    import db.database as _dbm

    fd, path = tempfile.mkstemp(suffix=".db", prefix="phantom_t3_")
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


# ── Helpers ──────────────────────────────────────────────────────────────────


def _make_ai_response(text: str = "ок"):
    from ai.provider import AIResponse
    return AIResponse(content=text, provider="stub")


def _mock_runtime(task_id: str | None = None):
    rt = MagicMock()
    rt.foreground_slot = None
    rt.foreground_substate = "idle"
    rt._broadcast = AsyncMock()
    return rt


# ── Tests ────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_reply_returned_and_thread_persisted(isolated_db):
    """Both turns written to DB; response has 'reply' key (back-compat)."""
    from agent.cognition.chat_prompt import load_thread

    tid = f"chat:user-{uuid.uuid4().hex[:8]}"
    fake_ai = _make_ai_response("Привіт від агента")

    with patch("agent.kernel.runtime.agent_runtime", _mock_runtime()), \
         patch("ai.chat_pipeline.run", new=AsyncMock(return_value=fake_ai)), \
         patch("agent.cognition.memory.recall.recall", new=AsyncMock(return_value=[])), \
         patch("agent.cognition.memory.lessons.recall_lessons", new=AsyncMock(return_value=[])):

        from api.routes_agent import parallel_chat, ParallelChatRequest
        from security.jwt_manager import TokenPayload

        token = TokenPayload(user_id="u1", username="u1", role="ROOT", exp=9999999999, iat=1)
        req = ParallelChatRequest(message="привіт", task_id=tid)

        result = await parallel_chat(req, token)

    assert result["reply"] == "Привіт від агента"
    assert "task_id" in result

    async with isolated_db() as db:
        thread = await load_thread(db, tid)
    assert len(thread) == 2
    assert thread[0]["role"] == "user"
    assert thread[1]["role"] == "assistant"
    assert "агента" in thread[1]["content"]


@pytest.mark.asyncio
async def test_thread_accumulates_across_calls(isolated_db):
    """Each call appends; second call sees prior history."""
    tid = f"chat:u2-{uuid.uuid4().hex[:8]}"
    calls: list[list] = []

    async def capture_run(user_message, system_prompt, history, user_id, db, **_kw):
        calls.append(list(history))
        return _make_ai_response("ok")

    with patch("agent.kernel.runtime.agent_runtime", _mock_runtime()), \
         patch("ai.chat_pipeline.run", new=capture_run), \
         patch("agent.cognition.memory.recall.recall", new=AsyncMock(return_value=[])), \
         patch("agent.cognition.memory.lessons.recall_lessons", new=AsyncMock(return_value=[])):

        from api.routes_agent import parallel_chat, ParallelChatRequest
        from security.jwt_manager import TokenPayload

        token = TokenPayload(user_id="u2", username="u2", role="ROOT", exp=9999999999, iat=1)

        await parallel_chat(ParallelChatRequest(message="перше", task_id=tid), token)
        await parallel_chat(ParallelChatRequest(message="друге", task_id=tid), token)

    # Second call must have seen 2 turns from first round (user+assistant)
    assert len(calls[0]) == 0      # first call: empty history
    assert len(calls[1]) == 2      # second call: prior user+assistant turn


@pytest.mark.asyncio
async def test_no_active_task_uses_chat_scoped_id(isolated_db):
    """When no task is active, falls back to chat:{user_id} thread."""
    fake_ai = _make_ai_response("idle reply")

    with patch("agent.kernel.runtime.agent_runtime", _mock_runtime()), \
         patch("ai.chat_pipeline.run", new=AsyncMock(return_value=fake_ai)), \
         patch("agent.cognition.memory.recall.recall", new=AsyncMock(return_value=[])), \
         patch("agent.cognition.memory.lessons.recall_lessons", new=AsyncMock(return_value=[])):

        from api.routes_agent import parallel_chat, ParallelChatRequest
        from security.jwt_manager import TokenPayload

        token = TokenPayload(user_id="u3", username="u3", role="ROOT", exp=9999999999, iat=1)
        result = await parallel_chat(ParallelChatRequest(message="ping"), token)

    assert result["task_id"] == "chat:u3"
    assert result["reply"] == "idle reply"


@pytest.mark.asyncio
async def test_pipeline_failure_returns_503(isolated_db):
    """When chat_pipeline raises, endpoint returns 503 HTTPException."""
    from fastapi import HTTPException

    async def fail(*_a, **_kw):
        raise RuntimeError("provider down")

    with patch("agent.kernel.runtime.agent_runtime", _mock_runtime()), \
         patch("ai.chat_pipeline.run", new=fail), \
         patch("agent.cognition.memory.recall.recall", new=AsyncMock(return_value=[])), \
         patch("agent.cognition.memory.lessons.recall_lessons", new=AsyncMock(return_value=[])):

        from api.routes_agent import parallel_chat, ParallelChatRequest
        from security.jwt_manager import TokenPayload

        token = TokenPayload(user_id="u4", username="u4", role="ROOT", exp=9999999999, iat=1)
        with pytest.raises(HTTPException) as exc_info:
            await parallel_chat(ParallelChatRequest(message="test"), token)

    assert exc_info.value.status_code == 503
