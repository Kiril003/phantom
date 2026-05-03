"""Phase 24-A — API contract tests for /map/layers + /map/attribution."""
from __future__ import annotations

import pytest

from geo.attribution import reset_attribution_store_for_tests
from geo.layer_registry import reload_layer_registry


@pytest.fixture(autouse=True)
def _isolated_registry_and_store():
    reload_layer_registry()
    reset_attribution_store_for_tests()
    yield
    reset_attribution_store_for_tests()


def test_layers_index_returns_full_set(auth_root_client):
    resp = auth_root_client.get("/api/v1/map/layers")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] >= 12
    ids = {layer["id"] for layer in body["layers"]}
    assert {"base", "presence", "frontline", "ads_b"} <= ids
    # Default-active flag mirrors registry seed.
    base = next(layer for layer in body["layers"] if layer["id"] == "base")
    assert base["active"] is True
    frontline = next(layer for layer in body["layers"] if layer["id"] == "frontline")
    assert frontline["active"] is False


def test_layers_index_filters_by_category(auth_root_client):
    resp = auth_root_client.get("/api/v1/map/layers?category=ukraine")
    assert resp.status_code == 200
    ids = {layer["id"] for layer in resp.json()["layers"]}
    assert ids == {"air_raid_ua", "frontline"}


def test_layers_index_rejects_unknown_category(auth_root_client):
    resp = auth_root_client.get("/api/v1/map/layers?category=mythical")
    assert resp.status_code == 400


def test_enable_layer_activates_for_session(auth_root_client):
    resp = auth_root_client.post("/api/v1/map/layers/frontline/enable")
    assert resp.status_code == 200
    body = resp.json()
    assert "frontline" in body["active_layer_ids"]
    assert body["activated"]["layer_id"] == "frontline"
    # Subsequent index reflects the activation.
    layers = auth_root_client.get("/api/v1/map/layers").json()["layers"]
    front = next(layer for layer in layers if layer["id"] == "frontline")
    assert front["active"] is True


def test_enable_unknown_layer_returns_404(auth_root_client):
    resp = auth_root_client.post("/api/v1/map/layers/no_such_layer/enable")
    assert resp.status_code == 404


def test_disable_layer_removes_from_active_set(auth_root_client):
    auth_root_client.post("/api/v1/map/layers/frontline/enable")
    resp = auth_root_client.delete("/api/v1/map/layers/frontline")
    assert resp.status_code == 200
    body = resp.json()
    assert body["was_active"] is True
    assert "frontline" not in body["active_layer_ids"]


def test_disable_unknown_layer_returns_404(auth_root_client):
    resp = auth_root_client.delete("/api/v1/map/layers/no_such_layer")
    assert resp.status_code == 404


def test_root_required_layer_blocked_for_operator(auth_operator_client):
    # `substations` is `require_root: true` per its manifest.
    resp = auth_operator_client.post("/api/v1/map/layers/substations/enable")
    assert resp.status_code == 403


def test_attribution_endpoint_returns_dedup_payload(auth_root_client):
    resp = auth_root_client.get("/api/v1/map/attribution")
    assert resp.status_code == 200
    body = resp.json()
    assert "attribution" in body
    assert "active_layer_ids" in body
    seen_text = set()
    for line in body["attribution"]:
        assert line["text"] not in seen_text
        seen_text.add(line["text"])


def test_attribution_updates_after_enable(auth_root_client):
    before = auth_root_client.get("/api/v1/map/attribution").json()
    auth_root_client.post("/api/v1/map/layers/frontline/enable")
    after = auth_root_client.get("/api/v1/map/attribution").json()
    after_texts = {line["text"] for line in after["attribution"]}
    assert "Дані: DeepStateMap.live" in after_texts
    assert len(after["attribution"]) > len(before["attribution"])


def test_layers_endpoint_requires_auth(unauth_client):
    resp = unauth_client.get("/api/v1/map/layers")
    assert resp.status_code in (401, 403)


def test_attribution_per_user_isolated(auth_root_client, auth_operator_client):
    auth_root_client.post("/api/v1/map/layers/frontline/enable")
    op_payload = auth_operator_client.get("/api/v1/map/attribution").json()
    assert "frontline" not in op_payload["active_layer_ids"]
