"""Непрочитане мусить рахуватись, читання — фіксуватись, імʼя — даватись власником."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from db.database import AsyncSessionLocal
from db.models import MessengerContact, MessengerConversation, MessengerMessage


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def _incoming(conversation_id: str, text: str) -> None:
    """Чужа репліка напряму в базу — щоб не тягнути крипту в тест лічильника."""
    async with AsyncSessionLocal() as session:
        conv = await session.get(MessengerConversation, conversation_id)
        session.add(
            MessengerMessage(
                id=str(uuid.uuid4()),
                conversation_id=conversation_id,
                client_id=f"in_{uuid.uuid4().hex[:10]}",
                seq=conv.next_seq,
                author_id="peer",
                author_name="Марта",
                kind="text",
                body=text,
                delivery_state="local",
                sent_at=_now(),
            )
        )
        conv.next_seq += 1
        await session.commit()


def _find(client, conv_id):
    rows = client.get("/api/v1/messenger/conversations").json()
    return next(c for c in rows if c["id"] == conv_id)


@pytest.mark.anyio
async def test_incoming_raises_unread_and_reading_clears_it(auth_root_client):
    conv = auth_root_client.post(
        "/api/v1/messenger/conversations", json={"title": "Лічильник"}
    ).json()
    await _incoming(conv["id"], "перше")
    await _incoming(conv["id"], "друге")

    row = _find(auth_root_client, conv["id"])
    assert row["unread_count"] == 2
    assert row["last_snippet"] == "друге"

    out = auth_root_client.patch(
        f"/api/v1/messenger/conversations/{conv['id']}/read", json={"seq": 2}
    ).json()
    assert out["unread_count"] == 0
    assert _find(auth_root_client, conv["id"])["unread_count"] == 0


@pytest.mark.anyio
async def test_own_message_is_already_read(auth_root_client):
    conv = auth_root_client.post(
        "/api/v1/messenger/conversations", json={"title": "Своє"}
    ).json()
    auth_root_client.post(
        f"/api/v1/messenger/conversations/{conv['id']}/messages",
        json={"client_id": "own-1", "author_id": "me", "author_name": "Кирило", "body": "привіт"},
    )

    row = _find(auth_root_client, conv["id"])
    assert row["unread_count"] == 0
    assert row["last_snippet"] == "привіт"


@pytest.mark.anyio
async def test_read_cursor_never_moves_backwards(auth_root_client):
    conv = auth_root_client.post(
        "/api/v1/messenger/conversations", json={"title": "Назад ні"}
    ).json()
    await _incoming(conv["id"], "раз")
    await _incoming(conv["id"], "два")

    auth_root_client.patch(
        f"/api/v1/messenger/conversations/{conv['id']}/read", json={"seq": 2}
    )
    out = auth_root_client.patch(
        f"/api/v1/messenger/conversations/{conv['id']}/read", json={"seq": 1}
    ).json()

    assert out["unread_count"] == 0


@pytest.mark.anyio
async def test_rename_gives_the_contact_a_human_name(auth_root_client):
    from messenger.crypto.keys import KeyStore

    bundle = KeyStore.generate(one_time_count=2).publish_bundle().to_dict()
    contact = auth_root_client.post(
        "/api/v1/messenger/contacts", json={"display_name": "Вузол 1234abcd", "bundle": bundle}
    ).json()
    conv = auth_root_client.post(
        "/api/v1/messenger/conversations",
        json={"title": "Вузол 1234abcd", "contact_id": contact["id"]},
    ).json()

    out = auth_root_client.patch(
        f"/api/v1/messenger/conversations/{conv['id']}", json={"title": "Марта"}
    ).json()
    assert out["title"] == "Марта"

    async with AsyncSessionLocal() as session:
        row = (
            await session.execute(
                select(MessengerContact).where(MessengerContact.id == contact["id"])
            )
        ).scalar_one()
    assert row.display_name == "Марта"
