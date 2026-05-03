"""Phase 24-A — AttributionStore tests."""
from __future__ import annotations

import pytest

from geo.attribution import AttributionStore, GLOBAL_SESSION
from geo.layer_registry import LayerNotFoundError, reload_layer_registry


@pytest.fixture()
def registry():
    return reload_layer_registry()


@pytest.fixture()
def store(registry):
    return AttributionStore(registry=registry)


def test_default_active_seeded_per_session(store):
    ids = store.active_ids(session_id="session-A")
    assert "base" in ids
    assert "presence" in ids
    # Non-default layers stay off until explicitly enabled.
    assert "frontline" not in ids


def test_enable_idempotent(store):
    a = store.enable("frontline", session_id="s1")
    b = store.enable("frontline", session_id="s1")
    assert a is b or (a.layer_id == b.layer_id and a.activated_at == b.activated_at)


def test_disable_returns_true_only_when_active(store):
    assert store.disable("frontline", session_id="s2") is False
    store.enable("frontline", session_id="s2")
    assert store.disable("frontline", session_id="s2") is True
    assert store.disable("frontline", session_id="s2") is False


def test_unknown_layer_id_rejected(store):
    with pytest.raises(LayerNotFoundError):
        store.enable("not_a_real_layer", session_id="s")


def test_attribution_lines_dedup_within_session(store):
    # Both Ukraine layers carry distinct attributions, but any two layers
    # sharing the same string should collapse into one entry. Use the
    # Wardriving + Heatmap pair — both PHANTOM-internal but with
    # different text so the dedup branch is exercised when we add
    # synthetic duplicates below.
    store.enable("frontline", session_id="dedup")
    store.enable("air_raid_ua", session_id="dedup")
    lines = store.attribution_lines(session_id="dedup")
    # No duplicates.
    seen = set()
    for line in lines:
        assert line.text not in seen
        seen.add(line.text)


def test_per_session_isolation(store):
    store.enable("frontline", session_id="alpha")
    assert "frontline" in store.active_ids(session_id="alpha")
    assert "frontline" not in store.active_ids(session_id="beta")


def test_reset_restores_defaults(store):
    store.enable("frontline", session_id="z")
    store.disable("base", session_id="z")
    assert "frontline" in store.active_ids(session_id="z")
    assert "base" not in store.active_ids(session_id="z")
    store.reset(session_id="z")
    assert "frontline" not in store.active_ids(session_id="z")
    assert "base" in store.active_ids(session_id="z")


def test_public_payload_contains_active_ids_and_attribution(store):
    payload = store.public_payload(session_id=GLOBAL_SESSION)
    assert "session_id" in payload
    assert isinstance(payload["active_layer_ids"], list)
    assert isinstance(payload["attribution"], list)
    if payload["attribution"]:
        first = payload["attribution"][0]
        assert {"text", "license", "layer_ids"} <= set(first.keys())


def test_attribution_layer_ids_are_sorted_and_unique(store):
    # Synthetic case: duplicate attribution by enabling layers that
    # share a PHANTOM-internal credit tag — wardriving + heatmap.
    store.enable("wardriving", session_id="combo")
    store.enable("heatmap", session_id="combo")
    lines = store.attribution_lines(session_id="combo")
    for line in lines:
        assert list(line.layer_ids) == sorted(set(line.layer_ids))
