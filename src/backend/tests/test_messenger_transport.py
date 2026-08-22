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
