"""
Phase 9.4b — memory-to-geo bridge tests.

Covers GeoExtractor, Nominatim adapter caching, process_chat_message_for_places,
and find_memories_near. Nominatim is monkey-patched — no live network.
"""
from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase094b-memgeo")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")

from agent.localization.adapters.nominatim import (
    GeocodeResult,
    NominatimGeocoder,
    ReverseGeocodeResult,
    set_default_nominatim,
)


@pytest_asyncio.fixture
async def db_factory(monkeypatch):
    import db.database as _dbm
    import db.models as _dm  # noqa: F401
    import importlib
    if not _dbm.Base.metadata.tables:
        importlib.reload(_dm)
    fd, tmp_file = tempfile.mkstemp(suffix=".db", prefix="phantom_p94b_memgeo_")
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


# ═════════════════════════════════════════════════════════════════════════════
# GeoExtractor
# ═════════════════════════════════════════════════════════════════════════════


class TestGeoExtractor:
    def test_detects_ukrainian_self_location(self):
        from memory.geo_extractor import GeoExtractor
        ex = GeoExtractor()
        assert ex.detect_self_location("я в Одесі") == "Одесі"
        assert ex.detect_self_location("зараз у Києві працюю") == "Києві"

    def test_detects_english_self_location(self):
        from memory.geo_extractor import GeoExtractor
        ex = GeoExtractor()
        assert ex.detect_self_location("I'm in Kyiv right now").lower() == "kyiv"
        assert ex.detect_self_location("arrived in Boston today").lower() == "boston"

    def test_ignores_mentions_without_location_intent(self):
        from memory.geo_extractor import GeoExtractor
        ex = GeoExtractor()
        assert ex.detect_self_location("Я читав книгу") is None
        assert ex.detect_self_location("Hello world") is None

    def test_extract_returns_candidates_via_regex_fallback(self):
        # Regex fallback runs even without spaCy — tests the deterministic path.
        from memory.geo_extractor import GeoExtractor
        ex = GeoExtractor()
        ents = ex.extract("Я пам'ятаю вечір у Парку Шевченка на Подолі",
                          lang="uk")
        texts = [e.text for e in ents]
        # Parku / Shevchenka / Podoli may be picked up individually —
        # exact output depends on regex but at least one should hit.
        assert len(ents) >= 1

    def test_empty_text_returns_empty(self):
        from memory.geo_extractor import GeoExtractor
        ex = GeoExtractor()
        assert ex.extract("", lang="uk") == []
        assert ex.detect_self_location("") is None


# ═════════════════════════════════════════════════════════════════════════════
# Nominatim adapter — cache + rate limit
# ═════════════════════════════════════════════════════════════════════════════


class _NominatimMock:
    """Stubs httpx.AsyncClient for Nominatim tests."""

    def __init__(self, payload, *, reverse_payload=None):
        self._search = payload
        self._reverse = reverse_payload or {}
        self.search_calls = 0
        self.reverse_calls = 0

    def __call__(self, *args, **kwargs):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def get(self, url, params=None):
        import httpx
        if "search" in url:
            self.search_calls += 1
            return httpx.Response(200, json=self._search, request=httpx.Request("GET", url))
        self.reverse_calls += 1
        return httpx.Response(200, json=self._reverse, request=httpx.Request("GET", url))


class TestNominatimAdapter:
    @pytest.mark.asyncio
    async def test_forward_caches_repeated_query(self, monkeypatch):
        from agent.localization.adapters import nominatim as nom_mod
        mock = _NominatimMock([
            {"lat": "50.4501", "lon": "30.5234", "display_name": "Київ, Україна", "importance": 0.9}
        ])
        monkeypatch.setattr(nom_mod.httpx, "AsyncClient", mock)
        g = NominatimGeocoder()
        r1 = await g.geocode("Київ")
        r2 = await g.geocode("Київ")
        assert len(r1) == 1 and len(r2) == 1
        assert mock.search_calls == 1  # second call cached

    @pytest.mark.asyncio
    async def test_forward_returns_empty_on_network_error(self, monkeypatch):
        from agent.localization.adapters import nominatim as nom_mod
        import httpx

        class _ErrClient:
            def __call__(self, *a, **k): return self
            async def __aenter__(self): return self
            async def __aexit__(self, *a): return False
            async def get(self, url, params=None):
                raise httpx.ConnectError("no net")

        monkeypatch.setattr(nom_mod.httpx, "AsyncClient", _ErrClient())
        g = NominatimGeocoder()
        assert await g.geocode("Київ") == []

    @pytest.mark.asyncio
    async def test_reverse_parses_address(self, monkeypatch):
        from agent.localization.adapters import nominatim as nom_mod
        mock = _NominatimMock(
            [],
            reverse_payload={
                "lat": "50.4501", "lon": "30.5234",
                "display_name": "Київ, Україна",
                "address": {"city": "Київ", "country": "Україна", "country_code": "ua"},
            },
        )
        monkeypatch.setattr(nom_mod.httpx, "AsyncClient", mock)
        g = NominatimGeocoder()
        r = await g.reverse(50.45, 30.52)
        assert r is not None
        assert r.country == "Україна"
        assert r.country_code == "UA"
        assert r.city == "Київ"

    @pytest.mark.asyncio
    async def test_disabled_config_returns_empty(self, monkeypatch):
        from config import config
        monkeypatch.setattr(config, "agent_nominatim_enabled", False)
        g = NominatimGeocoder()
        assert await g.geocode("Київ") == []
        assert await g.reverse(50.0, 30.0) is None


# ═════════════════════════════════════════════════════════════════════════════
# process_chat_message_for_places — chat handler hook
# ═════════════════════════════════════════════════════════════════════════════


class _FakeGeocoder:
    """Controllable stub for geo_integration tests."""

    def __init__(self):
        self.geocode_calls = []
        self.reverse_calls = []
        self.forward_map: dict[str, list[GeocodeResult]] = {}
        self.reverse_result: ReverseGeocodeResult | None = None

    async def geocode(self, q, *, limit=5):
        self.geocode_calls.append(q)
        return self.forward_map.get(q.casefold().strip(), [])

    async def reverse(self, lat, lon):
        self.reverse_calls.append((lat, lon))
        return self.reverse_result


@pytest_asyncio.fixture
async def seeded_user(db):
    from db.models import User
    u = User(id="u-geo-1", username="geoer", role="ROOT")
    db.add(u)
    await db.flush()
    return u


class TestProcessChatMessageForPlaces:
    @pytest.mark.asyncio
    async def test_stores_place_fact_for_mention(self, db, seeded_user, monkeypatch):
        from memory.geo_integration import process_chat_message_for_places
        from memory.geo_extractor import reset_extractor

        reset_extractor()
        fake = _FakeGeocoder()
        fake.forward_map["shevchenko park"] = [
            GeocodeResult(lat=50.44, lon=30.52, display_name="Shevchenko Park, Kyiv")
        ]
        monkeypatch.setattr(
            "agent.localization.adapters.nominatim.get_default_nominatim",
            lambda: fake,
        )

        result = await process_chat_message_for_places(
            db, user_id=seeded_user.id, session_id="s1",
            message_text="I loved Shevchenko Park yesterday",
        )
        assert result.places_extracted >= 1
        # Verify at least one MemoryFact landed in the DB with place fields.
        from sqlalchemy import select
        from db.models import MemoryFact
        res = await db.execute(
            select(MemoryFact).where(MemoryFact.user_id == seeded_user.id)
        )
        rows = list(res.scalars().all())
        assert any(
            r.place_lat is not None and r.place_source == "ner_extracted" for r in rows
        )

    @pytest.mark.asyncio
    async def test_self_location_sets_user_stated_source(self, db, seeded_user, monkeypatch):
        from memory.geo_integration import process_chat_message_for_places, reset_region_memory
        from agent.localization.sources.user_stated import clear_user_stated, peek_user_stated
        from memory.geo_extractor import reset_extractor

        reset_region_memory()
        reset_extractor()
        clear_user_stated()

        fake = _FakeGeocoder()
        fake.forward_map["одесі"] = [
            GeocodeResult(lat=46.48, lon=30.73, display_name="Одеса, Україна")
        ]
        fake.reverse_result = ReverseGeocodeResult(
            lat=46.48, lon=30.73, display_name="Одеса, Україна",
            country="Україна", country_code="UA", city="Одеса", state=None,
        )
        monkeypatch.setattr(
            "agent.localization.adapters.nominatim.get_default_nominatim",
            lambda: fake,
        )

        result = await process_chat_message_for_places(
            db, user_id=seeded_user.id, session_id="s1",
            message_text="я в Одесі зараз",
        )
        assert result.self_location_set == "Одесі"
        stated = peek_user_stated()
        assert stated is not None
        assert abs(stated.lat - 46.48) < 1e-4
        clear_user_stated()

    @pytest.mark.asyncio
    async def test_region_change_emits_trigger(self, db, seeded_user, monkeypatch):
        from memory.geo_integration import process_chat_message_for_places, reset_region_memory
        from agent.localization.sources.user_stated import clear_user_stated
        from memory.geo_extractor import reset_extractor

        # Wire a proactive loop that captures triggers.
        class _FakeLoop:
            def __init__(self):
                self.pushed = []
            def push_trigger(self, t):
                self.pushed.append(t)

        fake_loop = _FakeLoop()
        monkeypatch.setattr("agent.proactive.get_loop", lambda: fake_loop)

        reset_region_memory()
        reset_extractor()
        clear_user_stated()

        fake = _FakeGeocoder()
        # First message: user says they are in Київ.
        fake.forward_map["києві"] = [GeocodeResult(50.45, 30.52, "Київ")]
        fake.reverse_result = ReverseGeocodeResult(
            lat=50.45, lon=30.52, display_name="Київ",
            country="Україна", country_code="UA", city="Київ", state=None,
        )
        monkeypatch.setattr(
            "agent.localization.adapters.nominatim.get_default_nominatim",
            lambda: fake,
        )

        await process_chat_message_for_places(
            db, user_id=seeded_user.id, session_id="s1",
            message_text="я у Києві",
        )
        assert fake_loop.pushed == []  # no prior country → no transition yet

        # Second message: user says Singapore → different country.
        fake.forward_map["singapore"] = [GeocodeResult(1.35, 103.82, "Singapore")]
        fake.reverse_result = ReverseGeocodeResult(
            lat=1.35, lon=103.82, display_name="Singapore",
            country="Singapore", country_code="SG", city="Singapore", state=None,
        )
        result = await process_chat_message_for_places(
            db, user_id=seeded_user.id, session_id="s1",
            message_text="I'm in Singapore",
        )
        assert result.region_transition == ("Україна", "Singapore")
        assert len(fake_loop.pushed) == 1
        kind = fake_loop.pushed[0].kind.value
        assert kind == "region_changed"
        clear_user_stated()

    @pytest.mark.asyncio
    async def test_disabled_extractor_no_op(self, db, seeded_user, monkeypatch):
        from config import config
        from memory.geo_integration import process_chat_message_for_places
        monkeypatch.setattr(config, "agent_geo_extractor_enabled", False)
        result = await process_chat_message_for_places(
            db, user_id=seeded_user.id, session_id="s1",
            message_text="I was in Paris",
        )
        assert result.facts_stored == 0
        assert result.places_extracted == 0


# ═════════════════════════════════════════════════════════════════════════════
# find_memories_near
# ═════════════════════════════════════════════════════════════════════════════


class TestFindMemoriesNear:
    @pytest.mark.asyncio
    async def test_returns_memories_within_radius(self, db, seeded_user):
        from db.models import MemoryFact
        import uuid
        # Three memories — two near Київ, one in Одеса.
        for label, lat, lon in [
            ("Kyiv-A", 50.4501, 30.5234),
            ("Kyiv-B", 50.4520, 30.5250),
            ("Odessa", 46.4825, 30.7233),
        ]:
            db.add(MemoryFact(
                id=str(uuid.uuid4()),
                user_id=seeded_user.id,
                layer="tactical",
                category="location_reference",
                content=label,
                importance=0.5,
                source_session_id="s1",
                place_name=label,
                place_lat=lat,
                place_lon=lon,
                place_source="test",
                place_confidence=0.8,
            ))
        await db.flush()

        from memory.geo_query import find_memories_near
        results = await find_memories_near(
            db, user_id=seeded_user.id, lat=50.4501, lon=30.5234,
            radius_km=1.0,
        )
        names = {r["content"] for r in results}
        assert "Kyiv-A" in names
        assert "Kyiv-B" in names
        assert "Odessa" not in names
        # Sorted by distance ascending.
        assert results[0]["distance_m"] <= results[-1]["distance_m"]

    @pytest.mark.asyncio
    async def test_empty_when_no_matches(self, db, seeded_user):
        from memory.geo_query import find_memories_near
        results = await find_memories_near(
            db, user_id=seeded_user.id, lat=0.0, lon=0.0, radius_km=0.1,
        )
        assert results == []

    @pytest.mark.asyncio
    async def test_excludes_sealed_by_default(self, db, seeded_user):
        from db.models import MemoryFact
        import uuid
        db.add(MemoryFact(
            id=str(uuid.uuid4()), user_id=seeded_user.id, layer="tactical",
            category="location_reference", content="sealed", importance=0.5,
            source_session_id="s1",
            place_name="p", place_lat=50.45, place_lon=30.52,
            place_source="test", place_confidence=0.8,
            is_sealed=True,
        ))
        await db.flush()
        from memory.geo_query import find_memories_near
        r_default = await find_memories_near(
            db, user_id=seeded_user.id, lat=50.45, lon=30.52, radius_km=1.0,
        )
        r_sealed = await find_memories_near(
            db, user_id=seeded_user.id, lat=50.45, lon=30.52, radius_km=1.0,
            include_sealed=True,
        )
        assert len(r_default) == 0
        assert len(r_sealed) == 1
