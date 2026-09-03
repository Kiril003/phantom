"""Сховок PH5 — остання дорога листа, і єдина, розгорнута за замовчуванням.

ЩО ЦІ ТЕСТИ ДОВОДЯТЬ: що дорогу ВИКЛИКАНО і викликано правильно — адреса
скриньки складена за протоколом телефона (relay_key → msg_tag на сьогоднішню
добу), конверт відчиняється ключем сховка тієї самої пари і несе той самий
JSON, що й скриньки ретранслятора та Supabase; відмови сервера не видаються
за доставку; порядок доріг незмінний; невдалий сховок лишає `deliver()` з
порожнім рядком — рівно як досі.

ЧОГО ВОНИ НЕ ДОВОДЯТЬ: доставки. Зелений тут не означає, що вузол-адресат
зайде у сховок, забере конверт і покаже людині лист, — у цих тестах немає ні
розгорнутого сервера, ні другого вузла, ні коду, який ходить по листи (його
ще не написано). Доставку доведе окремий зонд на двох живих вузлах, не цей
файл.
"""
from __future__ import annotations

import base64
import json
from types import SimpleNamespace

import httpx
import pytest

from messenger.crypto.keys import KeyStore
from messenger.transport import deliver, deliver_via_drop, drop_pair_key, drop_road
from node import peer_relay as pr

STORE = "https://phantom-license.fly.dev"
PAIR_KEY = bytes(range(32))
#: Стала мить, щоб тест і код рахували ту саму добу. Довільна, але одна.
NOW_MS = 1_756_500_000_000


# ── Чи існує дорога ──────────────────────────────────────────────────────────


def test_the_road_needs_both_the_flag_and_the_url():
    assert drop_road(SimpleNamespace(relay_store_enabled=True, relay_store_url=f" {STORE} ")) == STORE
    # Вимкнений прапорець із заповненою адресою — «не ходи», а не «спробуй».
    assert drop_road(SimpleNamespace(relay_store_enabled=False, relay_store_url=STORE)) == ""
    assert drop_road(SimpleNamespace(relay_store_enabled=True, relay_store_url="  ")) == ""


def test_the_pair_key_is_the_same_from_both_ends():
    """Обидва вузли складають ключ із того, що вже мають, не домовляючись.

    Це наріжний камінь дороги: якщо ключі розійдуться, обидва боки чесно
    рахують РІЗНІ адреси скриньок і обидва бачать порожньо — мовчки.
    """
    a = KeyStore.generate(one_time_count=0)
    b = KeyStore.generate(one_time_count=0)
    key_at_a = drop_pair_key(a, b.publish_bundle(with_one_time=False).to_json())
    key_at_b = drop_pair_key(b, a.publish_bundle(with_one_time=False).to_json())
    assert key_at_a and key_at_a == key_at_b
    assert len(key_at_a) == 32


def test_a_broken_bundle_means_no_road_not_a_crash():
    keys = KeyStore.generate(one_time_count=0)
    assert drop_pair_key(keys, "не json") == b""
    assert drop_pair_key(keys, "") == b""


def test_the_pair_key_also_comes_from_a_session_when_there_is_no_bundle():
    """Контакт, заведений із вхідного кадру, bundle не має — лише сесію. Її
    довготривалого ключа для адреси сховка досить, і ключ той самий."""
    from messenger.crypto.session import Session
    from messenger.transport import drop_pair_key_of

    a = KeyStore.generate(one_time_count=2)
    b = KeyStore.generate(one_time_count=2)
    a_side = Session.initiate(a, b.publish_bundle())
    b_side, _ = Session.accept(b, a_side.encrypt("привіт".encode()))
    contact_at_b = SimpleNamespace(bundle_json="", session_blob=b_side.serialize(b).hex())

    from_session = drop_pair_key_of(b, contact_at_b)
    from_bundle = drop_pair_key(a, b.publish_bundle(with_one_time=False).to_json())
    assert from_session and from_session == from_bundle

    # Ні bundle, ні сесії — ключа немає, і це b"", а не виняток.
    assert drop_pair_key_of(b, SimpleNamespace(bundle_json="", session_blob=None)) == b""


# ── Сам похід у сховок ───────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_the_letter_lands_under_the_agreed_address_and_unwraps():
    """Адреса — та, яку адресат складе сам; конверт — той, що він відкриє."""
    seen: dict = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"held_until": "2026-09-14T00:00:00Z"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        ok = await deliver_via_drop(
            STORE, PAIR_KEY, "PEER", b"\x01\x02",
            from_node_id="ME", reply_address="http://дім:8000",
            now_ms=NOW_MS, client=client,
        )

    assert ok is True
    assert seen["url"].endswith("/relay/drop")

    # Рахуємо адресу так, як рахуватиме адресат: ключ сховка з ключа пари,
    # скринька «ME кладе для PEER» на сьогоднішню добу.
    relay_key = pr.relay_key(PAIR_KEY, "ME", "PEER")
    tag = pr.msg_tag(relay_key, "ME", "PEER", pr.epoch_of(NOW_MS))
    assert seen["body"]["tag"] == tag

    blob = base64.b64decode(seen["body"]["blob"])
    # Конверт сталої довжини — лист розчиняється серед листів такої ж ваги.
    assert len(blob) in pr.BLOB_SIZES
    # І відчиняється ключем сховка цієї пари, а всередині — той самий JSON,
    # що їде в скриньку ретранслятора і в Supabase.
    assert json.loads(pr.unwrap(blob, relay_key, tag)) == {
        "frame": "0102",
        "from_node_id": "ME",
        "reply_address": "http://дім:8000",
    }


@pytest.mark.anyio
async def test_a_busy_store_is_not_a_delivery():
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, headers={"Retry-After": "30"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        ok = await deliver_via_drop(
            STORE, PAIR_KEY, "PEER", b"\x01",
            from_node_id="ME", now_ms=NOW_MS, client=client,
        )
    assert ok is False


@pytest.mark.anyio
async def test_an_unreachable_store_is_not_a_delivery():
    async def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        ok = await deliver_via_drop(
            STORE, PAIR_KEY, "PEER", b"\x01",
            from_node_id="ME", now_ms=NOW_MS, client=client,
        )
    assert ok is False


@pytest.mark.anyio
async def test_an_oversized_letter_never_leaves_the_node():
    """Кадр, що не влазить у найбільшу корзину, не має їхати в мережу."""
    async def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover
        raise AssertionError("конверт понад корзину не має їхати в мережу")

    # hex подвоює вагу: 40 000 байтів кадру — це вже понад корзину 69 632.
    frame = b"\x00" * 40_000
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        ok = await deliver_via_drop(
            STORE, PAIR_KEY, "PEER", frame,
            from_node_id="ME", now_ms=NOW_MS, client=client,
        )
    assert ok is False


# ── Порядок доріг ────────────────────────────────────────────────────────────


def _four_roads(monkeypatch, *, direct: bool, relay: bool, supabase: bool, drop: bool) -> list:
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

    async def fake_drop(*args, **kwargs):
        order.append("drop")
        return drop

    import messenger.transport as transport

    monkeypatch.setattr(transport, "deliver_direct", fake_direct)
    monkeypatch.setattr(transport, "deliver_via_relay", fake_relay)
    monkeypatch.setattr(transport, "deliver_via_supabase", fake_supabase)
    monkeypatch.setattr(transport, "deliver_via_drop", fake_drop)
    return order


@pytest.mark.anyio
async def test_the_drop_is_the_last_road(monkeypatch):
    order = _four_roads(monkeypatch, direct=False, relay=False, supabase=False, drop=True)
    ok = await deliver(
        b"\x01", peer_node_id="PEER", from_node_id="ME",
        peer_address="peer.local", relay="relay.local",
        supabase_url="https://sb", supabase_key="k",
        drop_url=STORE, drop_key=PAIR_KEY,
    )
    assert ok == "drop"
    assert order == ["direct", "relay", "supabase", "drop"]


@pytest.mark.anyio
async def test_the_drop_stays_silent_when_the_cloud_delivers(monkeypatch):
    order = _four_roads(monkeypatch, direct=False, relay=False, supabase=True, drop=True)
    ok = await deliver(
        b"\x01", peer_node_id="PEER", from_node_id="ME",
        peer_address="peer.local", relay="relay.local",
        supabase_url="https://sb", supabase_key="k",
        drop_url=STORE, drop_key=PAIR_KEY,
    )
    assert ok == "cloud"
    assert order == ["direct", "relay", "supabase"]


@pytest.mark.anyio
async def test_in_the_shipped_config_the_drop_is_the_only_road(monkeypatch):
    """Живий стан флоту: адреси немає, relay_url порожній, Supabase порожній.

    Досі цей виклик повертав "" одразу — жодної дороги. Тепер лист їде у
    сховок, і людина бачить у стрічці слово «drop», а не мовчання.
    """
    order = _four_roads(monkeypatch, direct=True, relay=True, supabase=True, drop=True)
    ok = await deliver(
        b"\x01", peer_node_id="PEER", from_node_id="ME",
        drop_url=STORE, drop_key=PAIR_KEY,
    )
    assert ok == "drop"
    assert order == ["drop"]


@pytest.mark.anyio
async def test_without_a_pair_key_the_drop_road_does_not_exist(monkeypatch):
    order = _four_roads(monkeypatch, direct=False, relay=False, supabase=False, drop=True)
    ok = await deliver(
        b"\x01", peer_node_id="PEER", from_node_id="ME",
        peer_address="peer.local", relay="relay.local",
        supabase_url="https://sb", supabase_key="k",
        drop_url=STORE, drop_key=b"",
    )
    assert ok == "", "жодна дорога не взяла — назвати нічого"
    assert order == ["direct", "relay", "supabase"]


@pytest.mark.anyio
async def test_a_failed_drop_leaves_deliver_exactly_as_before(monkeypatch):
    """Межа завдання: сховок не спрацював — поведінка рівно теперішня."""
    order = _four_roads(monkeypatch, direct=False, relay=False, supabase=False, drop=False)
    ok = await deliver(
        b"\x01", peer_node_id="PEER", from_node_id="ME",
        peer_address="peer.local", relay="relay.local",
        supabase_url="https://sb", supabase_key="k",
        drop_url=STORE, drop_key=PAIR_KEY,
    )
    assert ok == ""
    assert order == ["direct", "relay", "supabase", "drop"]
