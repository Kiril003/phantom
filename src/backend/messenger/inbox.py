"""Приймальня: кадр від чужого вузла стає повідомленням у стрічці.

Автентичність тут дає не заголовок і не токен, а сама криптографія: кадр або
розшифровується сесією з цим співрозмовником, або ні. Підробити відправника
неможливо, не маючи його ключів, тож окремої «авторизації відправника» не
існує — вона була б слабшою за те, що вже є.

Перший кадр від незнайомця відкриває нову сесію і створює контакт, але
verified_at лишається порожнім: те, що людина вміє шифрувати, ще не означає,
що вона та, за кого себе видає. Звірку робить власник голосом.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import MessengerContact, MessengerConversation, MessengerMessage
from messenger.crypto.at_rest import seal
from messenger.crypto.keys import KeyStore
from messenger.crypto.safety import safety_number
from messenger.crypto.session import Session

__all__ = ["InboxError", "accept_frame"]


class InboxError(Exception):
    """Кадр не належить жодній відомій сесії."""


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def _contact_for(
    session: AsyncSession, owner_user_id: str, peer_node_id: str
) -> Optional[MessengerContact]:
    return (
        await session.execute(
            select(MessengerContact).where(
                MessengerContact.owner_user_id == owner_user_id,
                MessengerContact.peer_node_id == peer_node_id,
            )
        )
    ).scalar_one_or_none()


async def _conversation_for(
    session: AsyncSession, owner_user_id: str, contact: MessengerContact
) -> MessengerConversation:
    row = (
        await session.execute(
            select(MessengerConversation).where(
                MessengerConversation.owner_user_id == owner_user_id,
                MessengerConversation.contact_id == contact.id,
            )
        )
    ).scalar_one_or_none()
    if row is not None:
        return row
    row = MessengerConversation(
        owner_user_id=owner_user_id,
        title=contact.display_name,
        kind="dm",
        circle="all",
        contact_id=contact.id,
        created_at=_now(),
        updated_at=_now(),
    )
    session.add(row)
    await session.flush()
    return row


async def accept_frame(
    session: AsyncSession,
    keys: KeyStore,
    owner_user_id: str,
    frame: bytes,
    peer_node_id: Optional[str] = None,
    *,
    reply_address: Optional[str] = None,
) -> MessengerMessage:
    """Розшифровує кадр і кладе повідомлення у стрічку власника."""
    contact = (
        await _contact_for(session, owner_user_id, peer_node_id) if peer_node_id else None
    )

    if contact is not None and contact.session_blob:
        peer_session = Session.restore(keys, bytes.fromhex(contact.session_blob))
        try:
            plaintext = peer_session.decrypt(frame)
        except Exception as exc:  # noqa: BLE001 — будь-який збій тега рівнозначний відмові
            raise InboxError(f"кадр не розшифровується сесією: {exc}") from exc
    else:
        # Перший кадр від незнайомця: сесію відкриваємо з нього ж.
        try:
            peer_session, plaintext = Session.accept(keys, frame)
        except Exception as exc:  # noqa: BLE001
            raise InboxError(f"перший кадр не приймається: {exc}") from exc
        contact = await _contact_for(session, owner_user_id, peer_session.peer_node_id)
        if contact is None:
            contact = MessengerContact(
                owner_user_id=owner_user_id,
                peer_node_id=peer_session.peer_node_id,
                display_name=f"Вузол {peer_session.peer_node_id[:8]}",
                bundle_json="",
                safety_number=safety_number(
                    keys.identity_ed_public,
                    keys.identity_dh_public,
                    peer_session.peer_identity_ed,
                    peer_session.peer_identity_dh,
                ),
                created_at=_now(),
                updated_at=_now(),
            )
            session.add(contact)
            await session.flush()

    contact.session_blob = peer_session.serialize(keys).hex()
    # Адресу відповіді записуємо лише якщо своєї ще немає: те, що прийшло в
    # листі, не має мовчки переписувати адресу, яку власник поставив руками.
    if reply_address and not contact.peer_address:
        contact.peer_address = reply_address
    contact.updated_at = _now()

    conversation = await _conversation_for(session, owner_user_id, contact)
    row = MessengerMessage(
        id=str(uuid.uuid4()),
        conversation_id=conversation.id,
        client_id=f"in_{uuid.uuid4().hex[:16]}",
        seq=conversation.next_seq,
        author_id=contact.peer_node_id,
        author_name=contact.display_name,
        kind="text",
        transport="relay",
        sent_at=_now(),
    )
    row.ciphertext = seal(keys, plaintext.decode(), aad=row.id.encode()).hex()
    conversation.next_seq += 1
    conversation.updated_at = _now()
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row
