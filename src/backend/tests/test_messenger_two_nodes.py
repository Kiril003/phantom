"""Двоє людей листуються: повне коло через приймальню і відправку.

Це та перевірка, заради якої існує все решта. Якщо вона зелена — двоє з різних
вузлів можуть писати одне одному, і жодна ланка дорогою не читає текст.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from db.database import AsyncSessionLocal
from db.models import MessengerContact, MessengerConversation, User
from messenger.crypto.at_rest import unseal
from messenger.crypto.keys import KeyStore
from messenger.crypto.safety import safety_number
from messenger.inbox import accept_frame
from messenger.outbox import prepare_frame


async def _owner_id(session) -> str:
    return (await session.execute(select(User.id))).scalars().first()


@pytest.mark.anyio
async def test_two_nodes_hold_a_conversation(auth_root_client):
    kyrylo = KeyStore.generate(one_time_count=8)
    marta = KeyStore.generate(one_time_count=8)

    async with AsyncSessionLocal() as session:
        owner = await _owner_id(session)

        # Марта пише перша — Кирило її ще не знає.
        from messenger.crypto.session import Session

        hello = "привіт, це Марта"
        marta_side = Session.initiate(marta, kyrylo.publish_bundle())
        received = await accept_frame(session, kyrylo, owner, marta_side.encrypt(hello.encode()))

        assert unseal(kyrylo, bytes.fromhex(received.ciphertext), aad=received.id.encode()) == hello

        # У Кирила зʼявився контакт і розмова — але Марта ще не звірена.
        contact = (
            await session.execute(
                select(MessengerContact).where(MessengerContact.peer_node_id == marta.node_id)
            )
        ).scalars().one()
        assert contact.verified_at is None

        conversation = await session.get(MessengerConversation, received.conversation_id)

        # Кирило відповідає — уже своєю сесією.
        reply = "привіт! я на місці"
        out = await prepare_frame(session, kyrylo, conversation, reply)

    assert out is not None
    assert reply.encode() not in out.frame
    assert out.peer_node_id == marta.node_id
    assert out.verified is False

    # Марта читає відповідь своєю стороною сесії.
    assert marta_side.decrypt(out.frame).decode() == reply


@pytest.mark.anyio
async def test_safety_numbers_match_on_both_sides(auth_root_client):
    """Число, яке двоє читають вголос, мусить збігтися — інакше звірка марна."""
    kyrylo = KeyStore.generate(one_time_count=4)
    marta = KeyStore.generate(one_time_count=4)

    async with AsyncSessionLocal() as session:
        owner = await _owner_id(session)
        from messenger.crypto.session import Session

        frame = Session.initiate(marta, kyrylo.publish_bundle()).encrypt(b"hi")
        await accept_frame(session, kyrylo, owner, frame)
        contact = (
            await session.execute(
                select(MessengerContact).where(MessengerContact.peer_node_id == marta.node_id)
            )
        ).scalars().one()

    # Те саме число, пораховане на боці Марти.
    on_martas_side = safety_number(
        marta.identity_ed_public, marta.identity_dh_public,
        kyrylo.identity_ed_public, kyrylo.identity_dh_public,
    )

    assert contact.safety_number == on_martas_side


@pytest.mark.anyio
async def test_an_impostor_gets_a_different_number(auth_root_client):
    """Якщо між ними хтось став — числа розійдуться, і люди це почують."""
    kyrylo = KeyStore.generate(one_time_count=4)
    marta = KeyStore.generate(one_time_count=4)
    impostor = KeyStore.generate(one_time_count=4)

    async with AsyncSessionLocal() as session:
        owner = await _owner_id(session)
        from messenger.crypto.session import Session

        # Пише самозванець, видаючи себе за Марту.
        frame = Session.initiate(impostor, kyrylo.publish_bundle()).encrypt("це Марта".encode())
        await accept_frame(session, kyrylo, owner, frame)
        contact = (
            await session.execute(
                select(MessengerContact).where(MessengerContact.peer_node_id == impostor.node_id)
            )
        ).scalars().one()

    expected_with_real_marta = safety_number(
        marta.identity_ed_public, marta.identity_dh_public,
        kyrylo.identity_ed_public, kyrylo.identity_dh_public,
    )

    assert contact.safety_number != expected_with_real_marta
