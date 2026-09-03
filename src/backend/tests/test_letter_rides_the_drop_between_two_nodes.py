"""Лист БЕЗ прямої адреси доїжджає через сховок між двома вузлами.

Умову створює САМ тест, а не стенд. Два попередні зонди міряли не те: лист
їхав прямою, бо вузли на одній машині знаходили одне одного, а потім — бо
`POST /conversations` повертав наявну розмову зі справжньою адресою. Тут:

  * два вузли — застосунок (вузол А: його ключі й база) і окремий стор із
    власними ключами та ВЛАСНИМ файлом бази (вузол Б);
  * контакт в обидва боки БЕЗ `peer_address`; локального пошуку в бекенді
    немає, а щоб це не було на слово — пряма, ретранслятор і хмара підмінені
    на функції, які ВАЛЯТЬ тест, щойно їх покличуть;
  * сховок — справжній локальний HTTP-сервер у тесті з контрактом сервера
    (форма адреси, три розміри конверта, рівно 64 різні адреси у вибірці);
  * відправка з А через маршрут → `transport == "drop"`; забір на Б через
    `read_drop_store` → лист у розмові Б, розшифрований, з дорогою «drop».

І окремо: сховок мовчить → лист у черзі, жодного «надіслано», а розмова
каже наперед, що дороги немає.
"""
from __future__ import annotations

import base64
import json
import socket
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

API = "/api/v1/messenger"


# ── Сховок: локальний сервер із контрактом platform-site/server/relay.py ─────


class _Store:
    def __init__(self) -> None:
        self.url = ""
        self.letters: dict[str, tuple[str, bytes]] = {}  # id → (tag, blob)
        self.drops = 0
        self.fetches = 0
        self.burns = 0
        self.fetched_tag_counts: list[int] = []
        self.lock = threading.Lock()


def _handler(store: _Store):
    from node import peer_relay as pr

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args) -> None:  # noqa: D401 — сховок журналу не веде
            pass

        def _reply(self, code: int, payload: dict) -> None:
            body = json.dumps(payload).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self) -> None:  # noqa: N802 — імʼя диктує http.server
            length = int(self.headers.get("Content-Length") or 0)
            try:
                data = json.loads(self.rfile.read(length) or b"{}")
            except ValueError:
                return self._reply(400, {"detail": "не JSON"})
            with store.lock:
                if self.path == "/relay/drop":
                    tag = str(data.get("tag") or "")
                    try:
                        blob = base64.b64decode(str(data.get("blob") or ""), validate=True)
                    except Exception:  # noqa: BLE001
                        blob = b""
                    if not pr.is_tag(tag) or len(blob) not in pr.BLOB_SIZES:
                        return self._reply(400, {"detail": "конверт не за контрактом"})
                    store.drops += 1
                    store.letters[uuid.uuid4().hex] = (tag, blob)
                    return self._reply(200, {"held_until": "2026-09-10T00:00:00Z"})
                if self.path == "/relay/fetch":
                    tags = list(data.get("tags") or [])
                    store.fetches += 1
                    store.fetched_tag_counts.append(len(set(tags)))
                    if len(tags) != pr.FETCH_TAGS or len(set(tags)) != pr.FETCH_TAGS:
                        return self._reply(400, {"detail": "потрібно рівно 64 різні адреси"})
                    wanted = set(tags)
                    blobs = [
                        {"id": i, "tag": t, "blob": base64.b64encode(b).decode()}
                        for i, (t, b) in store.letters.items()
                        if t in wanted
                    ]
                    return self._reply(200, {"blobs": blobs})
                if self.path == "/relay/burn":
                    ids = list(data.get("ids") or [])
                    if not ids:
                        return self._reply(400, {"detail": "порожньо"})
                    burned = sum(1 for i in ids if store.letters.pop(i, None) is not None)
                    store.burns += 1
                    return self._reply(200, {"burned": burned})
            self._reply(404, {"detail": "немає такого шляху"})

    return Handler


@pytest.fixture
def drop_store():
    store = _Store()
    server = ThreadingHTTPServer(("127.0.0.1", 0), _handler(store))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    store.url = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        yield store
    finally:
        server.shutdown()
        server.server_close()


def _closed_port_url() -> str:
    """Адреса, за якою ніхто не слухає: порт узятий і одразу відпущений."""
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    return f"http://127.0.0.1:{port}"


# ── Другий вузол: свої ключі, свій файл бази, свій власник ───────────────────


class _Node:
    def __init__(self, keys, engine, sessions, owner: str) -> None:
        self.keys = keys
        self.engine = engine
        self.sessions = sessions
        self.owner = owner

    async def close(self) -> None:
        await self.engine.dispose()


async def _second_node(tmp_path) -> _Node:
    from db import models, tom_models  # noqa: F401 — реєструє таблиці
    from db.database import Base
    from db.models import User
    from messenger.crypto.keys import KeyStore

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'node_b.db'}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    owner = str(uuid.uuid4())
    async with sessions() as session:
        session.add(
            User(id=owner, username=f"b_{owner[:8]}", role="ROOT", pin_hash="x", preferences_json="{}")
        )
        await session.commit()
    return _Node(KeyStore.generate(one_time_count=2), engine, sessions, owner)


async def _b_adds_a(node: _Node, identity: dict) -> None:
    """Те саме, що робить `POST /contacts`, — але в базі Б і БЕЗ адреси."""
    from db.models import MessengerContact
    from messenger.crypto.keys import PublicBundle
    from messenger.crypto.safety import safety_number
    from messenger.crypto.session import Session

    bundle = PublicBundle.from_dict(identity["bundle"])
    bundle.verify()
    peer_session = Session.initiate(node.keys, bundle, expected_node_id=bundle.node_id)
    async with node.sessions() as session:
        session.add(
            MessengerContact(
                owner_user_id=node.owner,
                peer_node_id=bundle.node_id,
                display_name="Перша людина",
                peer_address=None,
                bundle_json=bundle.to_json(),
                session_blob=peer_session.serialize(node.keys).hex(),
                safety_number=safety_number(
                    node.keys.identity_ed_public,
                    node.keys.identity_dh_public,
                    bundle.identity_ed,
                    bundle.identity_dh,
                ),
            )
        )
        await session.commit()


# ── Умова: лише сховок ───────────────────────────────────────────────────────


def _only_the_drop(monkeypatch, url: str) -> None:
    import messenger.transport as transport
    from config import config

    monkeypatch.setattr(config, "relay_enabled", False)
    monkeypatch.setattr(config, "relay_url", "")
    monkeypatch.setattr(config, "supabase_mailbox_url", "")
    monkeypatch.setattr(config, "supabase_anon_key", "")
    monkeypatch.setattr(config, "messenger_public_address", "")
    monkeypatch.setattr(config, "relay_store_enabled", True)
    monkeypatch.setattr(config, "relay_store_url", url)
    # Чиста памʼять про сховок: цей тест міряє сам.
    monkeypatch.setattr(transport, "_store_last", None)


def _no_other_road(monkeypatch) -> None:
    """Пряма, ретранслятор і хмара ВАЛЯТЬ тест, щойно їх покличуть."""
    import messenger.transport as transport

    async def never(*args, **kwargs):
        raise AssertionError(
            "ця дорога не мала пробуватись: умова тесту — без прямої адреси, "
            "ретранслятора й хмари"
        )

    for name in ("deliver_direct", "deliver_via_relay", "deliver_via_supabase"):
        monkeypatch.setattr(transport, name, never)


def _a_adds_b(client, node: _Node) -> dict:
    contact = client.post(
        f"{API}/contacts",
        json={"display_name": "Друга людина", "bundle": node.keys.publish_bundle().to_dict()},
    )
    assert contact.status_code == 201, contact.text
    assert not contact.json().get("peer_address"), "адреси бути не мусить — це умова"
    return contact.json()


# ── Доказ ────────────────────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_a_letter_without_a_direct_address_rides_the_drop_to_the_other_node(
    auth_root_client, drop_store, monkeypatch, tmp_path
):
    _only_the_drop(monkeypatch, drop_store.url)
    _no_other_road(monkeypatch)

    from api.routes_messenger import _keys
    from db.models import MessengerConversation, MessengerMessage
    from messenger.crypto.at_rest import unseal
    from messenger.crypto.keys import PublicBundle
    from messenger.drop_inbox import read_drop_store
    from messenger.transport import drop_pair_key
    from node import peer_relay as pr

    b = await _second_node(tmp_path)
    try:
        a_keys = _keys()

        # Знайомство взаємне, адреси — ні в кого.
        contact = _a_adds_b(auth_root_client, b)
        identity = auth_root_client.get(f"{API}/identity").json()
        await _b_adds_a(b, identity)

        conversation = auth_root_client.post(
            f"{API}/conversations",
            json={"title": "Без прямої дороги", "kind": "direct", "contact_id": contact["id"]},
        )
        assert conversation.status_code == 201, conversation.text
        # Дорогу названо НАПЕРЕД — і саме сховок, не «немає».
        assert conversation.json()["road_ahead"] == "drop"

        marker = f"лист без прямої дороги {uuid.uuid4().hex[:8]}"
        sent = auth_root_client.post(
            f"{API}/conversations/{conversation.json()['id']}/messages",
            json={
                "client_id": f"c_{uuid.uuid4().hex[:8]}",
                "author_id": "me",
                "author_name": "Перша людина",
                "kind": "text",
                "body": marker,
            },
        )
        assert sent.status_code in (200, 201), sent.text
        assert sent.json()["delivery_state"] == "sent"
        assert sent.json()["transport"] == "drop"

        # Сховок отримав рівно один конверт — під адресою, яку Б складе САМ,
        # зі свого ключа й bundle А, не домовляючись.
        assert drop_store.drops == 1
        pair_at_b = drop_pair_key(b.keys, PublicBundle.from_dict(identity["bundle"]).to_json())
        relay_key = pr.relay_key(pair_at_b, b.keys.node_id, a_keys.node_id)
        expected_tag = pr.msg_tag(
            relay_key, a_keys.node_id, b.keys.node_id, pr.epoch_of(int(time.time() * 1000))
        )
        assert [tag for tag, _ in drop_store.letters.values()] == [expected_tag]

        # Забір на Б.
        async with b.sessions() as session:
            visit = await read_drop_store(session, b.keys, b.owner, store_url=drop_store.url)
            assert (visit.answered, visit.letters, visit.accepted, len(visit.rows)) == (True, 1, 1, 1)
            row = visit.rows[0]
            assert row.transport == "drop"
            assert row.author_id == a_keys.node_id
            assert unseal(b.keys, bytes.fromhex(row.ciphertext), aad=row.id.encode()) == marker
            conversation_b = await session.get(MessengerConversation, row.conversation_id)
            assert conversation_b is not None and conversation_b.owner_user_id == b.owner

        # Вибірка анонімна за формою — 64 різні адреси; забрану копію спалено.
        assert drop_store.fetched_tag_counts == [pr.FETCH_TAGS]
        assert drop_store.burns == 1 and drop_store.letters == {}

        # Другий захід нічого не роздвоює.
        async with b.sessions() as session:
            again = await read_drop_store(session, b.keys, b.owner, store_url=drop_store.url)
            assert (again.letters, again.accepted) == (0, 0)
            rows = (
                await session.execute(
                    select(MessengerMessage).where(
                        MessengerMessage.conversation_id == row.conversation_id
                    )
                )
            ).scalars().all()
            assert len(rows) == 1
    finally:
        await b.close()


@pytest.mark.anyio
async def test_when_the_store_is_silent_the_letter_waits_and_nothing_says_sent(
    auth_root_client, monkeypatch, tmp_path
):
    dead = _closed_port_url()
    _only_the_drop(monkeypatch, dead)
    _no_other_road(monkeypatch)

    from messenger.drop_inbox import read_drop_store

    b = await _second_node(tmp_path)
    try:
        contact = _a_adds_b(auth_root_client, b)
        conversation = auth_root_client.post(
            f"{API}/conversations",
            json={"title": "Сховок мовчить", "kind": "direct", "contact_id": contact["id"]},
        )
        assert conversation.status_code == 201, conversation.text
        # Ще не ходили: конфіг каже «є», спростувати не було чим.
        assert conversation.json()["road_ahead"] == "drop"

        sent = auth_root_client.post(
            f"{API}/conversations/{conversation.json()['id']}/messages",
            json={
                "client_id": f"c_{uuid.uuid4().hex[:8]}",
                "author_id": "me",
                "author_name": "Перша людина",
                "kind": "text",
                "body": "лист у мовчазний сховок",
            },
        )
        assert sent.status_code in (200, 201), sent.text
        assert sent.json()["delivery_state"] == "queued"
        assert sent.json()["transport"] is None

        # Після виміру вузол каже наперед: дороги немає.
        rows = auth_root_client.get(f"{API}/conversations").json()
        mine = [r for r in rows if r["id"] == conversation.json()["id"]]
        assert mine and mine[0]["road_ahead"] == ""

        assert auth_root_client.get(f"{API}/queue/status").json()["queued"] >= 1

        roads = {r["id"]: r for r in auth_root_client.get(f"{API}/roads").json()["roads"]}
        assert roads["drop"]["configured"] is True
        assert roads["drop"]["live"] is False

        # І Б звідти нічого не дістане — захід каже «мовчить», рядків немає.
        identity = auth_root_client.get(f"{API}/identity").json()
        await _b_adds_a(b, identity)
        async with b.sessions() as session:
            visit = await read_drop_store(session, b.keys, b.owner, store_url=dead)
            assert visit.answered is False and visit.rows == []
    finally:
        await b.close()


@pytest.mark.anyio
async def test_a_group_frame_takes_the_drop_when_there_is_no_address(monkeypatch, drop_store):
    """Групи їдуть тим самим `_try_deliver`, і без адреси в нього є сховок."""
    _only_the_drop(monkeypatch, drop_store.url)
    _no_other_road(monkeypatch)

    from messenger.groups import _try_deliver

    road = await _try_deliver("NODE-A", "NODE-B", b"\x01".hex(), "", bytes(range(32)))
    assert road == "drop"
    assert drop_store.drops == 1
    # Без ключа пари сховок — не дорога, і лічильник спроб не псується.
    assert await _try_deliver("NODE-A", "NODE-B", b"\x01".hex(), "", b"") is None
    assert drop_store.drops == 1
