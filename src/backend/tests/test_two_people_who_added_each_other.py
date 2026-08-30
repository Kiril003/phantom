"""Двоє, що додали одне одного, можуть говорити.

Знайдено 30.08.2026 на двох живих вузлах. Обидва обмінялись запрошеннями — те,
що двоє людей роблять природно, — і **жоден лист не доходив ніколи**, скільки
б повторів не було. Причина в `inbox.accept_frame`:

    if contact is not None and contact.session_blob:
        peer_session = Session.restore(...)
        try:    plaintext = peer_session.decrypt(frame)
        except: raise InboxError(...)          # ← глухий кут

Людина, яка завела наш контакт із бандла, тримає **власну вихідну сесію** й
пише саме нею, тобто надсилає ПОЧАТКОВИЙ кадр X3DH. Наша сесія розібрати його
не може за побудовою: ключі виводили двоє незалежно, храповики не збіглися.

Виміряно:
  * обидва додали одне одного → «тег не зійшовся», лист не доходив ніколи;
  * лише відправник додав отримувача → дійшло за 2 с.

Тобто ламало саме **взаємне** знайомство. Найгірше в цьому — що воно ламало
мовчки: вузол-отримувач повертав `200 {"accepted": true}`, і відправник ставив
листу «надіслано» (це виправлено окремо, див.
`test_inbox_never_claims_what_it_cannot_read`).
"""
from __future__ import annotations

import pytest

from messenger.crypto.keys import KeyStore
from messenger.crypto.session import Session
from messenger.inbox import InboxError, accept_frame
from messenger.blobs import wrap_frame

API = "/api/v1/messenger"


def _plaintext(row):
    """Розпечатане тіло рядка — те, що побачить людина."""
    from api.routes_messenger import _body_of

    return _body_of(row)


async def _owner_id(session) -> str:
    from sqlalchemy import select

    from db.models import User

    return (await session.execute(select(User.id).order_by(User.id))).scalars().first()


@pytest.mark.anyio
async def test_an_initial_frame_is_accepted_even_when_we_already_hold_a_session(
    auth_root_client,
):
    """Головний випадок: у нас ВЖЕ є сесія, а співрозмовник пише своєю.

    Саме тут розмова була неможлива назавжди.
    """
    from db.database import AsyncSessionLocal
    from api.routes_messenger import _keys

    peer = KeyStore.generate(one_time_count=4)

    # Ми додали його з бандла — виникла НАША вихідна сесія.
    added = auth_root_client.post(
        f"{API}/contacts",
        json={
            "display_name": "Той, хто теж нас додав",
            "bundle": peer.publish_bundle().to_dict(),
            "peer_address": "http://127.0.0.1:9",
        },
    )
    assert added.status_code == 201, added.text
    contact = added.json()
    assert contact["session_ready"] is True, "сесія мусить бути, інакше тест ні про що"

    # А він додав нас — і пише СВОЄЮ сесією, тобто початковим кадром.
    ours = _keys()
    theirs = Session.initiate(peer, ours.publish_bundle())
    frame = theirs.encrypt(wrap_frame("text", "я теж тебе додав").encode())

    async with AsyncSessionLocal() as session:
        owner = await _owner_id(session)
        row = await accept_frame(
            session, ours, owner, frame, contact["peer_node_id"], road="direct"
        )
        await session.commit()

    assert row is not None, "початковий кадр мусить перезаснувати сесію, а не впертись у стару"
    # Тіло лежить ЗАПЕЧАТАНИМ: колонка `body` порожня, читає його `_body_of`
    # ключами вузла. Перша версія цього тесту звірялась із `body` і падала —
    # вада була в сторожі, не в коді.
    assert _plaintext(row) == "я теж тебе додав"


@pytest.mark.anyio
async def test_garbage_still_cannot_reset_a_session(auth_root_client):
    """Падіння назад не є послабленням.

    `Session.accept` вимагає справжньої X3DH з нашим бандлом. Якби сесію могло
    скинути будь-що, ми обміняли б одну поломку на дірку.
    """
    from db.database import AsyncSessionLocal
    from api.routes_messenger import _keys

    peer = KeyStore.generate(one_time_count=4)
    added = auth_root_client.post(
        f"{API}/contacts",
        json={
            "display_name": "Знайомий",
            "bundle": peer.publish_bundle().to_dict(),
            "peer_address": "http://127.0.0.1:9",
        },
    )
    peer_node_id = added.json()["peer_node_id"]

    async with AsyncSessionLocal() as session:
        owner = await _owner_id(session)
        with pytest.raises(InboxError):
            await accept_frame(
                session, _keys(), owner, b"\xde" * 200, peer_node_id, road="direct"
            )


@pytest.mark.anyio
async def test_an_ordinary_frame_on_a_live_session_still_works(auth_root_client):
    """Звичайний випадок не зачеплено: сесія жива — кадр іде нею."""
    from db.database import AsyncSessionLocal
    from api.routes_messenger import _keys

    peer = KeyStore.generate(one_time_count=4)
    ours = _keys()
    theirs = Session.initiate(peer, ours.publish_bundle())

    async with AsyncSessionLocal() as session:
        owner = await _owner_id(session)
        first = await accept_frame(
            session, ours, owner, theirs.encrypt(wrap_frame("text", "перший").encode()),
            None, road="direct",
        )
        await session.commit()
        assert first is not None and _plaintext(first) == "перший"

        # Другий кадр іде вже наявною сесією — саме той шлях, який правка
        # не мала зачепити.
        second = await accept_frame(
            session, ours, owner, theirs.encrypt(wrap_frame("text", "другий").encode()),
            first.author_id, road="direct",
        )
        await session.commit()

    assert second is not None and _plaintext(second) == "другий"
