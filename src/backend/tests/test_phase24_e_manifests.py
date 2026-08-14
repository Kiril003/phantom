"""Phase 24-E — registry coverage for the 14 new manifests."""
from __future__ import annotations

import pytest

from geo import LayerCategory
from geo.layer_registry import reload_layer_registry


@pytest.fixture(autouse=True)
def _registry():
    return reload_layer_registry()


PHASE_E_NEW = {
    "earthquakes",
    "weather_radar",
    "aqi",
    "no2_plume",
    "aurora",
    "light_pollution",
    "sun_moon",
    "sat_passes",
    "power_plants",
    "bunkers",
    "cell_towers",
    "tor_relays",
    "mapillary",
}


def test_registry_now_carries_at_least_25_layers(_registry):
    # Було 26+; `ads_b` і `lightning` знято за ліцензіями (див.
    # test_killed_layers_stay_dead), тож підлога опустилась на два.
    assert len(_registry.all()) >= 25


def test_every_phase_e_manifest_loads(_registry):
    ids = {m.id for m in _registry.all()}
    missing = PHASE_E_NEW - ids
    assert missing == set(), f"manifests missing: {missing}"


def test_no_load_errors(_registry):
    assert _registry.load_errors() == []


@pytest.mark.parametrize("layer_id", sorted(PHASE_E_NEW))
def test_each_new_manifest_has_attribution_and_verbs(_registry, layer_id):
    m = _registry.get(layer_id)
    assert m.attribution.strip(), f"{layer_id} missing attribution"
    assert m.license.strip(), f"{layer_id} missing license"
    # Style is always default-instantiable; agent_verbs may legitimately
    # be empty for purely passive layers but every layer in Phase 24-E
    # ships at least one chat-callable verb so the planner can mention
    # it. If you add a passive-only layer later, drop it from this list.
    assert m.agent_verbs, f"{layer_id} should expose at least one agent verb"


def test_root_only_layers_explicit():
    expected_root = {"no2_plume", "power_plants", "bunkers", "cell_towers", "tor_relays"}
    reg = reload_layer_registry()
    actual = {m.id for m in reg.all() if m.require_root and m.id in PHASE_E_NEW}
    assert actual == expected_root


def test_categories_cover_expected_buckets(_registry):
    cats = {m.category for m in _registry.all() if m.id in PHASE_E_NEW}
    expected = {
        LayerCategory.live,
        LayerCategory.environment,
        LayerCategory.astronomy,
        LayerCategory.infra,
        LayerCategory.hacker,
        LayerCategory.osint,
        LayerCategory.reference,
    }
    assert expected <= cats
