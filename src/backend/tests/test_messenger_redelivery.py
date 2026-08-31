"""Те, що не доїхало, мусить доїхати пізніше — інакше «нічого не губиться» брехня."""
from __future__ import annotations

import pytest
from tests.conftest import owner_of

from db.database import AsyncSessionLocal
from db.models import MessengerContact, MessengerConversation, MessengerMessage, User
from messenger import redelivery
from messenger.crypto.keys import KeyStore
from messenger.crypto.safety import safety_number
from messenger.crypto.session import Session
from messenger.redelivery import MAX_ATTEMPTS, flush_queue


async def _queued_message(session, owner: str, *, address: str | None, frame: str = "aabb"):
    me, peer = KeyStore.generate(one_time_count=2), KeyStore.generate(one_time_count=2)
    contact = MessengerContact(
        owner_user_id=owner,
        peer_node_id=peer.node_id,
        display_name="Марта",
        peer_address=address,
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
    row = MessengerMessage(
        conversation_id=conversation.id, client_id="q1", seq=1,
        author_id="me", author_name="Кирило",
        delivery_state="queued", outbound_frame=frame,
    )
    session.add(row)
    await session.flush()
    return row


@pytest.mark.anyio
async def test_a_queued_message_is_delivered_on_retry(auth_root_client, monkeypatch):
    carried = {}

    async def _ok(frame, *, peer_node_id, from_node_id, peer_address="", relay="", supabase_url="", supabase_key="", reply_address=""):
        carried['frame'] = frame
        return True

    monkeypatch.setattr(redelivery, "deliver", _ok)

    async with AsyncSessionLocal() as session:
        owner = owner_of(auth_root_client)
        row = await _queued_message(session, owner, address="peer.local")
        row_id = row.id

        assert await flush_queue(session, "MY-NODE") >= 1
        refreshed = await session.get(MessengerMessage, row_id)

    assert refreshed.delivery_state == "sent"
    # Кадр після доставки не зберігаємо — він уже нікому не потрібен.
    assert refreshed.outbound_frame is None
    assert carried['frame'] == bytes.fromhex("aabb")


@pytest.mark.anyio
async def test_a_failed_retry_keeps_the_message_and_the_frame(auth_root_client, monkeypatch):
    async def _fail(frame, *, peer_node_id, from_node_id, peer_address="", relay="", supabase_url="", supabase_key="", reply_address=""):
        return False

    monkeypatch.setattr(redelivery, "deliver", _fail)

    async with AsyncSessionLocal() as session:
        owner = owner_of(auth_root_client)
        row = await _queued_message(session, owner, address="peer.local")
        row_id = row.id

        assert await flush_queue(session, "MY-NODE") == 0
        refreshed = await session.get(MessengerMessage, row_id)

    assert refreshed.delivery_state == "queued"
    assert refreshed.outbound_frame == "aabb"
    assert refreshed.delivery_attempts == 1


@pytest.mark.anyio
async def test_without_an_address_no_attempt_is_wasted(auth_root_client):
    async with AsyncSessionLocal() as session:
        owner = owner_of(auth_root_client)
        row = await _queued_message(session, owner, address=None)
        row_id = row.id

        assert await flush_queue(session, "MY-NODE") == 0
        refreshed = await session.get(MessengerMessage, row_id)

    # Лічильник не псуємо: адреси немає, спроба була б безглуздою.
    assert refreshed.delivery_attempts == 0
    assert refreshed.delivery_state == "queued"


@pytest.mark.anyio
async def test_the_node_stops_hammering_a_wall(auth_root_client, monkeypatch):
    async def _fail(frame, *, peer_node_id, from_node_id, peer_address="", relay="", supabase_url="", supabase_key="", reply_address=""):
        return False

    monkeypatch.setattr(redelivery, "deliver", _fail)

    async with AsyncSessionLocal() as session:
        owner = owner_of(auth_root_client)
        row = await _queued_message(session, owner, address="peer.local")
        row.delivery_attempts = MAX_ATTEMPTS
        await session.flush()
        row_id = row.id

        assert await flush_queue(session, "MY-NODE") == 0
        refreshed = await session.get(MessengerMessage, row_id)

    # Повідомлення не зникло — воно чекає на кращий транспорт.
    assert refreshed.delivery_state == "queued"
    assert refreshed.outbound_frame == "aabb"
    assert refreshed.delivery_attempts == MAX_ATTEMPTS
