"""Точка «я тут» їде наявними дорогами і лягає у стрічку як точка, не як текст.

Хвиля 1 контракту симбіозу: kind='geo:point', тіло {lat, lon, at, acc?, label?},
час у тілі — час ВИМІРУ. Дорога, якою кадр приїхав, записується разом із ним:
точка зі скриньки не має права вдягати живий бейдж.
"""
from __future__ import annotations

import json
import time

import pytest
from tests.conftest import owner_of

from db.database import AsyncSessionLocal
from messenger.blobs import WIRE_KINDS, unwrap_frame, wrap_frame
from messenger.crypto.at_rest import unseal
from messenger.crypto.keys import KeyStore
from messenger.crypto.session import Session
from messenger.geo import parse_point
from messenger.inbox import accept_frame


def _body(**over) -> str:
    point = {"lat": 50.4501, "lon": 30.5234, "at": int(time.time() * 1000), "acc": 12.5}
    point.update(over)
    return json.dumps(point)


def test_the_kind_survives_the_envelope():
    """Тип має пережити дорогу: інакше точка приїде як рядок JSON у стрічці."""
    assert "geo:point" in WIRE_KINDS
    kind, body, origin, group = unwrap_frame(wrap_frame("geo:point", _body(), "c_1"))
    assert kind == "geo:point"
    assert origin == "c_1"
    assert group == ""
    assert parse_point(body) is not None


def test_a_point_parses_into_numbers():
    point = parse_point(_body(label=" дім "))
    assert point is not None
    assert (round(point.lat, 4), round(point.lon, 4)) == (50.4501, 30.5234)
    assert point.accuracy_m == 12.5
    assert point.label == "дім"


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "не JSON",
        "[]",
        json.dumps({"lat": 50.4501}),
        json.dumps({"lat": 50.4501, "lon": 30.5234}),
        json.dumps({"lat": "50.4501", "lon": "30.5234", "at": 1}),
        json.dumps({"lat": 91.0, "lon": 30.5, "at": 1}),
        json.dumps({"lat": 50.4, "lon": 181.0, "at": 1}),
        json.dumps({"lat": 50.4, "lon": 30.5, "at": 0}),
    ],
)
def test_half_a_point_is_not_a_point(raw):
    """Пів-точки не буває: намалювати людину не там, де вона є, гірше за мовчання."""
    assert parse_point(raw) is None


@pytest.mark.anyio
async def test_a_point_from_another_node_lands_in_the_feed(auth_root_client):
    from api.routes_messenger import _keys

    me = _keys()
    peer = KeyStore.generate(one_time_count=4)
    body = _body(label="я тут")

    async with AsyncSessionLocal() as session:
        owner = owner_of(auth_root_client)
        frame = Session.initiate(peer, me.publish_bundle()).encrypt(
            wrap_frame("geo:point", body, "c_geo_1").encode()
        )
        row = await accept_frame(session, me, owner, frame, peer.node_id, road="direct")

    assert row is not None
    assert row.kind == "geo:point"
    assert row.transport == "direct"
    point = parse_point(unseal(me, bytes.fromhex(row.ciphertext), aad=row.id.encode()))
    assert point is not None
    assert point.label == "я тут"


@pytest.mark.anyio
async def test_a_point_from_the_mailbox_is_marked_as_such(auth_root_client):
    """Дорога записана в рядок: показ рахує вік не лише з `at`, а й зі скриньки."""
    from api.routes_messenger import _keys

    me = _keys()
    peer = KeyStore.generate(one_time_count=4)

    async with AsyncSessionLocal() as session:
        owner = owner_of(auth_root_client)
        frame = Session.initiate(peer, me.publish_bundle()).encrypt(
            wrap_frame("geo:point", _body(), "c_geo_2").encode()
        )
        row = await accept_frame(session, me, owner, frame, peer.node_id, road="mailbox")

    assert row is not None
    assert row.transport == "mailbox"


@pytest.mark.anyio
async def test_a_point_without_coordinates_never_reaches_the_feed(auth_root_client):
    from api.routes_messenger import _keys

    me = _keys()
    peer = KeyStore.generate(one_time_count=4)

    async with AsyncSessionLocal() as session:
        owner = owner_of(auth_root_client)
        frame = Session.initiate(peer, me.publish_bundle()).encrypt(
            wrap_frame("geo:point", json.dumps({"label": "десь"}), "c_geo_3").encode()
        )
        assert await accept_frame(session, me, owner, frame, peer.node_id) is None


@pytest.mark.anyio
async def test_the_node_refuses_to_send_a_point_without_coordinates(auth_root_client):
    """Відмова ДО запису: рядок у стрічці без координат нікому не поміг би."""
    created = auth_root_client.post(
        "/api/v1/messenger/conversations", json={"title": "Гео", "kind": "dm"}
    )
    conversation_id = created.json()["id"]

    response = auth_root_client.post(
        f"/api/v1/messenger/conversations/{conversation_id}/messages",
        json={
            "client_id": "c_geo_bad",
            "author_id": "me",
            "author_name": "Я",
            "kind": "geo:point",
            "body": json.dumps({"label": "десь"}),
        },
    )
    assert response.status_code == 400

    ok = auth_root_client.post(
        f"/api/v1/messenger/conversations/{conversation_id}/messages",
        json={
            "client_id": "c_geo_ok",
            "author_id": "me",
            "author_name": "Я",
            "kind": "geo:point",
            "body": _body(),
        },
    )
    assert ok.status_code == 200
    assert ok.json()["kind"] == "geo:point"
