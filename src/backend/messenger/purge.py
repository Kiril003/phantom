"""Видалення, яке справді видаляє.

Тут зібрано одну неприємну правду: стерти рядок у стрічці — не те саме, що
стерти повідомлення. У повідомлення з фото три тіла, і кожне лежить окремо:
запечатаний рядок у messenger_messages, облік перевезення в messenger_blobs і
самі байти файлом на диску. Прибрати перше й лишити два останніх — це не
видалення, а прибирання зі столу перед гостями.

Тому будь-яка дорога до видалення (для себе, для всіх, очистити історію,
видалити розмову) проходить через цей модуль, а не пише свій варіант чистки.

Надгробок лишається навмисно: рядок із deleted_at і без тіла чесно каже
«тут щось було й зникло». Прибрати сам факт неможливо — співрозмовник бачив
повідомлення до видалення, і вдавати, що його не існувало, було б брехнею.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Iterable, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import MessengerBlob, MessengerMessage
from messenger.blobs import delete_bytes
from messenger.crypto.at_rest import AtRestError, unseal
from messenger.crypto.keys import KeyStore

logger = logging.getLogger(__name__)

__all__ = [
    "blob_ids_of",
    "drop_blob",
    "find_by_origin",
    "origin_of",
    "purge_conversation_blobs",
    "tombstone",
    "wipe_message",
]


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _open_body(keys: KeyStore, row: MessengerMessage) -> Optional[str]:
    """Відкриває запечатане тіло. None — якщо ключі не ті або рядок зіпсовано."""
    if not row.ciphertext:
        return row.body
    try:
        return unseal(keys, bytes.fromhex(row.ciphertext), aad=row.id.encode())
    except (AtRestError, ValueError):
        return None


def blob_ids_of(keys: KeyStore, row: MessengerMessage) -> list[str]:
    """Які байти на диску тримає це повідомлення.

    Ідентифікатор блоба лежить у тілі — тобто під пломбою. Це не незручність,
    а наслідок того, що вузол не має читати листування: щоб дізнатись, який
    файл прибрати, потрібні ключі самого вузла.
    """
    if row.kind not in ("image", "file"):
        return []
    body = _open_body(keys, row)
    if not body:
        return []
    try:
        parsed = json.loads(body)
    except (TypeError, ValueError):
        return []
    blob_id = parsed.get("blob_id") if isinstance(parsed, dict) else None
    return [blob_id] if isinstance(blob_id, str) and blob_id else []


async def drop_blob(session: AsyncSession, blob_id: str) -> bool:
    """Прибирає байти з диска і рядок обліку. True — якщо файл справді зник.

    Порядок саме такий: спершу диск, потім облік. Впасти між ними означає
    лишити рядок про файл, якого вже немає, — це видно і лікується. Зворотний
    порядок лишив би файл, про який ніхто не знає, і він жив би вічно.
    """
    gone = delete_bytes(blob_id)
    row = await session.get(MessengerBlob, blob_id)
    if row is not None:
        await session.delete(row)
    return gone


async def wipe_message(
    session: AsyncSession, keys: KeyStore, row: MessengerMessage
) -> int:
    """Стирає тіло повідомлення і все, що воно тримало на диску."""
    dropped = 0
    for blob_id in blob_ids_of(keys, row):
        if await drop_blob(session, blob_id):
            dropped += 1
    row.body = None
    row.ciphertext = None
    return dropped


async def tombstone(
    session: AsyncSession, keys: KeyStore, row: MessengerMessage
) -> int:
    """Лишає надгробок: тіла немає, блоба немає, рядок каже «видалено».

    Черга теж зупиняється: везти кадр, який щойно скасували, немає сенсу.
    """
    dropped = await wipe_message(session, keys, row)
    row.outbound_frame = None
    row.delivery_state = "local"
    row.deleted_at = _now()
    return dropped


async def purge_conversation_blobs(
    session: AsyncSession, keys: KeyStore, conversation_id: str
) -> int:
    """Прибирає ВСІ вкладення розмови: і з тіл повідомлень, і з обліку.

    Двома заходами навмисно. Перший бере блоби, на які посилаються тіла.
    Другий — усе, що обліковано за цією розмовою: вхідний блоб міг приїхати
    раніше за повідомлення з ключем, і тоді на нього ніхто не посилається.
    Без другого заходу «очистити історію» лишала б мегабайти шифротексту.
    """
    rows = (
        await session.execute(
            select(MessengerMessage).where(
                MessengerMessage.conversation_id == conversation_id
            )
        )
    ).scalars().all()

    seen: set[str] = set()
    for row in rows:
        seen.update(blob_ids_of(keys, row))

    orphans = (
        await session.execute(
            select(MessengerBlob.blob_id).where(
                MessengerBlob.conversation_id == conversation_id
            )
        )
    ).scalars().all()
    seen.update(o for o in orphans if o)

    dropped = 0
    for blob_id in seen:
        if await drop_blob(session, blob_id):
            dropped += 1
    return dropped


async def find_by_origin(
    session: AsyncSession, conversation_id: str, origin_id: str
) -> Optional[MessengerMessage]:
    """Знаходить повідомлення за спільною назвою з іншого вузла.

    Одне повідомлення зветься по-різному на двох вузлах: у автора це його
    client_id, у одержувача — той самий рядок під префіксом `in_`. Службовий
    кадр везе назву БЕЗ префікса, тож шукати треба обидві — інакше видалення
    працювало б лише в один бік.
    """
    if not origin_id:
        return None
    candidates: Iterable[str] = (origin_id, f"in_{origin_id}")
    return (
        await session.execute(
            select(MessengerMessage)
            .where(
                MessengerMessage.conversation_id == conversation_id,
                MessengerMessage.client_id.in_(list(candidates)),
            )
            .limit(1)
        )
    ).scalars().first()


def origin_of(row: MessengerMessage) -> str:
    """Спільна назва цього повідомлення для іншого вузла."""
    client_id = row.client_id or ""
    return client_id[3:] if client_id.startswith("in_") else client_id
