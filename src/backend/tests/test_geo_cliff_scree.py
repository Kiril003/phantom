"""Cliff/scree/bare_rock hazard layer — store, bake parsing, and the route.

Covers the pieces this layer actually depends on being right:
- `reg`/`fresh` are on every served feature, never omitted (map-register-schema.md §1).
- bbox filtering is intersection, not centroid containment, so a feature straddling
  the query bbox edge still returns.
- `/map/hazards/cliff_scree` requires bounds (matches the manifest's `bbox_required`)
  and rejects an unknown `kinds` value instead of silently ignoring it.
- the manifest itself loads and is shaped as a static, non-polling layer.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

from geo.layer_manifest import LayerSourceType
from geo.layer_registry import reload_layer_registry
from geo.sources.terrain_hazards import (
    REGISTER,
    TerrainHazardFeature,
    TerrainHazardStore,
    freshness_bucket,
    reset_terrain_hazard_store_for_tests,
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


# ── TerrainHazardFeature ─────────────────────────────────────────────────────


def _cliff_way(osm_id: int = 1, *, timestamp: str | None = "2021-05-01T00:00:00Z") -> TerrainHazardFeature:
    return TerrainHazardFeature(
        osm_type="way",
        osm_id=osm_id,
        kind="cliff",
        geometry_type="LineString",
        coordinates=[[24.6, 48.0], [24.61, 48.01]],
        lat_min=48.0, lat_max=48.01, lon_min=24.6, lon_max=24.61,
        name="Тестова скеля",
        osm_timestamp=timestamp,
    )


def test_feature_always_carries_register_and_freshness():
    f = _cliff_way()
    props = f.to_geojson_feature()["properties"]
    assert props["reg"] == REGISTER == "measured"
    assert props["fresh"] == "2021H1"


def test_feature_missing_timestamp_still_carries_fresh():
    f = _cliff_way(timestamp=None)
    props = f.to_geojson_feature()["properties"]
    assert props["fresh"] == "pre2015"
    assert "reg" in props and props["reg"] == "measured"


# ── TerrainHazardStore ───────────────────────────────────────────────────────


@pytest.fixture()
def store(tmp_path: Path) -> TerrainHazardStore:
    return reset_terrain_hazard_store_for_tests(tmp_path / "terrain_hazards_test.sqlite")


def test_upsert_and_count(store: TerrainHazardStore):
    written = store.upsert_features([_cliff_way(1), _cliff_way(2)])
    assert written == 2
    assert store.count() == 2
    assert store.count_by_kind() == {"cliff": 2}


def test_upsert_is_idempotent_on_id(store: TerrainHazardStore):
    store.upsert_features([_cliff_way(1, timestamp="2018-01-01T00:00:00Z")])
    store.upsert_features([_cliff_way(1, timestamp="2024-01-01T00:00:00Z")])
    assert store.count() == 1
    feats = store.query_bbox(47.9, 24.5, 48.2, 24.8)
    assert feats[0]["properties"]["fresh"] == "2024H1"


def test_query_bbox_intersection_not_centroid(store: TerrainHazardStore):
    # Way spans lat 48.0-48.01 — a query bbox that only overlaps its edge
    # must still return it (intersection semantics, not "inside").
    store.upsert_features([_cliff_way(1)])
    feats = store.query_bbox(48.005, 24.55, 48.5, 25.0)
    assert len(feats) == 1
    assert feats[0]["id"] == "way/1"


def test_query_bbox_excludes_disjoint_feature(store: TerrainHazardStore):
    store.upsert_features([_cliff_way(1)])
    feats = store.query_bbox(50.0, 30.0, 50.1, 30.1)
    assert feats == []


def test_query_bbox_filters_by_kind(store: TerrainHazardStore):
    scree = TerrainHazardFeature(
        osm_type="way", osm_id=99, kind="scree", geometry_type="Polygon",
        coordinates=[[[24.6, 48.0], [24.61, 48.0], [24.61, 48.01], [24.6, 48.0]]],
        lat_min=48.0, lat_max=48.01, lon_min=24.6, lon_max=24.61,
    )
    store.upsert_features([_cliff_way(1), scree])
    only_scree = store.query_bbox(47.9, 24.5, 48.2, 24.8, kinds=["scree"])
    assert {f["properties"]["kind"] for f in only_scree} == {"scree"}


def test_clear_removes_everything(store: TerrainHazardStore):
    store.upsert_features([_cliff_way(1)])
    store.clear()
    assert store.count() == 0


def test_meta_roundtrip(store: TerrainHazardStore):
    assert store.get_meta("baked_at") is None
    store.set_meta("baked_at", "12345")
    assert store.get_meta("baked_at") == "12345"


# ── Manifest ──────────────────────────────────────────────────────────────


def test_manifest_is_static_not_live_polling():
    registry = reload_layer_registry()
    manifest = registry.get("cliff_scree")
    assert manifest.source.type == LayerSourceType.local_db
    assert manifest.source.poll_interval_s is None
    assert manifest.available_offline is True
    assert manifest.license.startswith("ODbL")


# ── Route ────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _isolated_store(tmp_path: Path):
    reset_terrain_hazard_store_for_tests(tmp_path / "terrain_hazards_route_test.sqlite")
    yield
    reset_terrain_hazard_store_for_tests(tmp_path / "terrain_hazards_route_test.sqlite")


def test_route_requires_bounds(auth_root_client):
    resp = auth_root_client.get("/api/v1/map/hazards/cliff_scree")
    assert resp.status_code == 422  # FastAPI required-query-param rejection


def test_route_rejects_unknown_kind(auth_root_client):
    resp = auth_root_client.get(
        "/api/v1/map/hazards/cliff_scree",
        params={"bounds": "47.9,24.5,48.2,24.8", "kinds": "lava"},
    )
    assert resp.status_code == 400


def test_route_returns_seeded_feature_with_register(auth_root_client):
    from geo.sources.terrain_hazards import get_terrain_hazard_store

    get_terrain_hazard_store().upsert_features([_cliff_way(1)])
    resp = auth_root_client.get(
        "/api/v1/map/hazards/cliff_scree",
        params={"bounds": "47.9,24.5,48.2,24.8"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    feature = body["features"][0]
    assert feature["properties"]["kind"] == "cliff"
    assert feature["properties"]["reg"] == "measured"
    assert feature["properties"]["fresh"] == "2021H1"
