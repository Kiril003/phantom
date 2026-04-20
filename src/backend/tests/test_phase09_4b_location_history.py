"""
Phase 9.4b — LocationHistory writer + enricher tests.
"""
from __future__ import annotations

import os
import tempfile
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase094b-hist")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")

from agent.localization.base import LocationEstimate
from agent.localization.adapters.nominatim import ReverseGeocodeResult


@pytest_asyncio.fixture
async def db_factory(monkeypatch):
    import db.database as _dbm
    import db.models as _dm  # noqa: F401
    import importlib
    if not _dbm.Base.metadata.tables:
        importlib.reload(_dm)
    fd, tmp_file = tempfile.mkstemp(suffix=".db", prefix="phantom_p94b_hist_")
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
async def seeded_user(db_factory):
    from db.models import User
    async with db_factory() as s:
        u = User(id="u-hist-1", username="tester", role="ROOT")
        s.add(u)
        await s.commit()
    return "u-hist-1"


def _est(lat: float, lon: float, *, ts: datetime | None = None) -> LocationEstimate:
    return LocationEstimate(
        lat=lat, lon=lon, source="gps_hardware", confidence=0.9,
        accuracy_m=15.0, timestamp=ts or datetime.now(tz=timezone.utc),
        trust_level=95,
    )


# ═════════════════════════════════════════════════════════════════════════════
# Writer
# ═════════════════════════════════════════════════════════════════════════════


class TestLocationHistoryWriter:
    @pytest.mark.asyncio
    async def test_writes_first_fix(self, db_factory, seeded_user, monkeypatch):
        from agent.localization import get_resolver, set_resolver
        from agent.localization.resolver import LocalizationResolver
        from agent.localization.history_writer import LocationHistoryWriter

        set_resolver(None)
        r = LocalizationResolver()
        set_resolver(r)
        # Seed an estimate in the resolver's history directly (bypass source tick).
        r._history.append(_est(50.45, 30.52))

        writer = LocationHistoryWriter()
        await writer._tick()

        from db.models import LocationHistory
        async with db_factory() as s:
            rows = (await s.execute(select(LocationHistory))).scalars().all()
        assert len(rows) == 1
        assert rows[0].source == "gps_hardware"
        set_resolver(None)

    @pytest.mark.asyncio
    async def test_skips_when_below_distance_and_interval(self, db_factory, seeded_user):
        from agent.localization import get_resolver, set_resolver
        from agent.localization.resolver import LocalizationResolver
        from agent.localization.history_writer import LocationHistoryWriter

        set_resolver(None)
        r = LocalizationResolver()
        set_resolver(r)

        writer = LocationHistoryWriter()
        r._history.append(_est(50.45, 30.52))
        await writer._tick()  # writes

        # Move < 50 m and come back immediately — should skip.
        r._history.append(_est(50.4501, 30.5201))
        await writer._tick()

        from db.models import LocationHistory
        async with db_factory() as s:
            rows = (await s.execute(select(LocationHistory))).scalars().all()
        assert len(rows) == 1
        set_resolver(None)

    @pytest.mark.asyncio
    async def test_writes_when_moved_beyond_threshold(self, db_factory, seeded_user):
        from agent.localization import set_resolver
        from agent.localization.resolver import LocalizationResolver
        from agent.localization.history_writer import LocationHistoryWriter

        set_resolver(None)
        r = LocalizationResolver()
        set_resolver(r)

        writer = LocationHistoryWriter()
        r._history.append(_est(50.45, 30.52))
        await writer._tick()  # writes

        # Move ~1 km away → exceeds 50 m threshold.
        r._history.append(_est(50.46, 30.52))
        await writer._tick()

        from db.models import LocationHistory
        async with db_factory() as s:
            rows = (await s.execute(select(LocationHistory))).scalars().all()
        assert len(rows) == 2
        set_resolver(None)

    @pytest.mark.asyncio
    async def test_disabled_config_short_circuits(self, db_factory, seeded_user, monkeypatch):
        from config import config
        from agent.localization import set_resolver
        from agent.localization.resolver import LocalizationResolver
        from agent.localization.history_writer import LocationHistoryWriter

        monkeypatch.setattr(config, "agent_location_history_enabled", False)
        set_resolver(None)
        r = LocalizationResolver()
        set_resolver(r)
        r._history.append(_est(50.45, 30.52))

        writer = LocationHistoryWriter()
        # _run respects the config flag, but direct _tick doesn't — validate
        # via _run's gate by awaiting one iteration manually.
        import asyncio
        task = asyncio.create_task(writer._run())
        await asyncio.sleep(0.01)
        writer._stop_event.set()
        # Give task a chance to notice.
        try:
            await asyncio.wait_for(task, timeout=15.0)
        except asyncio.TimeoutError:
            task.cancel()
        from db.models import LocationHistory
        async with db_factory() as s:
            rows = (await s.execute(select(LocationHistory))).scalars().all()
        assert len(rows) == 0
        set_resolver(None)


# ═════════════════════════════════════════════════════════════════════════════
# Enricher
# ═════════════════════════════════════════════════════════════════════════════


class TestLocationHistoryEnricher:
    @pytest.mark.asyncio
    async def test_populates_place_name_on_reverse_hit(self, db_factory, seeded_user, monkeypatch):
        import uuid
        from db.models import LocationHistory

        async with db_factory() as s:
            s.add(LocationHistory(
                id=str(uuid.uuid4()), user_id=seeded_user,
                lat=50.45, lon=30.52, source="gps_hardware", confidence=0.9,
                timestamp=datetime.now(tz=timezone.utc),
            ))
            await s.commit()

        class _FakeGeocoder:
            async def reverse(self, lat, lon):
                return ReverseGeocodeResult(
                    lat=lat, lon=lon, display_name="Київ, Україна",
                    country="Україна", country_code="UA", city="Київ", state=None,
                )
            async def geocode(self, *_, **__): return []

        monkeypatch.setattr(
            "agent.localization.adapters.nominatim.get_default_nominatim",
            lambda: _FakeGeocoder(),
        )
        from agent.localization.history_writer import LocationHistoryEnricher
        enricher = LocationHistoryEnricher()
        updated = await enricher._cycle()
        assert updated == 1

        async with db_factory() as s:
            rows = (await s.execute(select(LocationHistory))).scalars().all()
        assert rows[0].place_name == "Київ, Україна"
        assert rows[0].country == "Україна"

    @pytest.mark.asyncio
    async def test_nominatim_disabled_skips(self, db_factory, seeded_user, monkeypatch):
        from config import config
        monkeypatch.setattr(config, "agent_nominatim_enabled", False)
        from agent.localization.history_writer import LocationHistoryEnricher
        enricher = LocationHistoryEnricher()
        updated = await enricher._cycle()
        assert updated == 0
