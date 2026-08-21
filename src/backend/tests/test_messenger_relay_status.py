"""Стан ретранслятора для месенджера мусить бути виміряним, а не намальованим.

Клон Aura, який сюди приносили, показував мережеву панель із зашитими вузлами
й латентністю 18/34/39 мс — при тому що жоден із хостів не існував. Ці тести
фіксують протилежний контракт: маршрут віддає лише те, що сказав RelayClient,
а якщо клієнта нема — чесний connected=false із причиною.
"""
from __future__ import annotations

import pytest


@pytest.mark.anyio
async def test_relay_status_requires_auth(unauth_client):
    resp = unauth_client.get("/api/v1/messenger/relay/status")
    assert resp.status_code == 401


@pytest.mark.anyio
async def test_relay_status_reports_absent_client_honestly(auth_root_client):
    auth_root_client.app.state.relay_client = None

    resp = auth_root_client.get("/api/v1/messenger/relay/status")

    assert resp.status_code == 200
    body = resp.json()
    assert body["connected"] is False
    assert body["relay"] == ""
    assert body["sessions"] == 0
    assert body["last_error"] == "relay client not started"
    # Ім'я вузла існує навіть без ретранслятора — воно з ключа, а не з мережі.
    assert len(body["node_id"]) > 0


@pytest.mark.anyio
async def test_relay_status_mirrors_client_status(auth_root_client):
    class _StubRelay:
        def status(self) -> dict:
            return {
                "connected": True,
                "node_id": "node-under-test",
                "relay": "https://relay.example",
                "sessions": 2,
                "last_error": "",
            }

    auth_root_client.app.state.relay_client = _StubRelay()

    body = auth_root_client.get("/api/v1/messenger/relay/status").json()

    assert body == {
        "connected": True,
        "node_id": "node-under-test",
        "relay": "https://relay.example",
        "sessions": 2,
        "last_error": "",
    }
