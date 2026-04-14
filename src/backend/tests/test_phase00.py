"""
Phase 00 — Scaffolding tests.
Verify that all modules import correctly and DB models are valid.
"""
from __future__ import annotations

import pytest


def test_config_imports() -> None:
    from config import config, PhantomConfig  # noqa: F401
    assert config.host == "0.0.0.0"
    assert config.port == 8000
    assert config.ai_primary_provider in ("gemini", "ollama")


def test_db_models_import() -> None:
    from db.models import (  # noqa: F401
        User,
        ChatSession,
        ChatMessage,
        MemoryFact,
        TemporalAnchor,
        WardrivingRecord,
        MapPOI,
        Setting,
        StateTransitionLog,
        SensorLog,
        Timer,
        Alarm,
        CalendarEvent,
        GhostRecord,
    )


def test_db_base_import() -> None:
    from db.database import Base, engine, AsyncSessionLocal  # noqa: F401
    assert Base is not None


def test_api_routers_import() -> None:
    from api.routes_auth import router as auth_r  # noqa: F401
    from api.routes_chat import router as chat_r  # noqa: F401
    from api.routes_context import router as ctx_r  # noqa: F401
    from api.routes_settings import router as set_r  # noqa: F401
    from api.routes_map import router as map_r  # noqa: F401
    from api.routes_linux import router as linux_r  # noqa: F401
    from api.routes_tools import router as tools_r  # noqa: F401
    from api.routes_voice import router as voice_r  # noqa: F401


def test_websocket_hub_import() -> None:
    from api.websocket_hub import hub, WebSocketHub  # noqa: F401
    assert hub is not None
    assert hub.client_count == 0


def test_app_creation() -> None:
    from main import create_app
    app = create_app()
    assert app is not None
    # Check all routes registered
    paths = {r.path for r in app.routes}
    assert "/api/v1/auth/login/rfid" in paths
    assert "/api/v1/auth/login/pin" in paths
    assert "/api/v1/chat/message" in paths
    assert "/api/v1/context/current" in paths
    assert "/api/v1/settings" in paths
    assert "/api/v1/map/wardriving" in paths
    assert "/api/v1/linux/execute" in paths
    assert "/api/v1/tools/timer" in paths
    assert "/api/v1/voice/tts" in paths
    assert "/health" in paths


@pytest.mark.asyncio
async def test_db_init_creates_tables() -> None:
    """Test DB initializes in-memory without error."""
    import os
    os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"

    from importlib import reload
    import config as cfg_module
    import db.database as db_module

    reload(cfg_module)
    reload(db_module)

    from db.database import init_db, close_db
    await init_db()
    await close_db()
