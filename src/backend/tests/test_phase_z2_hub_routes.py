"""Day-4 Wave-2 Z-2 — `/api/v1/hub/*` HTTP route pin (ADR-HUB-005).

Coverage:

1. GET /api/v1/hub/providers requires auth (401 without bearer).
2. GET /api/v1/hub/providers returns the default-seeded 4 rows
   (Gemini chat + chat_subtask, Ollama chat + chat_subtask).
3. Each row carries the 7 ProviderCapability fields.
4. GET /api/v1/hub/route_state returns the in-memory decision ring.
5. /hub/route_state?limit=N clamps to [1, 200].
6. After a hub.pick() between calls, /hub/route_state shows the
   decision.
"""
from __future__ import annotations

import pytest


# ────────────────────────────────────────────────────── auth gating ──


def test_providers_route_requires_auth(client_no_auth):
    r = client_no_auth.get("/api/v1/hub/providers")
    assert r.status_code in (401, 403), r.text


def test_route_state_route_requires_auth(client_no_auth):
    r = client_no_auth.get("/api/v1/hub/route_state")
    assert r.status_code in (401, 403), r.text


# ───────────────────────────────────────────────────── providers ──


def test_providers_returns_seeded_rows(auth_root_client):
    """Default seed: Gemini + Ollama × {chat, chat_subtask} = 4 rows."""
    from ai.hub import get_ai_hub

    # Reset so the default seed runs cleanly on this test's first hit.
    get_ai_hub().reset_for_tests()

    r = auth_root_client.get("/api/v1/hub/providers")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] >= 4
    providers = {(p["provider"], p["task_class"]) for p in body["providers"]}
    assert ("gemini", "chat") in providers
    assert ("gemini", "chat_subtask") in providers
    assert ("ollama", "chat") in providers
    assert ("ollama", "chat_subtask") in providers


def test_providers_row_shape_matches_capability(auth_root_client):
    from ai.hub import get_ai_hub

    get_ai_hub().reset_for_tests()
    r = auth_root_client.get("/api/v1/hub/providers")
    body = r.json()
    sample = body["providers"][0]
    expected_keys = {
        "provider",
        "task_class",
        "modality",
        "latency_ms_p50",
        "quality_tier",
        "locality",
        "available",
    }
    assert set(sample.keys()) == expected_keys, (
        f"Z-2 wire shape drift: ProviderRow keys = {set(sample.keys())!r}. "
        "Frontend type contract mirrors this 1:1 — additions/renames "
        "need a migration in shared/types."
    )


# ───────────────────────────────────────────────────── route_state ──


def test_route_state_initially_empty(auth_root_client):
    from ai.hub import get_ai_hub

    hub = get_ai_hub()
    hub.reset_for_tests()
    r = auth_root_client.get("/api/v1/hub/route_state")
    assert r.status_code == 200
    body = r.json()
    assert body["decisions"] == []
    assert body["total"] == 0


def test_route_state_records_pick_decision(auth_root_client):
    from ai.hub import get_ai_hub, register_default_capabilities

    hub = get_ai_hub()
    hub.reset_for_tests()
    register_default_capabilities(hub=hub)
    # Trigger a pick so the ring has at least one row.
    hub.pick("chat", prefer="auto")

    r = auth_root_client.get("/api/v1/hub/route_state")
    body = r.json()
    assert body["total"] >= 1
    assert body["decisions"][-1]["task_class"] == "chat"
    # First pick is always changed=True.
    assert body["decisions"][-1]["changed"] is True


def test_route_state_limit_param_clamped(auth_root_client):
    from ai.hub import get_ai_hub

    get_ai_hub().reset_for_tests()
    # Out-of-range limits — Pydantic Query validation rejects with 422.
    r = auth_root_client.get("/api/v1/hub/route_state?limit=0")
    assert r.status_code == 422
    r = auth_root_client.get("/api/v1/hub/route_state?limit=999")
    assert r.status_code == 422
    # In-range — accepted, returns valid envelope.
    r = auth_root_client.get("/api/v1/hub/route_state?limit=10")
    assert r.status_code == 200


# ───────────────────────────────────────────────────────────── conftest ──


@pytest.fixture
def client_no_auth(auth_root_client):
    """Fresh TestClient sharing the app but stripped of auth header.
    Used for the 401 contract pins."""
    from fastapi.testclient import TestClient

    app = auth_root_client.app
    return TestClient(app)
