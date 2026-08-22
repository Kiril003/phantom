"""Відправка: повідомлення до співрозмовника їде шифротекстом.

Локальна копія і те, що летить у мережу, — різні речі. Храповик навмисне не
дає відправнику розшифрувати власний кадр, тож у базу лягає окремо запечатана
копія (at_rest), а назовні йде кадр сесії.

Куди саме його віддати — вирішує транспорт. Тут його не вибирають: функція
повертає кадр і адресу вузла, а хто його понесе (ретранслятор, прямий канал,
кур'єр на флешці) — не справа цього модуля.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import MessengerContact, MessengerConversation
from messenger.crypto.keys import KeyStore
from messenger.crypto.session import Session

__all__ = ["OutboundFrame", "OutboxError", "prepare_frame"]


class OutboxError(Exception):
    """Розмова не має співрозмовника або сесія з ним не зведена."""


@dataclass(frozen=True)
class OutboundFrame:
    peer_node_id: str
    frame: bytes
    #: Чи звірив власник число голосом. Транспорт має право відмовитись везти
    #: незвірене — але вирішувати це не тут.
    verified: bool


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def prepare_frame(
    session: AsyncSession,
    keys: KeyStore,
    conversation: MessengerConversation,
    plaintext: str,
) -> Optional[OutboundFrame]:
    """Готує кадр для співрозмовника. None — якщо розмова ні з ким.

    Стан храповика зсувається і одразу зберігається: кожен кадр витрачає свій
    ключ, тож втратити цей зсув означало б зашифрувати наступне повідомлення
    тим самим ключем.
    """
    if conversation.contact_id is None:
        return None

    contact = await session.get(MessengerContact, conversation.contact_id)
    if contact is None:
        return None
    if not contact.session_blob:
        raise OutboxError("з цим співрозмовником сесія ще не зведена")

    peer_session = Session.restore(keys, bytes.fromhex(contact.session_blob))
    frame = peer_session.encrypt(plaintext.encode())

    contact.session_blob = peer_session.serialize(keys).hex()
    contact.updated_at = _now()
    await session.commit()

    return OutboundFrame(
        peer_node_id=contact.peer_node_id,
        frame=frame,
        verified=contact.verified_at is not None,
    )
