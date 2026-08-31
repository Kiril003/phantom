"""Правка листа: живе у вузлі й доїжджає до другої людини.

Поле `edited_at` лежало в схемі з першої міграції і чесно віддавалось у
`MessageOut` — але його не ставив НІХТО: маршруту правки не існувало взагалі.
Жест на екрані був, поле в базі було, посередині порожньо. Це та сама фігура,
що була в реакціях, і той самий порядок лікування: тип на дроті → гілка
приймальні → маршрут → аж потім екран.

Ключове рішення протоколу: по дроту їде **ціле нове тіло**, а не різниця.
Смуга повторів везе кадр, поки не дістане підтвердження, тож застосування
різниці подвоїло б правку. Ціле тіло ідемпотентне за побудовою.
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


def _cid(tag: str = "c_edit") -> str:
    """Унікальний client_id на кожен виклик: база одна, а прогонів два."""
    return f"{tag}_{uuid4().hex[:8]}"


def _letter(client, body: str, client_id: str, peer: KeyStore, monkeypatch) -> tuple[str, str]:
    """Лист у розмові саме з цим співрозмовником.

    Транспорт підмінено навмисно: інакше лист лишався б у черзі вузла, а черга
    одна на процес, і сусідній тест, що її рахує, падав би через нас.
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
        json={"title": "Правка", "kind": "direct", "contact_id": contact.json()["id"]},
    )
    conversation_id = created.json()["id"]
    sent = client.post(
        f"{API}/conversations/{conversation_id}/messages",
        json={
            "client_id": client_id, "author_id": "me", "author_name": "Кирило",
            "kind": "text", "body": body,
        },
    )
    assert sent.status_code == 200, sent.text
    return conversation_id, sent.json()["id"]


def _edit(client, conversation_id: str, message_id: str, body: str):
    return client.patch(
        f"{API}/conversations/{conversation_id}/messages/{message_id}", json={"body": body}
    )


# ── Маршрут ──────────────────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_a_fix_lands_and_is_marked_as_a_fix(auth_root_client, monkeypatch):
    peer = KeyStore.generate(one_time_count=4)
    cid = _cid()
    conversation_id, message_id = _letter(
        auth_root_client, "зустріч о шостій", cid, peer, monkeypatch
    )

    response = _edit(auth_root_client, conversation_id, message_id, "зустріч о сьомій")
    assert response.status_code == 200, response.text

    out = response.json()
    assert out["body"] == "зустріч о сьомій"
    # Позначка часу — це те, що відрізняє правку від того, що людина одразу
    # так написала. Без неї співрозмовник не має способу дізнатись.
    assert out["edited_at"] is not None


@pytest.mark.anyio
async def test_the_fix_survives_a_reread(auth_root_client, monkeypatch):
    """Правка живе у вузлі, а не в памʼяті вкладки."""
    peer = KeyStore.generate(one_time_count=4)
    cid = _cid()
    conversation_id, message_id = _letter(auth_root_client, "перша редакція", cid, peer, monkeypatch)
    _edit(auth_root_client, conversation_id, message_id, "друга редакція")

    rows = auth_root_client.get(f"{API}/conversations/{conversation_id}/messages").json()
    mine = next(r for r in rows if r["id"] == message_id)

    assert mine["body"] == "друга редакція"
    assert mine["edited_at"] is not None


@pytest.mark.anyio
async def test_a_tombstone_cannot_be_rewritten(auth_root_client, monkeypatch):
    """Правка воскресила б вміст листа після того, як його прибрали для всіх."""
    peer = KeyStore.generate(one_time_count=4)
    cid = _cid()
    conversation_id, message_id = _letter(auth_root_client, "лист під знос", cid, peer, monkeypatch)
    auth_root_client.delete(
        f"{API}/conversations/{conversation_id}/messages/{message_id}?for_everyone=true"
    )

    assert _edit(auth_root_client, conversation_id, message_id, "інше").status_code == 409


@pytest.mark.anyio
async def test_an_empty_fix_is_refused(auth_root_client, monkeypatch):
    """Порожня правка — це видалення під виглядом виправлення.

    Небезпечна вона тим, що НЕ лишає надгробка: співрозмовник побачив би, що
    текст зник, і не мав би способу зрозуміти, чи його прибрали, чи він не
    доїхав.
    """
    peer = KeyStore.generate(one_time_count=4)
    cid = _cid()
    conversation_id, message_id = _letter(auth_root_client, "лишається", cid, peer, monkeypatch)

    assert _edit(auth_root_client, conversation_id, message_id, "   ").status_code == 422
    rows = auth_root_client.get(f"{API}/conversations/{conversation_id}/messages").json()
    assert next(r for r in rows if r["id"] == message_id)["body"] == "лишається"


@pytest.mark.anyio
async def test_a_letter_from_the_other_side_is_not_ours_to_rewrite(auth_root_client, monkeypatch):
    """Найгостріша межа маршруту.

    Без неї власник вузла переписував би чужі слова у власній стрічці — і
    виглядало б це так, ніби співрозмовник сам так написав.
    """
    peer = KeyStore.generate(one_time_count=4)
    cid = _cid()
    conversation_id, _ = _letter(auth_root_client, "наш лист", cid, peer, monkeypatch)

    from api.routes_messenger import _keys
    from db.database import AsyncSessionLocal

    ours = _keys()
    theirs = Session.initiate(peer, ours.publish_bundle())
    theirs_cid = _cid("c_theirs")
    frame = theirs.encrypt(wrap_frame("text", "їхній лист", theirs_cid).encode())
    async with AsyncSessionLocal() as session:
        row = await accept_frame(
            session, ours, owner_of(auth_root_client), frame, None, road="direct"
        )
        await session.commit()
        assert row is not None
        theirs_id = row.id

    assert _edit(auth_root_client, conversation_id, theirs_id, "переписано").status_code == 403


# ── Дріт ─────────────────────────────────────────────────────────────────────


def _edit_frame(client_id: str, body: str) -> str:
    return wrap_frame(
        "edit",
        json.dumps({"origin": client_id, "body": body}, ensure_ascii=False),
        client_id,
    )


@pytest.mark.anyio
async def test_a_fix_from_the_other_node_lands_on_their_letter(auth_root_client, monkeypatch):
    from api.routes_messenger import _keys
    from db.database import AsyncSessionLocal

    peer = KeyStore.generate(one_time_count=4)
    cid = _cid()
    conversation_id, _ = _letter(auth_root_client, "наш лист", cid, peer, monkeypatch)

    ours = _keys()
    theirs = Session.initiate(peer, ours.publish_bundle())
    theirs_cid = _cid("c_theirs")
    owner = owner_of(auth_root_client)

    async with AsyncSessionLocal() as session:
        original = await accept_frame(
            session, ours, owner,
            theirs.encrypt(wrap_frame("text", "буду о шостій", theirs_cid).encode()),
            None, road="direct",
        )
        await session.commit()
        assert original is not None
        target_id = original.id

        fixed = await accept_frame(
            session, ours, owner,
            theirs.encrypt(_edit_frame(theirs_cid, "буду о сьомій").encode()),
            peer.node_id, road="direct",
        )
        await session.commit()

    # Кадр повертає ТОЙ САМИЙ рядок, а не новий: інакше в стрічці лежали б
    # обидві редакції й виглядало б, ніби людина написала двічі.
    assert fixed is not None and fixed.id == target_id

    rows = auth_root_client.get(f"{API}/conversations/{conversation_id}/messages").json()
    theirs_row = next(r for r in rows if r["id"] == target_id)
    assert theirs_row["body"] == "буду о сьомій"
    assert theirs_row["edited_at"] is not None
    assert len([r for r in rows if r["id"] == target_id]) == 1


@pytest.mark.anyio
async def test_the_same_fix_twice_changes_nothing(auth_root_client, monkeypatch):
    """По дроту їде ціле тіло, тож повтор доставки безпечний за побудовою."""
    from api.routes_messenger import _keys
    from db.database import AsyncSessionLocal

    peer = KeyStore.generate(one_time_count=4)
    cid = _cid()
    conversation_id, _ = _letter(auth_root_client, "наш лист", cid, peer, monkeypatch)

    ours = _keys()
    theirs = Session.initiate(peer, ours.publish_bundle())
    theirs_cid = _cid("c_theirs")
    owner = owner_of(auth_root_client)

    async with AsyncSessionLocal() as session:
        original = await accept_frame(
            session, ours, owner,
            theirs.encrypt(wrap_frame("text", "перша", theirs_cid).encode()),
            None, road="direct",
        )
        await session.commit()
        target_id = original.id
        for _ in range(2):
            await accept_frame(
                session, ours, owner,
                theirs.encrypt(_edit_frame(theirs_cid, "виправлена").encode()),
                peer.node_id, road="direct",
            )
            await session.commit()

    rows = auth_root_client.get(f"{API}/conversations/{conversation_id}/messages").json()
    assert [r["body"] for r in rows if r["id"] == target_id] == ["виправлена"]


@pytest.mark.anyio
async def test_a_peer_cannot_rewrite_OUR_letter_over_the_wire(auth_root_client, monkeypatch):
    """Дзеркало маршрутної межі, і найважливіше з усього файлу.

    Кадр приїжджає попарною сесією, тобто відправник автентифікований. Але
    автентифікований ≠ уповноважений: без цієї перевірки співрозмовник
    переписав би НАШ власний лист у нашій же стрічці, і виглядало б це так,
    ніби ми самі це написали.
    """
    from api.routes_messenger import _keys
    from db.database import AsyncSessionLocal

    peer = KeyStore.generate(one_time_count=4)
    cid = _cid()
    conversation_id, message_id = _letter(
        auth_root_client, "наші слова", cid, peer, monkeypatch
    )

    ours = _keys()
    theirs = Session.initiate(peer, ours.publish_bundle())

    async with AsyncSessionLocal() as session:
        row = await accept_frame(
            session, ours, owner_of(auth_root_client),
            theirs.encrypt(_edit_frame(cid, "підмінені слова").encode()),
            None, road="direct",
        )
        await session.commit()

    assert row is None, "співрозмовник переписав наш лист"
    rows = auth_root_client.get(f"{API}/conversations/{conversation_id}/messages").json()
    mine = next(r for r in rows if r["id"] == message_id)
    assert mine["body"] == "наші слова"
    assert mine["edited_at"] is None


@pytest.mark.anyio
async def test_an_empty_fix_over_the_wire_does_not_erase(auth_root_client, monkeypatch):
    from api.routes_messenger import _keys
    from db.database import AsyncSessionLocal

    peer = KeyStore.generate(one_time_count=4)
    cid = _cid()
    conversation_id, _ = _letter(auth_root_client, "наш лист", cid, peer, monkeypatch)

    ours = _keys()
    theirs = Session.initiate(peer, ours.publish_bundle())
    theirs_cid = _cid("c_theirs")
    owner = owner_of(auth_root_client)

    async with AsyncSessionLocal() as session:
        original = await accept_frame(
            session, ours, owner,
            theirs.encrypt(wrap_frame("text", "лишається", theirs_cid).encode()),
            None, road="direct",
        )
        await session.commit()
        target_id = original.id
        dropped = await accept_frame(
            session, ours, owner,
            theirs.encrypt(_edit_frame(theirs_cid, "   ").encode()),
            peer.node_id, road="direct",
        )
        await session.commit()

    assert dropped is None
    rows = auth_root_client.get(f"{API}/conversations/{conversation_id}/messages").json()
    assert next(r for r in rows if r["id"] == target_id)["body"] == "лишається"


@pytest.mark.anyio
async def test_a_broken_fix_invents_nothing(auth_root_client, monkeypatch):
    from api.routes_messenger import _keys
    from db.database import AsyncSessionLocal

    peer = KeyStore.generate(one_time_count=4)
    cid = _cid()
    conversation_id, _ = _letter(auth_root_client, "наш лист", cid, peer, monkeypatch)

    ours = _keys()
    theirs = Session.initiate(peer, ours.publish_bundle())
    theirs_cid = _cid("c_theirs")
    owner = owner_of(auth_root_client)

    async with AsyncSessionLocal() as session:
        original = await accept_frame(
            session, ours, owner,
            theirs.encrypt(wrap_frame("text", "цілий", theirs_cid).encode()),
            None, road="direct",
        )
        await session.commit()
        target_id = original.id
        broken = await accept_frame(
            session, ours, owner,
            theirs.encrypt(wrap_frame("edit", "не json", theirs_cid).encode()),
            peer.node_id, road="direct",
        )
        await session.commit()

        # Контроль: без нього «нічого не сталось» доводило б лише те, що стенд
        # не вміє класти правку взагалі.
        good = await accept_frame(
            session, ours, owner,
            theirs.encrypt(_edit_frame(theirs_cid, "справді виправлений").encode()),
            peer.node_id, road="direct",
        )
        await session.commit()

    assert broken is None
    assert good is not None, "стенд не кладе правку навіть зі справним тілом"
    rows = auth_root_client.get(f"{API}/conversations/{conversation_id}/messages").json()
    assert next(r for r in rows if r["id"] == target_id)["body"] == "справді виправлений"


def test_the_edit_frame_is_marked_service_in_the_envelope():
    """Без ознаки стара збірка поклала б у стрічку рядок замість тиші."""
    assert SERVICE_TOKEN in _edit_frame("c_x", "текст").partition("\n")[0]
