"""Power-transmission-tower landmark layer — store, bake parsing, and the route.

Mirrors `test_geo_cliff_scree.py`'s shape for the sibling `power_towers`
layer. Covers the pieces this layer actually depends on being right:
- `reg`/`fresh` are on every served feature, never omitted (map-register-schema.md §1).
- bbox filtering is intersection over lat/lon range, so a point exactly on
  the query bbox edge still returns (inclusive bounds, not strict interior).
- `/map/hazards/power_towers` requires bounds (matches the manifest's
  `bbox_required`) and behaves like `/map/hazards/cliff_scree` on a
  malformed value.
- the manifest itself loads and is shaped as a static, non-polling layer.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

from geo.layer_manifest import LayerSourceType
from geo.layer_registry import reload_layer_registry
from geo.sources.power_towers import (
    REGISTER,
    PowerTowerFeature,
    PowerTowerStore,
    freshness_bucket,
    reset_power_tower_store_for_tests,
)


# ── freshness_bucket ────────────────────────────────────────────────────────


def test_freshness_bucket_none_is_pre2015():
    assert freshness_bucket(None) == "pre2015"


def test_freshness_bucket_before_threshold_collapses_to_pre2015():
    assert freshness_bucket(datetime(2011, 3, 1, tzinfo=timezone.utc)) == "pre2015"


def test_freshness_bucket_first_half():
    assert freshness_bucket(datetime(2020, 4, 12, tzinfo=timezone.utc)) == "2020H1"


def test_freshness_bucket_second_half():
    assert freshness_bucket(datetime(2020, 9, 1, tzinfo=timezone.utc)) == "2020H2"


def test_freshness_bucket_boundary_month_is_h1():
    assert freshness_bucket(datetime(2022, 6, 30, tzinfo=timezone.utc)) == "2022H1"


# ── PowerTowerFeature ─────────────────────────────────────────────────────


def _tower(osm_id: int = 1, *, timestamp: str | None = "2021-05-01T00:00:00Z", **kw) -> PowerTowerFeature:
    return PowerTowerFeature(
        osm_id=osm_id,
        lat=48.0,
        lon=24.6,
        osm_timestamp=timestamp,
        **kw,
    )


def test_feature_always_carries_register_and_freshness():
    f = _tower()
    props = f.to_geojson_feature()["properties"]
    assert props["reg"] == REGISTER == "measured"
    assert props["fresh"] == "2021H1"


def test_feature_missing_timestamp_still_carries_fresh():
    f = _tower(timestamp=None)
    props = f.to_geojson_feature()["properties"]
    assert props["fresh"] == "pre2015"
    assert "reg" in props and props["reg"] == "measured"


def test_feature_geometry_is_point():
    f = _tower()
    geom = f.to_geojson_feature()["geometry"]
    assert geom == {"type": "Point", "coordinates": [24.6, 48.0]}


def test_feature_carries_ref_design_disused_when_tagged():
    f = _tower(ref="22", design="monopolar", disused=True)
    props = f.to_geojson_feature()["properties"]
    assert props["ref"] == "22"
    assert props["design"] == "monopolar"
    assert props["disused"] is True


def test_feature_defaults_disused_false_and_optional_fields_none():
    f = _tower()
    props = f.to_geojson_feature()["properties"]
    assert props["disused"] is False
    assert props["ref"] is None
    assert props["design"] is None


# ── PowerTowerStore ───────────────────────────────────────────────────────


@pytest.fixture()
def store(tmp_path: Path) -> PowerTowerStore:
    return reset_power_tower_store_for_tests(tmp_path / "power_towers_test.sqlite")


def test_upsert_and_count(store: PowerTowerStore):
    written = store.upsert_features([_tower(1), _tower(2)])
    assert written == 2
    assert store.count() == 2


def test_upsert_is_idempotent_on_id(store: PowerTowerStore):
    store.upsert_features([_tower(1, timestamp="2018-01-01T00:00:00Z")])
    store.upsert_features([_tower(1, timestamp="2024-01-01T00:00:00Z")])
    assert store.count() == 1
    feats = store.query_bbox(47.9, 24.5, 48.2, 24.8)
    assert feats[0]["properties"]["fresh"] == "2024H1"


def test_query_bbox_includes_point_on_edge(store: PowerTowerStore):
    # A point exactly on the query bbox's boundary must still return —
    # inclusive bounds, the point analogue of terrain_hazards' intersection
    # (not strict-interior) rule.
    store.upsert_features([_tower(1)])  # lat=48.0, lon=24.6
    feats = store.query_bbox(48.0, 24.6, 48.5, 25.0)
    assert len(feats) == 1
    assert feats[0]["id"] == "node/1"


def test_query_bbox_excludes_disjoint_feature(store: PowerTowerStore):
    store.upsert_features([_tower(1)])
    feats = store.query_bbox(50.0, 30.0, 50.1, 30.1)
    assert feats == []


def test_clear_removes_everything(store: PowerTowerStore):
    store.upsert_features([_tower(1)])
    store.clear()
    assert store.count() == 0


def test_meta_roundtrip(store: PowerTowerStore):
    assert store.get_meta("baked_at") is None
    store.set_meta("baked_at", "12345")
    assert store.get_meta("baked_at") == "12345"


# ── Manifest ──────────────────────────────────────────────────────────────


def test_manifest_is_static_not_live_polling():
    registry = reload_layer_registry()
    manifest = registry.get("power_towers")
    assert manifest.source.type == LayerSourceType.local_db
    assert manifest.source.poll_interval_s is None
    assert manifest.available_offline is True
    assert manifest.license.startswith("ODbL")


# ── Route ────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _isolated_store(tmp_path: Path):
    reset_power_tower_store_for_tests(tmp_path / "power_towers_route_test.sqlite")
    yield
    reset_power_tower_store_for_tests(tmp_path / "power_towers_route_test.sqlite")


def test_route_requires_bounds(auth_root_client):
    resp = auth_root_client.get("/api/v1/map/hazards/power_towers")
    assert resp.status_code == 422  # FastAPI required-query-param rejection


def test_route_rejects_malformed_bounds(auth_root_client):
    resp = auth_root_client.get(
        "/api/v1/map/hazards/power_towers",
        params={"bounds": "not,a,valid,bbox"},
    )
    assert resp.status_code == 400


def test_route_returns_seeded_feature_with_register(auth_root_client):
    from geo.sources.power_towers import get_power_tower_store

    get_power_tower_store().upsert_features([_tower(1)])
    resp = auth_root_client.get(
        "/api/v1/map/hazards/power_towers",
        params={"bounds": "47.9,24.5,48.2,24.8"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    feature = body["features"][0]
    assert feature["properties"]["kind"] == "tower"
    assert feature["properties"]["reg"] == "measured"
    assert feature["properties"]["fresh"] == "2021H1"
