"""Кадр від чужого вузла стає повідомленням лише якщо він справді розшифрувався."""
from __future__ import annotations

import pytest
from sqlalchemy import select

from db.database import AsyncSessionLocal
from db.models import MessengerContact, MessengerConversation, MessengerMessage, User
from messenger.crypto.keys import KeyStore
from messenger.crypto.session import Session
from messenger.inbox import InboxError, accept_frame


async def _owner_id(session) -> str:
    return (await session.execute(select(User.id))).scalars().first()


@pytest.mark.anyio
async def test_first_frame_from_a_stranger_opens_a_conversation(auth_root_client):
    """Незнайомець може написати — але звіреним він від цього не стає."""
    me = KeyStore.generate(one_time_count=4)
    stranger = KeyStore.generate(one_time_count=4)
    frame = Session.initiate(stranger, me.publish_bundle()).encrypt("привіт".encode())

    async with AsyncSessionLocal() as session:
        owner = await _owner_id(session)
        row = await accept_frame(session, me, owner, frame)

        contact = (
            await session.execute(
                select(MessengerContact).where(
                    MessengerContact.peer_node_id == stranger.node_id
                )
            )
        ).scalars().first()
        conversation = await session.get(MessengerConversation, row.conversation_id)

    assert row.transport == "relay"
    assert contact.peer_node_id == stranger.node_id
    assert contact.verified_at is None
    assert conversation.contact_id == contact.id


@pytest.mark.anyio
async def test_delivered_text_is_readable_and_sealed(auth_root_client):
    me = KeyStore.generate(one_time_count=4)
    peer = KeyStore.generate(one_time_count=4)
    secret = "зустрічаємось о 19:00"
    frame = Session.initiate(peer, me.publish_bundle()).encrypt(secret.encode())

    async with AsyncSessionLocal() as session:
        owner = await _owner_id(session)
        row = await accept_frame(session, me, owner, frame)

    from messenger.crypto.at_rest import unseal

    assert row.body is None
    assert secret not in (row.ciphertext or "")
    assert unseal(me, bytes.fromhex(row.ciphertext), aad=row.id.encode()) == secret


@pytest.mark.anyio
async def test_garbage_frame_is_refused(auth_root_client):
    me = KeyStore.generate(one_time_count=4)

    async with AsyncSessionLocal() as session:
        owner = await _owner_id(session)
        with pytest.raises(InboxError):
            await accept_frame(session, me, owner, b"PHM1" + b"\x02" + b"\x00" * 80)


@pytest.mark.anyio
async def test_frame_meant_for_another_node_is_refused(auth_root_client):
    """Кадр, зашифрований не для нас, не має відкриватися."""
    me = KeyStore.generate(one_time_count=4)
    someone_else = KeyStore.generate(one_time_count=4)
    peer = KeyStore.generate(one_time_count=4)
    frame = Session.initiate(peer, someone_else.publish_bundle()).encrypt(b"not yours")

    async with AsyncSessionLocal() as session:
        owner = await _owner_id(session)
        with pytest.raises(InboxError):
            await accept_frame(session, me, owner, frame)


@pytest.mark.anyio
async def test_second_frame_continues_the_same_conversation(auth_root_client):
    me = KeyStore.generate(one_time_count=4)
    peer = KeyStore.generate(one_time_count=4)
    peer_session = Session.initiate(peer, me.publish_bundle())

    async with AsyncSessionLocal() as session:
        owner = await _owner_id(session)
        first = await accept_frame(session, me, owner, peer_session.encrypt("перше".encode()))
        second = await accept_frame(
            session, me, owner, peer_session.encrypt("друге".encode()),
            peer_node_id=peer.node_id,
        )

    assert first.conversation_id == second.conversation_id
    # Порядок тримає лічильник розмови.
    assert second.seq == first.seq + 1


@pytest.mark.anyio
async def test_inbox_route_accepts_a_real_frame(auth_root_client):
    """Чужий вузол доставляє повідомлення без жодного токена — і це правильно."""
    from api.routes_messenger import _keys

    me = _keys()
    peer = KeyStore.generate(one_time_count=4)
    frame = Session.initiate(peer, me.publish_bundle()).encrypt("з іншого вузла".encode())

    resp = auth_root_client.post(
        "/api/v1/messenger/inbox", json={"frame": frame.hex()}
    )

    assert resp.status_code == 200
    assert resp.json()["body"] == "з іншого вузла"
    assert resp.json()["transport"] == "relay"


@pytest.mark.anyio
async def test_inbox_route_refuses_a_forged_frame(unauth_client):
    resp = unauth_client.post(
        "/api/v1/messenger/inbox", json={"frame": ("00" * 200)}
    )

    assert resp.status_code == 400
