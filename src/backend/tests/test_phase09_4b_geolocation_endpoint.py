"""
Phase 9.4b — /map/geolocation/submit endpoint test.
"""
from __future__ import annotations

import os
import tempfile

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase094b-submit")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


@pytest_asyncio.fixture
async def client(monkeypatch, tmp_path):
    import db.database as _dbm
    import db.models as _dm  # noqa: F401
    import importlib
    if not _dbm.Base.metadata.tables:
        importlib.reload(_dm)
    fd, tmp_file = tempfile.mkstemp(suffix=".db", prefix="phantom_p94b_geo_")
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
    await engine.dispose()
    try:
        os.unlink(tmp_file)
    except OSError:
        pass


@pytest.mark.asyncio
async def test_submit_stores_estimate_for_resolver(client):
    from agent.localization.sources.browser_geolocation import (
        clear_browser_estimate, peek_browser_estimate,
    )
    clear_browser_estimate()

    resp = await client.post("/api/v1/map/geolocation/submit", json={
        "lat": 50.4501,
        "lon": 30.5234,
        "accuracy_m": 18.0,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["source"] == "browser_geolocation"
    assert data["accuracy_m"] == 18.0

    stored = peek_browser_estimate()
    assert stored is not None
    assert abs(stored.lat - 50.4501) < 1e-6
    clear_browser_estimate()


@pytest.mark.asyncio
async def test_submit_refuses_when_disabled(client, monkeypatch):
    from config import config
    monkeypatch.setattr(config, "agent_browser_geolocation_enabled", False)
    resp = await client.post("/api/v1/map/geolocation/submit", json={
        "lat": 0.0, "lon": 0.0,
    })
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_submit_rejects_invalid_coords(client):
    resp = await client.post("/api/v1/map/geolocation/submit", json={
        "lat": 1000.0,  # out of range
        "lon": 30.0,
    })
    assert resp.status_code == 422
