"""Позначка доїжджає до другої людини — і повторна доставка її не знімає.

Кінцева точка сама по собі дає позначку, видну лише тому, хто поставив. Для
месенджера це майже нічого не варте: реакція існує заради того, щоб її
побачив АВТОР листа.

Тут перевіряється саме дріт: кадр `reaction` приходить у приймальню й
змінює рядок у стрічці отримувача.

Ключова тонкість — по дроту їде **намір** (`on: true/false`), а не дія
(«перемкни»). Кадр може приїхати вдруге: черга повторів везе той самий кадр,
поки не дістане підтвердження. Перемикач на тому боці зняв би позначку, яку
людина ставила один раз, — і виглядало б це так, ніби вона сама передумала.
"""
from __future__ import annotations

import json
from uuid import uuid4

import pytest

from messenger.blobs import SERVICE_TOKEN, wrap_frame
from messenger.crypto.keys import KeyStore
from messenger.crypto.session import Session
from messenger.inbox import accept_frame
from tests.conftest import owner_of

API = "/api/v1/messenger"


def _cid(tag: str) -> str:
    """Унікальний client_id на кожен виклик.

    База в межах процесу одна, а кожен тест біжить двічі — під asyncio і під
    trio. З фіксованим `c_wire_1` другий прохід знаходив чужий рядок і
    `find_by_origin` промахувався; виглядало це дефектом дроту, а було
    зіткненням стендів. Та сама пастка вже коштувала мені години на пошуку.
    """
    return f"{tag}_{uuid4().hex[:8]}"


def _mark_frame(client_id: str, emoji: str, on: bool) -> str:
    return wrap_frame(
        "reaction",
        json.dumps({"origin": client_id, "emoji": emoji, "on": on}, ensure_ascii=False),
        client_id,
    )


async def _letter_from_us(
    client, body: str, client_id: str, peer: KeyStore, monkeypatch
) -> tuple[str, str]:
    """Лист у розмові САМЕ З ЦИМ співрозмовником.

    Транспорт підмінено НАВМИСНО. Співрозмовник за адресою 127.0.0.1:9 не
    відповідає, тож справжня доставка лишила б лист у черзі вузла — а черга
    одна на весь процес. `test_a_delete_for_an_offline_peer_waits_in_the_queue`
    гасить свій вузол і перевіряє, скільки кадрів вивезла смуга повторів; мої
    вісім листів давали йому `assert 9 == 1`. Тест падав у чужому файлі, а
    причина сиділа тут — саме тому прибирати за собою в спільній черзі
    обов'язково.

    Перша версія створювала розмову без контакту — і кадр реакції приходив у
    власну розмову незнайомця, де листа немає. Позначка не знаходила цілі, і
    виглядало це дефектом коду. Насправді реакція має сенс лише від того, з
    ким ти в розмові, і тест мусить це відтворювати.
    """
    import api.routes_messenger as routes

    async def _sent(frame, **kwargs):
        return "direct"

    monkeypatch.setattr(routes, "deliver", _sent)
    contact = client.post(
        f"{API}/contacts",
        json={
            "display_name": "Оксана",
            "bundle": peer.publish_bundle().to_dict(),
            "peer_address": "http://127.0.0.1:9",
        },
    )
    assert contact.status_code == 201, contact.text
    created = client.post(
        f"{API}/conversations",
        json={"title": "Дріт", "kind": "direct", "contact_id": contact.json()["id"]},
    )
    conversation_id = created.json()["id"]
    sent = client.post(
        f"{API}/conversations/{conversation_id}/messages",
        json={
            "client_id": client_id, "author_id": "me", "author_name": "Кирило",
            "kind": "text", "body": body,
        },
    )
    return conversation_id, sent.json()["id"]


@pytest.mark.anyio
async def test_a_mark_from_the_other_node_lands_on_our_letter(auth_root_client, monkeypatch):
    from api.routes_messenger import _keys
    from db.database import AsyncSessionLocal

    peer = KeyStore.generate(one_time_count=4)
    cid = _cid("c_wire")
    conversation_id, message_id = await _letter_from_us(
        auth_root_client, "лист, який позначать", cid, peer, monkeypatch
    )
    ours = _keys()
    theirs = Session.initiate(peer, ours.publish_bundle())
    frame = theirs.encrypt(_mark_frame(cid, "👍", True).encode())

    owner = owner_of(auth_root_client)
    async with AsyncSessionLocal() as session:
        row = await accept_frame(session, ours, owner, frame, None, road="direct")
        await session.commit()

    # Кадр повертає ТОЙ САМИЙ лист, а не новий рядок: позначка нічого не додає
    # у стрічку, вона міняє наявне.
    assert row is not None and row.id == message_id

    rows = auth_root_client.get(f"{API}/conversations/{conversation_id}/messages").json()
    mine = next(r for r in rows if r["id"] == message_id)
    assert [r["emoji"] for r in mine["reactions"]] == ["👍"]
    # Чужа позначка — не наша: інакше вона підсвітилась би як натиснута нами.
    assert mine["reactions"][0]["mine"] is False


@pytest.mark.anyio
async def test_the_same_frame_twice_does_not_undo_the_mark(auth_root_client, monkeypatch):
    """Найтонше місце: повтор доставки не має скасовувати чужу волю."""
    from api.routes_messenger import _keys
    from db.database import AsyncSessionLocal

    peer = KeyStore.generate(one_time_count=4)
    cid = _cid("c_wire")
    conversation_id, message_id = await _letter_from_us(
        auth_root_client, "лист під повтор", cid, peer, monkeypatch
    )
    ours = _keys()
    theirs = Session.initiate(peer, ours.publish_bundle())
    owner = owner_of(auth_root_client)

    async with AsyncSessionLocal() as session:
        # Другий кадр іде вже НАЯВНОЮ сесією: без `from_node_id` приймальня
        # вважала б його першим і витратила б одноразовий prekey удруге.
        # Маршрут передає туди `payload.from_node_id`, і стенд мусить так само.
        await accept_frame(
            session, ours, owner,
            theirs.encrypt(_mark_frame(cid, "🔥", True).encode()), None, road="direct",
        )
        await session.commit()
        await accept_frame(
            session, ours, owner,
            theirs.encrypt(_mark_frame(cid, "🔥", True).encode()),
            peer.node_id, road="direct",
        )
        await session.commit()

    rows = auth_root_client.get(f"{API}/conversations/{conversation_id}/messages").json()
    mine = next(r for r in rows if r["id"] == message_id)

    assert [r["emoji"] for r in mine["reactions"]] == ["🔥"], (
        "повторний кадр зняв позначку — по дроту їде дія замість наміру"
    )
    assert mine["reactions"][0]["count"] == 1


@pytest.mark.anyio
async def test_an_explicit_off_removes_it(auth_root_client, monkeypatch):
    from api.routes_messenger import _keys
    from db.database import AsyncSessionLocal

    peer = KeyStore.generate(one_time_count=4)
    cid = _cid("c_wire")
    conversation_id, message_id = await _letter_from_us(
        auth_root_client, "лист під зняття", cid, peer, monkeypatch
    )
    ours = _keys()
    theirs = Session.initiate(peer, ours.publish_bundle())

    owner = owner_of(auth_root_client)
    async with AsyncSessionLocal() as session:
        await accept_frame(
            session, ours, owner,
            theirs.encrypt(_mark_frame(cid, "❤️", True).encode()), None, road="direct",
        )
        await session.commit()

    # Контроль ПЕРЕД зняттям. Без нього тест зеленів вхолосту: «порожньо»
    # правда і тоді, коли жоден кадр не доїхав. Саме так він і проходив у
    # прогонах із хибним власником, поки сусідній тест червонів.
    midway = auth_root_client.get(f"{API}/conversations/{conversation_id}/messages").json()
    assert [r["emoji"] for r in next(
        m for m in midway if m["id"] == message_id
    )["reactions"]] == ["❤️"], "позначка не стала — зняття нема чого доводити"

    async with AsyncSessionLocal() as session:
        await accept_frame(
            session, ours, owner,
            theirs.encrypt(_mark_frame(cid, "❤️", False).encode()),
            peer.node_id, road="direct",
        )
        await session.commit()

    rows = auth_root_client.get(f"{API}/conversations/{conversation_id}/messages").json()
    assert next(r for r in rows if r["id"] == message_id)["reactions"] == []


@pytest.mark.anyio
async def test_a_mark_for_a_letter_we_never_had_is_accepted_and_dropped(auth_root_client):
    """Повторювати відправнику нема сенсу: ми його прийняли й виконали.

    Це та сама межа, що в службового `delete` на неіснуючий рядок.
    """
    from api.routes_messenger import _keys
    from db.database import AsyncSessionLocal

    peer = KeyStore.generate(one_time_count=4)
    ours = _keys()
    theirs = Session.initiate(peer, ours.publish_bundle())
    frame = theirs.encrypt(_mark_frame("c_ніколи_не_існував", "👍", True).encode())

    owner = owner_of(auth_root_client)
    async with AsyncSessionLocal() as session:
        row = await accept_frame(session, ours, owner, frame, None, road="direct")
        await session.commit()

    assert row is None


@pytest.mark.anyio
async def test_a_broken_mark_invents_nothing(auth_root_client, monkeypatch):
    from api.routes_messenger import _keys
    from db.database import AsyncSessionLocal

    peer = KeyStore.generate(one_time_count=4)
    cid = _cid("c_wire")
    conversation_id, message_id = await _letter_from_us(
        auth_root_client, "лист під сміття", cid, peer, monkeypatch
    )
    ours = _keys()
    theirs = Session.initiate(peer, ours.publish_bundle())
    # Тіло не JSON: ані листа, ані емодзі вигадувати не можна.
    frame = theirs.encrypt(wrap_frame("reaction", "не json", cid).encode())

    owner = owner_of(auth_root_client)
    async with AsyncSessionLocal() as session:
        row = await accept_frame(session, ours, owner, frame, None, road="direct")
        await session.commit()

    assert row is None
    rows = auth_root_client.get(f"{API}/conversations/{conversation_id}/messages").json()
    assert next(r for r in rows if r["id"] == message_id)["reactions"] == []

    # Контроль ПІСЛЯ. Порожній список нічого не доводить сам по собі — він
    # такий і тоді, коли стенд не здатен покласти позначку взагалі. Тож той
    # самий шлях, але зі справним тілом, мусить спрацювати.
    async with AsyncSessionLocal() as session:
        good = await accept_frame(
            session, ours, owner,
            theirs.encrypt(_mark_frame(cid, "👌", True).encode()),
            peer.node_id, road="direct",
        )
        await session.commit()

    assert good is not None, "стенд не кладе позначку навіть зі справним тілом"
    rows = auth_root_client.get(f"{API}/conversations/{conversation_id}/messages").json()
    assert [r["emoji"] for r in next(
        m for m in rows if m["id"] == message_id
    )["reactions"]] == ["👌"]


def test_the_reaction_frame_is_marked_service_in_the_envelope():
    """Без ознаки стара збірка поклала б у стрічку рядок замість тиші."""
    head = _mark_frame("c_x", "👍", True).partition("\n")[0]

    assert SERVICE_TOKEN in head
