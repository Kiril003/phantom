"""Хто ходить у сховок PH5 по листи для цього вузла.

`transport.deliver_via_drop` кладе; тут — забір. Без цього модуля четверта
дорога була дорогою в один бік: конверт лежав у сховку сім днів і зникав, а
адресат так і не дізнавався, що йому писали. Так і було до 03.09.2026 —
`RelayCourier.fetch` не мав жодного викликача поза власними тестами.

Один захід — той самий порядок, що в телефона (PeerRelayClient.kt):
  1. кожен контакт, з яким є ключ пари, → ключ сховка → скринька;
  2. `peer_relay.plan()` — рівно 64 адреси на три доби, решта — вигадані;
  3. один `fetch`; кожен конверт відчиняється ключем СВОЄЇ скриньки;
  4. лист → `accept_frame(road="drop")`; після заходу — `burn` забраних копій.

Конверт, який не відчинився, теж спалюється після однієї спроби — правило те
саме, що в Supabase-скриньки: кадр, що не розшифрувався зараз, не
розшифрується й завтра (храповик не ходить назад), а копія, яку ніхто не
палить, приїжджала б знову кожні 45 с сім днів поспіль.

Чого тут немає: квитанцій. Телефон кладе ACK у дзеркальну скриньку; ПК у V1
їх не пише й не читає — але свою копію квитанції зі сховка прибирає, бо
інакше вона лежала б там до кінця TTL.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Optional

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import MessengerContact, MessengerMessage
from messenger.crypto.keys import KeyStore
from messenger.inbox import accept_frame
from messenger.phone_letters import land_letter
from messenger.transport import drop_pair_key_of, note_store_answered
from node import pair_drop
from node import peer_letter as pl
from node import peer_relay as pr
from node.relay_courier import Burned, Fetched, Offline, RelayCourier

logger = logging.getLogger(__name__)

__all__ = ["Visit", "mailboxes_of", "phone_boxes_of", "read_drop_store"]


@dataclass(frozen=True)
class Visit:
    """Підсумок одного заходу — названі числа, а не «ок»."""

    #: None — не ходили (немає з ким листуватись); False — сховок мовчав.
    answered: Optional[bool]
    #: Конвертів віддано під нашими адресами.
    letters: int = 0
    #: Кадрів прийнято приймальнею — разом зі службовими, що рядка не лишають.
    accepted: int = 0
    #: Рядки стрічки, які варто показати відкритому вікну.
    rows: list[MessengerMessage] = field(default_factory=list)


async def mailboxes_of(
    session: AsyncSession, keys: KeyStore, owner_user_id: str
) -> list[pr.Mailbox]:
    """Скринька на кожного контакта, з яким є ключ пари.

    Без bundle і без сесії скриньки немає: адресу вміють скласти лише двоє,
    і той, хто не знає довготривалого ключа співрозмовника, — не з них. Це
    межа самого протоколу, а не цього коду: перший лист від незнайомця
    сховком приїхати не може.
    """
    contacts = (
        await session.execute(
            select(MessengerContact).where(
                MessengerContact.owner_user_id == owner_user_id
            )
        )
    ).scalars().all()
    boxes: list[pr.Mailbox] = []
    for contact in contacts:
        if contact.peer_node_id == keys.node_id:
            continue
        pair = drop_pair_key_of(keys, contact)
        if not pair:
            continue
        relay_key = pr.relay_key(pair, keys.node_id, contact.peer_node_id)
        if relay_key is None:
            continue
        boxes.append(pr.Mailbox(peer_id=contact.peer_node_id, relay_key=relay_key))
    # Спарований телефон — такий самий адресат, і скринька з ним рахується тією
    # самою формулою. Різниця лише в тому, що всередині конверта: у вузла — кадр
    # храповика, у телефона — конверт PH3. Один захід на обох, бо два заходи
    # означали б два вужчі гурти імен, у яких лист гірше ховається.
    known = {box.peer_id for box in boxes}
    for box in await pair_drop.phone_mailboxes(session, keys, owner_user_id):
        if box.peer_id in known:
            continue
        known.add(box.peer_id)
        boxes.append(box)
    return boxes


async def phone_boxes_of(
    session: AsyncSession, keys: KeyStore, owner_user_id: str
) -> dict[str, Any]:
    """Ім'я телефона → його запис пристрою. Ключ до того, ЯК читати конверт."""
    out: dict[str, Any] = {}
    for device in await pair_drop.paired_phones(session, owner_user_id):
        peer_id = (device.peer_id or "").strip()
        if peer_id and pair_drop.drop_ready(device):
            out[peer_id] = device
    return out


async def _land_phone_letter(
    session: AsyncSession,
    keys: KeyStore,
    owner_user_id: str,
    *,
    device: Any,
    pair_key: bytes,
    relay_key: bytes,
    frame: str,
    blob: bytes,
    epoch: int,
    courier: RelayCourier,
) -> Optional[MessengerMessage]:
    """Конверт PH3 → рядок стрічки → квитанція. Порядок не переставляється.

    Квитанція йде ЛИШЕ після запису: вона означає «воно в мене», і телефон,
    отримавши її, знімає лист із черги. Відправ її раніше — і обірваний запис
    коштував би людині лист, який на її екрані вже «доставлено».
    """
    peer_id = (device.peer_id or "").strip()
    if not pair_key:
        return None
    letter = pl.open_envelope(frame, pair_key)
    if letter is None:
        logger.info("конверт телефона %s не відчинився", peer_id[:8])
        return None
    if letter.from_id != peer_id or letter.to_id != keys.node_id:
        # Кадр, переадресований на конверті. Не помилка мережі — спроба.
        logger.info("лист телефона %s адресований не нам", peer_id[:8])
        return None
    import base64

    signing = (device.peer_pub_ed25519 or "").strip()
    raw = base64.b64decode(signing + "=" * (-len(signing) % 4)) if signing else b""
    if not pl.verify(letter, raw, expected_from=peer_id):
        logger.info("підпис листа телефона %s не зійшовся", peer_id[:8])
        return None
    try:
        row = await land_letter(session, keys, owner_user_id, device, letter)
    except Exception as exc:  # noqa: BLE001 — один отруйний лист не валить захід
        logger.info("лист телефона %s не записався: %s", peer_id[:8], exc)
        return None
    if row is None:
        return None
    await session.commit()
    await session.refresh(row)

    nonce_b64 = pr.nonce_of(blob)
    tag = pr.ack_tag(relay_key, letter.from_id, letter.to_id, epoch)
    mark = (
        pl.receipt(pair_key, letter.id, letter.from_id, letter.to_id, nonce_b64)
        if nonce_b64
        else None
    )
    if tag and mark:
        wrapped = pr.wrap(mark, relay_key, tag)
        if wrapped is not None:
            try:
                await courier.drop(tag, wrapped.blob)
            except Exception as exc:  # noqa: BLE001 — мережа падає як завгодно
                # Лист уже в стрічці. Без квитанції автор побачить «у сховку»
                # замість «доставлено» — гірше, але чесно: наступний захід
                # забере копію ще раз, запис відсіється за id, і квитанція піде.
                logger.info("квитанція телефону %s не пішла: %s", peer_id[:8], exc)
    return row


async def read_drop_store(
    session: AsyncSession,
    keys: KeyStore,
    owner_user_id: str,
    *,
    store_url: str,
    now_ms: Optional[int] = None,
    round_: int = 0,
    client: Optional[httpx.AsyncClient] = None,
) -> Visit:
    """Один захід: забрати, відчинити, прийняти, спалити."""
    boxes = await mailboxes_of(session, keys, owner_user_id)
    if not boxes:
        return Visit(answered=None)
    plan = pr.plan(
        keys.node_id,
        boxes,
        int(time.time() * 1000) if now_ms is None else now_ms,
        round_,
    )
    courier = RelayCourier(store_url, client=client)
    try:
        fetched = await courier.fetch(plan.tags)
    except Exception as exc:  # noqa: BLE001 — мережа падає як завгодно
        note_store_answered(store_url, False)
        logger.info("до сховка не достукались: %s", exc)
        return Visit(answered=False)
    answered = not isinstance(fetched, Offline)
    note_store_answered(store_url, answered)
    if not isinstance(fetched, Fetched):
        logger.info("сховок не віддав пошту: %s", fetched.__class__.__name__)
        return Visit(answered=answered)

    keys_by_peer = {box.peer_id: box.relay_key for box in boxes}
    phones = await phone_boxes_of(session, keys, owner_user_id)
    pair_by_phone = {
        peer_id: pair_drop.pair_key_of(keys, device) for peer_id, device in phones.items()
    }
    to_burn: list[str] = []
    accepted = 0
    rows: list[MessengerMessage] = []
    for letter in fetched.letters:
        slot = plan.slots.get(letter.tag)
        if slot is None:
            # Під вигаданою адресою наше не лежить — і палити чуже не нам.
            continue
        if letter.id:
            to_burn.append(letter.id)
        if slot.kind != pr.Kind.LETTER:
            continue
        text = pr.unwrap(letter.blob, keys_by_peer[slot.peer_id], letter.tag)
        if text is None:
            logger.info("конверт зі скриньки %s не відчинився", slot.peer_id[:8])
            continue
        if slot.peer_id in phones:
            # Телефон говорить конвертом PH3, а не кадром храповика. Ім'я
            # відправника бере АДРЕСА скриньки — її склав той, хто має ключ
            # пари, і підписатись у ній чужим іменем нічим.
            row = await _land_phone_letter(
                session,
                keys,
                owner_user_id,
                device=phones[slot.peer_id],
                pair_key=pair_by_phone.get(slot.peer_id) or b"",
                relay_key=keys_by_peer[slot.peer_id],
                frame=text,
                blob=letter.blob,
                epoch=slot.epoch,
                courier=courier,
            )
            if row is None:
                continue
            accepted += 1
            rows.append(row)
            continue
        try:
            envelope = json.loads(text)
            frame = bytes.fromhex(str(envelope.get("frame") or ""))
        except (ValueError, TypeError, AttributeError):
            logger.info("конверт зі скриньки %s не за формою", slot.peer_id[:8])
            continue
        if not frame:
            continue
        # Відправника називає АДРЕСА скриньки, а не поле в конверті: адресу
        # склав той, хто має ключ пари, і підписатись у ній чужим іменем нічим.
        try:
            row = await accept_frame(
                session,
                keys,
                owner_user_id,
                frame,
                slot.peer_id,
                reply_address=envelope.get("reply_address"),
                road="drop",
            )
        except Exception as exc:  # noqa: BLE001 — один отруйний лист не валить захід
            logger.info("лист зі сховка від %s не прийнявся: %s", slot.peer_id[:8], exc)
            continue
        accepted += 1
        if isinstance(row, MessengerMessage):
            rows.append(row)

    if to_burn:
        burned = await courier.burn(to_burn)
        if not isinstance(burned, Burned):
            # Копії доживуть до TTL; роздвоїти стрічку їм не дасть храповик —
            # той самий кадр удруге вже не відчиниться.
            logger.info("копії у сховку не спалились: %s", burned.__class__.__name__)
    return Visit(
        answered=True, letters=len(fetched.letters), accepted=accepted, rows=rows
    )
