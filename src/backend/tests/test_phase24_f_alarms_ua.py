"""Phase 24-F — alarms.in.ua adapter + LiveTasker tests."""
from __future__ import annotations

import asyncio

import httpx
import pytest

from geo.oblast_centroids import all_oblasts, lookup
from geo.live_tasker import LiveTasker, default_on_diff
from geo.sources.alarms_ua import (
    AlarmsUAAdapter,
    AlarmsUAAlert,
    _normalize_oblast_id,
)


# ── Centroid lookups ──────────────────────────────────────────────────────


def test_centroid_table_covers_all_oblasts():
    ids = {c.id for c in all_oblasts()}
    # 24 oblasts + 2 special territories (crimea, sevastopol) + kyiv-city
    assert "kyiv" in ids
    assert "kyiv-city" in ids
    assert "crimea" in ids
    assert len(ids) >= 26


def test_normalize_oblast_aliases():
    assert _normalize_oblast_id("kyiv_city") == "kyiv-city"
    assert _normalize_oblast_id("ar_crimea") == "crimea"
    assert _normalize_oblast_id("LVIV-OBLAST") == "lviv"
    assert _normalize_oblast_id("dnipropetrovsk") == "dnipro"


# ── Adapter parsing ──────────────────────────────────────────────────────


def test_alert_to_geojson_feature_shape():
    centroid = lookup("kyiv-city")
    assert centroid is not None
    alert = AlarmsUAAlert(
        oblast_id=centroid.id,
        oblast_name_ua=centroid.name_ua,
        oblast_name_en=centroid.name_en,
        iso=centroid.iso,
        lat=centroid.lat,
        lon=centroid.lon,
        started_at="2026-05-04T12:00:00Z",
        alert_type="air_raid",
    )
    feature = alert.to_geojson_feature()
    assert feature["type"] == "Feature"
    assert feature["geometry"] == {"type": "Point", "coordinates": [centroid.lon, centroid.lat]}
    assert feature["properties"]["oblast_id"] == "kyiv-city"


def test_adapter_unconfigured_returns_empty(monkeypatch):
    adapter = AlarmsUAAdapter("")
    assert adapter.configured() is False

    async def run() -> list[AlarmsUAAlert]:
        return await adapter.fetch()

    out = asyncio.run(run())
    assert out == []


def test_adapter_parses_known_oblasts(monkeypatch):
    adapter = AlarmsUAAdapter("test-key")
    sample = {
        "alerts": [
            {"location_oblast_uid": "kyiv_city", "started_at": "2026-05-04T12:00Z", "alert_type": "air_raid"},
            {"location_oblast_uid": "lviv", "started_at": "2026-05-04T12:01Z", "alert_type": "air_raid"},
            {"location_oblast_uid": "kyiv_city", "started_at": "2026-05-04T12:00Z", "alert_type": "air_raid"},
            {"location_oblast_uid": "atlantis", "started_at": "x", "alert_type": "air_raid"},
        ]
    }
    parsed = adapter._parse(sample)
    ids = [a.oblast_id for a in parsed]
    assert ids == ["kyiv-city", "lviv"]


def test_adapter_handles_malformed_payload():
    adapter = AlarmsUAAdapter("k")
    assert adapter._parse(None) == []
    assert adapter._parse([]) == []
    assert adapter._parse({"alerts": "not-a-list"}) == []
    assert adapter._parse({"alerts": [42, "hi", {"oblast": "lviv"}]}) != []


def test_adapter_http_error_returns_empty(monkeypatch):
    adapter = AlarmsUAAdapter("k")

    class _BoomClient:
        def __init__(self, *a, **kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, *a, **kw):
            raise httpx.ConnectError("dns down")

    monkeypatch.setattr("geo.sources.alarms_ua.httpx.AsyncClient", _BoomClient)

    async def run(): return await adapter.fetch()

    assert asyncio.run(run()) == []


def test_adapter_http_non_200_returns_empty(monkeypatch):
    adapter = AlarmsUAAdapter("k")

    class _Resp:
        status_code = 503
        text = "service unavailable"
        def json(self): return {}

    class _Client:
        def __init__(self, *a, **kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, *a, **kw): return _Resp()

    monkeypatch.setattr("geo.sources.alarms_ua.httpx.AsyncClient", _Client)

    async def run(): return await adapter.fetch()

    assert asyncio.run(run()) == []


# ── LiveTasker ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_tasker_diff_signature_avoids_duplicate_broadcasts():
    tk = LiveTasker()
    payload_state = [{"x": 1}]
    diffs: list[int] = []

    async def fetch(): return list(payload_state)
    async def on_diff(name, payload):
        diffs.append(len(payload))

    tk.register("t", interval_s=10.0, fetch=fetch, on_diff=on_diff)
    assert await tk.tick_once("t") is True
    assert await tk.tick_once("t") is False
    payload_state.append({"x": 2})
    assert await tk.tick_once("t") is True
    assert diffs == [1, 2]


@pytest.mark.asyncio
async def test_tasker_backoff_grows_on_failure():
    tk = LiveTasker()

    async def fetch_boom(): raise RuntimeError("upstream")
    async def on_diff(name, payload): pass

    tk.register("flaky", interval_s=2.0, fetch=fetch_boom, on_diff=on_diff)
    task = tk._tasks["flaky"]
    await tk.tick_once("flaky")
    await tk.tick_once("flaky")
    assert task.error_count >= 2
    assert tk._backoff(task) > task.interval_s


@pytest.mark.asyncio
async def test_default_on_diff_broadcasts_to_map_channel(monkeypatch):
    sent: list[tuple[str, str, dict]] = []

    class _RecHub:
        async def broadcast(self, channel, type_, data, user_id=None):
            sent.append((channel, type_, data))

    import api.websocket_hub as wh
    monkeypatch.setattr(wh, "hub", _RecHub())

    centroid = lookup("kyiv-city")
    assert centroid is not None
    alert = AlarmsUAAlert(
        oblast_id=centroid.id,
        oblast_name_ua=centroid.name_ua,
        oblast_name_en=centroid.name_en,
        iso=centroid.iso,
        lat=centroid.lat,
        lon=centroid.lon,
        started_at=None,
        alert_type="air_raid",
    )
    await default_on_diff("air_raid_ua", [alert])
    assert sent, "no broadcast happened"
    channel, type_, data = sent[0]
    assert channel == "map"
    assert type_ == "alert"
    assert data["target"] == "air_raid_ua"
    fc = data["payload"]["feature_collection"]
    assert fc["type"] == "FeatureCollection"
    assert fc["features"][0]["properties"]["oblast_id"] == "kyiv-city"


@pytest.mark.asyncio
async def test_tasker_register_rejects_zero_interval():
    tk = LiveTasker()

    async def fetch(): return []
    async def on_diff(name, payload): pass

    with pytest.raises(ValueError):
        tk.register("z", interval_s=0.0, fetch=fetch, on_diff=on_diff)


@pytest.mark.asyncio
async def test_tasker_stats_reports_counts_and_errors():
    tk = LiveTasker()
    counter = {"runs": 0}

    async def fetch():
        counter["runs"] += 1
        return [{"x": counter["runs"]}]

    async def on_diff(name, payload): pass

    tk.register("a", interval_s=5.0, fetch=fetch, on_diff=on_diff)
    await tk.tick_once("a")
    stats = tk.stats()
    assert stats[0]["name"] == "a"
    assert stats[0]["last_count"] == 1
    assert stats[0]["error_count"] == 0


@pytest.mark.asyncio
async def test_tasker_start_stop_smoke():
    tk = LiveTasker()
    counter = {"runs": 0}

    async def fetch():
        counter["runs"] += 1
        return [counter["runs"]]

    async def on_diff(name, payload): pass

    tk.register("loop", interval_s=0.05, fetch=fetch, on_diff=on_diff)
    await tk.start()
    await asyncio.sleep(0.25)
    await tk.stop()
    assert counter["runs"] >= 2
