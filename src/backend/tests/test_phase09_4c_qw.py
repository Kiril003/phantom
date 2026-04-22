"""
Phase 9.4c quick-wins — integration tests for the chat context fixes.

Covers fetch_recent_places (fix #2) against a real LocationHistory table,
purges (fix #4), and the EMOTION block helper (fix #5). The pure prompt
rendering tests live in test_phase03 alongside the rest of TestPromptBuilder.
"""
from __future__ import annotations

import os
import tempfile
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase094c-qw")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


@pytest_asyncio.fixture
async def db_factory(monkeypatch):
    import db.database as _dbm
    import db.models as _dm  # noqa: F401
    import importlib
    if not _dbm.Base.metadata.tables:
        importlib.reload(_dm)
    fd, tmp_file = tempfile.mkstemp(suffix=".db", prefix="phantom_p94c_qw_")
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


@pytest_asyncio.fixture
async def db(db_factory):
    async with db_factory() as session:
        yield session


@pytest_asyncio.fixture
async def seeded_user(db):
    from db.models import User
    u = User(id=str(uuid.uuid4()), username="qw_user", role="ROOT")
    db.add(u)
    await db.flush()
    return u


# ═════════════════════════════════════════════════════════════════════════════
# Fix #2 — fetch_recent_places
# ═════════════════════════════════════════════════════════════════════════════


def _add_history(db, user_id: str, place: str, ts: datetime):
    from db.models import LocationHistory
    db.add(LocationHistory(
        id=str(uuid.uuid4()),
        user_id=user_id,
        lat=50.45, lon=30.52,
        source="gps_hardware",
        confidence=0.9,
        place_name=place,
        timestamp=ts,
    ))


@pytest.mark.asyncio
class TestFetchRecentPlaces:
    async def test_returns_distinct_places_in_window(self, db, seeded_user):
        from ai.prompt_builder import fetch_recent_places
        now = datetime.now(tz=timezone.utc)
        _add_history(db, seeded_user.id, "Cafe Pravda", now - timedelta(hours=2))
        _add_history(db, seeded_user.id, "Lviv Library", now - timedelta(hours=5))
        _add_history(db, seeded_user.id, "Cafe Pravda", now - timedelta(hours=1))
        await db.flush()
        places = await fetch_recent_places(db, seeded_user.id, hours=24, limit=5)
        names = [n for n, _ in places]
        assert "Cafe Pravda" in names
        assert "Lviv Library" in names
        # GROUP BY collapses the two Cafe Pravda rows into one entry.
        assert len(names) == 2

    async def test_excludes_rows_outside_window(self, db, seeded_user):
        from ai.prompt_builder import fetch_recent_places
        now = datetime.now(tz=timezone.utc)
        _add_history(db, seeded_user.id, "OldPlace", now - timedelta(hours=48))
        _add_history(db, seeded_user.id, "NewPlace", now - timedelta(hours=2))
        await db.flush()
        places = await fetch_recent_places(db, seeded_user.id, hours=24, limit=5)
        names = [n for n, _ in places]
        assert "NewPlace" in names
        assert "OldPlace" not in names

    async def test_excludes_null_place_name(self, db, seeded_user):
        from db.models import LocationHistory
        from ai.prompt_builder import fetch_recent_places
        now = datetime.now(tz=timezone.utc)
        db.add(LocationHistory(
            id=str(uuid.uuid4()),
            user_id=seeded_user.id,
            lat=50.45, lon=30.52,
            source="ip_estimate",
            confidence=0.3,
            place_name=None,
            timestamp=now - timedelta(hours=1),
        ))
        _add_history(db, seeded_user.id, "ResolvedPlace", now - timedelta(hours=2))
        await db.flush()
        places = await fetch_recent_places(db, seeded_user.id, hours=24, limit=5)
        names = [n for n, _ in places]
        assert names == ["ResolvedPlace"]

    async def test_returns_empty_when_no_history(self, db, seeded_user):
        from ai.prompt_builder import fetch_recent_places
        places = await fetch_recent_places(db, seeded_user.id, hours=24, limit=5)
        assert places == []

    async def test_returns_empty_when_db_is_none(self):
        from ai.prompt_builder import fetch_recent_places
        places = await fetch_recent_places(None, "any-user-id", hours=24, limit=5)
        assert places == []

    async def test_respects_limit(self, db, seeded_user):
        from ai.prompt_builder import fetch_recent_places
        now = datetime.now(tz=timezone.utc)
        for i in range(10):
            _add_history(
                db, seeded_user.id,
                f"Place{i:02d}",
                now - timedelta(hours=i + 1),
            )
        await db.flush()
        places = await fetch_recent_places(db, seeded_user.id, hours=24, limit=3)
        assert len(places) == 3


# ═════════════════════════════════════════════════════════════════════════════
# Fix #3 — context_engine nearby cache
# ═════════════════════════════════════════════════════════════════════════════


class _StubOSMFeature:
    def __init__(self, name, ftype, distance_m):
        self.name = name
        self.type = ftype
        self.distance_m = distance_m


class _StubOverpass:
    def __init__(self, payload):
        self._payload = payload
        self.calls = 0

    async def features_near(self, lat, lon, *, radius_m=500, feature_types=None):
        self.calls += 1
        return self._payload


@pytest.mark.asyncio
class TestNearbyCache:
    async def test_refresh_caches_within_window(self, monkeypatch):
        """Two refreshes inside the 60 s TTL → only one Overpass call."""
        from core.context_engine import ContextEngine
        stub = _StubOverpass([
            _StubOSMFeature("Cafe Aroma", "amenity=cafe", 110),
            _StubOSMFeature("Park", "leisure=park", 320),
        ])
        monkeypatch.setattr(
            "agent.localization.adapters.overpass.get_default_overpass",
            lambda: stub,
        )
        eng = ContextEngine()
        first = await eng._refresh_nearby(50.450, 30.520)
        second = await eng._refresh_nearby(50.4501, 30.5202)  # within rounding
        assert stub.calls == 1
        assert first == second
        assert first[0]["name"] == "Cafe Aroma"
        assert first[0]["distance_m"] == 110

    async def test_refresh_returns_named_features_only(self, monkeypatch):
        from core.context_engine import ContextEngine
        stub = _StubOverpass([
            _StubOSMFeature(None, "amenity=cafe", 50),
            _StubOSMFeature("Library", "amenity=library", 80),
        ])
        monkeypatch.setattr(
            "agent.localization.adapters.overpass.get_default_overpass",
            lambda: stub,
        )
        eng = ContextEngine()
        result = await eng._refresh_nearby(50.45, 30.52)
        assert len(result) == 1
        assert result[0]["name"] == "Library"

    async def test_refresh_returns_cached_data_on_overpass_error(self, monkeypatch):
        from core.context_engine import ContextEngine
        eng = ContextEngine()
        eng._nearby_cache_data = [{"name": "Old", "type": "x", "distance_m": 99}]

        class _Boom:
            async def features_near(self, *a, **k):
                raise RuntimeError("overpass down")

        monkeypatch.setattr(
            "agent.localization.adapters.overpass.get_default_overpass",
            lambda: _Boom(),
        )
        result = await eng._refresh_nearby(99.0, 99.0)
        assert result == [{"name": "Old", "type": "x", "distance_m": 99}]

    async def test_refresh_caps_at_top_five(self, monkeypatch):
        from core.context_engine import ContextEngine
        stub = _StubOverpass([
            _StubOSMFeature(f"P{i}", "amenity=cafe", 100 + i)
            for i in range(10)
        ])
        monkeypatch.setattr(
            "agent.localization.adapters.overpass.get_default_overpass",
            lambda: stub,
        )
        eng = ContextEngine()
        result = await eng._refresh_nearby(50.45, 30.52)
        assert len(result) == 5
        assert result[0]["name"] == "P0"

    async def test_resolve_localization_populates_snapshot_nearby(self, monkeypatch):
        from core.context_engine import ContextEngine
        from agent.localization.base import LocationEstimate

        eng = ContextEngine()
        # Pretend a resolver fix is available.
        est = LocationEstimate(
            lat=50.45, lon=30.52,
            source="browser_geolocation",
            confidence=0.75,
            accuracy_m=2000.0,
            trust_level=70,
        )

        class _Resolver:
            async def resolve(self):
                return est

        def _get_resolver():
            return _Resolver()

        monkeypatch.setattr(
            "agent.localization.get_resolver",
            _get_resolver,
        )

        stub = _StubOverpass([_StubOSMFeature("Cafe", "amenity=cafe", 50)])
        monkeypatch.setattr(
            "agent.localization.adapters.overpass.get_default_overpass",
            lambda: stub,
        )

        await eng.resolve_localization()
        snap = eng.get_snapshot()
        assert snap["nearby"]
        assert snap["nearby"][0]["name"] == "Cafe"
