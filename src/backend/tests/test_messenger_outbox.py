"""Те, що летить у мережу, мусить бути шифротекстом — і читатись адресатом."""
from __future__ import annotations

import pytest
from tests.conftest import owner_of

from db.database import AsyncSessionLocal
from db.models import MessengerContact, MessengerConversation, User
from messenger.crypto.keys import KeyStore
from messenger.crypto.session import Session
from messenger.outbox import OutboxError, prepare_frame


async def _linked_conversation(session, owner: str, me: KeyStore, peer: KeyStore):
    """Розмова з живим контактом і зведеною сесією."""
    from messenger.crypto.safety import safety_number

    peer_session = Session.initiate(me, peer.publish_bundle())
    contact = MessengerContact(
        owner_user_id=owner,
        peer_node_id=peer.node_id,
        display_name="Марта",
        bundle_json=peer.publish_bundle().to_json(),
        session_blob=peer_session.serialize(me).hex(),
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
    return conversation


@pytest.mark.anyio
async def test_frame_is_ciphertext_that_the_peer_can_read(auth_root_client):
    me, peer = KeyStore.generate(one_time_count=4), KeyStore.generate(one_time_count=4)
    secret = "буду о шостій"

    async with AsyncSessionLocal() as session:
        owner = owner_of(auth_root_client)
        conversation = await _linked_conversation(session, owner, me, peer)
        out = await prepare_frame(session, me, conversation, secret)

    assert out is not None
    assert secret.encode() not in out.frame
    assert out.peer_node_id == peer.node_id
    # Незвірений контакт так і позначено — транспорт сам вирішить, чи везти.
    assert out.verified is False

    _, plaintext = Session.accept(peer, out.frame)
    assert plaintext.decode() == secret


@pytest.mark.anyio
async def test_conversation_without_a_contact_produces_nothing(auth_root_client):
    me = KeyStore.generate(one_time_count=2)

    async with AsyncSessionLocal() as session:
        owner = owner_of(auth_root_client)
        conversation = MessengerConversation(owner_user_id=owner, title="Нотатки")
        session.add(conversation)
        await session.flush()

        assert await prepare_frame(session, me, conversation, "сам собі") is None


@pytest.mark.anyio
async def test_contact_without_a_session_is_an_explicit_error(auth_root_client):
    me, peer = KeyStore.generate(one_time_count=2), KeyStore.generate(one_time_count=2)

    async with AsyncSessionLocal() as session:
        owner = owner_of(auth_root_client)
        contact = MessengerContact(
            owner_user_id=owner, peer_node_id=peer.node_id, display_name="Хтось",
            bundle_json="", safety_number="0" * 60,
        )
        session.add(contact)
        await session.flush()
        conversation = MessengerConversation(
            owner_user_id=owner, title="Хтось", contact_id=contact.id
        )
        session.add(conversation)
        await session.flush()

        with pytest.raises(OutboxError):
            await prepare_frame(session, me, conversation, "привіт")


@pytest.mark.anyio
async def test_ratchet_moves_so_two_frames_never_share_a_key(auth_root_client):
    me, peer = KeyStore.generate(one_time_count=4), KeyStore.generate(one_time_count=4)

    async with AsyncSessionLocal() as session:
        owner = owner_of(auth_root_client)
        conversation = await _linked_conversation(session, owner, me, peer)
        first = await prepare_frame(session, me, conversation, "однакове")
        second = await prepare_frame(session, me, conversation, "однакове")

    assert first.frame != second.frame
    peer_session, one = Session.accept(peer, first.frame)
    assert one.decode() == "однакове"
    assert peer_session.decrypt(second.frame).decode() == "однакове"


@pytest.mark.anyio
async def test_notes_to_self_are_marked_local_not_sent(auth_root_client):
    """Нотатка собі нікуди не їде — і не має вдавати доставку."""
    chat = auth_root_client.post(
        "/api/v1/messenger/conversations", json={"title": "Нотатки"}
    ).json()

    row = auth_root_client.post(
        f"/api/v1/messenger/conversations/{chat['id']}/messages",
        json={
            "client_id": "local-1",
            "author_id": "me",
            "author_name": "Кирило",
            "body": "нагадати про паспорт",
        },
    ).json()

    assert row["delivery"] == "local"
