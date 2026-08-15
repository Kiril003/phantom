"""Culvert layer — store, bake parsing, and the route.

Mirrors `test_geo_cliff_scree.py`'s shape for the sibling `culverts` layer.
Covers the pieces this layer actually depends on being right:
- `reg`/`fresh` are on every served feature, never omitted (map-register-schema.md §1).
- bbox filtering is intersection, not centroid containment, so a way
  straddling the query bbox edge still returns.
- `/map/hazards/culverts` requires bounds (matches the manifest's
  `bbox_required`).
- the manifest itself loads and is shaped as a static, non-polling layer.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

from geo.layer_manifest import LayerSourceType
from geo.layer_registry import reload_layer_registry
from geo.sources.culverts import (
    REGISTER,
    CulvertFeature,
    CulvertStore,
    freshness_bucket,
    reset_culvert_store_for_tests,
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


# ── CulvertFeature ─────────────────────────────────────────────────────


def _culvert_way(osm_id: int = 1, *, timestamp: str | None = "2021-05-01T00:00:00Z", **kw) -> CulvertFeature:
    # Defaults live in a dict so a caller can override any of them; passing
    # them as literals alongside **kw made `_culvert_way(waterway="river")`
    # a duplicate-keyword TypeError instead of the override it reads as.
    fields = dict(
        waterway="stream",
        name="Тестовий струмок",
        layer="-1",
    )
    fields.update(kw)
    return CulvertFeature(
        osm_id=osm_id,
        coordinates=[[24.6, 48.0], [24.61, 48.01]],
        lat_min=48.0, lat_max=48.01, lon_min=24.6, lon_max=24.61,
        osm_timestamp=timestamp,
        **fields,
    )


def test_feature_always_carries_register_and_freshness():
    f = _culvert_way()
    props = f.to_geojson_feature()["properties"]
    assert props["reg"] == REGISTER == "measured"
    assert props["fresh"] == "2021H1"


def test_feature_missing_timestamp_still_carries_fresh():
    f = _culvert_way(timestamp=None)
    props = f.to_geojson_feature()["properties"]
    assert props["fresh"] == "pre2015"
    assert "reg" in props and props["reg"] == "measured"


def test_feature_geometry_is_linestring():
    f = _culvert_way()
    geom = f.to_geojson_feature()["geometry"]
    assert geom["type"] == "LineString"
    assert geom["coordinates"] == [[24.6, 48.0], [24.61, 48.01]]


def test_feature_kind_is_always_culvert():
    f = _culvert_way()
    assert f.to_geojson_feature()["properties"]["kind"] == "culvert"


def test_feature_carries_waterway_and_layer_when_tagged():
    f = _culvert_way(waterway="river", layer="-2")
    props = f.to_geojson_feature()["properties"]
    assert props["waterway"] == "river"
    assert props["layer"] == "-2"


# ── CulvertStore ───────────────────────────────────────────────────────


@pytest.fixture()
def store(tmp_path: Path) -> CulvertStore:
    return reset_culvert_store_for_tests(tmp_path / "culverts_test.sqlite")


def test_upsert_and_count(store: CulvertStore):
    written = store.upsert_features([_culvert_way(1), _culvert_way(2)])
    assert written == 2
    assert store.count() == 2


def test_upsert_is_idempotent_on_id(store: CulvertStore):
    store.upsert_features([_culvert_way(1, timestamp="2018-01-01T00:00:00Z")])
    store.upsert_features([_culvert_way(1, timestamp="2024-01-01T00:00:00Z")])
    assert store.count() == 1
    feats = store.query_bbox(47.9, 24.5, 48.2, 24.8)
    assert feats[0]["properties"]["fresh"] == "2024H1"


def test_query_bbox_intersection_not_centroid(store: CulvertStore):
    # Way spans lat 48.0-48.01 — a query bbox that only overlaps its edge
    # must still return it (intersection semantics, not "inside").
    store.upsert_features([_culvert_way(1)])
    feats = store.query_bbox(48.005, 24.55, 48.5, 25.0)
    assert len(feats) == 1
    assert feats[0]["id"] == "way/1"


def test_query_bbox_excludes_disjoint_feature(store: CulvertStore):
    store.upsert_features([_culvert_way(1)])
    feats = store.query_bbox(50.0, 30.0, 50.1, 30.1)
    assert feats == []


def test_clear_removes_everything(store: CulvertStore):
    store.upsert_features([_culvert_way(1)])
    store.clear()
    assert store.count() == 0


def test_meta_roundtrip(store: CulvertStore):
    assert store.get_meta("baked_at") is None
    store.set_meta("baked_at", "12345")
    assert store.get_meta("baked_at") == "12345"


# ── Manifest ──────────────────────────────────────────────────────────────


def test_manifest_is_static_not_live_polling():
    registry = reload_layer_registry()
    manifest = registry.get("culverts")
    assert manifest.source.type == LayerSourceType.local_db
    assert manifest.source.poll_interval_s is None
    assert manifest.available_offline is True
    assert manifest.license.startswith("ODbL")


# ── Route ────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _isolated_store(tmp_path: Path):
    reset_culvert_store_for_tests(tmp_path / "culverts_route_test.sqlite")
    yield
    reset_culvert_store_for_tests(tmp_path / "culverts_route_test.sqlite")


def test_route_requires_bounds(auth_root_client):
    resp = auth_root_client.get("/api/v1/map/hazards/culverts")
    assert resp.status_code == 422  # FastAPI required-query-param rejection


def test_route_rejects_malformed_bounds(auth_root_client):
    resp = auth_root_client.get(
        "/api/v1/map/hazards/culverts",
        params={"bounds": "not,a,valid,bbox"},
    )
    assert resp.status_code == 400


def test_route_returns_seeded_feature_with_register(auth_root_client):
    from geo.sources.culverts import get_culvert_store

    get_culvert_store().upsert_features([_culvert_way(1)])
    resp = auth_root_client.get(
        "/api/v1/map/hazards/culverts",
        params={"bounds": "47.9,24.5,48.2,24.8"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    feature = body["features"][0]
    assert feature["properties"]["kind"] == "culvert"
    assert feature["properties"]["waterway"] == "stream"
    assert feature["properties"]["reg"] == "measured"
    assert feature["properties"]["fresh"] == "2021H1"
