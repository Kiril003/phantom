"""Позначки на листах — одне місце для обох боків.

Позначку ставлять двома різними шляхами: власник через маршрут
`/messages/{id}/reactions`, співрозмовник — кадром `reaction` через
приймальню. Логіка «поставити або зняти» в них ОДНА, і жити вона мусить в
одному місці.

Причина не в охайності. Дві копії однієї угоди в різних файлах розходяться
при першій же зміні, і розходяться тихо — сьогодні це вже коштувало нам
двічі: перелік типів, що возять блоби (`purge` проти `redelivery`), і умова
«чи це наш лист» (`isSelf` проти розрахунку стану). У другому випадку
розбіжність вилилась у те, що груповий лист не показував доставки взагалі.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import MessengerReaction


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def apply_reaction(
    session: AsyncSession,
    *,
    message_id: str,
    actor_node_id: str,
    actor_name: str,
    emoji: str,
    on: bool | None = None,
) -> bool:
    """Ставить або знімає позначку. Повертає, чи вона тепер стоїть.

    `on=None` означає ПЕРЕМИКАЧ — так тисне людина у себе: та сама кнопка
    ставить і знімає, і клієнтові не треба знати поточний стан перед дією.

    `on=True/False` означає явну волю — так приходить кадр від співрозмовника.
    Кадр може приїхати вдруге (повтор доставки), і перемикач тоді зняв би
    позначку, яку людина ставила один раз. Тому по дроту їде намір, а не дія.
    """
    existing = (
        await session.execute(
            select(MessengerReaction).where(
                MessengerReaction.message_id == message_id,
                MessengerReaction.actor_node_id == actor_node_id,
                MessengerReaction.emoji == emoji,
            )
        )
    ).scalar_one_or_none()

    should_be = (existing is None) if on is None else on

    if should_be and existing is None:
        session.add(
            MessengerReaction(
                message_id=message_id,
                actor_node_id=actor_node_id,
                actor_name=actor_name,
                emoji=emoji,
                created_at=_now(),
            )
        )
    elif not should_be and existing is not None:
        await session.delete(existing)

    return should_be
