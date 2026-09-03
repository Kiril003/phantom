"""Група: один текст — N попарних кадрів, кожен своєю сесією.

Групового спільного секрету тут немає і не буде. Кадр групи — це звичайний
кадр попарної сесії з третім токеном у конверті, тож він їде тими самими
чотирма дорогами, лягає в ту саму чергу і переживає вимкнений телефон рівно
так само, як переживало б особисте повідомлення.

Чому попарний віяр, а не sender keys: віяру немає ніде на дорозі —
`transport.deliver()` бере рівно один peer_node_id, тож кадр однаково їде N
разів. Байти на дроті різняться на 2%, а sender key довелося б ротувати
руками на кожен вихід із групи, тоді як Double Ratchet лікується сам.

Автентичність відправника тут безкоштовна: кожен отримувач перевіряє кадр
СВОЄЮ сесією, тож підписатися чужим іменем нічим. У sender keys ключ
відправника лежить у всіх учасників, і для того самого потрібен був би
окремий підпис на кожне повідомлення.

Чого тут НЕМАЄ і не буде: жодних адміністративних прав. Коли в учасника є
склад групи і попарні сесії, він фізично може написати кожному напряму —
ані «лише читання», ані «мут» вузлом не спиняються. Єдине адміністративне
правило, яке крипта справді тримає: склад веде творець.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import (
    MessengerContact,
    MessengerConversation,
    MessengerGroupDelivery,
    MessengerGroupMember,
    MessengerMessage,
)
from messenger.blobs import wrap_frame
from messenger.crypto.keys import KeyStore, PublicBundle, UntrustedBundle
from messenger.crypto.safety import safety_number
from messenger.crypto.session import Session
from messenger.transport import deliver, drop_pair_key_of, drop_road, supabase_road

logger = logging.getLogger(__name__)

__all__ = [
    "GroupError",
    "MAX_GROUP_ATTEMPTS",
    "MAX_GROUP_MEMBERS",
    "accept_invite",
    "active_members",
    "bundle_without_one_time",
    "conversation_by_group_id",
    "create_group",
    "fan_out",
    "flush_group_queue",
    "group_fingerprint",
    "member_of",
    "new_group_id",
    "self_member",
]

#: Стеля V1. Число не кругле — воно виведене, і впирається не крипта.
#:
#: Одне повністю застрягле групове повідомлення — це 31 рядок доставки. Прохід
#: повторів бере LIMIT 50 рядків раз на 45 с (`redelivery.MAX_ATTEMPTS` поруч,
#: `flush_queue(limit=50)`), тож 31 ще вміщається в ОДИН прохід і не морить
#: голодом решту черги. При 50 учасниках 49 рядків зʼїдають прохід цілком, і
#: все інше в черзі стоїть, доки вони не розсмокчуться.
#:
#: Крипта на 32 коштує 8.3 мс віяра і 11.8 КБ на дроті — не проблема ні на
#: якому N. Тому межа саме тут, і вище — чесна відмова, а не мовчазне гальмо.
MAX_GROUP_MEMBERS = 32

#: Після цього рядок доставки лишається queued назавжди, як і в особистій
#: черзі: вимкнений телефон — не привід виганяти людину з групи.
MAX_GROUP_ATTEMPTS = 12


class GroupError(Exception):
    """Групу не створити або кадр не віддати — з поясненням, а не мовчки."""


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def new_group_id() -> str:
    """16 байтів hex. Спільне імʼя групи на всіх вузлах і більше нічого."""
    return os.urandom(16).hex()


def group_fingerprint(epoch: int, node_ids: Iterable[str]) -> str:
    """Перші 16 hex від sha256(epoch ‖ sorted(node_id)).

    Творець фізично може розповісти різним людям різне про склад групи, і
    криптографія цього не ловить. Відбиток не лікує це — він робить це
    видимим: двоє читають 16 hex вголос, збіглось — складу не роздвоїли.
    """
    payload = f"{int(epoch)}\n" + "\n".join(sorted(set(node_ids)))
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def bundle_without_one_time(bundle_json: str) -> dict:
    """Bundle для роздачі в групі — завжди без одноразового prekey.

    Один OPK не ділиться між учасниками: той самий bundle у двох ініціаторів
    дає другому відмову «одноразовий prekey вже витрачений», і меш не
    зійшовся б ніколи. Ціна відома і її треба називати вголос: X3DH іде на
    трьох DH замість чотирьох, тобто немає захисту від повтору першого кадру
    після компрометації signed prekey.
    """
    data = json.loads(bundle_json or "{}")
    if not isinstance(data, dict):
        raise GroupError("bundle учасника не читається")
    data.pop("one_time_prekey", None)
    data.pop("one_time_prekey_id", None)
    return data


# ── Склад ────────────────────────────────────────────────────────────────────


async def conversation_by_group_id(
    session: AsyncSession, owner_user_id: str, group_id: str
) -> Optional[MessengerConversation]:
    if not group_id:
        return None
    return (
        await session.execute(
            select(MessengerConversation).where(
                MessengerConversation.owner_user_id == owner_user_id,
                MessengerConversation.group_id == group_id,
            )
        )
    ).scalar_one_or_none()


async def member_of(
    session: AsyncSession, conversation_id: str, node_id: str
) -> Optional[MessengerGroupMember]:
    return (
        await session.execute(
            select(MessengerGroupMember).where(
                MessengerGroupMember.conversation_id == conversation_id,
                MessengerGroupMember.node_id == node_id,
            )
        )
    ).scalar_one_or_none()


async def self_member(
    session: AsyncSession, conversation_id: str, own_node_id: str
) -> Optional[MessengerGroupMember]:
    return await member_of(session, conversation_id, own_node_id)


async def active_members(
    session: AsyncSession, conversation_id: str
) -> list[MessengerGroupMember]:
    return list(
        (
            await session.execute(
                select(MessengerGroupMember)
                .where(
                    MessengerGroupMember.conversation_id == conversation_id,
                    MessengerGroupMember.state == "active",
                )
                .order_by(MessengerGroupMember.node_id)
            )
        ).scalars().all()
    )


async def all_members(
    session: AsyncSession, conversation_id: str
) -> list[MessengerGroupMember]:
    return list(
        (
            await session.execute(
                select(MessengerGroupMember)
                .where(MessengerGroupMember.conversation_id == conversation_id)
                .order_by(MessengerGroupMember.node_id)
            )
        ).scalars().all()
    )


async def ensure_contact(
    session: AsyncSession,
    keys: KeyStore,
    owner_user_id: str,
    member: MessengerGroupMember,
) -> Optional[MessengerContact]:
    """Попарна сесія з учасником — ліниво, на першому кадрі до нього.

    Меш обовʼязковий (кожен мусить уміти писати кожному), але зводити 31 X3DH
    прямо на вході в групу означало б 55 мс паузи на порожньому місці. Тому
    сесія зводиться тоді, коли справді треба щось надіслати.
    """
    contact: Optional[MessengerContact] = None
    if member.contact_id:
        contact = await session.get(MessengerContact, member.contact_id)
    if contact is None:
        contact = (
            await session.execute(
                select(MessengerContact).where(
                    MessengerContact.owner_user_id == owner_user_id,
                    MessengerContact.peer_node_id == member.node_id,
                )
            )
        ).scalar_one_or_none()

    if contact is None:
        if not member.bundle_json:
            return None
        try:
            bundle = PublicBundle.from_dict(json.loads(member.bundle_json))
            bundle.verify(expected_node_id=member.node_id)
        except (UntrustedBundle, KeyError, ValueError, TypeError) as exc:
            logger.info("bundle учасника %s не прийнято: %s", member.node_id[:8], exc)
            return None
        peer_session = Session.initiate(keys, bundle, expected_node_id=member.node_id)
        contact = MessengerContact(
            owner_user_id=owner_user_id,
            peer_node_id=member.node_id,
            display_name=member.display_name,
            peer_address=member.address,
            bundle_json=bundle.to_json(),
            session_blob=peer_session.serialize(keys).hex(),
            safety_number=safety_number(
                keys.identity_ed_public,
                keys.identity_dh_public,
                bundle.identity_ed,
                bundle.identity_dh,
            ),
            created_at=_now(),
            updated_at=_now(),
        )
        session.add(contact)
        await session.flush()

    # Адресу з складу беремо лише коли своєї немає: те, що розповів творець,
    # не має переписувати адресу, яку власник поставив руками.
    if member.address and not contact.peer_address:
        contact.peer_address = member.address
    member.contact_id = contact.id
    return contact


# ── Дороги ───────────────────────────────────────────────────────────────────


def _roads() -> tuple[str, str, str, str, str]:
    from config import config

    relay = (config.relay_url or "") if config.relay_enabled else ""
    sb_url, sb_key = supabase_road(config)
    return relay, sb_url, sb_key, config.messenger_public_address, drop_road(config)


async def _try_deliver(
    own_node_id: str,
    member_node_id: str,
    frame_hex: str,
    address: str,
    drop_key: bytes = b"",
) -> Optional[bool]:
    """Одна спроба довезти один кадр.

    True — вузол-адресат відповів 200. False — дорога є, але мовчить. None —
    дороги немає взагалі, і псувати лічильник спроб за це нечесно.

    `drop_key` — ключ пари з цим учасником: адресу сховка складають лише двоє,
    тож без ключа сховок для цього кадру — не дорога. Виводить його той, хто
    має контакт учасника (`drop_pair_key_of`), сюди приходить готовий.
    """
    relay, sb_url, sb_key, reply_address, store_url = _roads()
    if not address and not relay and not sb_url and not (store_url and drop_key):
        return None
    if not frame_hex:
        return None
    return await deliver(
        bytes.fromhex(frame_hex),
        peer_node_id=member_node_id,
        from_node_id=own_node_id,
        peer_address=address,
        relay=relay,
        supabase_url=sb_url,
        supabase_key=sb_key,
        drop_url=store_url,
        drop_key=drop_key,
        reply_address=reply_address,
    )


async def _attempt_row(
    own_node_id: str,
    row: MessengerGroupDelivery,
    member: Optional[MessengerGroupMember],
    address: str,
    drop_key: bytes = b"",
) -> bool:
    """Спроба по рядку черги: веде і сам рядок, і лічильники учасника."""
    ok = await _try_deliver(
        own_node_id, row.member_node_id, row.outbound_frame or "", address, drop_key
    )
    if ok is None:
        return False
    row.attempts += 1
    row.last_attempt_at = _now()
    if ok:
        row.state = "sent"
        # Кадр доїхав — зберігати його далі лише зайвий ризик.
        row.outbound_frame = None
        if member is not None:
            member.last_delivered_at = _now()
            member.failed_attempts = 0
        return True
    if member is not None:
        member.failed_attempts += 1
    return False


# ── Створення групи ──────────────────────────────────────────────────────────


async def create_group(
    session: AsyncSession,
    keys: KeyStore,
    owner_user_id: str,
    *,
    title: str,
    contacts: list[MessengerContact],
    own_display_name: str = "Я",
) -> MessengerConversation:
    """Заводить групу і розсилає запрошення наявним контактам.

    Тільки з наявних контактів: щоб зашифрувати людині, потрібен її ключ, а
    він береться з контакту. Запрошень за посиланням і QR немає — творець
    додає, ти приймаєш.
    """
    title = (title or "").strip() or "Група"
    seen: dict[str, MessengerContact] = {}
    for contact in contacts:
        if contact.peer_node_id == keys.node_id:
            continue
        seen.setdefault(contact.peer_node_id, contact)
    picked = list(seen.values())
    if not picked:
        raise GroupError("групі потрібен хоча б один учасник із контактів")
    if len(picked) + 1 > MAX_GROUP_MEMBERS:
        raise GroupError(
            f"у групі V1 не більше {MAX_GROUP_MEMBERS} учасників разом із вами: "
            f"одне застрягле повідомлення на {MAX_GROUP_MEMBERS - 1} отримувачів "
            "ще вміщається в один прохід черги повторів, більше — вже ні"
        )
    for contact in picked:
        if not contact.bundle_json:
            raise GroupError(
                f"для {contact.display_name} немає ключа — без нього шифрувати нічим"
            )

    group_id = new_group_id()
    epoch = 1
    node_ids = [keys.node_id] + [c.peer_node_id for c in picked]
    conversation = MessengerConversation(
        owner_user_id=owner_user_id,
        title=title,
        kind="group",
        circle="all",
        group_id=group_id,
        group_creator_node_id=keys.node_id,
        group_epoch=epoch,
        group_fingerprint=group_fingerprint(epoch, node_ids),
        created_at=_now(),
        updated_at=_now(),
    )
    session.add(conversation)
    await session.flush()

    from config import config

    session.add(
        MessengerGroupMember(
            conversation_id=conversation.id,
            node_id=keys.node_id,
            display_name=own_display_name,
            role="creator",
            state="active",
            added_epoch=epoch,
            bundle_json=keys.publish_bundle(with_one_time=False).to_json(),
            # Власна адреса їде у складі поруч із чужими: без неї учасник,
            # який нас іще не знає, не мав би куди відповісти.
            address=(config.messenger_public_address or "").strip() or None,
        )
    )
    for contact in picked:
        session.add(
            MessengerGroupMember(
                conversation_id=conversation.id,
                node_id=contact.peer_node_id,
                display_name=contact.display_name,
                contact_id=contact.id,
                bundle_json=json.dumps(
                    bundle_without_one_time(contact.bundle_json),
                    separators=(",", ":"),
                    sort_keys=True,
                ),
                address=contact.peer_address,
                role="member",
                state="active",
                added_epoch=epoch,
            )
        )
    await session.flush()
    return conversation


def _roster_body(
    conversation: MessengerConversation, members: list[MessengerGroupMember]
) -> str:
    return json.dumps(
        {
            "g": conversation.group_id,
            "name": conversation.title,
            "epoch": conversation.group_epoch or 1,
            "fp": conversation.group_fingerprint or "",
            "members": [
                {
                    "id": m.node_id,
                    "name": m.display_name,
                    "bundle": json.loads(m.bundle_json) if m.bundle_json else None,
                    "addr": m.address or "",
                }
                for m in members
            ],
        },
        separators=(",", ":"),
    )


async def send_invites(
    session: AsyncSession,
    keys: KeyStore,
    owner_user_id: str,
    conversation: MessengerConversation,
) -> dict[str, int]:
    """Розсилає group:invite усім, крім себе. Не доїхало — лягає в чергу."""
    members = await all_members(session, conversation.id)
    body = _roster_body(conversation, members)
    targets = [m for m in members if m.node_id != keys.node_id and m.state == "active"]
    return await _fan_frames(
        session,
        keys,
        owner_user_id,
        conversation,
        targets,
        kind="group:invite",
        body=body,
        origin="",
        gseq=0,
        message_id=None,
    )


# ── Віяр ─────────────────────────────────────────────────────────────────────


async def _fan_frames(
    session: AsyncSession,
    keys: KeyStore,
    owner_user_id: str,
    conversation: MessengerConversation,
    targets: list[MessengerGroupMember],
    *,
    kind: str,
    body: str,
    origin: str,
    gseq: int,
    message_id: Optional[str],
) -> dict[str, int]:
    """Шифрує окремий кадр КОЖНОМУ і пробує довезти.

    Кадр кожному свій і неповторний: храповик зсувається на кожне шифрування,
    тож перешифрувати той самий текст удруге означало б надіслати людині два
    різні повідомлення. Саме тому кадри лягають рядками окремої черги, а не в
    одну колонку повідомлення.
    """
    plaintext = wrap_frame(
        kind, body, origin, group=f"{conversation.group_id}:{gseq}"
    )
    sent = 0
    queued = 0
    skipped = 0
    for member in targets:
        contact = await ensure_contact(session, keys, owner_user_id, member)
        if contact is None or not contact.session_blob:
            # Немає ключа — немає й кадру. Мовчки вдавати доставку не будемо.
            skipped += 1
            continue
        peer_session = Session.restore(keys, bytes.fromhex(contact.session_blob))
        frame = peer_session.encrypt(plaintext.encode())
        contact.session_blob = peer_session.serialize(keys).hex()
        contact.updated_at = _now()
        address = contact.peer_address or member.address or ""
        drop_key = drop_pair_key_of(keys, contact)

        if message_id is None:
            # Запрошення не має рядка в стрічці, тож і черги під нього немає:
            # не доїхало — творець надішле ще раз руками. Вигадувати запрошенню
            # власну чергу в V1 означало б обіцяти те, чого немає.
            ok = await _try_deliver(
                keys.node_id, member.node_id, frame.hex(), address, drop_key
            )
            if ok:
                member.last_delivered_at = _now()
                member.failed_attempts = 0
                sent += 1
            else:
                member.failed_attempts += 1
                queued += 1
            continue

        # attempts проставляємо руками: спроба йде ДО flush, а дефолт колонки
        # спрацював би лише на записі — тобто вже після першого лічильника.
        row = MessengerGroupDelivery(
            message_id=message_id,
            member_node_id=member.node_id,
            outbound_frame=frame.hex(),
            state="queued",
            attempts=0,
            created_at=_now(),
        )
        session.add(row)
        if await _attempt_row(keys.node_id, row, member, address, drop_key):
            sent += 1
        else:
            queued += 1
    await session.commit()
    return {"sent": sent, "queued": queued, "skipped": skipped}


async def outgoing_gseq(
    session: AsyncSession, conversation_id: str, own_node_id: str
) -> int:
    """Лічильник НА ВІДПРАВНИКА, а не на групу.

    Глобального номера в групі бути не може без сервера, і вдавати його ми не
    будемо. Це число служить дедупу і виявленню діри («від Ольги бракує #7»),
    а не сортуванню: у стрічці рядки лягають за порядком прибуття, і в двох
    учасників порядок двох майже одночасних реплік може відрізнятись.
    """
    from sqlalchemy import func

    return int(
        (
            await session.execute(
                select(func.count())
                .select_from(MessengerMessage)
                .where(
                    MessengerMessage.conversation_id == conversation_id,
                    MessengerMessage.author_id == own_node_id,
                )
            )
        ).scalar_one()
    )


async def fan_out(
    session: AsyncSession,
    keys: KeyStore,
    owner_user_id: str,
    conversation: MessengerConversation,
    message: MessengerMessage,
    *,
    kind: str,
    body: str,
) -> dict[str, int]:
    """Розносить одне повідомлення всьому активному складу, крім себе."""
    if not conversation.group_id:
        raise GroupError("це не група")
    mine = await self_member(session, conversation.id, keys.node_id)
    if mine is None or mine.state != "active":
        raise GroupError("ви ще не в цій групі — запрошення не прийнято")

    members = await active_members(session, conversation.id)
    targets = [m for m in members if m.node_id != keys.node_id]
    gseq = await outgoing_gseq(session, conversation.id, keys.node_id)
    return await _fan_frames(
        session,
        keys,
        owner_user_id,
        conversation,
        targets,
        kind=kind,
        body=body,
        origin=message.client_id,
        gseq=gseq,
        message_id=message.id,
    )


# ── Приймання запрошення ─────────────────────────────────────────────────────


async def accept_invite(
    session: AsyncSession,
    keys: KeyStore,
    owner_user_id: str,
    sender_node_id: str,
    body: str,
    *,
    expected_group_id: str = "",
) -> Optional[MessengerConversation]:
    """Кладе групу в список у стані «чекає на вашу згоду».

    Мовчки не приєднуємо: у складі зʼявляється рядок про нас зі станом
    pending, і доки його не прийняли, вузол у цю групу нічого не пише.

    Творцем визнаємо ТОГО, ХТО ПРИСЛАВ: кадр приїхав попарною сесією, тобто
    вже автентифікований храповиком, і підробити відправника нічим.
    """
    try:
        data = json.loads(body or "{}")
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None

    group_id = str(data.get("g") or "").strip()
    if len(group_id) != 32 or any(c not in "0123456789abcdef" for c in group_id):
        return None
    if expected_group_id and expected_group_id != group_id:
        # Конверт каже одну групу, тіло — іншу. Довіряти такому нема чого.
        return None

    roster = data.get("members")
    if not isinstance(roster, list) or not roster:
        return None
    if len(roster) > MAX_GROUP_MEMBERS:
        logger.info("запрошення в групу на %d — понад стелю V1", len(roster))
        return None

    existing = await conversation_by_group_id(session, owner_user_id, group_id)
    if existing is not None:
        # Уже знаємо цю групу. Повторне запрошення нічого не змінює: склад
        # веде творець окремими кадрами, а їх у V1 ще немає.
        return existing

    epoch = int(data.get("epoch") or 1)
    parsed: list[dict[str, Any]] = []
    for item in roster:
        if not isinstance(item, dict):
            continue
        node = str(item.get("id") or "").strip()
        if not node:
            continue
        bundle_json = None
        raw_bundle = item.get("bundle")
        if isinstance(raw_bundle, dict):
            try:
                bundle = PublicBundle.from_dict(raw_bundle)
                bundle.verify(expected_node_id=node)
            except (UntrustedBundle, KeyError, ValueError, TypeError) as exc:
                logger.info("у запрошенні bundle %s не прийнято: %s", node[:8], exc)
                continue
            if bundle.one_time_prekey is not None:
                # Одноразовий ключ у роздачі — знак, що творець роздав його
                # всім. Другий ініціатор отримав би відмову, тож прибираємо.
                raw_bundle = bundle_without_one_time(bundle.to_json())
            bundle_json = json.dumps(
                raw_bundle, separators=(",", ":"), sort_keys=True
            )
        parsed.append(
            {
                "id": node,
                "name": str(item.get("name") or f"Вузол {node[:8]}")[:120],
                "bundle": bundle_json,
                "addr": str(item.get("addr") or "")[:255] or None,
            }
        )

    ids = {p["id"] for p in parsed}
    if sender_node_id not in ids or keys.node_id not in ids:
        # Або нас немає у складі, або відправника — таке запрошення безглузде.
        return None

    conversation = MessengerConversation(
        owner_user_id=owner_user_id,
        title=str(data.get("name") or "Група")[:200],
        kind="group",
        circle="all",
        group_id=group_id,
        group_creator_node_id=sender_node_id,
        group_epoch=epoch,
        # Відбиток рахуємо СВОЇМ складом, а не переписуємо з кадру: інакше
        # звіряли б не склад, а те, що творець про нього сказав.
        group_fingerprint=group_fingerprint(epoch, ids),
        created_at=_now(),
        updated_at=_now(),
    )
    session.add(conversation)
    await session.flush()

    for item in parsed:
        mine = item["id"] == keys.node_id
        session.add(
            MessengerGroupMember(
                conversation_id=conversation.id,
                node_id=item["id"],
                display_name=item["name"],
                bundle_json=item["bundle"],
                address=item["addr"],
                role="creator" if item["id"] == sender_node_id else "member",
                state="pending" if mine else "active",
                added_epoch=epoch,
            )
        )
    await session.flush()
    return conversation


# ── Черга повторів ───────────────────────────────────────────────────────────


async def settle_message_state(session: AsyncSession, message_id: str) -> str:
    """Стан групового повідомлення — це стан НАЙГІРШОГО з його рядків.

    «Надіслано» на бульбашці означає «взяли всі вузли складу». Доки хоч один
    рядок у черзі, галочка була б брехнею на користь того, хто пише.
    """
    rows = list(
        (
            await session.execute(
                select(MessengerGroupDelivery).where(
                    MessengerGroupDelivery.message_id == message_id
                )
            )
        ).scalars().all()
    )
    message = await session.get(MessengerMessage, message_id)
    if message is None:
        return "local"
    if not rows:
        state = "local"
    elif all(r.state == "sent" for r in rows):
        state = "sent"
    else:
        state = "queued"
    message.delivery_state = state
    message.delivery_attempts = max((r.attempts for r in rows), default=0)
    message.last_attempt_at = max(
        (r.last_attempt_at for r in rows if r.last_attempt_at), default=None
    )
    return state


async def flush_group_queue(
    session: AsyncSession,
    own_node_id: str,
    *,
    limit: int = 50,
    keys: Optional[KeyStore] = None,
) -> int:
    """Довозить групові кадри, які не доїхали. Повертає кількість доставлених.

    Той самий LIMIT 50, що й в особистій черзі, і саме він визначає стелю в 32
    учасники: одне повністю застрягле повідомлення на 31 отримувача ще
    вміщається в один прохід, а на 49 — уже морить голодом усе інше.

    `keys` потрібні лише сховку: ключ пари складається з приватного ключа
    вузла і контакта учасника. Без них прохід поводиться як раніше.
    """
    rows = list(
        (
            await session.execute(
                select(MessengerGroupDelivery)
                .where(
                    MessengerGroupDelivery.state == "queued",
                    MessengerGroupDelivery.outbound_frame.is_not(None),
                    MessengerGroupDelivery.attempts < MAX_GROUP_ATTEMPTS,
                )
                .order_by(MessengerGroupDelivery.created_at, MessengerGroupDelivery.id)
                .limit(limit)
            )
        ).scalars().all()
    )
    if not rows:
        return 0

    delivered = 0
    touched: set[str] = set()
    for row in rows:
        message = await session.get(MessengerMessage, row.message_id)
        if message is None:
            continue
        conversation = await session.get(
            MessengerConversation, message.conversation_id
        )
        if conversation is None:
            continue
        member = await member_of(session, conversation.id, row.member_node_id)
        address = ""
        drop_key = b""
        if member is not None and member.contact_id:
            contact = await session.get(MessengerContact, member.contact_id)
            if contact is not None:
                address = contact.peer_address or ""
                if keys is not None:
                    drop_key = drop_pair_key_of(keys, contact)
        if not address and member is not None:
            address = member.address or ""
        if await _attempt_row(own_node_id, row, member, address, drop_key):
            delivered += 1
        touched.add(row.message_id)

    for message_id in touched:
        await settle_message_state(session, message_id)
    await session.commit()
    return delivered
