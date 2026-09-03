"""Лист спареного телефона у стрічці вузла — і відповідь тією ж дорогою.

Чому окремо від `inbox.accept_frame`. Той приймає кадр храповика X3DH: сесія,
prekeys, стан, який їде вперед із кожним листом. Телефон говорить іншою мовою —
конверт PH3 під ДОВІЧНИМ ключем пари (`node/peer_letter.py`), бо весь сенс
сховка в тому, що адресата зараз немає, а храповик потребує обох. Спроба
завести телефон у ту саму функцію означала б або зламати сесії вузлів, або
вдавати сесію там, де її немає.

Спільне з рештою месенджера — рядок стрічки: та сама розмова, той самий
`MessengerMessage`, той самий at-rest ключ. Людина не має розрізняти, звідки
приїхало слово; розрізняти мусить код.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import MessengerContact, MessengerMessage
from messenger.crypto.at_rest import seal
from messenger.crypto.keys import KeyStore
from messenger.crypto.safety import safety_number
from messenger.inbox import conversation_for
from node import peer_letter as pl

logger = logging.getLogger(__name__)

__all__ = ["contact_for_phone", "land_letter", "send_letter", "write_letter"]

#: Дедуп: імʼя рядка — ідентифікатор листа з телефона. Той самий лист, забраний
#: двома заходами, дає той самий рядок, а не двійника у стрічці.
_CLIENT_PREFIX = "ph_"


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def contact_for_phone(
    session: AsyncSession, keys: KeyStore, owner_user_id: str, device: object
) -> Optional[MessengerContact]:
    """Контакт під спарований телефон; None — сітьових ключів у записі немає.

    Заводиться на першому листі, а не на паринзі: рядок у списку розмов, куди
    ніхто не написав, — це обіцянка, а не факт.
    """
    peer_id = (getattr(device, "peer_id", None) or "").strip()
    peer_dh = (getattr(device, "peer_dh_x25519", None) or "").strip()
    peer_ed = (getattr(device, "peer_pub_ed25519", None) or "").strip()
    if not peer_id or not peer_dh or not peer_ed:
        return None
    row = (
        await session.execute(
            select(MessengerContact).where(
                MessengerContact.owner_user_id == owner_user_id,
                MessengerContact.peer_node_id == peer_id,
            )
        )
    ).scalar_one_or_none()
    if row is not None:
        return row
    import base64

    name = (getattr(device, "device_name", "") or "").strip()
    row = MessengerContact(
        owner_user_id=owner_user_id,
        peer_node_id=peer_id,
        display_name=name or f"Телефон {peer_id[:8]}",
        # Порожній bundle — і це чесно: телефон не має bundle PHANTOM OS, у
        # нього інший протокол. Адресу сховка виводить `node/pair_drop.py` з
        # полів пристрою, а не звідси, тож порожнеча тут нічого не ламає.
        bundle_json="",
        safety_number=safety_number(
            keys.identity_ed_public,
            keys.identity_dh_public,
            base64.b64decode(peer_ed + "=" * (-len(peer_ed) % 4)),
            base64.b64decode(peer_dh + "=" * (-len(peer_dh) % 4)),
        ),
        created_at=_now(),
        updated_at=_now(),
    )
    session.add(row)
    await session.flush()
    return row


async def land_letter(
    session: AsyncSession,
    keys: KeyStore,
    owner_user_id: str,
    device: object,
    letter: pl.PeerLetter,
    *,
    road: str = "drop",
) -> Optional[MessengerMessage]:
    """Кладе лист телефона у стрічку. Повертає рядок — новий або вже наявний.

    Підпис перевіряється ВИЩЕ (у того, хто знає, з якої скриньки лист приїхав):
    сюди має входити лише те, що вже доведено як слово цього телефона.
    """
    contact = await contact_for_phone(session, keys, owner_user_id, device)
    if contact is None:
        return None
    conversation = await conversation_for(session, owner_user_id, contact)
    client_id = f"{_CLIENT_PREFIX}{letter.id[:48]}" if letter.id else ""
    if client_id:
        existing = (
            await session.execute(
                select(MessengerMessage).where(
                    MessengerMessage.conversation_id == conversation.id,
                    MessengerMessage.client_id == client_id,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            # Той самий лист приїхав удруге. Повертаємо наявний рядок, а не
            # другий такий самий: копію в сховку палять за фактом запису, і
            # обірвана відповідь на спаленні коштує саме такий повтор.
            return existing
    else:
        client_id = f"{_CLIENT_PREFIX}{uuid.uuid4().hex[:16]}"

    row = MessengerMessage(
        id=str(uuid.uuid4()),
        conversation_id=conversation.id,
        client_id=client_id,
        seq=conversation.next_seq,
        author_id=contact.peer_node_id,
        author_name=contact.display_name,
        kind="text",
        transport=road,
        sent_at=_now(),
    )
    row.ciphertext = seal(keys, letter.body, aad=row.id.encode()).hex()
    conversation.next_seq += 1
    conversation.updated_at = _now()
    contact.updated_at = _now()
    session.add(row)
    await session.flush()
    return row


def write_letter(
    keys: KeyStore,
    device: object,
    body: str,
    *,
    message_id: Optional[str] = None,
    now_ms: Optional[int] = None,
) -> Optional[pl.PeerLetter]:
    """Відповідь вузла — той самий лист, яким пише телефон, тільки нашим ключем.

    Підписуємо довічним Ed25519 вузла: телефон перевіряє підпис ключем, який
    отримав у паринзі, і без збігу мовчки відкидає кадр. Тому підписати цей
    лист чимось іншим — те саме, що не надіслати його.
    """
    import time

    from node.identity import load_or_create_key

    peer_id = (getattr(device, "peer_id", None) or "").strip()
    if not peer_id:
        return None
    letter = pl.PeerLetter(
        id=message_id or uuid.uuid4().hex,
        from_id=keys.node_id,
        to_id=peer_id,
        body=body,
        sent_at_ms=int(time.time() * 1000) if now_ms is None else now_ms,
    )
    return pl.sign(letter, load_or_create_key())


async def send_letter(
    store_url: str,
    keys: KeyStore,
    device: object,
    body: str,
    *,
    message_id: Optional[str] = None,
    now_ms: Optional[int] = None,
    client: object = None,
) -> Optional[str]:
    """Відповідь у сховок ТІЄЮ Ж дорогою; id листа або None.

    None означає рівно «сховок не взяв», і жодного «як правило, дійшло» тут
    немає: адресат прийде по лист сам, за адресою, яку складе лише він.
    """
    import time

    from node import pair_drop
    from node import peer_relay as pr
    from node.relay_courier import Held, RelayCourier

    pair_key = pair_drop.pair_key_of(keys, device)
    if not pair_key:
        return None
    letter = write_letter(keys, device, body, message_id=message_id, now_ms=now_ms)
    if letter is None:
        return None
    relay_key = pr.relay_key(pair_key, keys.node_id, letter.to_id)
    if relay_key is None:
        return None
    epoch = pr.epoch_of(int(time.time() * 1000) if now_ms is None else now_ms)
    # Порядок сторін — той самий, що чекає телефон: sender=ми, recipient=він.
    # Переставиш — обидва боки будуть «праві» й обидва глухі.
    tag = pr.msg_tag(relay_key, letter.from_id, letter.to_id, epoch)
    if tag is None:
        return None
    sealed = pl.seal_envelope(letter, pair_key)
    if sealed is None:
        return None
    wrapped = pr.wrap(sealed[0], relay_key, tag)
    if wrapped is None:
        return None
    try:
        outcome = await RelayCourier(store_url, client=client).drop(tag, wrapped.blob)
    except Exception as exc:  # noqa: BLE001 — мережа падає як завгодно
        logger.info("лист телефону %s не поїхав: %s", letter.to_id[:8], exc)
        return None
    if isinstance(outcome, Held):
        return letter.id
    logger.info(
        "сховок не взяв лист для телефона %s: %s",
        letter.to_id[:8],
        outcome.__class__.__name__,
    )
    return None
