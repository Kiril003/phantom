"""Supabase-скринька — четверта дорога листа.

Порядок доріг священний: пряма → ретранслятор → Supabase. Чужа хмара бачить
лише непрозорий конверт (шифротекст плюс імʼя відправника), і лише коли
перші дві дороги мовчать. Читання скриньки без службового ключа з env не
вмикається взагалі.
"""
from __future__ import annotations

import json
from types import SimpleNamespace

import httpx
import pytest

from messenger.redelivery import read_supabase_mailbox, supabase_service_key
from messenger.transport import (
    SUPABASE_LETTER_MAX,
    deliver,
    deliver_via_supabase,
    supabase_mailbox_endpoint,
    supabase_road,
)

SB_URL = "https://example.supabase.co"
SB_KEY = "sb_publishable_test"


def test_endpoint_normalises_scheme():
    assert (
        supabase_mailbox_endpoint("example.supabase.co/")
        == "https://example.supabase.co/rest/v1/messenger_mailbox"
    )
    with pytest.raises(ValueError):
        supabase_mailbox_endpoint("  ")


def test_road_requires_both_url_and_key():
    assert supabase_road(SimpleNamespace(supabase_mailbox_url=SB_URL, supabase_anon_key="")) == ("", "")
    assert supabase_road(SimpleNamespace(supabase_mailbox_url="", supabase_anon_key=SB_KEY)) == ("", "")
    assert supabase_road(
        SimpleNamespace(supabase_mailbox_url=f" {SB_URL} ", supabase_anon_key=SB_KEY)
    ) == (SB_URL, SB_KEY)


@pytest.mark.anyio
async def test_supabase_carries_the_same_envelope():
    seen: dict = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["apikey"] = request.headers.get("apikey")
        seen["auth"] = request.headers.get("authorization")
        seen["body"] = json.loads(request.content)
        return httpx.Response(201)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        ok = await deliver_via_supabase(
            SB_URL, SB_KEY, "PEER", b"\x01\x02",
            from_node_id="ME", reply_address="http://дім:8000", client=client,
        )

    assert ok is True
    assert seen["url"].endswith("/rest/v1/messenger_mailbox")
    assert seen["apikey"] == SB_KEY
    assert seen["auth"] == f"Bearer {SB_KEY}"
    assert seen["body"]["recipient_node_id"] == "PEER"
    envelope = json.loads(seen["body"]["frame"])
    # У колонці — той самий конверт, що їде в скриньку ретранслятора.
    assert envelope == {
        "frame": "0102",
        "from_node_id": "ME",
        "reply_address": "http://дім:8000",
    }


@pytest.mark.anyio
async def test_a_supabase_refusal_is_not_a_delivery():
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        ok = await deliver_via_supabase(
            SB_URL, SB_KEY, "PEER", b"\x01", from_node_id="ME", client=client
        )

    assert ok is False


@pytest.mark.anyio
async def test_an_oversized_letter_never_leaves_the_node():
    async def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover
        raise AssertionError("конверт понад стелю не має їхати в мережу")

    frame = b"\x00" * (SUPABASE_LETTER_MAX // 2)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        ok = await deliver_via_supabase(
            SB_URL, SB_KEY, "PEER", frame, from_node_id="ME", client=client
        )

    assert ok is False


# ── Порядок доріг ────────────────────────────────────────────────────────────


def _roads(monkeypatch, *, direct: bool, relay: bool, supabase: bool) -> list:
    order: list[str] = []

    async def fake_direct(*args, **kwargs):
        order.append("direct")
        return direct

    async def fake_relay(*args, **kwargs):
        order.append("relay")
        return relay

    async def fake_supabase(*args, **kwargs):
        order.append("supabase")
        return supabase

    import messenger.transport as transport

    monkeypatch.setattr(transport, "deliver_direct", fake_direct)
    monkeypatch.setattr(transport, "deliver_via_relay", fake_relay)
    monkeypatch.setattr(transport, "deliver_via_supabase", fake_supabase)
    return order


@pytest.mark.anyio
async def test_supabase_stays_silent_when_the_relay_delivers(monkeypatch):
    order = _roads(monkeypatch, direct=False, relay=True, supabase=True)
    ok = await deliver(
        b"\x01", peer_node_id="PEER", from_node_id="ME",
        peer_address="peer.local", relay="relay.local",
        supabase_url=SB_URL, supabase_key=SB_KEY,
    )
    # `deliver` більше не каже «так/ні», а НАЗИВАЄ дорогу: саме її потім
    # показують людині в стрічці. Порожній рядок — жодної дороги.
    assert ok == "relay"
    assert order == ["direct", "relay"]


@pytest.mark.anyio
async def test_supabase_catches_what_both_roads_dropped(monkeypatch):
    order = _roads(monkeypatch, direct=False, relay=False, supabase=True)
    ok = await deliver(
        b"\x01", peer_node_id="PEER", from_node_id="ME",
        peer_address="peer.local", relay="relay.local",
        supabase_url=SB_URL, supabase_key=SB_KEY,
    )
    # `deliver` більше не каже «так/ні», а НАЗИВАЄ дорогу: саме її потім
    # показують людині в стрічці. Порожній рядок — жодної дороги.
    assert ok == "cloud"
    assert order == ["direct", "relay", "supabase"]


@pytest.mark.anyio
async def test_without_url_or_key_the_road_does_not_exist(monkeypatch):
    order = _roads(monkeypatch, direct=False, relay=False, supabase=True)
    ok = await deliver(
        b"\x01", peer_node_id="PEER", from_node_id="ME",
        peer_address="peer.local", relay="relay.local",
        supabase_url=SB_URL, supabase_key="",
    )
    assert ok == "", "жодна дорога не взяла — назвати нічого"
    assert order == ["direct", "relay"]


# ── Читання скриньки ─────────────────────────────────────────────────────────


def test_service_key_comes_only_from_env(monkeypatch):
    monkeypatch.delenv("SUPABASE_SERVICE_KEY", raising=False)
    assert supabase_service_key() == ""
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", " sk-test ")
    assert supabase_service_key() == "sk-test"


@pytest.mark.anyio
async def test_reader_accepts_letters_and_stamps_them(monkeypatch):
    accepted: list = []

    async def fake_accept(
        session, keys, owner, frame, peer_node_id=None, *, reply_address=None, road="relay"
    ):
        if frame == b"\xba\xad":
            raise ValueError("кадр не розшифровується")
        # Лист чекав у скриньці — дорога має доїхати до рядка разом із ним.
        assert road == "mailbox"
        accepted.append((frame, peer_node_id, reply_address))
        return None

    import messenger.inbox as inbox

    monkeypatch.setattr(inbox, "accept_frame", fake_accept)

    rows = [
        {"id": "r1", "frame": json.dumps({"frame": "0102", "from_node_id": "PEER"})},
        {"id": "r2", "frame": json.dumps({"frame": "baad", "from_node_id": "PEER"})},
    ]
    patched: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            assert request.url.params["recipient_node_id"] == "eq.NODE"
            assert request.url.params["delivered_at"] == "is.null"
            assert request.headers.get("apikey") == "sk-service"
            return httpx.Response(200, json=rows)
        assert request.method == "PATCH"
        patched.append(request.url.params["id"])
        assert json.loads(request.content).get("delivered_at")
        return httpx.Response(204)

    keys = SimpleNamespace(node_id="NODE")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        count = await read_supabase_mailbox(
            None, keys, "owner-1", url=SB_URL, service_key="sk-service", client=client
        )

    assert count == 1
    assert accepted == [(b"\x01\x02", "PEER", None)]
    # Отруйний лист теж штампується: вічний повтор заступив би дорогу решті.
    assert patched == ["eq.r1", "eq.r2"]


@pytest.mark.anyio
async def test_reader_takes_a_refusal_quietly():
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401)

    keys = SimpleNamespace(node_id="NODE")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        count = await read_supabase_mailbox(
            None, keys, "owner-1", url=SB_URL, service_key="bad", client=client
        )

    assert count == 0
