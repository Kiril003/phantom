"""Приймальня: кадр від чужого вузла стає повідомленням у стрічці.

Автентичність тут дає не заголовок і не токен, а сама криптографія: кадр або
розшифровується сесією з цим співрозмовником, або ні. Підробити відправника
неможливо, не маючи його ключів, тож окремої «авторизації відправника» не
існує — вона була б слабшою за те, що вже є.

Перший кадр від незнайомця відкриває нову сесію і створює контакт, але
verified_at лишається порожнім: те, що людина вміє шифрувати, ще не означає,
що вона та, за кого себе видає. Звірку робить власник голосом.

Не кожен кадр стає рядком у стрічці. Службовий кадр kind='delete' нічого не
показує — він ВИКОНУЄТЬСЯ: знаходить своє повідомлення, стирає тіло, знімає
вкладення з диска. Їде він тією ж дорогою і тією ж сесією, що й текст, саме
тому видалення доїжджає навіть до вузла, який був вимкнений: кадр чекає в
черзі відправника рівно так само, як чекало б звичайне повідомлення.

Кадр kind='radio' — те саме за формою, але інше за суттю: це шматок голосу з
режиму рації. Голос їде кадром саме тому, що кадр — єдина дорога, яка ще жива,
коли RTP уже не доходить: він переживає втрати, бо його везуть по TCP з
повтором, і його не треба домовляти наново. У стрічку він не лягає — розмову
чують, а не читають, і рядок «6 КБ звуку» в чаті був би сміттям.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional, Union

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import MessengerContact, MessengerConversation, MessengerMessage
from messenger.blobs import ORIGIN_LIMIT, unwrap_frame
from messenger.crypto.at_rest import seal
from messenger.crypto.keys import KeyStore
from messenger.crypto.safety import safety_number
from messenger.crypto.session import Session
from messenger.geo import parse_point
from messenger.purge import find_by_origin, tombstone

__all__ = ["InboxError", "RadioFrame", "accept_frame", "conversation_for"]


class InboxError(Exception):
    """Кадр не належить жодній відомій сесії."""


@dataclass(frozen=True)
class RadioFrame:
    """Шматок голосу з рації: його чують і забувають, у базі він не осідає."""

    peer_node_id: str
    #: JSON з {call_id, seq, audio_b64} — розбирає його той, хто веде дзвінок.
    body: str


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


async def conversation_for(
    session: AsyncSession, owner_user_id: str, contact: MessengerContact
) -> MessengerConversation:
    # ДВІ РОЗМОВИ НА ОДИН КОНТАКТ ВАЛИЛИ ВУЗОЛ. Виправлено 30.08.2026.
    #
    # Тут стояв `scalar_one_or_none()`, який на другому рядку **кидає**
    # `MultipleResultsFound`. А дві розмови з однією людиною завести легко:
    # `POST /messenger/conversations` з тим самим `contact_id` дублікату не
    # перевіряв. Наслідок виміряний на двох живих вузлах: кожен вхідний лист
    # від цієї людини діставав **500**, відправник лишався з `queued` і
    # повторював вічно, а отримувач не бачив нічого. Єдиний слід — стек у
    # журналі, бо виняток був необробленим.
    #
    # Беремо найранішу: вона та, у якій уже лежить листування. Порядок
    # детермінований навмисно — інакше кадри тієї самої людини лягали б у
    # різні розмови залежно від того, як база поверне рядки.
    row = (
        await session.execute(
            select(MessengerConversation)
            .where(
                MessengerConversation.owner_user_id == owner_user_id,
                MessengerConversation.contact_id == contact.id,
            )
            .order_by(MessengerConversation.created_at, MessengerConversation.id)
            .limit(1)
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


async def _group_conversation(
    session: AsyncSession,
    keys: KeyStore,
    owner_user_id: str,
    contact: MessengerContact,
    kind: str,
    body: str,
    group_id: str,
) -> Optional[MessengerConversation]:
    """Яка розмова прийме груповий кадр — і чи прийме взагалі.

    Правила тут навмисно суворі: інакше груповий токен у конверті став би
    способом матеріалізувати будь-що в чужому списку розмов.
    """
    from messenger.groups import accept_invite, conversation_by_group_id, member_of

    if kind == "group:invite":
        return await accept_invite(
            session,
            keys,
            owner_user_id,
            contact.peer_node_id,
            body,
            expected_group_id=group_id,
        )

    conversation = await conversation_by_group_id(session, owner_user_id, group_id)
    if conversation is None:
        # Кадр про групу, якої ми не знаємо. Приєднати нас до неї міг би лише
        # group:invite, а текст сам собою — ні.
        return None
    member = await member_of(session, conversation.id, contact.peer_node_id)
    if member is None or member.state != "active":
        # Пише той, кого немає в нашій копії складу. Мовчки відкидаємо.
        return None
    return conversation


async def _group_client_id(
    session: AsyncSession,
    conversation_id: str,
    origin: str,
    author_id: str,
) -> tuple[str, Optional[MessengerMessage]]:
    """Імʼя рядка в груповій стрічці плюс той рядок, якщо він уже є.

    Дедуп тримається на UniqueConstraint(conversation_id, client_id) — той
    самий кадр удруге дає той самий рядок. Але в групі origin вигадують РІЗНІ
    вузли, тож збіг двох імен від двох людей теоретично можливий, і тоді
    унікальність зняла б чуже повідомлення. Такий збіг розводимо власним
    імʼям, а не втратою рядка.
    """
    candidate = f"in_{origin[:ORIGIN_LIMIT]}" if origin else ""
    if not candidate:
        return f"in_{uuid.uuid4().hex[:16]}", None
    existing = (
        await session.execute(
            select(MessengerMessage).where(
                MessengerMessage.conversation_id == conversation_id,
                MessengerMessage.client_id == candidate,
            )
        )
    ).scalar_one_or_none()
    if existing is None:
        return candidate, None
    if existing.author_id == author_id:
        return candidate, existing
    return f"in_{uuid.uuid4().hex[:16]}", None


async def accept_frame(
    session: AsyncSession,
    keys: KeyStore,
    owner_user_id: str,
    frame: bytes,
    peer_node_id: Optional[str] = None,
    *,
    reply_address: Optional[str] = None,
    road: str = "relay",
) -> Optional[Union[MessengerMessage, RadioFrame]]:
    """Розшифровує кадр і кладе повідомлення у стрічку власника.

    Повертає рядок стрічки: нове повідомлення, а для кадру 'delete' — той
    надгробок, який щойно лишився від видаленого. Для 'radio' повертає
    `RadioFrame`: у стрічці йому місця немає, його треба віддати живому
    дзвінку. None означає «кадр прийнято й виконано, показувати нічого»:
    наприклад, видалення приїхало на те, чого в нас ніколи не було. Це не
    помилка, тож і 400 у відповідь бути не може — інакше відправник вічно
    повторював би кадр, який уже зробив свою роботу.

    `road` — якою дорогою кадр приїхав: direct | relay | mailbox. Це не
    прикраса: точка, що чекала у скриньці, народжується застарілою навіть коли
    доїхала за секунду після виміру, і без назви дороги сказати це нічим.
    """
    contact = (
        await _contact_for(session, owner_user_id, peer_node_id) if peer_node_id else None
    )

    if contact is not None and contact.session_blob:
        peer_session = Session.restore(keys, bytes.fromhex(contact.session_blob))
        try:
            plaintext = peer_session.decrypt(frame)
        except Exception as restore_exc:  # noqa: BLE001
            # ДВОЄ, ЩО ДОДАЛИ ОДНЕ ОДНОГО, НЕ МОГЛИ ГОВОРИТИ. Виправлено 30.08.2026.
            #
            # Тут був глухий кут: наявна сесія не розшифрувала — відмова. Але
            # людина, яка завела наш контакт із бандла, тримає ВЛАСНУ вихідну
            # сесію й пише саме нею, тобто надсилає ПОЧАТКОВИЙ кадр X3DH. Наша
            # сесія його розібрати не може за побудовою: ключі виводили двоє
            # незалежно, і храповики не збіглися.
            #
            # Виміряно на двох живих вузлах:
            #   * обидва додали одне одного → «тег не зійшовся», лист не доходив
            #     НІКОЛИ, скільки б повторів не було;
            #   * лише відправник додав отримувача → дійшло за 2 с.
            # Тобто ламало саме взаємне знайомство — те, що двоє людей роблять
            # природно, обмінявшись запрошеннями в обидва боки.
            #
            # Тому початковий кадр має право перезаснувати сесію. Це не
            # послаблення: `Session.accept` вимагає справжньої X3DH з нашим
            # бандлом, і сміття крізь неї не проходить — перевірено кадром
            # `de`*200, який дає відмову.
            try:
                peer_session, plaintext = Session.accept(keys, frame)
            except Exception:  # noqa: BLE001
                raise InboxError(
                    f"кадр не розшифровується сесією: {restore_exc}"
                ) from restore_exc
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

    # Тип приїхав у самому кадрі. Старий кадр без конверта лишається текстом,
    # тож уже зведені сесії від цього нічого не помічають.
    kind, body, origin, group = unwrap_frame(plaintext.decode())

    # Порожній тип — умовний знак від `unwrap_frame`: приїхав СЛУЖБОВИЙ кадр
    # невідомого типу. Такий не лишає у стрічці нічого — ні рядка, ні
    # порожньої бульбашки, ні місця під неї. Без цієї гілки він став би
    # текстом «ця версія не вміє показати» просто посеред розмови, і для
    # реакції чи іншої тихої дії це сміття, гірше за відсутність можливості.
    #
    # Стан храповика вже зрушено вище — його треба зберегти в БУДЬ-ЯКОМУ разі,
    # інакше наступний кадр від цієї людини не розшифрується.
    if not kind:
        await session.commit()
        return None

    group_id = group.partition(":")[0]

    if group_id or kind == "group:invite":
        # Груповий кадр НЕ має права матеріалізувати особисту розмову: інакше
        # будь-хто заводив би собі рядок у чужому списку самим лише кадром.
        conversation = await _group_conversation(
            session, keys, owner_user_id, contact, kind, body, group_id
        )
        if conversation is None:
            # Невідома група, не той відправник або зіпсоване запрошення.
            # Стан храповика вже зрушено — його треба зберегти в будь-якому
            # разі, інакше наступний кадр від цієї людини не розшифрується.
            await session.commit()
            return None
        if kind == "group:invite":
            conversation.updated_at = _now()
            await session.commit()
            return None
    else:
        conversation = await conversation_for(session, owner_user_id, contact)

    if kind == "radio":
        # Голос, а не лист. Стан храповика вже зрушено вище і його треба
        # зберегти в будь-якому разі, інакше наступний кадр від цієї людини —
        # хоч голос, хоч текст — уже не розшифрується.
        await session.commit()
        return RadioFrame(peer_node_id=contact.peer_node_id, body=body)

    if kind == "delete":
        # Службовий кадр: ніякого нового рядка, лише робота над наявним.
        # Стан храповика вже зрушено вище — його треба зберегти в будь-якому
        # разі, інакше наступний кадр від цієї людини не розшифрується.
        target = await find_by_origin(session, conversation.id, body.strip())
        if target is None:
            await session.commit()
            return None
        await tombstone(session, keys, target)
        conversation.updated_at = _now()
        await session.commit()
        await session.refresh(target)
        return target

    if kind == "geo:point" and parse_point(body) is None:
        # Тіло без координат — не точка. Показати її нічим, а храповик уже
        # зрушено вище: стан треба зберегти, інакше наступний кадр не відкриється.
        await session.commit()
        return None

    # Ім'я з вузла-відправника під префіксом: воно єдине спільне для двох
    # вузлів, і саме за ним потім приїде видалення. Немає origin (старий
    # кадр) — лишаємось із власним випадковим, але видалити таке ззовні
    # вже не вийде, і вдавати протилежне не будемо.
    client_id, duplicate = await _group_client_id(
        session, conversation.id, origin, contact.peer_node_id
    )
    if duplicate is not None:
        # Той самий кадр приїхав удруге — двома дорогами або після повтору.
        # Стан храповика вже зрушено, зберігаємо його і віддаємо наявний рядок.
        await session.commit()
        return duplicate

    row = MessengerMessage(
        id=str(uuid.uuid4()),
        conversation_id=conversation.id,
        client_id=client_id,
        seq=conversation.next_seq,
        author_id=contact.peer_node_id,
        author_name=contact.display_name,
        kind=kind,
        transport=road,
        sent_at=_now(),
    )
    row.ciphertext = seal(keys, body, aad=row.id.encode()).hex()
    conversation.next_seq += 1
    conversation.updated_at = _now()
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row
