"""Транспорт мусить називати відправника, а не адресата.

Баг, який тести не ловили: у листі їхав node_id того, КОМУ пишуть. Вузол-
адресат шукав контакт за власним ідентифікатором, не знаходив, і відмовляв.
Побачити це вдалося лише запустивши два справжні вузли.
"""
from __future__ import annotations

import httpx
import pytest

from messenger.transport import deliver_direct, inbox_url


def test_inbox_url_defaults_to_plain_http():
    assert inbox_url("192.168.1.5:8000") == "http://192.168.1.5:8000/api/v1/messenger/inbox"
    assert inbox_url("https://дім.local/") == "https://дім.local/api/v1/messenger/inbox"


def test_empty_address_is_an_error():
    with pytest.raises(ValueError):
        inbox_url("   ")


@pytest.mark.anyio
async def test_payload_names_the_sender_not_the_recipient():
    seen: dict = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen.update(__import__("json").loads(request.content))
        return httpx.Response(200, json={})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        ok = await deliver_direct(
            "peer.local", "PEER-NODE", b"\x01\x02", from_node_id="MY-NODE", client=client
        )

    assert ok is True
    assert seen["from_node_id"] == "MY-NODE"
    assert "PEER-NODE" not in str(seen)


@pytest.mark.anyio
async def test_a_refusal_is_not_a_delivery():
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"detail": "no"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        ok = await deliver_direct(
            "peer.local", "PEER", b"\x01", from_node_id="ME", client=client
        )

    assert ok is False


@pytest.mark.anyio
async def test_unreachable_node_is_not_a_delivery():
    async def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        ok = await deliver_direct(
            "peer.local", "PEER", b"\x01", from_node_id="ME", client=client
        )

    assert ok is False


def test_mailbox_url_normalises_the_relay_scheme():
    from messenger.transport import mailbox_url

    # Вузол тримає ретранслятор як ws://, а лист кладемо звичайним HTTP.
    assert mailbox_url("ws://relay.local", "NODE") == "http://relay.local/relay/mailbox/NODE"
    assert mailbox_url("wss://relay.local/", "NODE") == "https://relay.local/relay/mailbox/NODE"
    assert mailbox_url("relay.local", "NODE") == "https://relay.local/relay/mailbox/NODE"


@pytest.mark.anyio
async def test_relay_accepts_the_letter():
    from messenger.transport import deliver_via_relay

    seen: dict = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen.update(__import__("json").loads(request.content))
        return httpx.Response(202, json={})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        ok = await deliver_via_relay(
            "ws://relay.local", "PEER", b"\x09\x08",
            from_node_id="ME", reply_address="me.local", client=client,
        )

    assert ok is True
    assert seen["url"].endswith("/relay/mailbox/PEER")
    assert seen["from_node_id"] == "ME"
    assert seen["reply_address"] == "me.local"


@pytest.mark.anyio
async def test_a_relay_refusal_is_not_a_delivery():
    from messenger.transport import deliver_via_relay

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"detail": "забагато"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        ok = await deliver_via_relay(
            "relay.local", "PEER", b"\x01", from_node_id="ME", client=client
        )

    assert ok is False


# ── Вибір дороги ─────────────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_direct_is_tried_first_and_the_relay_is_left_alone(monkeypatch):
    """Пряма дорога нікому не показує метаданих — тож вона перша."""
    from messenger import transport

    calls: list[str] = []

    async def _direct(*a, **kw):
        calls.append("direct")
        return True

    async def _relay(*a, **kw):
        calls.append("relay")
        return True

    monkeypatch.setattr(transport, "deliver_direct", _direct)
    monkeypatch.setattr(transport, "deliver_via_relay", _relay)

    ok = await transport.deliver(
        b"\x01", peer_node_id="PEER", from_node_id="ME",
        peer_address="peer.local", relay="relay.local",
    )

    # `deliver` більше не каже «так/ні», а НАЗИВАЄ дорогу: саме її потім
    # показують людині в стрічці. Порожній рядок — жодної дороги.
    assert ok == "direct"
    assert calls == ["direct"]


@pytest.mark.anyio
async def test_the_relay_catches_what_the_direct_road_dropped(monkeypatch):
    from messenger import transport

    calls: list[str] = []

    async def _direct(*a, **kw):
        calls.append("direct")
        return False

    async def _relay(*a, **kw):
        calls.append("relay")
        return True

    monkeypatch.setattr(transport, "deliver_direct", _direct)
    monkeypatch.setattr(transport, "deliver_via_relay", _relay)

    ok = await transport.deliver(
        b"\x01", peer_node_id="PEER", from_node_id="ME",
        peer_address="peer.local", relay="relay.local",
    )

    # `deliver` більше не каже «так/ні», а НАЗИВАЄ дорогу: саме її потім
    # показують людині в стрічці. Порожній рядок — жодної дороги.
    assert ok == "relay"
    assert calls == ["direct", "relay"]


@pytest.mark.anyio
async def test_without_an_address_the_relay_carries_it_alone(monkeypatch):
    """Найчастіший випадок: людина за NAT, прямої адреси немає взагалі."""
    from messenger import transport

    calls: list[str] = []

    async def _relay(*a, **kw):
        calls.append("relay")
        return True

    monkeypatch.setattr(transport, "deliver_via_relay", _relay)

    ok = await transport.deliver(
        b"\x01", peer_node_id="PEER", from_node_id="ME", relay="relay.local"
    )

    # `deliver` більше не каже «так/ні», а НАЗИВАЄ дорогу: саме її потім
    # показують людині в стрічці. Порожній рядок — жодної дороги.
    assert ok == "relay"
    assert calls == ["relay"]


@pytest.mark.anyio
async def test_with_no_road_at_all_nothing_is_pretended():
    from messenger import transport

    assert await transport.deliver(b"\x01", peer_node_id="P", from_node_id="M") == ""
