"""Хмарна дорога для вкладень: R2 як місце, де байти чекають адресата.

Блокер, заради якого це написано: файл без прямої адреси не доїжджав НІКОЛИ —
`flush_blob_queue` мовчки пропускав такий рядок, і блоб лежав queued вічно.
Тепер дороги дві: пряма адреса, а коли її немає або вона мовчить — бакет, з
якого адресат забирає шифротекст сам.

Що саме тут доводиться:
  * підпис SigV4 збігається з опублікованим вектором AWS байт у байт;
  * порядок доріг: прямий пуш → хмара → чесний queued, коли хмари немає;
  * імʼя обʼєкта не виводить запит за межі бакета;
  * стеля розміру ріжеться ДО мережі;
  * ані ключ, ані підпис не потрапляють у журнал;
  * забране з хмари одразу прибирається звідти.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import select

from db.database import AsyncSessionLocal
from db.models import MessengerBlob, MessengerContact, User
from messenger import blobs
from messenger.blobs import (
    BLOB_LIMIT_BYTES,
    blob_path,
    flush_blob_queue,
    new_blob_id,
    park_blob,
    read_bytes,
    store_bytes,
    wrap_frame,
)
from messenger.crypto.keys import KeyStore
from messenger.crypto.session import Session
from messenger.inbox import accept_frame
from messenger.r2 import (
    PARK_MAX_BYTES,
    R2Road,
    canonical_request,
    drop_object,
    fetch_object,
    object_key,
    park_object,
    r2_road,
    sigv4_authorization,
)
from messenger.redelivery import fetch_parked_blobs

ROAD = R2Road(
    endpoint="https://acc.r2.cloudflarestorage.com",
    bucket="phantom-blobs",
    access_key="R2_ACCESS_KEY_FOR_TESTS",
    secret_key="R2_SECRET_KEY_FOR_TESTS_do_not_log_me",
)
NODE = "a" * 64
BLOB = "b" * 32


# ── Підпис ───────────────────────────────────────────────────────────────────


def test_signature_matches_the_published_aws_vector():
    """Вектор `get-vanilla` з набору AWS SigV4 — чужа арифметика, не наша.

    Якби підпис рахувався інакше хоч на один байт, збіг 64 шістнадцяткових
    символів був би неможливий. Це та перевірка, яку не обдурить власний код.
    """
    empty = hashlib.sha256(b"").hexdigest()
    authorization = sigv4_authorization(
        method="GET",
        uri="/",
        headers={"Host": "example.amazonaws.com", "X-Amz-Date": "20150830T123600Z"},
        payload_hash=empty,
        access_key="AKIDEXAMPLE",
        secret_key="wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
        amz_date="20150830T123600Z",
        region="us-east-1",
        service="service",
    )
    assert authorization == (
        "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, "
        "SignedHeaders=host;x-amz-date, "
        "Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31"
    )


def test_canonical_request_lowercases_sorts_and_trims():
    creq, signed = canonical_request(
        "put", "/bucket/key", "", {"X-Amz-Date": " 20150830T123600Z ", "Host": "h"}, "HASH"
    )
    assert signed == "host;x-amz-date"
    assert creq.splitlines()[:2] == ["PUT", "/bucket/key"]
    assert "host:h" in creq and "x-amz-date:20150830T123600Z" in creq


# ── Дорога вмикається лише повним набором ────────────────────────────────────


def test_the_road_needs_all_four_values():
    full = SimpleNamespace(
        r2_endpoint="e", r2_bucket="b", r2_access_key="a", r2_secret_key="s"
    )
    assert r2_road(full) == R2Road("e", "b", "a", "s")
    for missing in ("r2_endpoint", "r2_bucket", "r2_access_key", "r2_secret_key"):
        half = SimpleNamespace(**{**vars(full), missing: "  "})
        assert r2_road(half) is None
    assert r2_road(SimpleNamespace()) is None


def test_an_object_name_cannot_walk_out_of_the_bucket():
    assert object_key(NODE, BLOB) == f"{NODE}/{BLOB}"
    for node, blob in (
        ("../../secrets", BLOB),
        ("..", BLOB),
        (NODE, "../../etc/passwd"),
        (NODE, "ZZ" * 32),
        ("", BLOB),
        (NODE, ""),
    ):
        with pytest.raises(ValueError):
            object_key(node, blob)


def test_the_cloud_ceiling_is_the_node_ceiling():
    """Хмара не має брати те, чого не взяв би сам вузол."""
    assert PARK_MAX_BYTES == BLOB_LIMIT_BYTES


# ── PUT / GET / DELETE ───────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_park_signs_the_request_and_carries_only_ciphertext():
    seen: dict = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen["method"] = request.method
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization", "")
        seen["sha"] = request.headers.get("x-amz-content-sha256")
        seen["date"] = request.headers.get("x-amz-date")
        seen["body"] = request.content
        return httpx.Response(200)

    payload = os.urandom(2048)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        ok = await park_object(ROAD, object_key(NODE, BLOB), payload, client=client)

    assert ok is True
    assert seen["method"] == "PUT"
    assert seen["url"] == (
        f"https://acc.r2.cloudflarestorage.com/phantom-blobs/{NODE}/{BLOB}"
    )
    assert seen["sha"] == hashlib.sha256(payload).hexdigest()
    assert seen["body"] == payload
    assert seen["auth"].startswith("AWS4-HMAC-SHA256 Credential=R2_ACCESS_KEY_FOR_TESTS/")
    assert "SignedHeaders=host;x-amz-content-sha256;x-amz-date" in seen["auth"]
    # Секрет підписує, але сам ніколи не їде.
    assert ROAD.secret_key not in seen["auth"]
    assert ROAD.secret_key.encode() not in seen["body"]


@pytest.mark.anyio
async def test_a_refusal_is_not_a_delivery():
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        assert await park_object(ROAD, object_key(NODE, BLOB), b"x", client=client) is False


@pytest.mark.anyio
async def test_an_oversized_blob_never_leaves_the_node():
    async def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover
        raise AssertionError("понад стелю не має їхати в мережу")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        assert await park_object(
            ROAD, object_key(NODE, BLOB), b"x" * (PARK_MAX_BYTES + 1), client=client
        ) is False
        assert await park_object(ROAD, object_key(NODE, BLOB), b"", client=client) is False


@pytest.mark.anyio
async def test_fetch_returns_bytes_or_an_honest_none():
    payload = os.urandom(64)

    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        if request.url.path.endswith(BLOB):
            return httpx.Response(200, content=payload)
        return httpx.Response(404)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        assert await fetch_object(ROAD, object_key(NODE, BLOB), client=client) == payload
        assert await fetch_object(ROAD, object_key(NODE, "c" * 32), client=client) is None


@pytest.mark.anyio
async def test_a_failed_cleanup_is_not_an_error_but_a_lie_is():
    codes = iter((204, 404, 500))

    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "DELETE"
        return httpx.Response(next(codes))

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        key = object_key(NODE, BLOB)
        assert await drop_object(ROAD, key, client=client) is True   # прибрано
        assert await drop_object(ROAD, key, client=client) is True   # вже не було
        assert await drop_object(ROAD, key, client=client) is False  # хмара відмовила


@pytest.mark.anyio
async def test_neither_key_nor_signature_reaches_the_journal(caplog):
    """Журнал читають люди й збирають системи — секрету там бути не може."""
    async def refuse(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, text="SignatureDoesNotMatch")

    async def explode(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(f"немає маршруту до {request.url}")

    with caplog.at_level(logging.DEBUG):
        async with httpx.AsyncClient(transport=httpx.MockTransport(refuse)) as client:
            await park_object(ROAD, object_key(NODE, BLOB), b"x", client=client)
            await fetch_object(ROAD, object_key(NODE, BLOB), client=client)
            await drop_object(ROAD, object_key(NODE, BLOB), client=client)
        async with httpx.AsyncClient(transport=httpx.MockTransport(explode)) as client:
            await park_object(ROAD, object_key(NODE, BLOB), b"x", client=client)
            await fetch_object(ROAD, object_key(NODE, BLOB), client=client)

    assert caplog.text, "мовчазний журнал нічого не доводить"
    assert ROAD.secret_key not in caplog.text
    assert ROAD.access_key not in caplog.text
    assert "AWS4-HMAC-SHA256" not in caplog.text
    assert "Signature=" not in caplog.text


# ── Порядок доріг ────────────────────────────────────────────────────────────


async def _owner_id(session) -> str:
    return (await session.execute(select(User.id))).scalars().first()


async def _queued_blob(session, *, address, peer_node_id, payload):
    """Рядок черги з тими самими звʼязками, що й після справжнього надсилання."""
    from db.models import MessengerConversation
    from messenger.crypto.safety import safety_number

    owner = await _owner_id(session)
    me = KeyStore.generate(one_time_count=2)
    peer_keys = KeyStore.generate(one_time_count=2)
    contact = MessengerContact(
        owner_user_id=owner,
        peer_node_id=peer_node_id,
        display_name="Марта",
        peer_address=address,
        bundle_json="",
        safety_number=safety_number(
            me.identity_ed_public, me.identity_dh_public,
            peer_keys.identity_ed_public, peer_keys.identity_dh_public,
        ),
    )
    session.add(contact)
    await session.flush()
    conversation = MessengerConversation(
        owner_user_id=owner, title="Марта", contact_id=contact.id
    )
    session.add(conversation)
    await session.flush()
    blob_id = new_blob_id()
    digest = store_bytes(blob_id, payload)
    session.add(MessengerBlob(
        blob_id=blob_id, conversation_id=conversation.id, direction="out",
        state="queued", size=len(payload), sha256=digest, peer_node_id=peer_node_id,
    ))
    await session.commit()
    return blob_id, me, contact


@pytest.mark.anyio
async def test_the_cloud_stays_silent_while_the_direct_road_works(
    auth_root_client, monkeypatch
):
    peer_node_id = os.urandom(32).hex()  # два прогони (asyncio/trio) ділять одну базу
    payload = os.urandom(256)
    async with AsyncSessionLocal() as session:
        blob_id, me, contact = await _queued_blob(
            session, address="http://127.0.0.1:9/", peer_node_id=peer_node_id,
            payload=payload,
        )

        async def _direct_ok(address, bid, data, *, from_node_id, client=None):
            return True

        async def _never(*args, **kwargs):  # pragma: no cover
            raise AssertionError("хмара не потрібна, коли пряма дорога жива")

        monkeypatch.setattr(blobs, "push_blob", _direct_ok)
        monkeypatch.setattr(blobs, "r2_road", lambda config: ROAD)
        monkeypatch.setattr(blobs, "park_object", _never)

        assert await flush_blob_queue(session, me.node_id) == 1
        row = await session.get(MessengerBlob, blob_id)
        assert row.state == "sent"

    blob_path(blob_id).unlink()


@pytest.mark.anyio
async def test_a_blob_with_no_address_goes_to_the_cloud(auth_root_client, monkeypatch):
    """Той самий випадок, що раніше висів queued вічно."""
    peer_node_id = os.urandom(32).hex()  # два прогони (asyncio/trio) ділять одну базу
    payload = os.urandom(256)
    parked: dict = {}

    async def _park(road, key, data, *, client=None):
        parked["road"], parked["key"], parked["bytes"] = road, key, data
        return True

    async def _no_direct(*args, **kwargs):  # pragma: no cover
        raise AssertionError("прямої адреси немає — пуш не має навіть пробувати")

    async with AsyncSessionLocal() as session:
        blob_id, me, contact = await _queued_blob(
            session, address=None, peer_node_id=peer_node_id, payload=payload
        )
        monkeypatch.setattr(blobs, "push_blob", _no_direct)
        monkeypatch.setattr(blobs, "r2_road", lambda config: ROAD)
        monkeypatch.setattr(blobs, "park_object", _park)

        # Хмара — не доставка: повернене число рахує лише те, що взяв вузол.
        assert await flush_blob_queue(session, me.node_id) == 0
        row = await session.get(MessengerBlob, blob_id)
        assert row.state == "parked"
        assert row.attempts == 1

    assert parked["key"] == f"{peer_node_id}/{blob_id}"
    assert parked["bytes"] == payload
    blob_path(blob_id).unlink()


@pytest.mark.anyio
async def test_a_dead_direct_road_falls_through_to_the_cloud(
    auth_root_client, monkeypatch
):
    peer_node_id = os.urandom(32).hex()  # два прогони (asyncio/trio) ділять одну базу
    payload = os.urandom(256)
    order: list[str] = []

    async def _direct_fails(address, bid, data, *, from_node_id, client=None):
        order.append("direct")
        return False

    async def _park(road, key, data, *, client=None):
        order.append("cloud")
        return True

    async with AsyncSessionLocal() as session:
        blob_id, me, contact = await _queued_blob(
            session, address="http://127.0.0.1:9/", peer_node_id=peer_node_id,
            payload=payload,
        )
        monkeypatch.setattr(blobs, "push_blob", _direct_fails)
        monkeypatch.setattr(blobs, "r2_road", lambda config: ROAD)
        monkeypatch.setattr(blobs, "park_object", _park)

        await flush_blob_queue(session, me.node_id)
        assert (await session.get(MessengerBlob, blob_id)).state == "parked"

    assert order == ["direct", "cloud"]
    blob_path(blob_id).unlink()


@pytest.mark.anyio
async def test_without_credentials_the_blob_waits_honestly(auth_root_client, monkeypatch):
    """Дороги немає — стан лишається queued, і жодного натяку на доставку."""
    peer_node_id = os.urandom(32).hex()  # два прогони (asyncio/trio) ділять одну базу
    payload = os.urandom(256)

    async def _never(*args, **kwargs):  # pragma: no cover
        raise AssertionError("без креденшелів у мережу не ходять")

    async with AsyncSessionLocal() as session:
        blob_id, me, contact = await _queued_blob(
            session, address=None, peer_node_id=peer_node_id, payload=payload
        )
        monkeypatch.setattr(blobs, "r2_road", lambda config: None)
        monkeypatch.setattr(blobs, "park_object", _never)

        assert await flush_blob_queue(session, me.node_id) == 0
        row = await session.get(MessengerBlob, blob_id)
        assert row.state == "queued"
        assert row.attempts == 0

    blob_path(blob_id).unlink()


@pytest.mark.anyio
async def test_a_parked_blob_still_takes_the_direct_road_when_it_opens(
    auth_root_client, monkeypatch
):
    """Хмара не закриває пряму дорогу: адресат міг не мати креденшелів узагалі.

    І другий раз у бакет той самий блоб не кладеться — за це платять двічі.
    """
    peer_node_id = os.urandom(32).hex()
    payload = os.urandom(256)
    parks = 0

    async def _park(road, key, data, *, client=None):
        nonlocal parks
        parks += 1
        return True

    async def _direct_ok(address, bid, data, *, from_node_id, client=None):
        return True

    async with AsyncSessionLocal() as session:
        blob_id, me, contact = await _queued_blob(
            session, address=None, peer_node_id=peer_node_id, payload=payload
        )
        monkeypatch.setattr(blobs, "r2_road", lambda config: ROAD)
        monkeypatch.setattr(blobs, "park_object", _park)

        async def _no_address(*args, **kwargs):  # pragma: no cover
            raise AssertionError("адреси ще немає")

        monkeypatch.setattr(blobs, "push_blob", _no_address)
        await flush_blob_queue(session, me.node_id)
        assert (await session.get(MessengerBlob, blob_id)).state == "parked"

        # Адресат обізвався — той самий блоб доїжджає прямою дорогою.
        contact.peer_address = "http://127.0.0.1:9/"
        await session.commit()

        monkeypatch.setattr(blobs, "push_blob", _direct_ok)
        assert await flush_blob_queue(session, me.node_id) == 1
        assert (await session.get(MessengerBlob, blob_id)).state == "sent"

    assert parks == 1, "у бакет той самий блоб не кладуть двічі"
    blob_path(blob_id).unlink()


@pytest.mark.anyio
async def test_park_blob_without_a_road_touches_nothing(monkeypatch):
    monkeypatch.setattr(blobs, "r2_road", lambda config: None)

    async def _never(*args, **kwargs):  # pragma: no cover
        raise AssertionError("дороги немає — і запиту бути не може")

    monkeypatch.setattr(blobs, "park_object", _never)
    assert await park_blob(BLOB, b"x", NODE) is False
    # Порожній node_id — теж «дороги немає», а не запит у нікуди.
    assert await park_blob(BLOB, b"x", "", road=ROAD) is False
