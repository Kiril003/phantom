"""Сигналінг дзвінка: що долітає до хаба, а що не має долетіти нікуди.

Медіа тут не перевіряється й перевірятися не може — SRTP їде повз вузол.
Перевіряється рівно те, за що вузол відповідає: чи доносить він сигнал до
власника, чи відсікає чужого і чи не дає завалити себе сміттям.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from api import routes_calls
from db.database import AsyncSessionLocal
from db.models import MessengerContact, User
from messenger.crypto.keys import KeyStore
from messenger.guard import InboxGuard


async def _owner_id() -> str:
    async with AsyncSessionLocal() as session:
        return (
            await session.execute(select(User.id).order_by(User.id))
        ).scalars().first()


async def _make_contact(peer_node_id: str, *, address: str | None) -> str:
    """Контакт кладемо власнику вузла — саме його шукає вхід для чужих сигналів."""
    owner = await _owner_id()
    async with AsyncSessionLocal() as session:
        contact = MessengerContact(
            id=str(uuid.uuid4()),
            owner_user_id=owner,
            peer_node_id=peer_node_id,
            display_name="Марта",
            peer_address=address,
            bundle_json="{}",
            safety_number="1" * 60,
        )
        session.add(contact)
        await session.commit()
        return contact.id


@pytest.fixture
def captured_broadcasts(monkeypatch):
    """Перехоплюємо хаб: живий WS у тесті не потрібен, потрібен факт розсилки.

    Записуємо лише канал дзвінка: на тому ж хабі живе анімація OLED, і її кадри
    інакше змішувалися б із сигналом.
    """
    seen: list[tuple] = []
    original = routes_calls.hub.broadcast

    async def _spy(channel, type_, data, user_id=None, profile_id=None):
        if channel == "call":
            seen.append((channel, type_, data, user_id))
            return
        await original(channel, type_, data, user_id=user_id, profile_id=profile_id)

    monkeypatch.setattr(routes_calls.hub, "broadcast", _spy)
    return seen


@pytest.fixture
def fresh_guard(monkeypatch):
    """Свій лічильник на тест — інакше тести труїли б один одного квотою."""
    guard = InboxGuard(max_per_window=3, frame_limit=routes_calls.CALL_FRAME_LIMIT_BYTES)
    monkeypatch.setattr(routes_calls, "call_guard", guard)
    return guard


@pytest.mark.anyio
async def test_offer_from_a_contact_reaches_the_hub(
    auth_root_client, captured_broadcasts, fresh_guard
):
    peer = KeyStore.generate(one_time_count=2)
    contact_id = await _make_contact(peer.node_id, address="http://127.0.0.1:8001")

    resp = auth_root_client.post(
        "/api/v1/messenger/call/inbound",
        json={
            "kind": "offer",
            "call_id": "c-1",
            "from_node_id": peer.node_id,
            "sdp": "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n",
            "media": "video",
        },
    )

    assert resp.status_code == 200
    assert resp.json()["delivered"] is True

    channel, type_, data, user_id = captured_broadcasts[-1]
    assert (channel, type_) == ("call", "call:offer")
    assert user_id == await _owner_id()
    assert data["call_id"] == "c-1"
    assert data["from_node_id"] == peer.node_id
    assert data["contact_id"] == contact_id
    # Ім'я малює цей вузол зі свого контакту, а не той, хто дзвонить.
    assert data["display_name"] == "Марта"
    assert data["verified"] is False
    assert data["sdp"].startswith("v=0")


@pytest.mark.anyio
async def test_every_stage_travels_the_same_way(
    auth_root_client, captured_broadcasts, fresh_guard
):
    """Відповідь, кандидат і кінець дзвінка їдуть тим самим входом."""
    peer = KeyStore.generate(one_time_count=2)
    await _make_contact(peer.node_id, address=None)

    for kind, extra in (
        ("answer", {"sdp": "v=0\r\n"}),
        ("ice", {"candidate": {"candidate": "candidate:1 1 udp 2 127.0.0.1 5 typ host"}}),
        ("hangup", {"reason": "peer-hangup"}),
    ):
        resp = auth_root_client.post(
            "/api/v1/messenger/call/inbound",
            json={"kind": kind, "call_id": "c-2", "from_node_id": peer.node_id, **extra},
        )
        assert resp.status_code == 200, kind

    assert [t for _, t, _, _ in captured_broadcasts] == [
        "call:answer",
        "call:ice",
        "call:hangup",
    ]
    assert captured_broadcasts[1][2]["candidate"]["candidate"].startswith("candidate:1")
    assert captured_broadcasts[2][2]["reason"] == "peer-hangup"


@pytest.mark.anyio
async def test_a_stranger_may_not_call(auth_root_client, captured_broadcasts, fresh_guard):
    """Того, кого немає в контактах, вузол не пускає навіть подзвонити."""
    stranger = KeyStore.generate(one_time_count=2)

    resp = auth_root_client.post(
        "/api/v1/messenger/call/inbound",
        json={"kind": "offer", "call_id": "c-3", "from_node_id": stranger.node_id, "sdp": "v=0"},
    )

    assert resp.status_code == 403
    assert captured_broadcasts == []


@pytest.mark.anyio
async def test_an_unknown_stage_is_refused(auth_root_client, captured_broadcasts, fresh_guard):
    peer = KeyStore.generate(one_time_count=2)
    await _make_contact(peer.node_id, address=None)

    resp = auth_root_client.post(
        "/api/v1/messenger/call/inbound",
        json={"kind": "record", "call_id": "c-4", "from_node_id": peer.node_id},
    )

    assert resp.status_code == 400
    assert captured_broadcasts == []


@pytest.mark.anyio
async def test_an_oversized_signal_is_cut_off_by_the_guard(
    auth_root_client, captured_broadcasts, fresh_guard
):
    """SDP — це кілобайти. Мегабайт означає, що це вже не сигнал."""
    peer = KeyStore.generate(one_time_count=2)
    await _make_contact(peer.node_id, address=None)

    resp = auth_root_client.post(
        "/api/v1/messenger/call/inbound",
        json={
            "kind": "offer",
            "call_id": "c-5",
            "from_node_id": peer.node_id,
            "sdp": "v" * (routes_calls.CALL_FRAME_LIMIT_BYTES + 1),
        },
    )

    assert resp.status_code == 429
    assert captured_broadcasts == []


@pytest.mark.anyio
async def test_a_flood_of_signals_is_cut_off_by_the_guard(
    auth_root_client, captured_broadcasts, fresh_guard
):
    peer = KeyStore.generate(one_time_count=2)
    await _make_contact(peer.node_id, address=None)
    body = {"kind": "ice", "call_id": "c-6", "from_node_id": peer.node_id}

    codes = [
        auth_root_client.post("/api/v1/messenger/call/inbound", json=body).status_code
        for _ in range(4)
    ]

    # Лічильник фікстури — три кадри у вікні, четвертий уже зайвий.
    assert codes == [200, 200, 200, 429]


@pytest.mark.anyio
async def test_the_guard_runs_before_the_database(
    auth_root_client, captured_broadcasts, fresh_guard
):
    """Сміття від незнайомця не має коштувати нам навіть походу в базу."""
    stranger = KeyStore.generate(one_time_count=2)

    resp = auth_root_client.post(
        "/api/v1/messenger/call/inbound",
        json={
            "kind": "offer",
            "call_id": "c-7",
            "from_node_id": stranger.node_id,
            "sdp": "v" * (routes_calls.CALL_FRAME_LIMIT_BYTES + 1),
        },
    )

    # 429, а не 403: до перевірки контакту справа не дійшла.
    assert resp.status_code == 429


# ── Бік того, хто дзвонить ───────────────────────────────────────────────────


@pytest.fixture
def captured_posts(monkeypatch):
    """Замість справжнього вузла-сусіда — записник. Перевіряємо, ЩО поїхало."""
    sent: list[tuple[str, dict]] = []

    async def _spy(peer_address: str, payload: dict) -> bool:
        sent.append((peer_address, payload))
        return True

    monkeypatch.setattr(routes_calls, "_post_signal", _spy)
    return sent


@pytest.mark.anyio
async def test_offer_goes_to_the_peer_node(auth_root_client, captured_posts):
    peer = KeyStore.generate(one_time_count=2)
    resp = auth_root_client.post(
        "/api/v1/messenger/contacts",
        json={
            "display_name": "Марта",
            "bundle": peer.publish_bundle().to_dict(),
            "peer_address": "http://127.0.0.1:8001",
        },
    )
    assert resp.status_code == 201
    contact_id = resp.json()["id"]

    out = auth_root_client.post(
        "/api/v1/messenger/call/offer",
        json={"call_id": "c-8", "contact_id": contact_id, "sdp": "v=0", "media": "audio"},
    )

    assert out.status_code == 200
    assert out.json() == {"delivered": True, "call_id": "c-8", "detail": ""}

    address, payload = captured_posts[-1]
    assert address == "http://127.0.0.1:8001"
    assert payload["kind"] == "offer"
    assert payload["media"] == "audio"
    # У листі їде НАШ node_id: сусід шукає контакт за тим, хто дзвонить.
    from api.routes_messenger import _keys

    assert payload["from_node_id"] == _keys().node_id


@pytest.mark.anyio
async def test_a_contact_without_an_address_cannot_be_called(auth_root_client, captured_posts):
    """Ретранслятор асинхронний за задумом — дзвінок із нього не збереш."""
    peer = KeyStore.generate(one_time_count=2)
    contact_id = auth_root_client.post(
        "/api/v1/messenger/contacts",
        json={"display_name": "Без адреси", "bundle": peer.publish_bundle().to_dict()},
    ).json()["id"]

    out = auth_root_client.post(
        "/api/v1/messenger/call/offer",
        json={"call_id": "c-9", "contact_id": contact_id, "sdp": "v=0"},
    )

    assert out.status_code == 409
    assert captured_posts == []


@pytest.mark.anyio
async def test_calling_an_unknown_contact_is_refused(auth_root_client, captured_posts):
    out = auth_root_client.post(
        "/api/v1/messenger/call/offer",
        json={"call_id": "c-10", "contact_id": str(uuid.uuid4()), "sdp": "v=0"},
    )

    assert out.status_code == 404
    assert captured_posts == []


@pytest.mark.anyio
async def test_a_node_that_refuses_is_not_reported_as_delivered(auth_root_client, monkeypatch):
    """Галочка «доставлено» означає 200 від сусіда — і нічого іншого."""
    async def _refuse(peer_address: str, payload: dict) -> bool:
        return False

    monkeypatch.setattr(routes_calls, "_post_signal", _refuse)

    peer = KeyStore.generate(one_time_count=2)
    contact_id = auth_root_client.post(
        "/api/v1/messenger/contacts",
        json={
            "display_name": "Офлайн",
            "bundle": peer.publish_bundle().to_dict(),
            "peer_address": "http://127.0.0.1:9",
        },
    ).json()["id"]

    out = auth_root_client.post(
        "/api/v1/messenger/call/offer",
        json={"call_id": "c-11", "contact_id": contact_id, "sdp": "v=0"},
    ).json()

    assert out["delivered"] is False
    assert out["detail"]


@pytest.mark.anyio
async def test_signalling_needs_a_token(unauth_client):
    out = unauth_client.post(
        "/api/v1/messenger/call/offer", json={"call_id": "c-12", "sdp": "v=0"}
    )

    assert out.status_code in (401, 403)
