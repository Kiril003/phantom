"""
Phase 06 — Tactical Map tests.
Covers: wardriving.collector (MAC normalization, upsert, ingest_wifi_networks,
WardrivingCollector.process_batch), wardriving.heatmap (rssi_to_linear,
generate_heatmap), routes_map (bounds parser, wardriving/heatmap/POI/track).
"""
from __future__ import annotations

import os
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, AsyncGenerator
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase06")
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

    fd, tmp_file = tempfile.mkstemp(suffix=".db", prefix="phantom_p6_")
    os.close(fd)
    url = f"sqlite+aiosqlite:///{tmp_file}"
    engine = create_async_engine(url, echo=False, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.run_sync(_dbm.Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    return engine, factory, tmp_file


def _make_wifi_net(
    mac: str = "AA:BB:CC:DD:EE:01",
    ssid: str = "PhantomLab",
    rssi: int = -55,
    encryption: int = 3,
    channel: int = 6,
):
    from sensors.sensor_parser import WiFiNetwork
    return WiFiNetwork(mac=mac, ssid=ssid, rssi=rssi, encryption=encryption, channel=channel)


def _make_batch_with_wifi(lat: float = 50.45, lon: float = 30.52, nets=None, has_gps: bool = True):
    from sensors.sensor_parser import SensorBatch, GPSData
    batch = SensorBatch(version=3, timestamp_ms=123456, type="sensor_batch")
    if has_gps:
        batch.gps = GPSData(
            lat=lat, lon=lon, fix=True, satellites=8,
            speed_kmh=0.0, altitude_m=100.0, hdop=1.2,
        )
    batch.wifi_nets = nets if nets is not None else [_make_wifi_net()]
    return batch


# ═══════════════════════════════════════════════════════════════════════════════
# 1. MAC / encryption / coord helpers
# ═══════════════════════════════════════════════════════════════════════════════

class TestCollectorHelpers:
    def test_normalize_mac_colon(self):
        from wardriving.collector import normalize_mac
        assert normalize_mac("aa:bb:cc:dd:ee:ff") == "AA:BB:CC:DD:EE:FF"

    def test_normalize_mac_dash(self):
        from wardriving.collector import normalize_mac
        assert normalize_mac("aa-bb-cc-dd-ee-ff") == "AA:BB:CC:DD:EE:FF"

    def test_normalize_mac_bare(self):
        from wardriving.collector import normalize_mac
        assert normalize_mac("aabbccddeeff") == "AA:BB:CC:DD:EE:FF"

    def test_normalize_mac_invalid_empty(self):
        from wardriving.collector import normalize_mac
        assert normalize_mac("") == ""
        assert normalize_mac("zz:zz") == ""
        assert normalize_mac("AA:BB:CC") == ""

    def test_encryption_label_known(self):
        from wardriving.collector import encryption_label
        assert encryption_label(0) == "OPEN"
        assert encryption_label(3) == "WPA2"
        assert encryption_label(6) == "WPA3"

    def test_encryption_label_unknown_preserves_code(self):
        from wardriving.collector import encryption_label
        label = encryption_label(99)
        assert "99" in label

    def test_round_coord_precision_4(self):
        from wardriving.collector import round_coord
        assert round_coord(50.4512345, 4) == 50.4512
        assert round_coord(-30.5999, 2) == -30.60


# ═══════════════════════════════════════════════════════════════════════════════
# 2. upsert_network — SQLite integration
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
class TestUpsertNetwork:
    async def test_insert_creates_record(self):
        from wardriving.collector import upsert_network
        from db.models import WardrivingRecord
        engine, factory, tmp = await _make_test_db()
        try:
            async with factory() as db:
                status = await upsert_network(
                    db, mac="AA:BB:CC:DD:EE:01", ssid="Lab", rssi=-60,
                    encryption="WPA2", channel=6, lat=50.4512, lon=30.5234,
                )
                await db.commit()
                assert status == "inserted"

                result = await db.execute(select(WardrivingRecord))
                records = result.scalars().all()
                assert len(records) == 1
                assert records[0].seen_count == 1
                assert records[0].rssi == -60
        finally:
            await engine.dispose()
            Path(tmp).unlink(missing_ok=True)

    async def test_upsert_existing_increments_count(self):
        from wardriving.collector import upsert_network
        from db.models import WardrivingRecord
        engine, factory, tmp = await _make_test_db()
        try:
            async with factory() as db:
                await upsert_network(
                    db, mac="AA:BB:CC:DD:EE:01", ssid="Lab", rssi=-70,
                    encryption="WPA2", channel=6, lat=50.4512, lon=30.5234,
                )
                status = await upsert_network(
                    db, mac="AA:BB:CC:DD:EE:01", ssid="Lab", rssi=-50,
                    encryption="WPA2", channel=6, lat=50.4512, lon=30.5234,
                )
                await db.commit()
                assert status == "updated"

                result = await db.execute(select(WardrivingRecord))
                records = result.scalars().all()
                assert len(records) == 1
                # Strongest RSSI is kept
                assert records[0].rssi == -50
                assert records[0].seen_count == 2
        finally:
            await engine.dispose()
            Path(tmp).unlink(missing_ok=True)

    async def test_different_cells_are_separate_records(self):
        from wardriving.collector import upsert_network
        from db.models import WardrivingRecord
        engine, factory, tmp = await _make_test_db()
        try:
            async with factory() as db:
                await upsert_network(
                    db, mac="AA:BB:CC:DD:EE:01", ssid="Lab", rssi=-60,
                    encryption="WPA2", channel=6, lat=50.4500, lon=30.5200,
                )
                await upsert_network(
                    db, mac="AA:BB:CC:DD:EE:01", ssid="Lab", rssi=-65,
                    encryption="WPA2", channel=6, lat=50.4600, lon=30.5300,
                )
                await db.commit()

                result = await db.execute(select(WardrivingRecord))
                records = result.scalars().all()
                assert len(records) == 2
        finally:
            await engine.dispose()
            Path(tmp).unlink(missing_ok=True)


# ═══════════════════════════════════════════════════════════════════════════════
# 3. ingest_wifi_networks — batch
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
class TestIngestBatch:
    async def test_ingest_multiple_networks(self):
        from wardriving.collector import ingest_wifi_networks
        engine, factory, tmp = await _make_test_db()
        try:
            async with factory() as db:
                nets = [
                    _make_wifi_net(mac="AA:BB:CC:DD:EE:01"),
                    _make_wifi_net(mac="AA:BB:CC:DD:EE:02", encryption=0),
                    _make_wifi_net(mac="AA:BB:CC:DD:EE:03", encryption=6),
                ]
                stats = await ingest_wifi_networks(
                    db, networks=nets, lat=50.4512, lon=30.5234,
                )
                await db.commit()
                assert stats.seen == 3
                assert stats.inserted == 3
                assert stats.updated == 0
                assert stats.skipped == 0
        finally:
            await engine.dispose()
            Path(tmp).unlink(missing_ok=True)

    async def test_ingest_skips_invalid_mac(self):
        from wardriving.collector import ingest_wifi_networks
        engine, factory, tmp = await _make_test_db()
        try:
            async with factory() as db:
                nets = [
                    _make_wifi_net(mac=""),
                    _make_wifi_net(mac="AA:BB:CC:DD:EE:01"),
                ]
                stats = await ingest_wifi_networks(
                    db, networks=nets, lat=50.45, lon=30.52,
                )
                await db.commit()
                assert stats.seen == 2
                assert stats.inserted == 1
                assert stats.skipped == 1
        finally:
            await engine.dispose()
            Path(tmp).unlink(missing_ok=True)


# ═══════════════════════════════════════════════════════════════════════════════
# 4. WardrivingCollector.process_batch
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
class TestCollectorProcessBatch:
    async def test_process_batch_ingests_when_gps_fix(self):
        import db.database as _db_mod
        from wardriving.collector import WardrivingCollector
        from db.models import WardrivingRecord
        engine, factory, tmp = await _make_test_db()
        original_engine = _db_mod.engine
        original_session = _db_mod.AsyncSessionLocal
        _db_mod.engine = engine
        _db_mod.AsyncSessionLocal = factory
        try:
            collector = WardrivingCollector()
            batch = _make_batch_with_wifi()
            stats = await collector.process_batch(batch)
            assert stats.seen == 1
            assert stats.inserted == 1

            async with factory() as db:
                result = await db.execute(select(WardrivingRecord))
                records = result.scalars().all()
                assert len(records) == 1
        finally:
            _db_mod.engine = original_engine
            _db_mod.AsyncSessionLocal = original_session
            await engine.dispose()
            Path(tmp).unlink(missing_ok=True)

    async def test_process_batch_skips_without_gps(self):
        from wardriving.collector import WardrivingCollector
        collector = WardrivingCollector()
        batch = _make_batch_with_wifi(has_gps=False)
        stats = await collector.process_batch(batch)
        assert stats.seen == 0

    async def test_process_batch_skips_without_wifi(self):
        from wardriving.collector import WardrivingCollector
        from sensors.sensor_parser import SensorBatch, GPSData
        collector = WardrivingCollector()
        batch = SensorBatch(version=3, timestamp_ms=0, type="sensor_batch")
        batch.gps = GPSData(lat=0, lon=0, fix=True, satellites=5, speed_kmh=0, altitude_m=0, hdop=1)
        stats = await collector.process_batch(batch)
        assert stats.seen == 0

    async def test_process_batch_respects_scan_disabled(self):
        from wardriving.collector import WardrivingCollector
        collector = WardrivingCollector()
        with patch("wardriving.collector.config") as mock_cfg:
            mock_cfg.sensor_wifi_scan_enabled = False
            batch = _make_batch_with_wifi()
            stats = await collector.process_batch(batch)
            assert stats.seen == 0


# ═══════════════════════════════════════════════════════════════════════════════
# 5. Heatmap
# ═══════════════════════════════════════════════════════════════════════════════

class TestRssiToLinear:
    def test_min_rssi_maps_to_zero(self):
        from wardriving.heatmap import rssi_to_linear
        assert rssi_to_linear(-100) == 0.0

    def test_max_rssi_maps_to_one(self):
        from wardriving.heatmap import rssi_to_linear
        assert rssi_to_linear(-30) == 1.0

    def test_clamps_below_min(self):
        from wardriving.heatmap import rssi_to_linear
        assert rssi_to_linear(-150) == 0.0

    def test_clamps_above_max(self):
        from wardriving.heatmap import rssi_to_linear
        assert rssi_to_linear(10) == 1.0

    def test_monotonic(self):
        from wardriving.heatmap import rssi_to_linear
        assert rssi_to_linear(-90) < rssi_to_linear(-60) < rssi_to_linear(-40)


@pytest.mark.asyncio
class TestGenerateHeatmap:
    async def test_empty_returns_empty_list(self):
        from wardriving.heatmap import generate_heatmap
        engine, factory, tmp = await _make_test_db()
        try:
            async with factory() as db:
                points = await generate_heatmap(db)
                assert points == []
        finally:
            await engine.dispose()
            Path(tmp).unlink(missing_ok=True)

    async def test_aggregates_records_by_cell(self):
        from wardriving.collector import upsert_network
        from wardriving.heatmap import generate_heatmap
        engine, factory, tmp = await _make_test_db()
        try:
            async with factory() as db:
                # Two APs in the same heatmap cell (~110 m precision = 3 digits)
                await upsert_network(
                    db, mac="AA:BB:CC:DD:EE:01", ssid="A", rssi=-50,
                    encryption="WPA2", channel=1, lat=50.4501, lon=30.5201,
                    precision=4,
                )
                await upsert_network(
                    db, mac="AA:BB:CC:DD:EE:02", ssid="B", rssi=-70,
                    encryption="WPA2", channel=1, lat=50.4502, lon=30.5203,
                    precision=4,
                )
                await db.commit()

                points = await generate_heatmap(db, precision=3)
                assert len(points) == 1
                p = points[0]
                assert p.network_count == 2
                assert p.strongest_rssi == -50
                assert p.weight == 1.0
        finally:
            await engine.dispose()
            Path(tmp).unlink(missing_ok=True)

    async def test_normalizes_peak_to_one(self):
        from wardriving.collector import upsert_network
        from wardriving.heatmap import generate_heatmap
        engine, factory, tmp = await _make_test_db()
        try:
            async with factory() as db:
                # Two separate cells — strongest gets weight 1.0
                await upsert_network(
                    db, mac="AA:BB:CC:DD:EE:01", ssid="Strong", rssi=-35,
                    encryption="WPA2", channel=1, lat=50.4500, lon=30.5200,
                    precision=4,
                )
                await upsert_network(
                    db, mac="AA:BB:CC:DD:EE:02", ssid="Weak", rssi=-90,
                    encryption="WPA2", channel=1, lat=50.5000, lon=30.6000,
                    precision=4,
                )
                await db.commit()

                points = await generate_heatmap(db, precision=3)
                assert len(points) == 2
                assert points[0].weight == 1.0
                assert points[1].weight < 1.0
                assert points[1].weight >= 0.0
        finally:
            await engine.dispose()
            Path(tmp).unlink(missing_ok=True)

    async def test_bounds_filter(self):
        from wardriving.collector import upsert_network
        from wardriving.heatmap import generate_heatmap
        engine, factory, tmp = await _make_test_db()
        try:
            async with factory() as db:
                await upsert_network(
                    db, mac="AA:BB:CC:DD:EE:01", ssid="InBounds", rssi=-50,
                    encryption="WPA2", channel=1, lat=50.45, lon=30.52, precision=4,
                )
                await upsert_network(
                    db, mac="AA:BB:CC:DD:EE:02", ssid="OutBounds", rssi=-50,
                    encryption="WPA2", channel=1, lat=10.00, lon=20.00, precision=4,
                )
                await db.commit()

                points = await generate_heatmap(
                    db, lat_min=50.0, lon_min=30.0, lat_max=51.0, lon_max=31.0,
                )
                assert len(points) == 1
                assert abs(points[0].lat - 50.45) < 0.01
        finally:
            await engine.dispose()
            Path(tmp).unlink(missing_ok=True)


# ═══════════════════════════════════════════════════════════════════════════════
# 6. routes_map bounds parser
# ═══════════════════════════════════════════════════════════════════════════════

class TestBoundsParser:
    def test_valid_bounds(self):
        from api.routes_map import _parse_bounds
        assert _parse_bounds("50.0,30.0,51.0,31.0") == (50.0, 30.0, 51.0, 31.0)

    def test_reversed_bounds_normalized(self):
        from api.routes_map import _parse_bounds
        assert _parse_bounds("51.0,31.0,50.0,30.0") == (50.0, 30.0, 51.0, 31.0)

    def test_none_returns_none(self):
        from api.routes_map import _parse_bounds
        assert _parse_bounds(None) is None

    def test_malformed_raises(self):
        from api.routes_map import _parse_bounds
        from fastapi import HTTPException
        with pytest.raises(HTTPException):
            _parse_bounds("garbage")

    def test_wrong_count_raises(self):
        from api.routes_map import _parse_bounds
        from fastapi import HTTPException
        with pytest.raises(HTTPException):
            _parse_bounds("1,2,3")

    def test_out_of_range_lat_raises(self):
        from api.routes_map import _parse_bounds
        from fastapi import HTTPException
        with pytest.raises(HTTPException):
            _parse_bounds("100,0,0,0")


class TestSinceParser:
    def test_iso_utc(self):
        from api.routes_map import _parse_since
        dt = _parse_since("2026-04-16T12:00:00Z")
        assert dt is not None
        assert dt.tzinfo is not None

    def test_none(self):
        from api.routes_map import _parse_since
        assert _parse_since(None) is None

    def test_naive_gets_utc_attached(self):
        from api.routes_map import _parse_since
        dt = _parse_since("2026-04-16T12:00:00")
        assert dt is not None
        assert dt.tzinfo is not None

    def test_invalid_raises(self):
        from api.routes_map import _parse_since
        from fastapi import HTTPException
        with pytest.raises(HTTPException):
            _parse_since("not-a-date")


# ═══════════════════════════════════════════════════════════════════════════════
# 7. Route integration (authenticated)
# ═══════════════════════════════════════════════════════════════════════════════

@pytest_asyncio.fixture
async def map_client() -> AsyncGenerator[AsyncClient, None]:
    import db.database as _db_mod
    from main import app
    from db.database import get_db
    from security.auth import ensure_default_user

    engine, factory, tmp = await _make_test_db()
    original_engine = _db_mod.engine
    original_session = _db_mod.AsyncSessionLocal
    _db_mod.engine = engine
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

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client

    app.dependency_overrides.clear()
    _db_mod.engine = original_engine
    _db_mod.AsyncSessionLocal = original_session
    await engine.dispose()
    Path(tmp).unlink(missing_ok=True)


async def _login(client: AsyncClient) -> str:
    resp = await client.post(
        "/api/v1/auth/login/pin",
        json={"username": "phantom", "pin": "000000"},
    )
    assert resp.status_code == 200
    return resp.json()["token"]


@pytest.mark.asyncio
class TestRoutesMap:
    async def test_wardriving_requires_auth(self, map_client):
        resp = await map_client.get("/api/v1/map/wardriving")
        assert resp.status_code == 401

    async def test_wardriving_empty(self, map_client):
        token = await _login(map_client)
        resp = await map_client.get(
            "/api/v1/map/wardriving",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json() == {"records": [], "total": 0}

    async def test_heatmap_empty(self, map_client):
        token = await _login(map_client)
        resp = await map_client.get(
            "/api/v1/map/heatmap",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json() == {"points": []}

    async def test_pois_empty(self, map_client):
        token = await _login(map_client)
        resp = await map_client.get(
            "/api/v1/map/pois",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json() == {"pois": []}

    async def test_create_poi(self, map_client):
        token = await _login(map_client)
        payload = {
            "lat": 50.45, "lon": 30.52,
            "name": "Base", "category": "home",
            "notes": "starting point", "icon": "🏠", "is_secret": False,
        }
        resp = await map_client.post(
            "/api/v1/map/pois",
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Base"
        assert data["category"] == "home"
        assert "id" in data

    async def test_create_poi_invalid_category(self, map_client):
        token = await _login(map_client)
        payload = {
            "lat": 50.45, "lon": 30.52,
            "name": "Base", "category": "not-a-real-category",
        }
        resp = await map_client.post(
            "/api/v1/map/pois",
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 400

    async def test_delete_poi(self, map_client):
        token = await _login(map_client)
        create_resp = await map_client.post(
            "/api/v1/map/pois",
            json={"lat": 50.45, "lon": 30.52, "name": "X"},
            headers={"Authorization": f"Bearer {token}"},
        )
        poi_id = create_resp.json()["id"]
        del_resp = await map_client.delete(
            f"/api/v1/map/pois/{poi_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert del_resp.status_code == 200
        assert del_resp.json()["ok"] is True

    async def test_delete_poi_not_found(self, map_client):
        token = await _login(map_client)
        resp = await map_client.delete(
            "/api/v1/map/pois/nonexistent-id",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 404

    async def test_pois_filter_by_category(self, map_client):
        token = await _login(map_client)
        headers = {"Authorization": f"Bearer {token}"}
        await map_client.post(
            "/api/v1/map/pois",
            json={"lat": 50.45, "lon": 30.52, "name": "H", "category": "home"},
            headers=headers,
        )
        await map_client.post(
            "/api/v1/map/pois",
            json={"lat": 50.46, "lon": 30.53, "name": "T", "category": "threat"},
            headers=headers,
        )
        resp = await map_client.get(
            "/api/v1/map/pois?category=threat",
            headers=headers,
        )
        data = resp.json()
        assert len(data["pois"]) == 1
        assert data["pois"][0]["category"] == "threat"

    async def test_secret_poi_hidden_outside_ghost(self, map_client):
        token = await _login(map_client)
        headers = {"Authorization": f"Bearer {token}"}
        await map_client.post(
            "/api/v1/map/pois",
            json={"lat": 50.45, "lon": 30.52, "name": "SecretX", "is_secret": True},
            headers=headers,
        )
        await map_client.post(
            "/api/v1/map/pois",
            json={"lat": 50.46, "lon": 30.53, "name": "Public", "is_secret": False},
            headers=headers,
        )
        resp = await map_client.get("/api/v1/map/pois", headers=headers)
        names = [p["name"] for p in resp.json()["pois"]]
        assert "SecretX" not in names
        assert "Public" in names

    async def test_bounds_malformed_returns_400(self, map_client):
        token = await _login(map_client)
        resp = await map_client.get(
            "/api/v1/map/wardriving?bounds=not-valid",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 400

    async def test_track_returns_points_from_context_history(self, map_client):
        token = await _login(map_client)
        # Inject a history snapshot with GPS fix into ContextEngine.
        # Clear first — the singleton may carry state from earlier tests.
        from core.context_engine import context_engine
        context_engine._history.clear()

        snap = dict(context_engine.get_snapshot())
        snap["where"] = {**snap["where"], "lat": 50.5, "lon": 30.5, "fix": True, "speed_kmh": 5.0}
        snap["timestamp"] = int(datetime.now(tz=timezone.utc).timestamp() * 1000)
        context_engine._history.append(snap)
        snap2 = dict(snap)
        snap2["where"] = {**snap["where"], "lat": 50.501, "lon": 30.501}
        context_engine._history.append(snap2)

        try:
            resp = await map_client.get(
                "/api/v1/map/track?hours=1",
                headers={"Authorization": f"Bearer {token}"},
            )
            assert resp.status_code == 200
            points = resp.json()["points"]
            assert len(points) == 2
            assert points[0]["lat"] == 50.5
            assert points[1]["lat"] == 50.501
        finally:
            context_engine._history.clear()
