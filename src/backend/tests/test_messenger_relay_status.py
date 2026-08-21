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


# ── Стрічка не має права загубити повідомлення ───────────────────────────────


@pytest.mark.anyio
async def test_message_survives_and_keeps_order(auth_root_client):
    chat = auth_root_client.post(
        "/api/v1/messenger/conversations", json={"title": "Рідний Дім"}
    ).json()

    for i in range(3):
        auth_root_client.post(
            f"/api/v1/messenger/conversations/{chat['id']}/messages",
            json={
                "client_id": f"c{i}",
                "author_id": "me",
                "author_name": "Кирило",
                "body": f"повідомлення {i}",
            },
        )

    rows = auth_root_client.get(
        f"/api/v1/messenger/conversations/{chat['id']}/messages"
    ).json()

    assert [r["body"] for r in rows] == ["повідомлення 0", "повідомлення 1", "повідомлення 2"]
    # Порядок тримає лічильник, а не час: у двох пристроїв годинники різні.
    assert [r["seq"] for r in rows] == [1, 2, 3]


@pytest.mark.anyio
async def test_resend_after_broken_link_does_not_duplicate(auth_root_client):
    chat = auth_root_client.post(
        "/api/v1/messenger/conversations", json={"title": "Робота"}
    ).json()
    body = {
        "client_id": "same-one",
        "author_id": "me",
        "author_name": "Кирило",
        "body": "чи дійшло?",
    }

    first = auth_root_client.post(
        f"/api/v1/messenger/conversations/{chat['id']}/messages", json=body
    ).json()
    second = auth_root_client.post(
        f"/api/v1/messenger/conversations/{chat['id']}/messages", json=body
    ).json()

    assert first["id"] == second["id"]
    assert first["seq"] == second["seq"]
    rows = auth_root_client.get(
        f"/api/v1/messenger/conversations/{chat['id']}/messages"
    ).json()
    assert len(rows) == 1


@pytest.mark.anyio
async def test_after_seq_returns_only_the_tail(auth_root_client):
    chat = auth_root_client.post(
        "/api/v1/messenger/conversations", json={"title": "Друзі"}
    ).json()
    for i in range(4):
        auth_root_client.post(
            f"/api/v1/messenger/conversations/{chat['id']}/messages",
            json={
                "client_id": f"t{i}",
                "author_id": "me",
                "author_name": "Кирило",
                "body": str(i),
            },
        )

    tail = auth_root_client.get(
        f"/api/v1/messenger/conversations/{chat['id']}/messages?after_seq=2"
    ).json()

    assert [r["body"] for r in tail] == ["2", "3"]


@pytest.mark.anyio
async def test_foreign_conversation_is_not_readable(auth_root_client, auth_operator_client):
    chat = auth_root_client.post(
        "/api/v1/messenger/conversations", json={"title": "Особисте"}
    ).json()

    resp = auth_operator_client.get(
        f"/api/v1/messenger/conversations/{chat['id']}/messages"
    )

    assert resp.status_code == 404
