"""Фото і файли: ключ їде наскрізно, байти — окремо і незрозумілими.

Головне, що тут доводиться: вузол-одержувач зберігає вкладення, якого НЕ МОЖЕ
прочитати. Не «не читає з ввічливості», а не має чим — ключ ніколи туди не
потрапляв. Решта перевірок захищають цю обіцянку з боків: межа розміру,
відмова незнайомцю, заборона на обхід каталогу і чесний стан черги.
"""
from __future__ import annotations

import hashlib
import os

import pytest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import select

from db.database import AsyncSessionLocal
from db.models import MessengerBlob, MessengerContact, MessengerConversation, User
from messenger import blobs
from messenger.blobs import (
    BLOB_LIMIT_BYTES,
    BlobRejected,
    InboundBlobGuard,
    blob_path,
    flush_blob_queue,
    new_blob_id,
    read_bytes,
    store_bytes,
    unwrap_frame,
    wrap_frame,
)
from messenger.crypto.at_rest import unseal
from messenger.crypto.keys import KeyStore
from messenger.crypto.safety import safety_number
from messenger.crypto.session import Session
from messenger.inbox import accept_frame

#: Найкоротший справжній PNG: сигнатура і порожні чанки. Достатньо, щоб
#: сигнатуру можна було шукати в шифротексті.
PNG = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
    b"\x00\x00\x00\x0cIDATx\x9cc```\x00\x00\x00\x04\x00\x01\xf6\x178U"
    b"\x00\x00\x00\x00IEND\xaeB`\x82"
)


async def _owner_id(session) -> str:
    return (await session.execute(select(User.id))).scalars().first()


def _seal_file(plain: bytes) -> tuple[bytes, bytes, bytes, str]:
    """Робить те, що робить браузер відправника."""
    key, nonce = os.urandom(32), os.urandom(12)
    ct = AESGCM(key).encrypt(nonce, plain, None)
    return key, nonce, ct, hashlib.sha256(ct).hexdigest()


# ── Головне коло ─────────────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_photo_reaches_the_other_node_and_stays_unreadable_there(auth_root_client):
    """A шле фото → B має байти, бачить kind=image, але прочитати не може."""
    kyrylo = KeyStore.generate(one_time_count=4)   # вузол B (одержувач)
    marta = KeyStore.generate(one_time_count=4)    # вузол A (відправник)

    key, nonce, ct, digest = _seal_file(PNG)

    # Шифротекст лягає на диск одержувача рівно так, як його кладе /inbound.
    blob_id = new_blob_id()
    assert store_bytes(blob_id, ct) == digest
    on_disk = read_bytes(blob_id)

    # Ось воно: у того, що зберігає вузол B, немає ані сигнатури PNG,
    # ані жодного спільного шматка з відкритим файлом.
    assert on_disk == ct
    assert b"\x89PNG" not in on_disk
    assert b"IHDR" not in on_disk and b"IEND" not in on_disk

    # Опис із ключем їде В ТІЛІ повідомлення — тобто наскрізним кадром.
    import json

    body = json.dumps({
        "name": "фото.png", "size": len(PNG), "mime": "image/png",
        "sha256": digest, "blob_id": blob_id,
        "key_hex": key.hex(), "nonce_hex": nonce.hex(),
    })

    async with AsyncSessionLocal() as session:
        owner = await _owner_id(session)
        frame = Session.initiate(marta, kyrylo.publish_bundle()).encrypt(
            wrap_frame("image", body).encode()
        )
        # Ключ не має бути видно в кадрі, який їде мережею.
        assert key.hex().encode() not in frame

        row = await accept_frame(session, kyrylo, owner, frame)

        # Тип доїхав разом із кадром, а не був вгаданий вузлом.
        assert row.kind == "image"
        # У базі тіло лежить запечатаним; відкритого body немає.
        assert row.body is None
        opened = json.loads(unseal(kyrylo, bytes.fromhex(row.ciphertext), aad=row.id.encode()))

    assert opened["blob_id"] == blob_id

    # Маючи ключ із тіла — розшифровується і збігається байт у байт.
    assert AESGCM(bytes.fromhex(opened["key_hex"])).decrypt(
        bytes.fromhex(opened["nonce_hex"]), on_disk, None
    ) == PNG

    # Без ключа — ні. Це і є вся суть.
    with pytest.raises(Exception):
        AESGCM(os.urandom(32)).decrypt(nonce, on_disk, None)

    blob_path(blob_id).unlink()


@pytest.mark.anyio
async def test_a_stranger_cannot_drop_bytes_on_the_node(auth_root_client):
    """Приймальня блобів без токена — але не для всіх підряд."""
    response = auth_root_client.post(
        "/api/v1/messenger/files/inbound",
        data={"blob_id": "ab" * 32, "from_node_id": "ff" * 16},
        files={"blob": ("blob", b"hello", "application/octet-stream")},
    )
    assert response.status_code == 403
    assert "відомих" in response.json()["detail"]


@pytest.mark.anyio
async def test_a_known_peer_gets_through_but_an_oversize_blob_does_not(auth_root_client):
    """26 МБ відбиває межа, 1 КБ від того самого вузла — проходить."""
    peer = KeyStore.generate(one_time_count=2)
    me = KeyStore.generate(one_time_count=2)

    async with AsyncSessionLocal() as session:
        owner = await _owner_id(session)
        session.add(MessengerContact(
            owner_user_id=owner,
            peer_node_id=peer.node_id,
            display_name="Марта",
            bundle_json="",
            safety_number=safety_number(
                me.identity_ed_public, me.identity_dh_public,
                peer.identity_ed_public, peer.identity_dh_public,
            ),
        ))
        await session.commit()

    small_id = new_blob_id()
    ok = auth_root_client.post(
        "/api/v1/messenger/files/inbound",
        data={"blob_id": small_id, "from_node_id": peer.node_id},
        files={"blob": ("blob", os.urandom(1024), "application/octet-stream")},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["size"] == 1024
    blob_path(small_id).unlink()

    too_big = auth_root_client.post(
        "/api/v1/messenger/files/inbound",
        data={"blob_id": new_blob_id(), "from_node_id": peer.node_id},
        files={"blob": ("blob", b"\0" * (BLOB_LIMIT_BYTES + 1), "application/octet-stream")},
    )
    assert too_big.status_code == 413


def test_the_guard_counts_size_and_rate():
    guard = InboundBlobGuard(window_s=60.0, max_per_window=3, limit_bytes=1024)

    with pytest.raises(BlobRejected, match="порожній"):
        guard.check("peer", 0, now=0.0)
    with pytest.raises(BlobRejected, match="завелике"):
        guard.check("peer", 1025, now=0.0)

    for i in range(3):
        guard.check("peer", 10, now=float(i))
    with pytest.raises(BlobRejected, match="забагато"):
        guard.check("peer", 10, now=3.0)

    # Інший вузол лічильника сусіда не успадковує.
    guard.check("інший", 10, now=3.0)
    # Мине вікно — знову можна.
    guard.check("peer", 10, now=200.0)


def test_a_blob_id_cannot_walk_out_of_its_directory():
    """Ідентифікатор приходить з мережі і стає іменем файла — саме тут його межа."""
    for evil in ("../../etc/passwd", "..", "/etc/passwd", "abc", "AB" * 32, "zz" * 32, ""):
        with pytest.raises(ValueError):
            blob_path(evil)

    good = new_blob_id()
    assert blob_path(good).parent == blobs.blob_dir()


# ── Офлайн ───────────────────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_a_blob_with_nowhere_to_go_waits_honestly(auth_root_client, monkeypatch):
    """Немає адреси вузла — блоб лежить у черзі, а не вдає доставленим."""
    peer = KeyStore.generate(one_time_count=2)
    me = KeyStore.generate(one_time_count=2)
    blob_id = new_blob_id()
    payload = os.urandom(512)
    digest = store_bytes(blob_id, payload)

    async with AsyncSessionLocal() as session:
        owner = await _owner_id(session)
        contact = MessengerContact(
            owner_user_id=owner,
            peer_node_id=peer.node_id,
            display_name="Марта",
            peer_address=None,        # вузол недосяжний
            bundle_json="",
            safety_number=safety_number(
                me.identity_ed_public, me.identity_dh_public,
                peer.identity_ed_public, peer.identity_dh_public,
            ),
        )
        session.add(contact)
        await session.flush()
        conversation = MessengerConversation(
            owner_user_id=owner, title="Марта", contact_id=contact.id
        )
        session.add(conversation)
        await session.flush()
        session.add(MessengerBlob(
            blob_id=blob_id, conversation_id=conversation.id, direction="out",
            state="queued", size=len(payload), sha256=digest,
            peer_node_id=peer.node_id,
        ))
        await session.commit()

        # Дороги немає — доставляти нічого, і лічильник спроб не псуємо.
        assert await flush_blob_queue(session, me.node_id) == 0
        waiting = await session.get(MessengerBlob, blob_id)
        assert waiting.state == "queued"
        assert waiting.attempts == 0

        # Зʼявилась адреса — той самий блоб доїжджає без повторного шифрування.
        pushed = {}

        async def _ok(address, bid, data, *, from_node_id, client=None):
            pushed["address"], pushed["bytes"] = address, data
            return True

        monkeypatch.setattr(blobs, "push_blob", _ok)
        contact.peer_address = "http://127.0.0.1:9/"
        await session.commit()

        assert await flush_blob_queue(session, me.node_id) == 1
        done = await session.get(MessengerBlob, blob_id)
        assert done.state == "sent"
        assert done.attempts == 1

    # Поїхали саме ті байти, що лежали, — шифротекст, не файл.
    assert pushed["bytes"] == payload
    blob_path(blob_id).unlink()


@pytest.mark.anyio
async def test_missing_bytes_are_reported_not_invented(auth_root_client):
    """Байти зникли з диска — стан 'missing', а не тиха вдавана доставка."""
    peer = KeyStore.generate(one_time_count=2)
    me = KeyStore.generate(one_time_count=2)
    blob_id = new_blob_id()

    async with AsyncSessionLocal() as session:
        owner = await _owner_id(session)
        contact = MessengerContact(
            owner_user_id=owner, peer_node_id=peer.node_id, display_name="Марта",
            peer_address="http://127.0.0.1:9/", bundle_json="",
            safety_number=safety_number(
                me.identity_ed_public, me.identity_dh_public,
                peer.identity_ed_public, peer.identity_dh_public,
            ),
        )
        session.add(contact)
        await session.flush()
        conversation = MessengerConversation(
            owner_user_id=owner, title="Марта", contact_id=contact.id
        )
        session.add(conversation)
        await session.flush()
        session.add(MessengerBlob(
            blob_id=blob_id, conversation_id=conversation.id, direction="out",
            state="queued", size=10, sha256="00" * 32, peer_node_id=peer.node_id,
        ))
        await session.commit()

        assert await flush_blob_queue(session, me.node_id) == 0
        assert (await session.get(MessengerBlob, blob_id)).state == "missing"


# ── Конверт типу ─────────────────────────────────────────────────────────────


def test_the_frame_carries_its_kind_without_breaking_old_text():
    assert unwrap_frame(wrap_frame("image", '{"a":1}')) == ("image", '{"a":1}')
    assert unwrap_frame(wrap_frame("file", "тіло")) == ("file", "тіло")

    # Текст їде як їхав — інакше зведені сесії почали б бачити службовий рядок.
    assert wrap_frame("text", "привіт") == "привіт"
    assert unwrap_frame("привіт") == ("text", "привіт")

    # Незнайомий тип не має права стати чимось, чого ми не вміємо показати.
    assert unwrap_frame("\x01phantom-kind:executable\nrm -rf /")[0] == "text"
