"""Повторна доставка того, що не доїхало.

«Нічого не губиться» — обіцянка, яка нічого не варта без цього модуля: без
повторів повідомлення в стані queued лежало б у базі вічно, і людина була б
певна, що написала, а співрозмовник ніколи б цього не побачив.

Повтор везе ТОЙ САМИЙ кадр, який уже зашифровано. Перешифрувати означало б
зрушити храповик іще раз і надіслати людині два різні повідомлення замість
одного.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import MessengerContact, MessengerConversation, MessengerMessage
from messenger.blobs import flush_blob_queue
from messenger.r2 import R2Road, drop_object, fetch_object, object_key, r2_road
from messenger.transport import deliver, supabase_mailbox_endpoint, supabase_road

logger = logging.getLogger(__name__)

__all__ = [
    "MAX_ATTEMPTS",
    "fetch_parked_blobs",
    "flush_queue",
    "read_supabase_mailbox",
    "supabase_service_key",
]

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
        if contact is None:
            continue

        from config import config

        relay = (config.relay_url or "") if config.relay_enabled else ""
        sb_url, sb_key = supabase_road(config)
        if not contact.peer_address and not relay and not sb_url:
            # Жодної дороги — спроба нічого не дасть,
            # і лічильник псувати не варто.
            continue

        row.delivery_attempts += 1
        row.last_attempt_at = _now()
        ok = await deliver(
            bytes.fromhex(row.outbound_frame),
            peer_node_id=contact.peer_node_id,
            from_node_id=own_node_id,
            peer_address=contact.peer_address or "",
            relay=relay,
            supabase_url=sb_url,
            supabase_key=sb_key,
            reply_address=config.messenger_public_address,
        )
        if ok:
            row.delivery_state = "sent"
            # Кадр більше не потрібен: він доїхав, а зберігати його — лишній ризик.
            row.outbound_frame = None
            delivered += 1

    await session.commit()
    return delivered


async def fetch_parked_blobs(
    session: AsyncSession,
    keys: Any,
    owner_user_id: str,
    *,
    road: Optional[R2Road] = None,
    only_blob_id: str = "",
    client: Optional[httpx.AsyncClient] = None,
    limit: int = 40,
) -> int:
    """Забирає з хмари вкладення, ключі до яких уже приїхали в стрічці.

    Тягне вузол АДРЕСАТА і тільки своє: імʼя обʼєкта починається з його
    власного node_id, тож попросити чуже нічим. Ідентифікатор блоба лежить під
    пломбою в тілі повідомлення — без ключів вузла не дізнатись навіть того,
    що просити, і це навмисно.

    Забране одразу прибирається з хмари: байти вже на диску, а місце в
    безкоштовному бакеті скінченне. Невдале прибирання — не помилка.
    """
    from messenger.blobs import blob_path, record, store_bytes
    from messenger.purge import blob_ids_of

    if road is None:
        from config import config

        road = r2_road(config)
    if road is None:
        return 0

    rows = (
        await session.execute(
            select(MessengerMessage)
            .join(
                MessengerConversation,
                MessengerConversation.id == MessengerMessage.conversation_id,
            )
            .where(
                MessengerConversation.owner_user_id == owner_user_id,
                MessengerMessage.kind.in_(("image", "file")),
                MessengerMessage.deleted_at.is_(None),
                MessengerMessage.author_id != keys.node_id,
            )
            .order_by(MessengerMessage.sent_at.desc())
            .limit(limit)
        )
    ).scalars().all()

    taken = 0
    for row in rows:
        for blob_id in blob_ids_of(keys, row):
            if only_blob_id and blob_id != only_blob_id:
                continue
            try:
                if blob_path(blob_id).exists():
                    continue
                key = object_key(keys.node_id, blob_id)
            except ValueError:
                continue
            data = await fetch_object(road, key, client=client)
            if data is None:
                continue
            digest = store_bytes(blob_id, data)
            await record(
                session,
                blob_id,
                direction="in",
                state="stored",
                size=len(data),
                sha256=digest,
                conversation_id=row.conversation_id,
                peer_node_id=row.author_id,
            )
            taken += 1
            if not await drop_object(road, key, client=client):
                logger.info("обʼєкт %s лишився в хмарі — прибрати не вдалось", blob_id[:8])
    if taken:
        await session.commit()
    return taken


def supabase_service_key() -> str:
    """Службовий ключ читання — ТІЛЬКИ з середовища, ніколи з конфігурації.

    Ключ, що читає чужі скриньки, не має жодного права опинитись у файлі
    конфігурації, базі чи коді: власник вставляє його в env сам.
    """
    return os.environ.get("SUPABASE_SERVICE_KEY", "").strip()


async def read_supabase_mailbox(
    session: AsyncSession,
    keys: Any,
    owner_user_id: str,
    *,
    url: str,
    service_key: str,
    client: Optional[httpx.AsyncClient] = None,
    limit: int = 20,
) -> int:
    """Забирає свої листи зі скриньки Supabase у стрічку власника.

    Кожен принесений конверт штампується delivered_at після ОДНІЄЇ спроби:
    кадр, що не розшифрувався зараз, не розшифрується й завтра (храповик не
    ходить назад), а вічний повтор отруйного листа заступив би дорогу решті.
    """
    endpoint = supabase_mailbox_endpoint(url)
    headers = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}
    own = client is None
    http = client or httpx.AsyncClient(timeout=8.0)
    try:
        response = await http.get(
            endpoint,
            params={
                "recipient_node_id": f"eq.{keys.node_id}",
                "delivered_at": "is.null",
                "select": "id,frame",
                "order": "created_at.asc",
                "limit": str(limit),
            },
            headers=headers,
        )
        if response.status_code != 200:
            logger.info(
                "скринька Supabase: читання не вдалось (%s)", response.status_code
            )
            return 0
        accepted = 0
        for item in response.json():
            try:
                from messenger.inbox import accept_frame

                envelope = json.loads(str(item.get("frame") or "") or "{}")
                frame_hex = str(envelope.get("frame", ""))
                if frame_hex:
                    await accept_frame(
                        session,
                        keys,
                        owner_user_id,
                        bytes.fromhex(frame_hex),
                        envelope.get("from_node_id"),
                        reply_address=envelope.get("reply_address"),
                    )
                    accepted += 1
            except Exception as exc:  # noqa: BLE001
                logger.info("лист зі скриньки Supabase не прийнявся: %s", exc)
            await http.patch(
                endpoint,
                params={"id": f"eq.{item.get('id')}"},
                json={"delivered_at": datetime.now(timezone.utc).isoformat()},
                headers={**headers, "Prefer": "return=minimal"},
            )
        return accepted
    finally:
        if own:
            await http.aclose()


async def redelivery_loop(interval_s: float = 45.0) -> None:
    """Фонова смуга: періодично повертається до боргів.

    Тихо переживає будь-який збій: недоступний співрозмовник — це нормальний
    стан, а не привід зупинити смугу назавжди.
    """
    import asyncio

    from config import config
    from db.database import AsyncSessionLocal

    sb_url = (getattr(config, "supabase_mailbox_url", "") or "").strip()
    if sb_url and not supabase_service_key():
        logger.info("скринька Supabase: читання вимкнено — немає службового ключа")

    while True:
        try:
            await asyncio.sleep(interval_s)
            from api.routes_messenger import _keys

            async with AsyncSessionLocal() as session:
                delivered = await flush_queue(session, _keys().node_id)
                # Вкладення їдуть тією ж смугою: фото, яке не доїхало, не має
                # чекати, поки людина згадає про нього руками.
                blobs = await flush_blob_queue(session, _keys().node_id)
                # Групові кадри — тією ж смугою і тим самим LIMIT 50: у групі
                # на 32 одне застрягле повідомлення (31 рядок) ще вміщається
                # в один прохід і не морить голодом решту черги.
                from messenger.groups import flush_group_queue

                group = await flush_group_queue(session, _keys().node_id)
            letters = 0
            parked = 0
            service_key = supabase_service_key()
            has_r2 = r2_road(config) is not None
            if (sb_url and service_key) or has_r2:
                from db.models import User

                async with AsyncSessionLocal() as session:
                    owner = (
                        await session.execute(select(User.id).order_by(User.id))
                    ).scalars().first()
                    if owner is not None and sb_url and service_key:
                        letters = await read_supabase_mailbox(
                            session,
                            _keys(),
                            owner,
                            url=sb_url,
                            service_key=service_key,
                        )
                    if owner is not None and has_r2:
                        # Вкладення, що чекають у хмарі: ключ до них уже в
                        # стрічці, лишилось забрати байти.
                        parked = await fetch_parked_blobs(session, _keys(), owner)
            if delivered or blobs or group or letters or parked:
                logger.info(
                    "черга месенджера: довезено %d, вкладень %d, групових %d, "
                    "зі скриньки Supabase %d, з хмари %d",
                    delivered,
                    blobs,
                    group,
                    letters,
                    parked,
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.debug("черга месенджера спіткнулась: %s", exc)
