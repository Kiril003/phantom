"""Група: один текст — N попарних кадрів, і кожен читається лише своєю сесією.

Перевіряємо рівно те, що обіцяно у V1: конверт із третім токеном, віяр окремим
кадром на кожного, дедуплікацію повтору, чергу для вимкненого вузла і межу в
32 учасники. Прав адміністратора не перевіряємо, бо їх немає.
"""
from __future__ import annotations

import json

import pytest

from tests.conftest import NoStandIdentity
from sqlalchemy import select

from db.database import AsyncSessionLocal
from db.models import (
    MessengerContact,
    MessengerConversation,
    MessengerGroupDelivery,
    MessengerGroupMember,
    MessengerMessage,
    User,
)
from messenger import groups
from messenger.blobs import unwrap_frame, wrap_frame
from messenger.crypto.keys import KeyStore, PublicBundle
from messenger.crypto.session import Session
from messenger.groups import MAX_GROUP_MEMBERS, group_fingerprint
from messenger.inbox import accept_frame

API = "/api/v1/messenger"


async def _owner_id(session, conversation_id: str = "") -> str:
    """Власник саме тієї розмови, з якою працює тест.

    База в межах процесу одна на всі тести, а користувачів у ній кілька —
    брати «першого-ліпшого» означало б шукати контакт у чужому списку.
    """
    if conversation_id:
        conversation = await session.get(MessengerConversation, conversation_id)
        if conversation is not None:
            return conversation.owner_user_id
    # Запасної гілки «перший-ліпший» тут більше немає. Вона мовчки давала
    # ЧУЖОГО власника, і тест падав із «не знайдено» замість того, щоб сказати,
    # що стенд не знає, з чиєї розмови працює. Краще гучна відмова.
    raise NoStandIdentity(
        "не передано conversation_id: власника беруть із розмови або з токена, "
        "а не з першого рядка таблиці User"
    )


def _add_contact(client, keys: KeyStore, name: str, address: str = "http://127.0.0.1:9") -> str:
    response = client.post(
        f"{API}/contacts",
        json={
            "display_name": name,
            "bundle": keys.publish_bundle().to_dict(),
            "peer_address": address,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _capture(monkeypatch, *, ok: bool = True) -> list[tuple[str, bytes]]:
    """Підміняє дорогу: кадри осідають у списку замість того, щоб їхати."""
    carried: list[tuple[str, bytes]] = []

    async def _deliver(
        frame, *, peer_node_id, from_node_id, peer_address="", relay="",
        supabase_url="", supabase_key="", reply_address="", drop_url="", drop_key=b"",
    ):
        carried.append((peer_node_id, frame))
        return ok

    monkeypatch.setattr(groups, "deliver", _deliver)
    return carried


# ── Конверт ──────────────────────────────────────────────────────────────────


def test_the_group_token_rides_as_a_third_token_and_old_frames_still_parse():
    """Третій токен і є вся різниця між груповим кадром і особистим."""
    gid = "a" * 32
    wire = wrap_frame("text", "привіт", "c_1", f"{gid}:7")
    assert wire == f"\x01phantom-kind:text c_1 g={gid}:7\nпривіт"
    assert unwrap_frame(wire) == ("text", "привіт", "c_1", f"{gid}:7")

    # Кадр без origin, але з групою: групу впізнають за префіксом g=, а не за
    # місцем у рядку, тож порожній origin нічого не зсуває.
    invite = wrap_frame("group:invite", "{}", "", f"{gid}:0")
    assert unwrap_frame(invite) == ("group:invite", "{}", "", f"{gid}:0")

    # Старий кадр має ≤2 токени і розбирається як досі — сумісність на дроті.
    assert unwrap_frame(wrap_frame("text", "привіт", "c_1")) == ("text", "привіт", "c_1", "")
    assert unwrap_frame("голий текст") == ("text", "голий текст", "", "")

    # Тіло з переносами лишається цілим і в груповому кадрі.
    body = "перший\nдругий"
    assert unwrap_frame(wrap_frame("file", body, "c_2", f"{gid}:1"))[1] == body


def test_the_fingerprint_does_not_depend_on_the_order_of_the_roster():
    """Відбиток звіряють вголос — він мусить збігтись на всіх вузлах."""
    ids = ["ccc", "aaa", "bbb"]
    assert group_fingerprint(1, ids) == group_fingerprint(1, reversed(ids))
    assert len(group_fingerprint(1, ids)) == 16
    # Епоха входить у відбиток: інакше зміна складу лишалась би невидимою.
    assert group_fingerprint(1, ids) != group_fingerprint(2, ids)


# ── Створення групи і запрошення ─────────────────────────────────────────────


@pytest.mark.anyio
async def test_creating_a_group_hands_out_bundles_without_the_one_time_prekey(
    auth_root_client, monkeypatch
):
    """Один OPK не ділиться між учасниками — другий ініціатор отримав би відмову."""
    carried = _capture(monkeypatch)
    marta = KeyStore.generate(one_time_count=4)
    oleh = KeyStore.generate(one_time_count=4)
    ids = [
        _add_contact(auth_root_client, marta, "Марта"),
        _add_contact(auth_root_client, oleh, "Олег"),
    ]

    created = auth_root_client.post(
        f"{API}/groups", json={"title": "Північний вхід", "contact_ids": ids}
    )
    assert created.status_code == 201, created.text
    group = created.json()
    assert group["member_count"] == 3
    assert len(group["fingerprint"]) == 16
    assert group["own_state"] == "active"
    assert {m["role"] for m in group["members"]} == {"creator", "member"}
    # Жодних прав понад «склад веде творець» тут немає і бути не може.
    assert all(set(m) >= {"node_id", "state", "verified"} for m in group["members"])

    assert len(carried) == 2
    for keys in (marta, oleh):
        frame = next(f for node_id, f in carried if node_id == keys.node_id)
        _peer, plain = Session.accept(keys, frame)
        kind, body, _origin, token = unwrap_frame(plain.decode())
        assert kind == "group:invite"
        assert token == f"{group['group_id']}:0"
        roster = json.loads(body)
        assert roster["g"] == group["group_id"]
        assert len(roster["members"]) == 3
        for member in roster["members"]:
            assert "one_time_prekey" not in member["bundle"]
            assert "one_time_prekey_id" not in member["bundle"]
            # Bundle усе одно перевірюваний — просто на три DH замість чотирьох.
            PublicBundle.from_dict(member["bundle"]).verify(
                expected_node_id=member["id"]
            )


@pytest.mark.anyio
async def test_a_group_above_the_ceiling_is_refused_with_the_reason(
    auth_root_client, monkeypatch
):
    """Стеля в 32 — не кругле число: на 50 одне застрягле повідомлення зʼїдає прохід черги."""
    _capture(monkeypatch)
    ids = [
        _add_contact(auth_root_client, KeyStore.generate(one_time_count=1), f"n{i}")
        for i in range(MAX_GROUP_MEMBERS)
    ]

    too_many = auth_root_client.post(
        f"{API}/groups", json={"title": "Забагато", "contact_ids": ids}
    )
    assert too_many.status_code == 400
    assert str(MAX_GROUP_MEMBERS) in too_many.json()["detail"]

    # Рівно на стелі — проходить: 31 отримувач плюс ми.
    fits = auth_root_client.post(
        f"{API}/groups",
        json={"title": "Рівно стеля", "contact_ids": ids[: MAX_GROUP_MEMBERS - 1]},
    )
    assert fits.status_code == 201, fits.text
    assert fits.json()["member_count"] == MAX_GROUP_MEMBERS


# ── Віяр ─────────────────────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_one_message_becomes_a_separate_frame_for_every_member(
    auth_root_client, monkeypatch
):
    """Кадр кожному свій: храповик зсувається на кожне шифрування."""
    carried = _capture(monkeypatch)
    marta = KeyStore.generate(one_time_count=4)
    oleh = KeyStore.generate(one_time_count=4)
    ids = [
        _add_contact(auth_root_client, marta, "Марта"),
        _add_contact(auth_root_client, oleh, "Олег"),
    ]
    group = auth_root_client.post(
        f"{API}/groups", json={"title": "Віяр", "contact_ids": ids}
    ).json()
    sessions = {}
    for keys in (marta, oleh):
        frame = next(f for node_id, f in carried if node_id == keys.node_id)
        sessions[keys.node_id] = Session.accept(keys, frame)[0]
    carried.clear()

    text = "Зустріч о 19:00 біля північного входу"
    sent = auth_root_client.post(
        f"{API}/conversations/{group['conversation_id']}/messages",
        json={
            "client_id": "c_g1",
            "author_id": "me",
            "author_name": "Кирило",
            "kind": "text",
            "body": text,
        },
    )
    assert sent.status_code == 200, sent.text
    assert sent.json()["delivery"] == "sent"

    assert len(carried) == 2
    frames = {node_id: frame for node_id, frame in carried}
    # Два різні шифротексти з одного тексту — інакше це був би спільний ключ.
    assert frames[marta.node_id] != frames[oleh.node_id]
    for keys in (marta, oleh):
        plain = sessions[keys.node_id].decrypt(frames[keys.node_id]).decode()
        kind, body, origin, token = unwrap_frame(plain)
        assert (kind, body, origin) == ("text", text, "c_g1")
        assert token.startswith(f"{group['group_id']}:")

    async with AsyncSessionLocal() as session:
        rows = (
            await session.execute(
                select(MessengerGroupDelivery)
                .where(MessengerGroupDelivery.message_id == sent.json()["id"])
                .order_by(MessengerGroupDelivery.member_node_id)
            )
        ).scalars().all()
        assert len(rows) == 2
        assert {r.state for r in rows} == {"sent"}
        # Кадр, що доїхав, не має лежати далі — це зайвий ризик.
        assert all(r.outbound_frame is None for r in rows)


@pytest.mark.anyio
async def test_a_dead_node_keeps_its_frame_in_the_queue_until_it_wakes_up(
    auth_root_client, monkeypatch
):
    """Офлайн уже вирішений чергою — груповий кадр іде тією ж смугою."""
    carried = _capture(monkeypatch)
    marta = KeyStore.generate(one_time_count=4)
    oleh = KeyStore.generate(one_time_count=4)
    ids = [
        _add_contact(auth_root_client, marta, "Марта"),
        _add_contact(auth_root_client, oleh, "Олег"),
    ]
    group = auth_root_client.post(
        f"{API}/groups", json={"title": "Черга", "contact_ids": ids}
    ).json()
    sessions = {
        keys.node_id: Session.accept(
            keys, next(f for node_id, f in carried if node_id == keys.node_id)
        )[0]
        for keys in (marta, oleh)
    }

    # Олег вимкнув вузол: його дорога мовчить, Мартина працює.
    async def _half_dead(
        frame, *, peer_node_id, from_node_id, peer_address="", relay="",
        supabase_url="", supabase_key="", reply_address="", drop_url="", drop_key=b"",
    ):
        if peer_node_id == oleh.node_id:
            return False
        carried.append((peer_node_id, frame))
        return True

    monkeypatch.setattr(groups, "deliver", _half_dead)
    carried.clear()
    before = auth_root_client.get(f"{API}/queue/status").json()["group_frames_queued"]

    sent = auth_root_client.post(
        f"{API}/conversations/{group['conversation_id']}/messages",
        json={
            "client_id": "c_off",
            "author_id": "me",
            "author_name": "Кирило",
            "kind": "text",
            "body": "поки тебе не було",
        },
    ).json()
    # Один із двох не взяв — галочки «надіслано» бути не може.
    assert sent["delivery"] == "queued"

    status = auth_root_client.get(f"{API}/queue/status").json()
    assert status["group_frames_queued"] == before + 1

    async with AsyncSessionLocal() as session:
        rows = (
            await session.execute(
                select(MessengerGroupDelivery).where(
                    MessengerGroupDelivery.message_id == sent["id"]
                )
            )
        ).scalars().all()
        by_node = {r.member_node_id: r for r in rows}
        assert by_node[marta.node_id].state == "sent"
        assert by_node[oleh.node_id].state == "queued"
        # Кадр чекає ТОЙ САМИЙ: перешифрувати означало б зрушити храповик удруге.
        waiting = by_node[oleh.node_id].outbound_frame

    # Олег прокинувся.
    carried.clear()
    _capture(monkeypatch)
    flushed = auth_root_client.post(f"{API}/queue/flush").json()
    assert flushed["group_frames"] == before + 1
    assert (
        auth_root_client.get(f"{API}/queue/status").json()["group_frames_queued"] == 0
    )

    async with AsyncSessionLocal() as session:
        row = (
            await session.execute(
                select(MessengerGroupDelivery).where(
                    MessengerGroupDelivery.message_id == sent["id"],
                    MessengerGroupDelivery.member_node_id == oleh.node_id,
                )
            )
        ).scalar_one()
        assert row.state == "sent"
        message = await session.get(MessengerMessage, row.message_id)
        # Тепер узяли всі — тільки тепер це «надіслано».
        assert message.delivery_state == "sent"

    # І кадр, який пролежав у черзі, читається Олеговою сесією як звичайний.
    assert sessions[oleh.node_id].decrypt(bytes.fromhex(waiting)).decode().endswith(
        "поки тебе не було"
    )


# ── Приймання ────────────────────────────────────────────────────────────────


async def _group_with_marta(client, monkeypatch, marta: KeyStore):
    carried = _capture(monkeypatch)
    contact_id = _add_contact(client, marta, "Марта")
    group = client.post(
        f"{API}/groups", json={"title": "Прийом", "contact_ids": [contact_id]}
    ).json()
    frame = next(f for node_id, f in carried if node_id == marta.node_id)
    marta_side = Session.accept(marta, frame)[0]
    return group, marta_side


@pytest.mark.anyio
async def test_a_group_frame_lands_in_the_group_feed_and_never_opens_a_private_one(
    auth_root_client, monkeypatch
):
    marta = KeyStore.generate(one_time_count=4)
    group, marta_side = await _group_with_marta(auth_root_client, monkeypatch, marta)
    gid = group["group_id"]

    text = "я на місці"
    wire = wrap_frame("text", text, "c_m1", f"{gid}:0")
    async with AsyncSessionLocal() as session:
        from api.routes_messenger import _keys

        owner = await _owner_id(session, group["conversation_id"])
        row = await accept_frame(
            session, _keys(), owner, marta_side.encrypt(wire.encode()), marta.node_id
        )
        assert row is not None
        assert row.conversation_id == group["conversation_id"]

        # Особистої розмови з Мартою так і не завелось: груповий кадр не має
        # права матеріалізувати рядок у списку.
        private = (
            await session.execute(
                select(MessengerConversation)
                .join(
                    MessengerContact,
                    MessengerContact.id == MessengerConversation.contact_id,
                )
                .where(
                    MessengerConversation.kind == "dm",
                    MessengerContact.peer_node_id == marta.node_id,
                )
            )
        ).scalars().all()
        assert private == []

    feed = auth_root_client.get(
        f"{API}/conversations/{group['conversation_id']}/messages"
    ).json()
    assert [m["body"] for m in feed] == [text]


@pytest.mark.anyio
async def test_the_same_group_frame_twice_stays_one_row(auth_root_client, monkeypatch):
    """Дедуп тримається на (розмова, client_id) плюс origin у конверті."""
    marta = KeyStore.generate(one_time_count=4)
    group, marta_side = await _group_with_marta(auth_root_client, monkeypatch, marta)
    wire = wrap_frame("text", "двічі", "c_dup", f"{group['group_id']}:0")

    async with AsyncSessionLocal() as session:
        from api.routes_messenger import _keys

        owner = await _owner_id(session, group["conversation_id"])
        keys = _keys()
        first = await accept_frame(
            session, keys, owner, marta_side.encrypt(wire.encode()), marta.node_id
        )
        # Той самий текст із тим самим origin приїхав ще раз — іншою дорогою.
        second = await accept_frame(
            session, keys, owner, marta_side.encrypt(wire.encode()), marta.node_id
        )
        assert second.id == first.id

    feed = auth_root_client.get(
        f"{API}/conversations/{group['conversation_id']}/messages"
    ).json()
    assert len(feed) == 1


@pytest.mark.anyio
async def test_a_frame_about_a_group_we_do_not_know_is_dropped(
    auth_root_client, monkeypatch
):
    """Інакше будь-хто матеріалізував би групу в чужому списку одним текстом."""
    marta = KeyStore.generate(one_time_count=4)
    group, marta_side = await _group_with_marta(auth_root_client, monkeypatch, marta)
    stranger_gid = "f" * 32
    wire = wrap_frame("text", "вітаю в новій групі", "c_x", f"{stranger_gid}:0")

    async with AsyncSessionLocal() as session:
        from api.routes_messenger import _keys

        owner = await _owner_id(session, group["conversation_id"])
        assert (
            await accept_frame(
                session, _keys(), owner, marta_side.encrypt(wire.encode()), marta.node_id
            )
            is None
        )
        rows = (
            await session.execute(
                select(MessengerConversation).where(
                    MessengerConversation.group_id == stranger_gid
                )
            )
        ).scalars().all()
        assert rows == []


@pytest.mark.anyio
async def test_a_frame_from_someone_outside_the_roster_is_dropped(
    auth_root_client, monkeypatch
):
    marta = KeyStore.generate(one_time_count=4)
    group, _marta_side = await _group_with_marta(auth_root_client, monkeypatch, marta)
    stranger = KeyStore.generate(one_time_count=4)

    async with AsyncSessionLocal() as session:
        from api.routes_messenger import _keys

        owner = await _owner_id(session, group["conversation_id"])
        keys = _keys()
        outside = Session.initiate(stranger, keys.publish_bundle(with_one_time=False))
        wire = wrap_frame("text", "а я теж тут", "c_s", f"{group['group_id']}:0")
        assert (
            await accept_frame(
                session, keys, owner, outside.encrypt(wire.encode()), stranger.node_id
            )
            is None
        )

    feed = auth_root_client.get(
        f"{API}/conversations/{group['conversation_id']}/messages"
    ).json()
    assert feed == []


# ── Запрошення ───────────────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_an_invite_never_joins_you_silently(auth_root_client, _root_payload):
    """У списку група зʼявляється, але доки не прийняли — вузол у неї не пише."""
    creator = KeyStore.generate(one_time_count=4)
    identity = auth_root_client.get(f"{API}/identity").json()
    gid = groups.new_group_id()
    roster = {
        "g": gid,
        "name": "Запрошення",
        "epoch": 1,
        "fp": "",
        "members": [
            {
                "id": creator.node_id,
                "name": "Творець",
                "bundle": creator.publish_bundle(with_one_time=False).to_dict(),
                "addr": "http://127.0.0.1:9",
            },
            {
                "id": identity["node_id"],
                "name": "Я",
                "bundle": identity["bundle"],
                "addr": "",
            },
        ],
    }
    wire = wrap_frame(
        "group:invite", json.dumps(roster, separators=(",", ":")), "", f"{gid}:0"
    )

    async with AsyncSessionLocal() as session:
        from api.routes_messenger import _keys

        owner = _root_payload["id"]
        keys = _keys()
        side = Session.initiate(creator, keys.publish_bundle(with_one_time=False))
        # Запрошення нічого не показує в стрічці — воно ВИКОНУЄТЬСЯ.
        assert (
            await accept_frame(
                session, keys, owner, side.encrypt(wire.encode()), creator.node_id
            )
            is None
        )
        conversation = (
            await session.execute(
                select(MessengerConversation).where(
                    MessengerConversation.group_id == gid
                )
            )
        ).scalar_one()
        mine = (
            await session.execute(
                select(MessengerGroupMember).where(
                    MessengerGroupMember.conversation_id == conversation.id,
                    MessengerGroupMember.node_id == keys.node_id,
                )
            )
        ).scalar_one()
        assert mine.state == "pending"
        conversation_id = conversation.id

    detail = auth_root_client.get(f"{API}/groups/{conversation_id}").json()
    assert detail["own_state"] == "pending"
    assert detail["creator_node_id"] == creator.node_id

    # Доки не прийняли — писати в групу вузол відмовляється, і каже чому.
    refused = auth_root_client.post(
        f"{API}/conversations/{conversation_id}/messages",
        json={
            "client_id": "c_early",
            "author_id": "me",
            "author_name": "Кирило",
            "kind": "text",
            "body": "рано",
        },
    )
    assert refused.status_code == 400
    assert "запрошення" in refused.json()["detail"]
    # І в стрічці не лишилось рядка, якого ніхто не отримав.
    assert auth_root_client.get(
        f"{API}/conversations/{conversation_id}/messages"
    ).json() == []

    accepted = auth_root_client.post(f"{API}/groups/{conversation_id}/accept").json()
    assert accepted["own_state"] == "active"


@pytest.mark.anyio
async def test_the_group_refuses_what_wave_one_cannot_actually_deliver(
    auth_root_client, monkeypatch
):
    """Чого немає — того немає: краще 400 з поясненням, ніж тиха напівправда."""
    marta = KeyStore.generate(one_time_count=4)
    group, _marta_side = await _group_with_marta(auth_root_client, monkeypatch, marta)
    conversation_id = group["conversation_id"]

    # Вкладення в групі — хвиля 4. Кадр із ключем поїхав би, а байти — ні.
    attachment = auth_root_client.post(
        f"{API}/conversations/{conversation_id}/messages",
        json={
            "client_id": "c_img",
            "author_id": "me",
            "author_name": "Кирило",
            "kind": "image",
            "body": '{"blob_id":"ff","key":"zz"}',
        },
    )
    assert attachment.status_code == 400
    assert "хвиля 4" in attachment.json()["detail"]
    assert auth_root_client.get(
        f"{API}/conversations/{conversation_id}/messages"
    ).json() == []

    # Видалення для всіх у групі — хвиля 3.
    sent = auth_root_client.post(
        f"{API}/conversations/{conversation_id}/messages",
        json={
            "client_id": "c_del",
            "author_id": "me",
            "author_name": "Кирило",
            "kind": "text",
            "body": "це можна",
        },
    )
    assert sent.status_code == 200
    everyone = auth_root_client.delete(
        f"{API}/conversations/{conversation_id}/messages/{sent.json()['id']}"
        "?for_everyone=true"
    )
    assert everyone.status_code == 400
    assert "хвиля 3" in everyone.json()["detail"]

    # А «лише в себе» працює вже зараз — і саме так і кажемо.
    mine = auth_root_client.delete(
        f"{API}/conversations/{conversation_id}/messages/{sent.json()['id']}"
    )
    assert mine.status_code == 200
    assert mine.json()["for_everyone"] is False


@pytest.mark.anyio
async def test_an_invite_that_does_not_list_us_is_dropped(auth_root_client, _root_payload):
    """Склад без нас — запрошення в нікуди, і матеріалізувати його нема сенсу."""
    creator = KeyStore.generate(one_time_count=4)
    other = KeyStore.generate(one_time_count=4)
    gid = groups.new_group_id()
    roster = {
        "g": gid,
        "name": "Чужа група",
        "epoch": 1,
        "fp": "",
        "members": [
            {
                "id": creator.node_id,
                "name": "Творець",
                "bundle": creator.publish_bundle(with_one_time=False).to_dict(),
                "addr": "",
            },
            {
                "id": other.node_id,
                "name": "Хтось",
                "bundle": other.publish_bundle(with_one_time=False).to_dict(),
                "addr": "",
            },
        ],
    }
    wire = wrap_frame(
        "group:invite", json.dumps(roster, separators=(",", ":")), "", f"{gid}:0"
    )

    async with AsyncSessionLocal() as session:
        from api.routes_messenger import _keys

        owner = _root_payload["id"]
        keys = _keys()
        side = Session.initiate(creator, keys.publish_bundle(with_one_time=False))
        assert (
            await accept_frame(
                session, keys, owner, side.encrypt(wire.encode()), creator.node_id
            )
            is None
        )
        rows = (
            await session.execute(
                select(MessengerConversation).where(
                    MessengerConversation.group_id == gid
                )
            )
        ).scalars().all()
        assert rows == []
