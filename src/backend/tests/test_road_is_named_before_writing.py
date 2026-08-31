"""Вузол каже, чи є дорога, ДО того як людина напише.

Навіщо. Дороги в `deliver()` три: пряма (потрібна відома адреса), ретранслятор
(`relay_url`) і хмара (Supabase). За замовчуванням дві останні порожні —
ретранслятор навмисно, бо WS-тунель на розгорнутому сервері дає 404. Тобто
поза домашньою мережею, де адреса невідома, **дороги немає жодної**: лист
ляже в чергу й лежатиме, доки дорога не зʼявиться.

Дізнатись про це, написавши важливе й чекаючи відповіді, — найдорожчий спосіб.
Тому вузол називає дорогу **наперед**, а порожнє значення означає прямо:
жодної.

Межа цього сторожа сказана вголос: він перевіряє, що вузол **не мовчить і не
вигадує**, а не що дорога працює. Довести доставку може лише лист, що доїхав.
"""
from __future__ import annotations

import pytest

from tests.conftest import owner_of

API = "/api/v1/messenger"


def _conversation_with_contact(client, address: str | None) -> dict:
    from messenger.crypto.keys import KeyStore

    peer = KeyStore.generate(one_time_count=2)
    body = {"display_name": "Марта", "bundle": peer.publish_bundle().to_dict()}
    if address:
        body["peer_address"] = address
    contact = client.post(f"{API}/contacts", json=body)
    assert contact.status_code == 201, contact.text
    created = client.post(
        f"{API}/conversations",
        json={"title": "Марта", "kind": "direct", "contact_id": contact.json()["id"]},
    )
    assert created.status_code == 201, created.text
    return created.json()


@pytest.mark.anyio
async def test_a_known_address_is_named_as_the_direct_road(auth_root_client):
    out = _conversation_with_contact(auth_root_client, "http://127.0.0.1:9")

    assert out["road_ahead"] == "direct"


@pytest.mark.anyio
async def test_without_an_address_the_node_says_there_is_NO_road(auth_root_client):
    """Найважливіше: порожньо означає «жодної», і це сказано, а не замовчано."""
    out = _conversation_with_contact(auth_root_client, None)

    # Саме порожній рядок, а не `null` і не відсутнє поле: вузол ЗНАЄ, що
    # дороги немає, і це знання, а не незнання.
    assert out["road_ahead"] == ""


@pytest.mark.anyio
async def test_the_relay_when_configured_is_named(auth_root_client, monkeypatch):
    """Контроль: сторож не просто завжди каже «немає».

    Без цього випадку перевірка вище була б зелена й тоді, коли поле зламане
    й повертає порожньо завжди — тобто доводила б протилежне тому, що треба.
    """
    from config import config

    monkeypatch.setattr(config, "relay_enabled", True)
    monkeypatch.setattr(config, "relay_url", "https://relay.example")

    out = _conversation_with_contact(auth_root_client, None)

    assert out["road_ahead"] == "relay"


@pytest.mark.anyio
async def test_a_conversation_with_nobody_is_marked_as_such(auth_root_client):
    """Нотатки собі: дороги не треба, і «немає дороги» тут було б неправдою."""
    created = auth_root_client.post(
        f"{API}/conversations", json={"title": "Собі", "kind": "direct"}
    )

    assert created.json()["road_ahead"] == "self"


@pytest.mark.anyio
async def test_the_list_names_the_road_too(auth_root_client):
    """Список розмов — саме там людина обирає, кому писати."""
    _conversation_with_contact(auth_root_client, None)
    owner = owner_of(auth_root_client)
    assert owner

    rows = auth_root_client.get(f"{API}/conversations").json()

    assert rows, "жодної розмови — перевіряти нема чого"
    assert all("road_ahead" in row for row in rows)
