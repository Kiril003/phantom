"""Лист зі скриньки ретранслятора мусить дійти до стрічки власника."""
from __future__ import annotations

import pytest
from sqlalchemy import select

from db.database import AsyncSessionLocal
from db.models import MessengerMessage, User
from messenger.crypto.at_rest import unseal
from messenger.crypto.session import Session
from node.relay_client import _accept_mailbox


@pytest.mark.anyio
async def test_a_letter_from_the_mailbox_lands_in_the_feed(auth_root_client):
    from api.routes_messenger import _keys
    from messenger.crypto.keys import KeyStore

    me = _keys()
    peer = KeyStore.generate(one_time_count=4)
    text = "лист чекав, поки я був поза мережею"
    frame = Session.initiate(peer, me.publish_bundle()).encrypt(text.encode())

    await _accept_mailbox(
        {
            "t": "mailbox",
            "frame": frame.hex(),
            "from_node_id": peer.node_id,
            "reply_address": "http://192.168.1.30:8000",
        }
    )

    async with AsyncSessionLocal() as session:
        row = (
            await session.execute(
                select(MessengerMessage)
                .where(MessengerMessage.author_id == peer.node_id)
                .order_by(MessengerMessage.sent_at.desc())
            )
        ).scalars().first()

    assert row is not None
    assert unseal(me, bytes.fromhex(row.ciphertext), aad=row.id.encode()) == text
    # Дорога записана як «скринька»: лист чекав, поки канал був мертвий, і
    # точка з такого листа не має права вдягати живий бейдж.
    assert row.transport == "mailbox"


@pytest.mark.anyio
async def test_a_broken_letter_does_not_bring_the_link_down(auth_root_client):
    """Чужий зіпсований лист не має рвати зʼєднання з ретранслятором."""
    await _accept_mailbox({"t": "mailbox", "frame": "не шістнадцяткове"})
    await _accept_mailbox({"t": "mailbox", "frame": "00" * 300})
    await _accept_mailbox({"t": "mailbox"})
