"""Phase 24-B — `map.*` agent action surface contract tests."""
from __future__ import annotations

import pytest

from agent.actions.base import ActionContext
from agent.actions.map import (
    MAP_ACTIONS,
    MapAddMarker,
    MapDisableLayer,
    MapEnableLayer,
    MapExplainView,
    MapFlyTo,
    MapGeocode,
    MapListLayers,
    MapOpenMap,
    MapQueryNearby,
    MapReverseGeocode,
    MapSetView,
    MapSnapshot,
)
from agent.actions.map._common import (
    AGENT_SESSION,
    MapMutation,
    build_map_output,
)
from agent.actions.registry import registry
from geo.attribution import reset_attribution_store_for_tests
from geo.layer_registry import reload_layer_registry


@pytest.fixture(autouse=True)
def _isolated_registry_and_store():
    reload_layer_registry()
    reset_attribution_store_for_tests()
    yield
    reset_attribution_store_for_tests()


def _ctx() -> ActionContext:
    return ActionContext(task_id="t1", step_idx=0, workspace_dir="/tmp")


# ── Registry wiring ────────────────────────────────────────────────────────


def test_all_12_map_verbs_resolve_through_registry():
    expected = {
        "map.open_map",
        "map.set_view",
        "map.flyto",
        "map.add_marker",
        "map.query_nearby",
        "map.geocode",
        "map.reverse_geocode",
        "map.list_layers",
        "map.enable_layer",
        "map.disable_layer",
        "map.snapshot",
        "map.explain_view",
    }
    actual = {n for n in registry.names() if n.startswith("map.")}
    assert expected == actual
    for verb in expected:
        assert registry.get(verb) is not None
    assert {cls.name for cls in MAP_ACTIONS} == expected


def test_catalog_exposes_map_verbs_with_signatures():
    catalog = registry.catalog()
    map_entries = [e for e in catalog if e["name"].startswith("map.")]
    assert len(map_entries) == 12
    for entry in map_entries:
        assert "args" in entry
        assert "risk_level" in entry


# ── Output shape ───────────────────────────────────────────────────────────


def test_build_map_output_carries_narrative_and_mutation():
    out = build_map_output(
        narrative="hello",
        mutation=MapMutation(op="set_view", payload={"x": 1}),
    )
    assert out["narrative"] == "hello"
    assert out["map_mutation"]["op"] == "set_view"
    assert out["map_mutation"]["payload"] == {"x": 1}
    assert out["artifacts"] == []
    assert out["follow_ups"] == []


# ── Per-action smoke ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_open_map_returns_open_map_mutation():
    res = await MapOpenMap(reason="show frontline").execute(_ctx())
    assert res.ok is True
    assert res.output["map_mutation"]["op"] == "open_map"
    assert "Відкриваю мапу" in res.output["narrative"]


@pytest.mark.asyncio
async def test_set_view_includes_optional_bearing_pitch():
    res = await MapSetView(lat=50.45, lon=30.52, zoom=15, bearing=90, pitch=30).execute(_ctx())
    assert res.ok is True
    payload = res.output["map_mutation"]["payload"]
    assert payload["center"] == [30.52, 50.45]
    assert payload["zoom"] == 15
    assert payload["bearing"] == 90
    assert payload["pitch"] == 30


@pytest.mark.asyncio
async def test_flyto_with_explicit_coords_skips_geocoder():
    res = await MapFlyTo(lat=50.0, lon=30.0, zoom=12).execute(_ctx())
    assert res.ok is True
    assert res.output["map_mutation"]["op"] == "fly_to"
    assert res.output["extras"]["lat"] == 50.0


def test_flyto_validation_requires_target():
    with pytest.raises(Exception):
        MapFlyTo(zoom=12)  # type: ignore[call-arg]


@pytest.mark.asyncio
async def test_add_marker_rejects_unknown_category():
    res = await MapAddMarker(
        lat=50.45, lon=30.52, name="x", category="bogus", user_id="u1",
    ).execute(_ctx())
    assert res.ok is False
    assert res.output["reason"] == "bad_category"


@pytest.mark.asyncio
async def test_add_marker_rejects_missing_owner():
    res = await MapAddMarker(lat=50.45, lon=30.52, name="x").execute(_ctx())
    assert res.ok is False
    assert res.output["reason"] == "missing_owner"


@pytest.mark.asyncio
async def test_list_layers_filters_by_category():
    res = await MapListLayers(category="ukraine").execute(_ctx())
    assert res.ok is True
    items = res.output["artifacts"][0]["payload"]["items"]
    ids = {row["id"] for row in items}
    assert ids == {"air_raid_ua", "frontline"}


@pytest.mark.asyncio
async def test_list_layers_rejects_bad_category():
    res = await MapListLayers(category="mythical").execute(_ctx())
    assert res.ok is False
    assert res.output["reason"] == "bad_category"


@pytest.mark.asyncio
async def test_enable_then_disable_layer_round_trip():
    enable = await MapEnableLayer(layer_id="frontline").execute(_ctx())
    assert enable.ok is True
    assert enable.output["map_mutation"]["op"] == "enable_layer"
    assert "frontline" in enable.output["extras"]["active_layer_ids"]

    disable = await MapDisableLayer(layer_id="frontline").execute(_ctx())
    assert disable.ok is True
    assert disable.output["map_mutation"]["op"] == "disable_layer"
    assert "frontline" not in disable.output["extras"]["active_layer_ids"]
    assert disable.output["extras"]["was_active"] is True


@pytest.mark.asyncio
async def test_enable_layer_blocks_root_only_when_role_is_operator():
    res = await MapEnableLayer(layer_id="substations").execute(
        ActionContext(task_id="t", step_idx=0, workspace_dir="/tmp", extras={"role": "OPERATOR"}),
    )
    assert res.ok is False
    assert res.output["reason"] == "require_root"


@pytest.mark.asyncio
async def test_enable_unknown_layer_returns_unknown_layer_reason():
    res = await MapEnableLayer(layer_id="not_a_layer").execute(_ctx())
    assert res.ok is False
    assert res.output["reason"] == "unknown_layer"


@pytest.mark.asyncio
async def test_snapshot_records_active_layers_and_emits_artifact():
    # Seed an extra active layer so the snapshot has a non-default state.
    await MapEnableLayer(layer_id="frontline").execute(_ctx())
    res = await MapSnapshot(label="зимовий рейд").execute(_ctx())
    assert res.ok is True
    artifact = res.output["artifacts"][0]
    assert artifact["kind"] == "screenshot"
    assert "frontline" in artifact["payload"]["active_layer_ids"]


@pytest.mark.asyncio
async def test_explain_view_rejects_inverted_bbox():
    res = await MapExplainView(bbox=[51.0, 30.0, 50.0, 31.0]).execute(_ctx())
    assert res.ok is False
    assert res.output["reason"] == "bad_bbox"


@pytest.mark.asyncio
async def test_query_nearby_returns_artifact_pair_even_offline(monkeypatch):
    # Force adapters to fail — action must still return an OK envelope.
    async def _boom(*_a, **_k):
        raise RuntimeError("offline")

    from agent.localization.adapters import overpass as ov_mod

    class _FakeOv:
        async def features_near(self, *_a, **_k):
            raise RuntimeError("offline")

    monkeypatch.setattr(ov_mod, "get_default_overpass", lambda: _FakeOv())
    res = await MapQueryNearby(lat=50.45, lon=30.52, radius_m=200).execute(_ctx())
    assert res.ok is True
    artifact_kinds = {a["label"] for a in res.output["artifacts"]}
    assert artifact_kinds == {"osm", "pois"}


@pytest.mark.asyncio
async def test_geocode_handles_offline_provider(monkeypatch):
    class _FakeGeo:
        async def geocode(self, *_a, **_k):
            raise RuntimeError("dns down")

    from agent.localization.adapters import nominatim as nm
    monkeypatch.setattr(nm, "get_default_nominatim", lambda: _FakeGeo())
    res = await MapGeocode(query="Lviv").execute(_ctx())
    assert res.ok is False
    assert res.output["reason"] == "geocoder_offline"


@pytest.mark.asyncio
async def test_reverse_geocode_handles_no_match(monkeypatch):
    class _FakeGeo:
        async def reverse(self, *_a, **_k):
            return None

    from agent.localization.adapters import nominatim as nm
    monkeypatch.setattr(nm, "get_default_nominatim", lambda: _FakeGeo())
    res = await MapReverseGeocode(lat=0.0, lon=0.0).execute(_ctx())
    assert res.ok is False
    assert res.output["reason"] == "no_match"
