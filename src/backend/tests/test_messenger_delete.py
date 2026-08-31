"""Видалення, яке доходить до диска — і до другого вузла.

Панель поставила месенджеру 2/10 за одну річ: «Видалити для всіх учасників»
не породжувало ЖОДНОГО запиту. Повідомлення переживало F5, deleted_at лишався
порожнім, файли лежали на дисках обох вузлів, а delete_bytes() не викликався
ніде в src/. Тут доводиться протилежне, і доводиться по байтах на диску, а не
по вигляду стрічки.

Найважливіше — останній тест: вузол одержувача вимкнений у момент видалення.
Кадр чекає в черзі й доїжджає пізніше. Саме це відрізняє справжнє наскрізне
видалення від напису «видалено» на власному екрані.
"""
from __future__ import annotations

import hashlib
import json
import os

import pytest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import select

from db.database import AsyncSessionLocal
from db.models import (
    MessengerBlob,
    MessengerContact,
    MessengerConversation,
    MessengerMessage,
    User,
)
from tests.conftest import owner_of
from messenger.blobs import blob_path, new_blob_id, store_bytes, wrap_frame
from messenger.crypto.keys import KeyStore
from messenger.crypto.safety import safety_number
from messenger.crypto.session import Session
from messenger.inbox import accept_frame
from messenger.purge import blob_ids_of, purge_conversation_blobs, tombstone

PNG = b"\x89PNG\r\n\x1a\n" + b"phantom-test-bytes" * 4


def _seal_file(plain: bytes) -> tuple[bytes, bytes, bytes, str]:
    """Робить те, що робить браузер відправника."""
    key, nonce = os.urandom(32), os.urandom(12)
    ct = AESGCM(key).encrypt(nonce, plain, None)
    return key, nonce, ct, hashlib.sha256(ct).hexdigest()


def _media_body(blob_id: str, key: bytes, nonce: bytes, digest: str) -> str:
    return json.dumps({
        "name": "фото.png", "size": len(PNG), "mime": "image/png",
        "sha256": digest, "blob_id": blob_id,
        "key_hex": key.hex(), "nonce_hex": nonce.hex(),
    })


async def _stored_blob(session, conversation_id: str, *, direction: str, peer: str = "") -> str:
    """Кладе шифротекст на диск і в облік — рівно як це робить /files/upload."""
    _key, _nonce, ct, digest = _seal_file(PNG)
    blob_id = new_blob_id()
    store_bytes(blob_id, ct)
    session.add(MessengerBlob(
        blob_id=blob_id, conversation_id=conversation_id, direction=direction,
        state="stored", size=len(ct), sha256=digest, peer_node_id=peer or None,
    ))
    return blob_id


# ── Чистка як така ───────────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_deleting_a_message_takes_the_bytes_off_the_disk(auth_root_client):
    """Рядок, облік і файл зникають разом. Інакше це не видалення."""
    from api.routes_messenger import _keys

    keys = _keys()
    key, nonce, ct, digest = _seal_file(PNG)
    blob_id = new_blob_id()
    store_bytes(blob_id, ct)
    assert blob_path(blob_id).exists()

    conv = auth_root_client.post(
        "/api/v1/messenger/conversations", json={"title": "З фото"}
    ).json()

    msg = auth_root_client.post(
        f"/api/v1/messenger/conversations/{conv['id']}/messages",
        json={
            "client_id": "c_photo", "author_id": "me", "author_name": "К",
            "kind": "image", "body": _media_body(blob_id, key, nonce, digest),
        },
    ).json()

    async with AsyncSessionLocal() as session:
        session.add(MessengerBlob(
            blob_id=blob_id, conversation_id=conv["id"], direction="out",
            state="stored", size=len(ct), sha256=digest,
        ))
        await session.commit()

    resp = auth_root_client.delete(
        f"/api/v1/messenger/conversations/{conv['id']}/messages/{msg['id']}"
    )
    assert resp.status_code == 200
    assert resp.json()["blobs"] == 1

    # Ось те, чого не було: байти справді зникли з диска.
    assert not blob_path(blob_id).exists()

    async with AsyncSessionLocal() as session:
        assert await session.get(MessengerBlob, blob_id) is None
        assert await session.get(MessengerMessage, msg["id"]) is None

    # І переживає перезавантаження — саме тут падала попередня спроба.
    feed = auth_root_client.get(
        f"/api/v1/messenger/conversations/{conv['id']}/messages"
    ).json()
    assert [m["id"] for m in feed] == []


@pytest.mark.anyio
async def test_clearing_history_takes_the_attachments_with_it(auth_root_client):
    """43 МБ шифротексту після «Очистити історію» — це не очищена історія."""
    from api.routes_messenger import _keys

    conv = auth_root_client.post(
        "/api/v1/messenger/conversations", json={"title": "Прибирання"}
    ).json()

    key, nonce, ct, digest = _seal_file(PNG)
    referenced = new_blob_id()
    store_bytes(referenced, ct)
    auth_root_client.post(
        f"/api/v1/messenger/conversations/{conv['id']}/messages",
        json={
            "client_id": "c_ph", "author_id": "me", "author_name": "К",
            "kind": "image", "body": _media_body(referenced, key, nonce, digest),
        },
    )

    async with AsyncSessionLocal() as session:
        session.add(MessengerBlob(
            blob_id=referenced, conversation_id=conv["id"], direction="out",
            state="stored", size=len(ct), sha256=digest,
        ))
        # Блоб, який приїхав раніше за повідомлення з ключем: на нього ніхто
        # не посилається, і саме такі лишались лежати назавжди.
        orphan = await _stored_blob(session, conv["id"], direction="in", peer="peer")
        await session.commit()

    assert blob_path(referenced).exists() and blob_path(orphan).exists()

    cleared = auth_root_client.post(
        f"/api/v1/messenger/conversations/{conv['id']}/clear"
    ).json()
    assert cleared["cleared"] == 1
    assert cleared["blobs"] == 2

    assert not blob_path(referenced).exists()
    assert not blob_path(orphan).exists()

    async with AsyncSessionLocal() as session:
        left = (
            await session.execute(
                select(MessengerBlob).where(
                    MessengerBlob.conversation_id == conv["id"]
                )
            )
        ).scalars().all()
    assert left == []


@pytest.mark.anyio
async def test_deleting_a_conversation_takes_its_attachments_too(auth_root_client):
    conv = auth_root_client.post(
        "/api/v1/messenger/conversations", json={"title": "Геть"}
    ).json()

    async with AsyncSessionLocal() as session:
        blob_id = await _stored_blob(session, conv["id"], direction="in", peer="peer")
        await session.commit()

    assert blob_path(blob_id).exists()
    assert auth_root_client.delete(
        f"/api/v1/messenger/conversations/{conv['id']}"
    ).json()["blobs"] == 1
    assert not blob_path(blob_id).exists()

    async with AsyncSessionLocal() as session:
        assert await session.get(MessengerBlob, blob_id) is None


# ── Наскрізне видалення ──────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_a_delete_frame_wipes_the_message_on_the_receiving_node(auth_root_client):
    """Кадр kind='delete' приїхав — і в одержувача зникло тіло, блоб і файл."""
    from api.routes_messenger import _keys

    me = _keys()
    peer = KeyStore.generate(one_time_count=4)
    peer_session = Session.initiate(peer, me.publish_bundle())

    key, nonce, ct, digest = _seal_file(PNG)
    blob_id = new_blob_id()
    store_bytes(blob_id, ct)

    async with AsyncSessionLocal() as session:
        owner = owner_of(auth_root_client)

        # Співрозмовник шле фото — тим самим шляхом, що й у житті.
        frame = peer_session.encrypt(
            wrap_frame("image", _media_body(blob_id, key, nonce, digest), "c_orig").encode()
        )
        row = await accept_frame(session, me, owner, frame)
        assert row is not None
        assert row.kind == "image"
        # Ім'я з вузла-відправника доїхало — саме за ним прийде видалення.
        assert row.client_id == "in_c_orig"

        session.add(MessengerBlob(
            blob_id=blob_id, conversation_id=row.conversation_id, direction="in",
            state="stored", size=len(ct), sha256=digest, peer_node_id=peer.node_id,
        ))
        await session.commit()
        message_id, conversation_id = row.id, row.conversation_id

    assert blob_path(blob_id).exists()

    # А тепер службовий кадр — тією ж сесією, тією ж дорогою.
    async with AsyncSessionLocal() as session:
        owner = owner_of(auth_root_client)
        killed = await accept_frame(
            session, me, owner,
            peer_session.encrypt(wrap_frame("delete", "c_orig").encode()),
            peer_node_id=peer.node_id,
        )
        assert killed is not None
        assert killed.id == message_id
        assert killed.deleted_at is not None
        assert killed.body is None and killed.ciphertext is None

    # Байти зникли з диска одержувача, облік — з бази.
    assert not blob_path(blob_id).exists()
    async with AsyncSessionLocal() as session:
        assert await session.get(MessengerBlob, blob_id) is None
        # Надгробок лишається: рядок є, тіла немає.
        left = await session.get(MessengerMessage, message_id)
        assert left is not None and left.deleted_at is not None

    # Видалене не має тіла і назовні.
    feed = auth_root_client.get(
        f"/api/v1/messenger/conversations/{conversation_id}/messages"
    ).json()
    assert isinstance(feed, list), f"вузол віддав не стрічку: {feed!r}"
    stone = [m for m in feed if m["id"] == message_id][0]
    assert stone["deleted_at"] is not None
    assert stone["body"] is None


@pytest.mark.anyio
async def test_a_delete_frame_for_something_we_never_had_is_still_accepted(auth_root_client):
    """400 у відповідь означав би вічні повтори кадру, який уже зайвий."""
    from api.routes_messenger import _keys

    me = _keys()
    peer = KeyStore.generate(one_time_count=4)
    peer_session = Session.initiate(peer, me.publish_bundle())

    async with AsyncSessionLocal() as session:
        owner = owner_of(auth_root_client)
        # Спершу звичайний кадр, щоб зʼявилась сесія й розмова.
        first = await accept_frame(session, me, owner, peer_session.encrypt(b"hi"))
        assert first is not None

    async with AsyncSessionLocal() as session:
        owner = owner_of(auth_root_client)
        nothing = await accept_frame(
            session, me, owner,
            peer_session.encrypt(wrap_frame("delete", "c_never_existed").encode()),
            peer_node_id=peer.node_id,
        )

    # Прийнято й виконано; показувати нема чого.
    assert nothing is None

    # Головне: сесія вціліла, і наступне повідомлення читається.
    async with AsyncSessionLocal() as session:
        owner = owner_of(auth_root_client)
        after = await accept_frame(
            session, me, owner, peer_session.encrypt("а тепер далі".encode()),
            peer_node_id=peer.node_id,
        )
    assert after is not None


@pytest.mark.anyio
async def test_the_route_carries_the_delete_frame_to_the_other_node(auth_root_client, monkeypatch):
    """«Видалити для всіх» породжує кадр і віддає його транспорту.

    Панель бачила рівно нуль запитів. Тут кадр перехоплюється на транспорті —
    тобто доводиться, що він існує, зашифрований і адресований співрозмовнику.
    """
    from api.routes_messenger import _keys
    import api.routes_messenger as routes

    me = _keys()
    peer = KeyStore.generate(one_time_count=8)

    async with AsyncSessionLocal() as session:
        owner = owner_of(auth_root_client)
        peer_bundle = peer.publish_bundle()
        my_side = Session.initiate(me, peer_bundle, expected_node_id=peer.node_id)
        contact = MessengerContact(
            owner_user_id=owner,
            peer_node_id=peer.node_id,
            display_name="Марта",
            peer_address="127.0.0.1:9",
            bundle_json=peer_bundle.to_json(),
            session_blob=my_side.serialize(me).hex(),
            safety_number=safety_number(
                me.identity_ed_public, me.identity_dh_public,
                peer_bundle.identity_ed, peer_bundle.identity_dh,
            ),
        )
        session.add(contact)
        await session.flush()
        conversation = MessengerConversation(
            owner_user_id=owner, title="Марта", contact_id=contact.id
        )
        session.add(conversation)
        await session.commit()
        conversation_id = conversation.id

    sent: list[bytes] = []

    async def _catch(frame, **kwargs):
        sent.append(frame)
        return True

    monkeypatch.setattr(routes, "deliver", _catch)

    msg = auth_root_client.post(
        f"/api/v1/messenger/conversations/{conversation_id}/messages",
        json={"client_id": "c_bye", "author_id": "me", "author_name": "К", "body": "прощавай"},
    ).json()
    assert len(sent) == 1

    resp = auth_root_client.delete(
        f"/api/v1/messenger/conversations/{conversation_id}/messages/{msg['id']}"
        "?for_everyone=true"
    ).json()

    assert resp["for_everyone"] is True
    assert resp["frame"] == "sent"
    # Кадр існує — і це другий кадр, а не той самий.
    assert len(sent) == 2

    # Він зашифрований: імені цілі в ньому голим оком не видно.
    assert b"c_bye" not in sent[1]

    # А співрозмовник його читає — і бачить саме службове видалення.
    from messenger.blobs import unwrap_frame

    peer_side, plain = Session.accept(peer, sent[0])
    assert unwrap_frame(plain.decode()) == ("text", "прощавай", "c_bye", "")
    kind, body, _origin, _group = unwrap_frame(peer_side.decrypt(sent[1]).decode())
    assert (kind, body) == ("delete", "c_bye")

    # У нас лишився надгробок, а не рядок із текстом.
    feed = auth_root_client.get(
        f"/api/v1/messenger/conversations/{conversation_id}/messages"
    ).json()
    stone = [m for m in feed if m["id"] == msg["id"]][0]
    assert stone["deleted_at"] is not None and stone["body"] is None


@pytest.mark.anyio
async def test_a_delete_for_an_offline_peer_waits_in_the_queue(auth_root_client, monkeypatch):
    """Вузол одержувача погашений. Видалення не скасовується — воно чекає."""
    import api.routes_messenger as routes
    from api.routes_messenger import _keys
    from messenger.redelivery import flush_queue

    me = _keys()
    peer = KeyStore.generate(one_time_count=8)

    async with AsyncSessionLocal() as session:
        owner = owner_of(auth_root_client)
        peer_bundle = peer.publish_bundle()
        my_side = Session.initiate(me, peer_bundle, expected_node_id=peer.node_id)
        contact = MessengerContact(
            owner_user_id=owner, peer_node_id=peer.node_id, display_name="Марта",
            peer_address="127.0.0.1:9", bundle_json=peer_bundle.to_json(),
            session_blob=my_side.serialize(me).hex(),
            safety_number=safety_number(
                me.identity_ed_public, me.identity_dh_public,
                peer_bundle.identity_ed, peer_bundle.identity_dh,
            ),
        )
        session.add(contact)
        await session.flush()
        conversation = MessengerConversation(
            owner_user_id=owner, title="Марта", contact_id=contact.id
        )
        session.add(conversation)
        await session.commit()
        conversation_id = conversation.id

    # Вузол співрозмовника лежить: транспорт чесно каже «ні».
    async def _down(frame, **kwargs):
        return False

    monkeypatch.setattr(routes, "deliver", _down)

    msg = auth_root_client.post(
        f"/api/v1/messenger/conversations/{conversation_id}/messages",
        json={"client_id": "c_off", "author_id": "me", "author_name": "К", "body": "текст"},
    ).json()

    resp = auth_root_client.delete(
        f"/api/v1/messenger/conversations/{conversation_id}/messages/{msg['id']}"
        "?for_everyone=true"
    ).json()

    # Відправник видалив у себе одразу — і чесно каже, що кадр ще в черзі.
    assert resp["frame"] == "queued"
    async with AsyncSessionLocal() as session:
        row = await session.get(MessengerMessage, msg["id"])
        assert row.deleted_at is not None
        assert row.body is None and row.ciphertext is None
        assert row.delivery_state == "queued" and row.outbound_frame

    # Вузол піднявся — смуга повторів довозить саме кадр видалення.
    carried: list[bytes] = []

    async def _up(frame, **kwargs):
        carried.append(frame)
        return True

    import messenger.redelivery as redelivery

    monkeypatch.setattr(redelivery, "deliver", _up)
    async with AsyncSessionLocal() as session:
        delivered = await flush_queue(session, me.node_id)

    # Черга ОДНА на весь процес, тож глобальне число тут — розтяжка для
    # кожного, хто прийде після: досить сусідньому тесту завести контакт із
    # погашеним співрозмовником, і цей рядок падає в чужому файлі. Так уже
    # сталось 31.08 — тест реакцій лишив вісім листів, і тут вийшло `9 == 1`.
    # Питання ж стоїть не «скільки всього вивезли», а «чи вивезли МІЙ кадр».
    assert delivered >= 1
    from messenger.blobs import unwrap_frame

    mine = None
    for frame in carried:
        try:
            _peer_side, plain = Session.accept(peer, frame)
        except Exception:
            # Кадр іншої людини: наш співрозмовник його не відкриє, і це
            # правильно. Пропускаємо, а не оголошуємо дефектом.
            continue
        kind, body, _origin, _group = unwrap_frame(plain.decode())
        if kind == "delete":
            mine = (kind, body)
            break

    assert mine == ("delete", "c_off"), "кадру видалення не було серед вивезених"

    async with AsyncSessionLocal() as session:
        row = await session.get(MessengerMessage, msg["id"])
        assert row.delivery_state == "sent" and row.outbound_frame is None


# ── Чесний стан застряглого вкладення ────────────────────────────────────────


@pytest.mark.anyio
async def test_a_photo_that_never_arrived_does_not_wear_a_sent_tick(auth_root_client):
    """Блоб у черзі — повідомлення НЕ надіслане. Галочка тут була б брехнею."""
    conv = auth_root_client.post(
        "/api/v1/messenger/conversations", json={"title": "Застрягло"}
    ).json()

    key, nonce, ct, digest = _seal_file(PNG)
    blob_id = new_blob_id()
    store_bytes(blob_id, ct)

    msg = auth_root_client.post(
        f"/api/v1/messenger/conversations/{conv['id']}/messages",
        json={
            "client_id": "c_stuck", "author_id": "me", "author_name": "К",
            "kind": "image", "body": _media_body(blob_id, key, nonce, digest),
        },
    ).json()

    async with AsyncSessionLocal() as session:
        session.add(MessengerBlob(
            blob_id=blob_id, conversation_id=conv["id"], direction="out",
            state="queued", size=len(ct), sha256=digest,
        ))
        await session.commit()

    feed = auth_root_client.get(
        f"/api/v1/messenger/conversations/{conv['id']}/messages"
    ).json()
    stuck = [m for m in feed if m["id"] == msg["id"]][0]
    assert stuck["attachment_state"] == "queued"

    # Доїхало — стан змінюється разом із дійсністю, а не сам по собі.
    async with AsyncSessionLocal() as session:
        row = await session.get(MessengerBlob, blob_id)
        row.state = "sent"
        await session.commit()

    feed = auth_root_client.get(
        f"/api/v1/messenger/conversations/{conv['id']}/messages"
    ).json()
    assert [m for m in feed if m["id"] == msg["id"]][0]["attachment_state"] == "sent"

    blob_path(blob_id).unlink()


@pytest.mark.anyio
async def test_a_plain_text_message_has_no_attachment_state(auth_root_client):
    """Немає вкладення — немає й стану перевезення. Порожнє поле чесніше за 'sent'."""
    conv = auth_root_client.post(
        "/api/v1/messenger/conversations", json={"title": "Просто текст"}
    ).json()
    auth_root_client.post(
        f"/api/v1/messenger/conversations/{conv['id']}/messages",
        json={"client_id": "c_txt", "author_id": "me", "author_name": "К", "body": "слово"},
    )
    feed = auth_root_client.get(
        f"/api/v1/messenger/conversations/{conv['id']}/messages"
    ).json()
    assert feed[0]["attachment_state"] is None


# ── Дрібниці, на яких усе тримається ─────────────────────────────────────────


@pytest.mark.anyio
async def test_purge_survives_a_body_it_cannot_open(auth_root_client):
    """Зіпсоване тіло не має валити прибирання решти розмови."""
    from api.routes_messenger import _keys

    conv = auth_root_client.post(
        "/api/v1/messenger/conversations", json={"title": "Зіпсоване"}
    ).json()

    async with AsyncSessionLocal() as session:
        broken = MessengerMessage(
            conversation_id=conv["id"], client_id="c_bad", seq=1,
            author_id="me", author_name="К", kind="image",
            ciphertext="не шістнадцяткове",
        )
        session.add(broken)
        blob_id = await _stored_blob(session, conv["id"], direction="in", peer="peer")
        await session.commit()

        # Тіло не відкривається — але блоб розмови однаково прибирається.
        assert blob_ids_of(_keys(), broken) == []
        dropped = await purge_conversation_blobs(session, _keys(), conv["id"])
        await session.commit()

    assert dropped == 1
    assert not blob_path(blob_id).exists()


@pytest.mark.anyio
async def test_a_tombstone_stops_the_queue(auth_root_client):
    """Везти кадр, який щойно скасували, немає сенсу."""
    from api.routes_messenger import _keys

    conv = auth_root_client.post(
        "/api/v1/messenger/conversations", json={"title": "Черга"}
    ).json()

    async with AsyncSessionLocal() as session:
        row = MessengerMessage(
            conversation_id=conv["id"], client_id="c_q", seq=1,
            author_id="me", author_name="К", kind="text",
            delivery_state="queued", outbound_frame="aabb",
        )
        session.add(row)
        await session.commit()

        await tombstone(session, _keys(), row)
        await session.commit()

        assert row.outbound_frame is None
        assert row.delivery_state == "local"
        assert row.deleted_at is not None
