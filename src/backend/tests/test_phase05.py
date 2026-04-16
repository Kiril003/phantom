"""
Phase 05 — Chat + Response Forms tests.
Covers: routes_chat WS broadcast (message + stream), ResponseFormatter attachment
shapes, _chunk_content helper, register_ws_handlers wiring.
"""
from __future__ import annotations

import asyncio
import json
import os
import tempfile
import uuid
from pathlib import Path
from typing import Any, AsyncGenerator
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase05")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")


# ═══════════════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════════════

async def _make_test_db():
    import db.database as _dbm
    import db.models as _dm
    import importlib

    if not _dbm.Base.metadata.tables:
        importlib.reload(_dm)

    fd, tmp_file = tempfile.mkstemp(suffix=".db", prefix="phantom_p5_")
    os.close(fd)
    url = f"sqlite+aiosqlite:///{tmp_file}"
    engine = create_async_engine(url, echo=False, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.run_sync(_dbm.Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    return engine, factory, tmp_file


class _FakeHub:
    """Captures hub.broadcast() calls for inspection in tests."""
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        # Mirror real WebSocketHub surface so code under test can assert handlers on it
        self._handlers: dict[str, list] = {}
        self._clients: dict[str, Any] = {}

    async def broadcast(self, channel: str, type_: str, data: dict, user_id: str | None = None) -> None:
        self.calls.append({"channel": channel, "type": type_, "data": data, "user_id": user_id})

    def on(self, channel: str, handler) -> None:
        self._handlers.setdefault(channel, []).append(handler)


# ═══════════════════════════════════════════════════════════════════════════════
# 1. _chunk_content
# ═══════════════════════════════════════════════════════════════════════════════

class TestChunkContent:
    def test_empty_returns_empty(self):
        from api.routes_chat import _chunk_content
        assert _chunk_content("") == []

    def test_chunk_size_zero_single(self):
        from api.routes_chat import _chunk_content
        assert _chunk_content("hello", chunk_size=0) == ["hello"]

    def test_splits_on_whitespace_boundary(self):
        from api.routes_chat import _chunk_content
        text = "The quick brown fox jumps over the lazy dog"
        chunks = _chunk_content(text, chunk_size=12)
        assert "".join(chunks) == text
        # No chunk should exceed chunk_size by more than a few chars
        for c in chunks[:-1]:
            assert len(c) <= 16

    def test_joins_back_to_original(self):
        from api.routes_chat import _chunk_content
        text = "Hello PHANTOM, this is a short message."
        assert "".join(_chunk_content(text, chunk_size=5)) == text

    def test_handles_unicode(self):
        from api.routes_chat import _chunk_content
        text = "Привіт, я PHANTOM. Все працює добре."
        chunks = _chunk_content(text, chunk_size=10)
        assert "".join(chunks) == text


# ═══════════════════════════════════════════════════════════════════════════════
# 2. _broadcast_message_stream
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
class TestBroadcastStream:
    async def test_emits_stream_then_final(self):
        from api.routes_chat import _broadcast_message_stream
        hub = _FakeHub()
        message = {"id": "m1", "content": "Hello from PHANTOM", "session_id": "s1",
                   "role": "assistant", "response_form": "text", "attachments": [],
                   "user_id": "u1", "metadata": {}, "created_at": "2026-04-16T14:30:00+00:00"}
        with patch("api.routes_chat.config") as mock_cfg:
            mock_cfg.chat_stream_chunk_chars = 6
            mock_cfg.chat_stream_delay_s = 0.0
            await _broadcast_message_stream(hub, "u1", message, "s1")

        stream_calls = [c for c in hub.calls if c["type"] == "stream"]
        message_calls = [c for c in hub.calls if c["type"] == "message"]

        # At least one non-done stream + one done + final message
        assert any(sc["data"]["done"] is False for sc in stream_calls)
        done_calls = [sc for sc in stream_calls if sc["data"]["done"] is True]
        assert len(done_calls) == 1
        assert done_calls[0]["data"]["message"]["id"] == "m1"
        assert len(message_calls) == 1
        assert message_calls[0]["data"]["message"]["id"] == "m1"
        assert message_calls[0]["data"]["session_id"] == "s1"

    async def test_empty_content_still_emits_done(self):
        from api.routes_chat import _broadcast_message_stream
        hub = _FakeHub()
        message = {"id": "m2", "content": "", "session_id": "s2",
                   "role": "assistant", "response_form": "text", "attachments": [],
                   "user_id": "u2", "metadata": {}, "created_at": "2026-04-16T14:30:00+00:00"}
        with patch("api.routes_chat.config") as mock_cfg:
            mock_cfg.chat_stream_chunk_chars = 6
            mock_cfg.chat_stream_delay_s = 0.0
            await _broadcast_message_stream(hub, "u2", message, "s2")

        stream_done = [c for c in hub.calls if c["type"] == "stream" and c["data"]["done"]]
        assert len(stream_done) == 1


# ═══════════════════════════════════════════════════════════════════════════════
# 3. register_ws_handlers wires chat channel
# ═══════════════════════════════════════════════════════════════════════════════

class TestRegisterWsHandlers:
    def test_register_adds_chat_handler(self):
        from api.websocket_hub import WebSocketHub
        import api.routes_chat as rc
        import api.websocket_hub as whub

        fake_hub = WebSocketHub()
        original_hub = whub.hub
        try:
            whub.hub = fake_hub  # type: ignore[assignment]
            rc.register_ws_handlers()
            handlers = fake_hub._handlers.get("chat", [])
            assert len(handlers) >= 1
        finally:
            whub.hub = original_hub  # type: ignore[assignment]


# ═══════════════════════════════════════════════════════════════════════════════
# 4. Response attachment contracts (frontend dep)
# ═══════════════════════════════════════════════════════════════════════════════

class TestResponseAttachments:
    def test_chart_attachment_has_required_keys(self):
        from ai.response_formatter import parse_function_call
        form, _content, attachments = parse_function_call(
            "respond_chart",
            {"content": "x", "chart_type": "line",
             "data": [{"name": "A", "value": 1}], "title": "t"},
        )
        assert form == "chart"
        att = attachments[0]["data"]
        assert att["chart_type"] == "line"
        assert isinstance(att["data"], list)
        assert att["title"] == "t"
        assert att["x_key"] == "name"

    def test_map_attachment_has_markers_center_zoom(self):
        from ai.response_formatter import parse_function_call
        form, _content, attachments = parse_function_call(
            "respond_map",
            {"content": "x", "markers": [{"lat": 50.4, "lon": 30.5, "label": "p"}],
             "center": [50.4, 30.5], "zoom": 15},
        )
        assert form == "map"
        data = attachments[0]["data"]
        assert data["zoom"] == 15
        assert data["center"] == [50.4, 30.5]
        assert data["markers"][0]["label"] == "p"

    def test_terminal_attachment_has_command_and_explanation(self):
        from ai.response_formatter import parse_function_call
        form, _content, attachments = parse_function_call(
            "respond_terminal",
            {"content": "c", "command": "ls -la", "explanation": "listing"},
        )
        assert form == "terminal"
        data = attachments[0]["data"]
        assert data["command"] == "ls -la"
        assert data["explanation"] == "listing"

    def test_metric_card_attachment(self):
        from ai.response_formatter import parse_function_call
        form, _content, attachments = parse_function_call(
            "respond_metrics",
            {"content": "x", "metrics": [
                {"label": "CPU", "value": 42.0, "trend": "up"},
                {"label": "RAM", "value": 60.0, "trend": "stable"},
            ]},
        )
        assert form == "metric_cards"
        metrics = attachments[0]["data"]["metrics"]
        assert len(metrics) == 2
        assert metrics[0]["label"] == "CPU"


# ═══════════════════════════════════════════════════════════════════════════════
# 5. WS chat handler integration
# ═══════════════════════════════════════════════════════════════════════════════

@pytest_asyncio.fixture
async def ws_env() -> AsyncGenerator[tuple[Any, Any, Any, Any], None]:
    """Environment: test DB, mocked AI, fake WS hub with a loopback client."""
    from ai.provider import AIResponse
    import db.database as _db_mod

    engine, factory, tmp_file = await _make_test_db()
    original_engine = _db_mod.engine
    original_session = _db_mod.AsyncSessionLocal
    _db_mod.engine = engine
    _db_mod.AsyncSessionLocal = factory

    # Create a user
    from db.models import User
    user_id = str(uuid.uuid4())
    async with factory() as session:
        u = User(id=user_id, username="wsuser", role="ROOT",
                 preferences_json="{}", behavioral_model_json="{}")
        session.add(u)
        await session.commit()

    fake_hub = _FakeHub()

    class FakeClient:
        def __init__(self, uid: str):
            self.client_id = "test-client"
            self.user_id = uid
            self.sent: list[dict] = []

        async def send(self, channel: str, type_: str, data: dict) -> None:
            self.sent.append({"channel": channel, "type": type_, "data": data})

    client = FakeClient(user_id)

    import api.websocket_hub as whub
    original_hub = whub.hub
    whub.hub = fake_hub  # type: ignore[assignment]

    ai_mock = AsyncMock(return_value=AIResponse(
        content="Streamed response text", response_form="text",
        attachments=[], provider="gemini", tokens_used=10, latency_ms=50,
    ))

    try:
        with patch("api.routes_chat.ai_router") as ar, \
             patch("memory.strategic_memory.retrieve_relevant",
                   new=AsyncMock(return_value=[])), \
             patch("memory.strategic_memory.extract_and_store_facts",
                   new=AsyncMock(return_value=[])):
            ar.generate = ai_mock
            ar.active_provider_name = "gemini"
            yield fake_hub, client, factory, ai_mock
    finally:
        whub.hub = original_hub  # type: ignore[assignment]
        _db_mod.engine = original_engine
        _db_mod.AsyncSessionLocal = original_session
        await engine.dispose()
        Path(tmp_file).unlink(missing_ok=True)


@pytest.mark.asyncio
class TestWSChatHandler:
    async def test_message_triggers_stream_and_broadcast(self, ws_env):
        from api.routes_chat import _ws_chat_handler
        fake_hub, client, _factory, ai_mock = ws_env

        with patch("api.routes_chat.config") as mock_cfg:
            mock_cfg.chat_stream_chunk_chars = 6
            mock_cfg.chat_stream_delay_s = 0.0
            mock_cfg.memory_top_k = 5
            mock_cfg.chat_max_session_history = 20

            await _ws_chat_handler(
                "message",
                {"content": "Hi PHANTOM", "input_method": "text", "session_id": None},
                client,
            )

        # AI was invoked
        assert ai_mock.await_count == 1

        # No error sent to client
        errors = [s for s in client.sent if s["type"] == "error"]
        assert errors == []

        # Hub received events: user message + stream chunks + done + final assistant message
        user_msg_broadcasts = [
            c for c in fake_hub.calls
            if c["type"] == "message" and c["data"]["message"]["role"] == "user"
        ]
        assert len(user_msg_broadcasts) == 1

        stream_calls = [c for c in fake_hub.calls if c["type"] == "stream"]
        assert any(not sc["data"]["done"] for sc in stream_calls), "expected at least one delta chunk"
        done_calls = [sc for sc in stream_calls if sc["data"]["done"]]
        assert len(done_calls) == 1
        assert done_calls[0]["data"]["message"]["role"] == "assistant"
        assert done_calls[0]["data"]["message"]["content"] == "Streamed response text"

        assistant_msg_broadcasts = [
            c for c in fake_hub.calls
            if c["type"] == "message" and c["data"]["message"]["role"] == "assistant"
        ]
        assert len(assistant_msg_broadcasts) == 1
        assert assistant_msg_broadcasts[0]["user_id"] == client.user_id

    async def test_empty_content_ignored(self, ws_env):
        from api.routes_chat import _ws_chat_handler
        _hub, client, _factory, ai_mock = ws_env

        await _ws_chat_handler("message", {"content": "   "}, client)
        assert ai_mock.await_count == 0

    async def test_unauth_user_gets_error(self, ws_env):
        from api.routes_chat import _ws_chat_handler
        _hub, _client, _factory, _ai_mock = ws_env

        class Unauth:
            user_id = None
            client_id = "x"
            sent: list[dict] = []

            async def send(self, channel, type_, data):
                self.sent.append({"channel": channel, "type": type_, "data": data})

        u = Unauth()
        await _ws_chat_handler("message", {"content": "hi"}, u)
        assert any(s["type"] == "error" for s in u.sent)

    async def test_wrong_type_ignored(self, ws_env):
        from api.routes_chat import _ws_chat_handler
        _hub, client, _factory, ai_mock = ws_env
        await _ws_chat_handler("noop", {"content": "hi"}, client)
        assert ai_mock.await_count == 0


# ═══════════════════════════════════════════════════════════════════════════════
# 6. POST /chat/message still sends WS stream (regression)
# ═══════════════════════════════════════════════════════════════════════════════

@pytest_asyncio.fixture
async def chat_client_p5() -> AsyncGenerator[tuple[AsyncClient, _FakeHub], None]:
    import db.database as _db_mod
    from main import app
    from db.database import get_db
    from security.auth import ensure_default_user
    from ai.provider import AIResponse

    test_engine, factory, tmp_file = await _make_test_db()
    original_engine = _db_mod.engine
    original_session = _db_mod.AsyncSessionLocal
    _db_mod.engine = test_engine
    _db_mod.AsyncSessionLocal = factory

    async def _override_get_db():
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    async with factory() as session:
        await ensure_default_user(session)
        await session.commit()

    app.dependency_overrides[get_db] = _override_get_db

    mock_response = AIResponse(
        content="Привіт! Працюю.", response_form="text",
        attachments=[], provider="gemini", tokens_used=5, latency_ms=50,
    )

    fake_hub = _FakeHub()

    with patch("api.routes_chat.ai_router") as ar, \
         patch("api.routes_chat.hub", fake_hub, create=True) if False else \
         patch.dict(os.environ, os.environ.copy()), \
         patch("memory.strategic_memory.retrieve_relevant",
               new=AsyncMock(return_value=[])), \
         patch("memory.strategic_memory.extract_and_store_facts",
               new=AsyncMock(return_value=[])):
        ar.generate = AsyncMock(return_value=mock_response)
        ar.active_provider_name = "gemini"

        # Inject fake hub by patching the module-level reference inside routes_chat
        import api.websocket_hub as _whub
        original_hub = _whub.hub
        _whub.hub = fake_hub  # type: ignore[assignment]

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            try:
                yield client, fake_hub
            finally:
                _whub.hub = original_hub  # type: ignore[assignment]

    app.dependency_overrides.clear()
    _db_mod.engine = original_engine
    _db_mod.AsyncSessionLocal = original_session
    await test_engine.dispose()
    Path(tmp_file).unlink(missing_ok=True)


@pytest.mark.asyncio
class TestPostMessageBroadcast:
    async def _login(self, client: AsyncClient) -> str:
        resp = await client.post(
            "/api/v1/auth/login/pin",
            json={"username": "phantom", "pin": "000000"},
        )
        assert resp.status_code == 200
        return resp.json()["token"]

    async def test_post_message_broadcasts_stream(self, chat_client_p5):
        client, fake_hub = chat_client_p5
        token = await self._login(client)

        with patch("api.routes_chat.config") as mock_cfg:
            mock_cfg.chat_stream_chunk_chars = 6
            mock_cfg.chat_stream_delay_s = 0.0
            mock_cfg.memory_top_k = 5

            resp = await client.post(
                "/api/v1/chat/message",
                json={"content": "Привіт", "input_method": "text"},
                headers={"Authorization": f"Bearer {token}"},
            )
        assert resp.status_code == 200

        types = [c["type"] for c in fake_hub.calls]
        assert "stream" in types
        assert "message" in types
        # Final done=true must include the message payload
        done_calls = [c for c in fake_hub.calls if c["type"] == "stream" and c["data"].get("done")]
        assert len(done_calls) == 1
        assert done_calls[0]["data"]["message"]["response_form"] == "text"
