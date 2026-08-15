"""Drain/ditch vehicle-obstacle layer — store, bake parsing, and the route.

Mirrors `test_geo_cliff_scree.py`'s shape for the sibling `drain_ditch`
layer. Covers the pieces this layer actually depends on being right:
- `reg`/`fresh` are on every served feature, never omitted (map-register-schema.md §1).
- bbox filtering is intersection, not centroid containment, so a way
  straddling the query bbox edge still returns.
- `/map/hazards/drain_ditch` requires bounds (matches the manifest's
  `bbox_required`) and rejects an unknown `kinds` value instead of
  silently ignoring it.
- the manifest itself loads and is shaped as a static, non-polling layer.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

from geo.layer_manifest import LayerSourceType
from geo.layer_registry import reload_layer_registry
from geo.sources.drain_ditch import (
    REGISTER,
    DrainDitchFeature,
    DrainDitchStore,
    freshness_bucket,
    reset_drain_ditch_store_for_tests,
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


# ── DrainDitchFeature ─────────────────────────────────────────────────────


def _drain_way(osm_id: int = 1, *, timestamp: str | None = "2021-05-01T00:00:00Z", **kw) -> DrainDitchFeature:
    return DrainDitchFeature(
        osm_id=osm_id,
        kind="drain",
        coordinates=[[24.6, 48.0], [24.61, 48.01]],
        lat_min=48.0, lat_max=48.01, lon_min=24.6, lon_max=24.61,
        name="Тестовий дренаж",
        osm_timestamp=timestamp,
        **kw,
    )


def test_feature_always_carries_register_and_freshness():
    f = _drain_way()
    props = f.to_geojson_feature()["properties"]
    assert props["reg"] == REGISTER == "measured"
    assert props["fresh"] == "2021H1"


def test_feature_missing_timestamp_still_carries_fresh():
    f = _drain_way(timestamp=None)
    props = f.to_geojson_feature()["properties"]
    assert props["fresh"] == "pre2015"
    assert "reg" in props and props["reg"] == "measured"


def test_feature_geometry_is_linestring():
    f = _drain_way()
    geom = f.to_geojson_feature()["geometry"]
    assert geom["type"] == "LineString"
    assert geom["coordinates"] == [[24.6, 48.0], [24.61, 48.01]]


def test_feature_carries_width_when_tagged():
    f = _drain_way(width_m="35")
    props = f.to_geojson_feature()["properties"]
    assert props["width_m"] == "35"


# ── DrainDitchStore ───────────────────────────────────────────────────────


@pytest.fixture()
def store(tmp_path: Path) -> DrainDitchStore:
    return reset_drain_ditch_store_for_tests(tmp_path / "drain_ditch_test.sqlite")


def test_upsert_and_count(store: DrainDitchStore):
    written = store.upsert_features([_drain_way(1), _drain_way(2)])
    assert written == 2
    assert store.count() == 2
    assert store.count_by_kind() == {"drain": 2}


def test_upsert_is_idempotent_on_id(store: DrainDitchStore):
    store.upsert_features([_drain_way(1, timestamp="2018-01-01T00:00:00Z")])
    store.upsert_features([_drain_way(1, timestamp="2024-01-01T00:00:00Z")])
    assert store.count() == 1
    feats = store.query_bbox(47.9, 24.5, 48.2, 24.8)
    assert feats[0]["properties"]["fresh"] == "2024H1"


def test_query_bbox_intersection_not_centroid(store: DrainDitchStore):
    # Way spans lat 48.0-48.01 — a query bbox that only overlaps its edge
    # must still return it (intersection semantics, not "inside").
    store.upsert_features([_drain_way(1)])
    feats = store.query_bbox(48.005, 24.55, 48.5, 25.0)
    assert len(feats) == 1
    assert feats[0]["id"] == "way/1"


def test_query_bbox_excludes_disjoint_feature(store: DrainDitchStore):
    store.upsert_features([_drain_way(1)])
    feats = store.query_bbox(50.0, 30.0, 50.1, 30.1)
    assert feats == []


def test_query_bbox_filters_by_kind(store: DrainDitchStore):
    ditch = DrainDitchFeature(
        osm_id=99, kind="ditch",
        coordinates=[[24.6, 48.0], [24.61, 48.0]],
        lat_min=48.0, lat_max=48.0, lon_min=24.6, lon_max=24.61,
    )
    store.upsert_features([_drain_way(1), ditch])
    only_ditch = store.query_bbox(47.9, 24.5, 48.2, 24.8, kinds=["ditch"])
    assert {f["properties"]["kind"] for f in only_ditch} == {"ditch"}


def test_clear_removes_everything(store: DrainDitchStore):
    store.upsert_features([_drain_way(1)])
    store.clear()
    assert store.count() == 0


def test_meta_roundtrip(store: DrainDitchStore):
    assert store.get_meta("baked_at") is None
    store.set_meta("baked_at", "12345")
    assert store.get_meta("baked_at") == "12345"


# ── Manifest ──────────────────────────────────────────────────────────────


def test_manifest_is_static_not_live_polling():
    registry = reload_layer_registry()
    manifest = registry.get("drain_ditch")
    assert manifest.source.type == LayerSourceType.local_db
    assert manifest.source.poll_interval_s is None
    assert manifest.available_offline is True
    assert manifest.license.startswith("ODbL")


# ── Route ────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _isolated_store(tmp_path: Path):
    reset_drain_ditch_store_for_tests(tmp_path / "drain_ditch_route_test.sqlite")
    yield
    reset_drain_ditch_store_for_tests(tmp_path / "drain_ditch_route_test.sqlite")


def test_route_requires_bounds(auth_root_client):
    resp = auth_root_client.get("/api/v1/map/hazards/drain_ditch")
    assert resp.status_code == 422  # FastAPI required-query-param rejection


def test_route_rejects_unknown_kind(auth_root_client):
    resp = auth_root_client.get(
        "/api/v1/map/hazards/drain_ditch",
        params={"bounds": "47.9,24.5,48.2,24.8", "kinds": "river"},
    )
    assert resp.status_code == 400


def test_route_returns_seeded_feature_with_register(auth_root_client):
    from geo.sources.drain_ditch import get_drain_ditch_store

    get_drain_ditch_store().upsert_features([_drain_way(1)])
    resp = auth_root_client.get(
        "/api/v1/map/hazards/drain_ditch",
        params={"bounds": "47.9,24.5,48.2,24.8"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    feature = body["features"][0]
    assert feature["properties"]["kind"] == "drain"
    assert feature["properties"]["reg"] == "measured"
    assert feature["properties"]["fresh"] == "2021H1"
