"""Повторна доставка того, що не доїхало.

«Нічого не губиться» — обіцянка, яка нічого не варта без цього модуля: без
повторів повідомлення в стані queued лежало б у базі вічно, і людина була б
певна, що написала, а співрозмовник ніколи б цього не побачив.

Повтор везе ТОЙ САМИЙ кадр, який уже зашифровано. Перешифрувати означало б
зрушити храповик іще раз і надіслати людині два різні повідомлення замість
одного.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import MessengerContact, MessengerConversation, MessengerMessage
from messenger.transport import deliver_direct

logger = logging.getLogger(__name__)

__all__ = ["MAX_ATTEMPTS", "flush_queue"]

#: Після цього числа спроб повідомлення лишається queued, але вузол перестає
#: гатити в стіну. Воно не зникає — просто чекає на кращий транспорт.
MAX_ATTEMPTS = 12


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def flush_queue(
    session: AsyncSession, own_node_id: str, *, limit: int = 50
) -> int:
    """Пробує довезти те, що чекає. Повертає кількість доставлених."""
    rows = (
        await session.execute(
            select(MessengerMessage)
            .where(
                MessengerMessage.delivery_state == "queued",
                MessengerMessage.outbound_frame.is_not(None),
                MessengerMessage.delivery_attempts < MAX_ATTEMPTS,
            )
            .order_by(MessengerMessage.sent_at)
            .limit(limit)
        )
    ).scalars().all()

    delivered = 0
    for row in rows:
        conversation = await session.get(MessengerConversation, row.conversation_id)
        if conversation is None or conversation.contact_id is None:
            continue
        contact = await session.get(MessengerContact, conversation.contact_id)
        if contact is None or not contact.peer_address:
            # Адреси немає — спроба нічого не дасть, і лічильник псувати не варто.
            continue

        row.delivery_attempts += 1
        row.last_attempt_at = _now()
        ok = await deliver_direct(
            contact.peer_address,
            contact.peer_node_id,
            bytes.fromhex(row.outbound_frame),
            from_node_id=own_node_id,
        )
        if ok:
            row.delivery_state = "sent"
            # Кадр більше не потрібен: він доїхав, а зберігати його — лишній ризик.
            row.outbound_frame = None
            delivered += 1

    await session.commit()
    return delivered


async def redelivery_loop(interval_s: float = 45.0) -> None:
    """Фонова смуга: періодично повертається до боргів.

    Тихо переживає будь-який збій: недоступний співрозмовник — це нормальний
    стан, а не привід зупинити смугу назавжди.
    """
    import asyncio

    from db.database import AsyncSessionLocal

    while True:
        try:
            await asyncio.sleep(interval_s)
            from api.routes_messenger import _keys

            async with AsyncSessionLocal() as session:
                delivered = await flush_queue(session, _keys().node_id)
            if delivered:
                logger.info("черга месенджера: довезено %d", delivered)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.debug("черга месенджера спіткнулась: %s", exc)
