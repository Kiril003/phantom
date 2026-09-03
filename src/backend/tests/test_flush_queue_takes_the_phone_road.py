"""Черга вузла ВИКЛИКАЄ дорогу телефона, а не просто вміє її.

Двічі за тиждень підсистема виявлялась написаною, покритою тестами й не
під'єднаною. Тут доводиться саме доступність: лист власника до спареного
телефона, що лежить у черзі, виходить із неї через `phone_letters.send_letter`
і жодного разу не заходить у `deliver` — бо в телефона немає ані bundle, ані
храповика, і кадр для нього нічим зшити.

Мережі тут немає навмисно: сховок підмінено, і саме підміна показує, ЯКУ
дорогу обрано. Живий сховок міряє `test_pair_drop_rides_prod_store.py`.
"""
from __future__ import annotations

import base64
import uuid

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey

from db.database import AsyncSessionLocal
from db.models import (
    MessengerContact,
    MessengerConversation,
    MessengerMessage,
    PairedDevice,
)
from messenger.crypto.at_rest import seal
from messenger.crypto.keys import KeyStore
from node import peer_channel
from node import peer_letter as pl


def _now():
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).replace(tzinfo=None)


@pytest.mark.asyncio
async def test_a_queued_letter_to_a_paired_phone_leaves_by_the_drop(
    auth_root_user, monkeypatch
):
    import messenger.redelivery as rd
    from api.routes_messenger import _keys

    keys = _keys()

    ed = Ed25519PrivateKey.generate()
    dh = X25519PrivateKey.generate()
    ed_pub = ed.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw
    )
    dh_pub = dh.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw
    )
    dh_priv = dh.private_bytes(
        serialization.Encoding.Raw,
        serialization.PrivateFormat.Raw,
        serialization.NoEncryption(),
    )
    peer_id = peer_channel.peer_id_of(ed_pub)

    async with AsyncSessionLocal() as s:
        s.add(
            PairedDevice(
                user_id=auth_root_user.id,
                device_name="Гейтовий Pixel",
                device_model="gate/v1",
                platform="android",
                device_pub_ed25519=base64.b64encode(ed_pub).decode(),
                peer_id=peer_id,
                peer_pub_ed25519=base64.b64encode(ed_pub).decode(),
                peer_dh_x25519=base64.b64encode(dh_pub).decode(),
                capabilities_json="[]",
            )
        )
        contact = MessengerContact(
            owner_user_id=auth_root_user.id,
            peer_node_id=peer_id,
            display_name="Гейтовий Pixel",
            bundle_json="",  # у телефона його немає — і саме тому дорога інша
            safety_number="0" * 12,
            created_at=_now(),
            updated_at=_now(),
        )
        s.add(contact)
        await s.flush()
        conversation = MessengerConversation(
            owner_user_id=auth_root_user.id,
            title="Гейтовий Pixel",
            kind="dm",
            circle="all",
            contact_id=contact.id,
            created_at=_now(),
            updated_at=_now(),
        )
        s.add(conversation)
        await s.flush()
        row = MessengerMessage(
            id=str(uuid.uuid4()),
            conversation_id=conversation.id,
            client_id=f"out_{uuid.uuid4().hex[:12]}",
            seq=0,
            author_id=keys.node_id,
            author_name="вузол",
            kind="text",
            delivery_state="queued",
            sent_at=_now(),
        )
        row.ciphertext = seal(keys, "відповідь вузла", aad=row.id.encode()).hex()
        s.add(row)
        await s.commit()
        row_id, client_id = row.id, row.client_id

    # `flush_queue` бере конфіг усередині себе — правимо сам обʼєкт, а не
    # імʼя в модулі, інакше підміна не доїде до виклику.
    from config import config as app_config

    monkeypatch.setattr(app_config, "relay_store_enabled", True, raising=False)
    monkeypatch.setattr(
        app_config, "relay_store_url", "https://example.invalid", raising=False
    )

    seen: dict = {}

    async def _fake_send(store_url, node_keys, device, body, *, message_id=None, **kw):
        seen["store_url"] = store_url
        seen["peer_id"] = device.peer_id
        seen["body"] = body
        seen["message_id"] = message_id
        # Той самий кадр, що поїхав би в сховок: телефон мусить його відчинити.
        seen["letter"] = pl.sign(
            pl.PeerLetter(
                id=message_id or "x",
                from_id=node_keys.node_id,
                to_id=device.peer_id,
                body=body,
                sent_at_ms=1,
            ),
            __import__("node.identity", fromlist=["load_or_create_key"]).load_or_create_key(),
        )
        return message_id

    async def _explode(*args, **kwargs):  # pragma: no cover — має не викликатись
        raise AssertionError("телефону поїхали дорогою вузла — кадру для неї немає")

    monkeypatch.setattr(rd, "send_letter", _fake_send)
    monkeypatch.setattr(rd, "deliver", _explode)

    async with AsyncSessionLocal() as s:
        delivered = await rd.flush_queue(s, keys.node_id, keys=keys)

    assert delivered == 1, "лист телефону не вийшов із черги"
    assert seen["peer_id"] == peer_id
    assert seen["body"] == "відповідь вузла"
    # Ім'я листа — client_id рядка: телефон дедупить за ним, і без цього той
    # самий лист, повторений другим заходом, ліг би у стрічку двічі.
    assert seen["message_id"] == client_id

    # І кадр справді читається ключем каналу, який телефон вивів САМ.
    at_phone = peer_channel.channel_key(
        dh_priv,
        base64.b64encode(keys.identity_dh_public).decode(),
        peer_id,
        keys.node_id,
    )
    frame, _nonce = pl.seal_envelope(seen["letter"], at_phone)
    opened = pl.open_envelope(frame, at_phone)
    assert opened is not None and opened.body == "відповідь вузла"
    assert pl.verify(opened, keys.identity_ed_public, expected_from=keys.node_id)

    async with AsyncSessionLocal() as s:
        again = await s.get(MessengerMessage, row_id)
        assert again.delivery_state == "sent"
        assert again.delivery_attempts == 1
