"""
Phase 9.4b — Overpass adapter + /map/nearby endpoint + NEAR_REMEMBERED trigger.
"""
from __future__ import annotations

import os
import tempfile
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase094b-nearby")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")

from agent.localization.adapters.overpass import (
    OSMFeature,
    OverpassQuery,
    set_default_overpass,
)


# ═════════════════════════════════════════════════════════════════════════════
# Overpass adapter
# ═════════════════════════════════════════════════════════════════════════════


class _OverpassMock:
    def __init__(self, payload):
        self._payload = payload
        self.calls = 0

    def __call__(self, *args, **kwargs):
        return self

    async def __aenter__(self): return self
    async def __aexit__(self, *_): return False

    async def post(self, url, data=None):
        import httpx
        self.calls += 1
        return httpx.Response(200, json=self._payload, request=httpx.Request("POST", url))


class TestOverpassQuery:
    @pytest.mark.asyncio
    async def test_parses_and_sorts_by_distance(self, monkeypatch):
        from agent.localization.adapters import overpass as op_mod
        payload = {
            "elements": [
                {"id": 1, "lat": 50.4510, "lon": 30.5240,
                 "tags": {"amenity": "cafe", "name": "Кав'ярня"}},
                {"id": 2, "lat": 50.4530, "lon": 30.5300,
                 "tags": {"amenity": "park", "name": "Парк"}},
            ],
        }
        monkeypatch.setattr(op_mod.httpx, "AsyncClient", _OverpassMock(payload))
        q = OverpassQuery()
        features = await q.features_near(50.4501, 30.5234, radius_m=500,
                                         feature_types=("amenity=cafe",))
        # Cafe matches feature_type filter, park does not.
        names = [f.name for f in features]
        assert "Кав'ярня" in names
        # Distance is ascending.
        assert all(features[i].distance_m <= features[i+1].distance_m
                   for i in range(len(features) - 1))

    @pytest.mark.asyncio
    async def test_caches_repeated_query(self, monkeypatch):
        from agent.localization.adapters import overpass as op_mod
        mock = _OverpassMock({"elements": []})
        monkeypatch.setattr(op_mod.httpx, "AsyncClient", mock)
        q = OverpassQuery()
        await q.features_near(50.45, 30.52, radius_m=500)
        await q.features_near(50.45, 30.52, radius_m=500)
        assert mock.calls == 1

    @pytest.mark.asyncio
    async def test_handles_network_error(self, monkeypatch):
        import httpx
        from agent.localization.adapters import overpass as op_mod

        class _Err:
            def __call__(self, *a, **k): return self
            async def __aenter__(self): return self
            async def __aexit__(self, *a): return False
            async def post(self, url, data=None):
                raise httpx.ConnectError("no net")

        monkeypatch.setattr(op_mod.httpx, "AsyncClient", _Err())
        q = OverpassQuery()
        assert await q.features_near(50.45, 30.52) == []

    @pytest.mark.asyncio
    async def test_disabled_config_returns_empty(self, monkeypatch):
        from config import config
        monkeypatch.setattr(config, "agent_overpass_enabled", False)
        q = OverpassQuery()
        assert await q.features_near(50.45, 30.52) == []

    @pytest.mark.asyncio
    async def test_sends_custom_user_agent(self, monkeypatch):
        """Phase 9.4c.1 hotfix — the Overpass public mirror returns 406
        Not Acceptable for httpx's default UA. Verify we pass a custom UA
        header into the httpx.AsyncClient constructor."""
        from agent.localization.adapters import overpass as op_mod
        import httpx as _httpx

        captured_headers: dict = {}
        real_async_client = _httpx.AsyncClient

        class _Spy(real_async_client):
            def __init__(self, *args, headers=None, **kwargs):
                if headers:
                    captured_headers.update(headers)
                super().__init__(*args, headers=headers, **kwargs)

            async def post(self, url, *args, **kwargs):  # type: ignore[override]
                return _httpx.Response(
                    200, json={"elements": []},
                    request=_httpx.Request("POST", url),
                )

        monkeypatch.setattr(op_mod.httpx, "AsyncClient", _Spy)
        q = OverpassQuery()
        await q.features_near(50.45, 30.52, radius_m=500)
        ua = captured_headers.get("User-Agent", "")
        assert ua, "Overpass adapter must set a User-Agent header"
        assert "PHANTOM" in ua or "phantom" in ua, f"UA looks wrong: {ua!r}"
        assert "python-httpx" not in ua, (
            "UA still looks like the httpx default — Overpass will 406"
        )


# ═════════════════════════════════════════════════════════════════════════════
# /map/nearby endpoint
# ═════════════════════════════════════════════════════════════════════════════


@pytest_asyncio.fixture
async def client(monkeypatch, tmp_path):
    import db.database as _dbm
    import db.models as _dm  # noqa: F401
    import importlib
    if not _dbm.Base.metadata.tables:
        importlib.reload(_dm)
    fd, tmp_file = tempfile.mkstemp(suffix=".db", prefix="phantom_p94b_nearby_")
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
        return TokenPayload(user_id="u-nearby", username="tester", role="ROOT",
                            exp=9_999_999_999, iat=0)
    app.dependency_overrides[require_auth] = _fake_auth

    # Seed user + memory + POI.
    from db.models import User, MemoryFact, MapPOI
    import uuid
    async with factory() as s:
        s.add(User(id="u-nearby", username="tester", role="ROOT"))
        s.add(MemoryFact(
            id=str(uuid.uuid4()), user_id="u-nearby", layer="tactical",
            category="location_reference", content="Парк Шевченка",
            importance=0.5, source_session_id="s1",
            place_name="Shevchenko Park", place_lat=50.4420, place_lon=30.5100,
            place_source="ner_extracted", place_confidence=0.7,
        ))
        s.add(MapPOI(
            id=str(uuid.uuid4()), user_id="u-nearby", lat=50.4430, lon=30.5110,
            name="Home", category="home", notes="",
        ))
        await s.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
    await engine.dispose()
    try:
        os.unlink(tmp_file)
    except OSError:
        pass


class TestNearbyEndpoint:
    @pytest.mark.asyncio
    async def test_combines_three_sources(self, client, monkeypatch):
        # Stub Overpass so it returns a predictable feature.
        class _FakeOverpass:
            async def features_near(self, lat, lon, *, radius_m=500, feature_types=None):
                return [OSMFeature(
                    osm_id=42, lat=50.4422, lon=30.5108,
                    name="Cafe Test", type="amenity=cafe",
                    tags={"amenity": "cafe"}, distance_m=120,
                )]
        set_default_overpass(_FakeOverpass())

        resp = await client.get("/api/v1/map/nearby",
                                params={"lat": 50.4420, "lon": 30.5100, "radius_m": 500})
        assert resp.status_code == 200
        data = resp.json()
        assert "remembered" in data and "osm" in data and "pois" in data
        assert any(r["content"] == "Парк Шевченка" for r in data["remembered"])
        assert any(f["osm_id"] == 42 for f in data["osm"])
        assert any(p["name"] == "Home" for p in data["pois"])
        set_default_overpass(None)

    @pytest.mark.asyncio
    async def test_overpass_disabled_returns_empty_osm(self, client, monkeypatch):
        from config import config
        monkeypatch.setattr(config, "agent_overpass_enabled", False)
        resp = await client.get("/api/v1/map/nearby",
                                params={"lat": 50.4420, "lon": 30.5100, "radius_m": 500})
        assert resp.status_code == 200
        data = resp.json()
        assert data["osm"] == []

    @pytest.mark.asyncio
    async def test_rejects_invalid_coords(self, client):
        resp = await client.get("/api/v1/map/nearby",
                                params={"lat": 999.0, "lon": 30.0, "radius_m": 500})
        assert resp.status_code == 422


# ═════════════════════════════════════════════════════════════════════════════
# /map/location_history endpoint
# ═════════════════════════════════════════════════════════════════════════════


class TestLocationHistoryEndpoint:
    @pytest.mark.asyncio
    async def test_returns_entries_ordered_desc(self, client):
        from db.models import LocationHistory
        import uuid
        from db.database import AsyncSessionLocal
        ts = datetime.now(tz=timezone.utc)
        async with AsyncSessionLocal() as s:
            for i in range(3):
                s.add(LocationHistory(
                    id=str(uuid.uuid4()), user_id="u-nearby",
                    lat=50.45 + i * 0.001, lon=30.52,
                    source="gps_hardware", confidence=0.9,
                    timestamp=ts.replace(minute=(ts.minute + i) % 60),
                ))
            await s.commit()

        resp = await client.get("/api/v1/map/location_history")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 3
        # Descending order by timestamp.
        ts_iso = [e["timestamp"] for e in data["entries"]]
        assert ts_iso == sorted(ts_iso, reverse=True)


# ═════════════════════════════════════════════════════════════════════════════
# NEAR_REMEMBERED_PLACE trigger
# ═════════════════════════════════════════════════════════════════════════════


class TestNearRememberedTrigger:
    @pytest.mark.asyncio
    async def test_emits_when_memory_is_close(self, db_factory_for_trigger, monkeypatch):
        from agent.localization.nearby_watch import check_and_emit, reset_state
        reset_state()

        class _FakeLoop:
            def __init__(self): self.pushed = []
            def push_trigger(self, t): self.pushed.append(t)

        loop = _FakeLoop()
        monkeypatch.setattr("agent.cognition.proactive.loop.get_loop", lambda: loop)

        payload = await check_and_emit(50.4500, 30.5234)
        assert payload is not None
        assert payload["distance_m"] < 200
        assert len(loop.pushed) == 1
        assert loop.pushed[0].kind.value == "near_remembered_place"
        reset_state()

    @pytest.mark.asyncio
    async def test_dedup_hour_window(self, db_factory_for_trigger, monkeypatch):
        from agent.localization.nearby_watch import check_and_emit, reset_state
        reset_state()

        class _FakeLoop:
            def __init__(self): self.pushed = []
            def push_trigger(self, t): self.pushed.append(t)

        loop = _FakeLoop()
        monkeypatch.setattr("agent.cognition.proactive.loop.get_loop", lambda: loop)

        await check_and_emit(50.4500, 30.5234)
        # Second call within dedup window: no new trigger.
        second = await check_and_emit(50.4500, 30.5234)
        assert second is None
        assert len(loop.pushed) == 1
        reset_state()


@pytest_asyncio.fixture
async def db_factory_for_trigger(monkeypatch):
    """Fixture tailored for nearby_watch — seeds one MemoryFact near Kyiv."""
    import db.database as _dbm
    import db.models as _dm  # noqa: F401
    import importlib
    if not _dbm.Base.metadata.tables:
        importlib.reload(_dm)
    fd, tmp_file = tempfile.mkstemp(suffix=".db", prefix="phantom_p94b_trig_")
    os.close(fd)
    url = f"sqlite+aiosqlite:///{tmp_file}"
    engine = create_async_engine(url, echo=False, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.run_sync(_dbm.Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(_dbm, "engine", engine)
    monkeypatch.setattr(_dbm, "AsyncSessionLocal", factory)

    from db.models import User, MemoryFact
    import uuid
    async with factory() as s:
        s.add(User(id="u-trig", username="tester", role="ROOT"))
        s.add(MemoryFact(
            id=str(uuid.uuid4()), user_id="u-trig", layer="tactical",
            category="location_reference", content="кав'ярня біля парку",
            importance=0.5, source_session_id="s1",
            place_name="Cafe", place_lat=50.4501, place_lon=30.5235,
            place_source="ner_extracted", place_confidence=0.7,
        ))
        await s.commit()

    yield factory
    await engine.dispose()
    try:
        os.unlink(tmp_file)
    except OSError:
        pass
