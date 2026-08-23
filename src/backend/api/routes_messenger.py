"""`/api/v1/messenger/*` — стрічка й транспорт месенджера.

Два принципи, на яких тут усе тримається.

Перший: показуємо лише виміряне. Стан ретранслятора приходить від RelayClient,
і якщо його не піднято — так і кажемо, а не малюємо «online» із латентністю.

Другий: повідомлення не має права загубитися. Клієнт вигадує client_id ще до
відправки, тож повтор після обриву зв'язку не роздвоює запис — унікальність
пари (розмова, client_id) робить повторну доставку безпечною. Порядок тримає
лічильник next_seq у розмові, а не годинник: у телефона й ПК час розходиться.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Optional

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.websocket_hub import hub
from config import config
from db.database import get_db
from db.models import (
    MessengerBlob,
    MessengerContact,
    MessengerConversation,
    MessengerMessage,
    User,
)
from messenger.crypto.at_rest import AtRestError, seal, unseal
from messenger.crypto.keys import KeyStore, PublicBundle, UntrustedBundle
from messenger.crypto.safety import format_safety_number, safety_number
from messenger.crypto.session import Session
from messenger.blobs import wrap_frame
from messenger.guard import GuardRejected, inbox_guard
from messenger.inbox import InboxError, RadioFrame, accept_frame
from messenger.outbox import OutboxError, prepare_frame
from messenger.purge import (
    blob_ids_of,
    origin_of,
    purge_conversation_blobs,
    tombstone,
    wipe_message,
)
from messenger.transport import deliver, supabase_road
from messenger.turn import ice_payload, load_turn_config
from node.identity import node_id
# Месенджер приймає і користувацький JWT, і токен спареного пристрою:
# телефон власника — повноцінний клієнт вузла (рішення власника 23.08.2026).
from security.device_auth import get_user_or_device_user

_node_keys: KeyStore | None = None
_node_keys_path: str | None = None


def _keys() -> KeyStore:
    """Ключі вузла читаємо з диска один раз на теку даних.

    Prekey-набір теж підіймається з диска: вузол уже роздав публічні частини
    у своєму bundle, і якщо після рестарту згенерувати нові, той, хто саме
    зараз пише вперше, отримає сесію, яку неможливо прийняти.

    Кеш памʼятає, з якого файла взято ключі: у одному процесі тека даних може
    змінитися, і мовчки лишити в памʼяті ключі чужого вузла — найгірший з
    можливих наслідків, бо сесії перестають розшифровуватись без жодної помилки.
    """
    global _node_keys, _node_keys_path
    from node.identity import key_path

    current = str(key_path())
    if _node_keys is None or _node_keys_path != current:
        store = KeyStore.from_node()
        prekeys = key_path().parent / "messenger_prekeys.bin"
        if prekeys.exists():
            try:
                store.restore_prekeys(prekeys)
            except Exception as exc:  # noqa: BLE001 — зіпсований файл не має валити вузол
                logger.warning("prekey-набір не піднявся, беремо свіжий: %s", exc)
                store.persist_prekeys(prekeys)
        else:
            store.persist_prekeys(prekeys)
        _node_keys = store
        _node_keys_path = current
    return _node_keys

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/messenger", tags=["messenger"])


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ── Ретранслятор ─────────────────────────────────────────────────────────────


class RelayStatus(BaseModel):
    """Дзеркалить RelayClient.status() один-до-одного."""

    connected: bool
    node_id: str
    relay: str
    sessions: int
    last_error: str


@router.get("/relay/status", response_model=RelayStatus)
async def get_relay_status(
    request: Request,
    _user: User = Depends(get_user_or_device_user),
) -> RelayStatus:
    client = getattr(request.app.state, "relay_client", None)
    if client is None:
        # Ретранслятор вимкнено в конфізі або він не стартував — вузол усе одно
        # має ім'я, і клієнту корисно його бачити.
        return RelayStatus(
            connected=False,
            node_id=node_id(),
            relay="",
            sessions=0,
            last_error="relay client not started",
        )
    return RelayStatus(**client.status())


# ── Дороги для медіа ─────────────────────────────────────────────────────────


class IceServer(BaseModel):
    """Один запис для RTCPeerConnection — форма прямо з WebRTC."""

    urls: list[str]
    username: Optional[str] = None
    credential: Optional[str] = None


class IceConfig(BaseModel):
    """Чим браузеру шукати дорогу до співрозмовника.

    `turn=false` — це не помилка, а стан: ретранслятора цей вузол не має, і
    за суворим NAT дзвінок не встане. Клієнт має право сказати це людині
    вголос, і саме тому прапорець тут окремий, а не вгадується з urls.
    """

    iceServers: list[IceServer]
    turn: bool
    #: Скільки секунд живе видана пара. 0 — видавати не було чого.
    ttl: int


@router.get("/ice", response_model=IceConfig)
async def get_ice_config(_user: User = Depends(get_user_or_device_user)) -> IceConfig:
    """Ефемерна пара до ретранслятора — на один дзвінок, а не назавжди.

    Секрет coturn лишається на вузлі: браузер отримує username (час смерті
    пари) і пароль, виведений із секрету через HMAC-SHA1. Механіка — у
    `messenger/turn.py`.
    """
    return IceConfig(**ice_payload(load_turn_config()))


# ── Розмови ──────────────────────────────────────────────────────────────────


class SeedMessage(BaseModel):
    client_id: str
    author_id: str
    author_name: str
    kind: str = "text"
    #: Для складних типів тут лежить JSON — клієнт його і збирає назад.
    body: Optional[str] = None


class ConversationIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    kind: str = "dm"
    circle: str = "all"
    handle: Optional[str] = None
    avatar: Optional[str] = None
    #: Розмова з конкретною людиною — тоді повідомлення поїдуть шифротекстом.
    contact_id: Optional[str] = None
    #: Показова розмова: вміст вигаданий і буде позначений як вигаданий.
    is_demo: bool = False
    #: Готова стрічка для показової розмови.
    messages: list[SeedMessage] = []


class ConversationOut(BaseModel):
    id: str
    title: str
    kind: str
    circle: str
    handle: Optional[str]
    avatar: Optional[str]
    pinned: bool
    archived: bool
    created_at: datetime
    updated_at: datetime
    contact_id: Optional[str] = None
    is_demo: bool = False
    #: null — розмова ні з ким (нотатки собі), тож і звіряти нема кого.
    contact_verified: Optional[bool] = None
    peer_node_id: Optional[str] = None
    unread_count: int = 0
    #: Прев'ю останнього повідомлення — список чатів живе на цьому.
    last_kind: Optional[str] = None
    last_snippet: Optional[str] = None
    last_author: Optional[str] = None
    last_at: Optional[datetime] = None


def _conversation_out(
    row: MessengerConversation,
    contact: Optional[MessengerContact] = None,
    last: Optional[MessengerMessage] = None,
) -> ConversationOut:
    snippet = None
    last_kind = last.kind if last else None
    if last is not None and last.deleted_at:
        # Прев'ю не має обіцяти фото, якого вже немає на жодному з дисків.
        last_kind, snippet = "text", "Повідомлення видалено"
    elif last is not None and last.kind == "text":
        body = _body_of(last)
        snippet = (body or "")[:90] or None
    return ConversationOut(
        id=row.id,
        title=row.title,
        kind=row.kind,
        circle=row.circle,
        handle=row.handle,
        avatar=row.avatar,
        pinned=row.pinned,
        archived=row.archived,
        created_at=row.created_at,
        updated_at=row.updated_at,
        contact_id=row.contact_id,
        is_demo=row.is_demo,
        contact_verified=(contact.verified_at is not None) if contact else None,
        peer_node_id=contact.peer_node_id if contact else None,
        unread_count=max(0, (row.next_seq - 1) - row.last_read_seq),
        last_kind=last_kind,
        last_snippet=snippet,
        last_author=last.author_name if last else None,
        last_at=last.sent_at if last else None,
    )


async def _conversations_for(user: User, session: AsyncSession) -> list[ConversationOut]:
    """Список розмов разом зі станом звірки — його малює заголовок чату."""
    rows = (
        await session.execute(
            select(MessengerConversation)
            .where(MessengerConversation.owner_user_id == user.id)
            .order_by(MessengerConversation.updated_at.desc(), MessengerConversation.id)
        )
    ).scalars().all()
    contacts = {
        c.id: c
        for c in (
            await session.execute(
                select(MessengerContact).where(MessengerContact.owner_user_id == user.id)
            )
        ).scalars().all()
    }
    ids = [r.id for r in rows]
    lasts: dict[str, MessengerMessage] = {}
    if ids:
        for m in (
            await session.execute(
                select(MessengerMessage)
                .where(MessengerMessage.conversation_id.in_(ids))
                .order_by(MessengerMessage.conversation_id, MessengerMessage.seq)
            )
        ).scalars():
            lasts[m.conversation_id] = m
    return [
        _conversation_out(r, contacts.get(r.contact_id or ""), lasts.get(r.id))
        for r in rows
    ]


@router.get("/conversations", response_model=list[ConversationOut])
async def list_conversations(
    user: User = Depends(get_user_or_device_user),
    session: AsyncSession = Depends(get_db),
) -> list[ConversationOut]:
    return await _conversations_for(user, session)


class BootstrapIn(BaseModel):
    conversations: list[ConversationIn]


@router.post("/bootstrap", response_model=list[ConversationOut])
async def bootstrap_conversations(
    payload: BootstrapIn,
    user: User = Depends(get_user_or_device_user),
    session: AsyncSession = Depends(get_db),
) -> list[ConversationOut]:
    """Первинний список розмов. Ідемпотентний за побудовою.

    Клієнт може смикнути це двічі — на подвійному монтажі в dev, після
    перезапуску, з двох вкладок. Якщо в користувача вже є хоч одна розмова,
    ми нічого не створюємо і віддаємо те, що є: інакше список роздвоюється,
    і це видно тільки живцем у браузері, а не в тестах.
    """
    existing = (
        await session.execute(
            select(MessengerConversation)
            .where(MessengerConversation.owner_user_id == user.id)
            .order_by(MessengerConversation.updated_at.desc(), MessengerConversation.id)
        )
    ).scalars().all()
    if existing:
        return await _conversations_for(user, session)

    rows = []
    for c in payload.conversations:
        row = MessengerConversation(
            owner_user_id=user.id,
            title=c.title,
            kind=c.kind,
            circle=c.circle,
            handle=c.handle,
            avatar=c.avatar,
            is_demo=c.is_demo,
            created_at=_now(),
            updated_at=_now(),
        )
        session.add(row)
        await session.flush()
        rows.append(row)
        # Показова стрічка лягає в базу тим самим шляхом, що й справжня —
        # інакше вітрина жила б окремим життям і розходилась із дійсністю.
        for m in c.messages:
            msg = MessengerMessage(
                id=str(uuid.uuid4()),
                conversation_id=row.id,
                client_id=m.client_id,
                seq=row.next_seq,
                author_id=m.author_id,
                author_name=m.author_name,
                kind=m.kind,
                transport=None,
                delivery_state="local",
                sent_at=_now(),
            )
            if m.body is not None:
                msg.ciphertext = seal(_keys(), m.body, aad=msg.id.encode()).hex()
            row.next_seq += 1
            session.add(msg)
        row.last_read_seq = row.next_seq - 1
    await session.commit()
    # Віддаємо тим самим порядком, що й /conversations: інакше повторний виклик
    # поверне ті самі розмови інакше перемішаними, і клієнт вирішить, що щось змінилось.
    return await _conversations_for(user, session)


@router.post(
    "/conversations", response_model=ConversationOut, status_code=status.HTTP_201_CREATED
)
async def create_conversation(
    payload: ConversationIn,
    user: User = Depends(get_user_or_device_user),
    session: AsyncSession = Depends(get_db),
) -> ConversationOut:
    row = MessengerConversation(
        owner_user_id=user.id,
        title=payload.title,
        kind=payload.kind,
        circle=payload.circle,
        handle=payload.handle,
        avatar=payload.avatar,
        contact_id=payload.contact_id,
        is_demo=payload.is_demo,
        created_at=_now(),
        updated_at=_now(),
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _conversation_out(row)


class ReadIn(BaseModel):
    seq: int


class RenameIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)


@router.patch("/conversations/{conversation_id}/read")
async def mark_read(
    conversation_id: str,
    payload: ReadIn,
    user: User = Depends(get_user_or_device_user),
    session: AsyncSession = Depends(get_db),
) -> dict:
    row = await _owned_conversation(conversation_id, user, session)
    # Курсор лише рухається вперед: пізній запит зі старим seq не «розчитує».
    row.last_read_seq = max(row.last_read_seq, min(payload.seq, row.next_seq - 1))
    await session.commit()
    return {
        "last_read_seq": row.last_read_seq,
        "unread_count": max(0, (row.next_seq - 1) - row.last_read_seq),
    }


@router.patch("/conversations/{conversation_id}", response_model=ConversationOut)
async def rename_conversation(
    conversation_id: str,
    payload: RenameIn,
    user: User = Depends(get_user_or_device_user),
    session: AsyncSession = Depends(get_db),
) -> ConversationOut:
    """Імʼя співрозмовнику дає власник — автоматика знає лише його вузол."""
    row = await _owned_conversation(conversation_id, user, session)
    row.title = payload.title.strip()
    contact = await session.get(MessengerContact, row.contact_id) if row.contact_id else None
    if contact is not None:
        contact.display_name = row.title
        contact.updated_at = _now()
    row.updated_at = _now()
    await session.commit()
    await session.refresh(row)
    return _conversation_out(row, contact)


async def _owned_conversation(
    conversation_id: str, user: User, session: AsyncSession
) -> MessengerConversation:
    row = (
        await session.execute(
            select(MessengerConversation).where(
                MessengerConversation.id == conversation_id,
                MessengerConversation.owner_user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="conversation not found")
    return row


# ── Повідомлення ─────────────────────────────────────────────────────────────


class MessageIn(BaseModel):
    #: Клієнт генерує його до відправки — саме він робить повтор безпечним.
    client_id: str = Field(min_length=1, max_length=64)
    author_id: str = Field(min_length=1, max_length=64)
    author_name: str = Field(min_length=1, max_length=120)
    kind: str = "text"
    body: Optional[str] = None
    ciphertext: Optional[str] = None
    transport: Optional[str] = None
    reply_to_id: Optional[str] = None


class MessageOut(BaseModel):
    id: str
    conversation_id: str
    client_id: str
    seq: int
    author_id: str
    author_name: str
    kind: str
    body: Optional[str]
    ciphertext: Optional[str]
    transport: Optional[str]
    reply_to_id: Optional[str] = None
    #: local | queued | sent — з бази, переживає перезавантаження.
    delivery_state: str = "local"
    #: Стан ПЕРЕВЕЗЕННЯ вкладення цього повідомлення: stored | queued | sent |
    #: missing. Кадр із ключем міг доїхати, а байти — ні, і тоді галочка
    #: «надіслано» на бульбашці була б брехнею: у людини немає фото.
    attachment_state: Optional[str] = None
    sent_at: datetime
    edited_at: Optional[datetime]
    deleted_at: Optional[datetime]
    #: local — розмова ні з ким (нотатки собі), везти нікуди.
    #: queued — кадр зашифровано, але транспорту до вузла співрозмовника немає.
    #: sent — віддано транспорту.
    delivery: str = 'local'


def _body_of(row: MessengerMessage) -> Optional[str]:
    """Тіло повідомлення лежить запечатаним; відкритий body лишився в старих рядках."""
    if not row.ciphertext:
        return row.body
    try:
        return unseal(_keys(), bytes.fromhex(row.ciphertext), aad=row.id.encode())
    except (AtRestError, ValueError):
        # Ключі вузла змінилися або рядок зіпсовано — краще порожньо, ніж вигадка.
        return None


def _message_out(
    row: MessengerMessage, attachment_state: Optional[str] = None
) -> MessageOut:
    return MessageOut(
        id=row.id,
        conversation_id=row.conversation_id,
        client_id=row.client_id,
        seq=row.seq,
        author_id=row.author_id,
        author_name=row.author_name,
        kind=row.kind,
        # Видалене не має тіла — ані відкритого, ані запечатаного. Клієнт
        # малює надгробок за deleted_at, а не за порожнім рядком.
        body=None if row.deleted_at else _body_of(row),
        # Назовні шифротекст не віддаємо: клієнту він ні до чого, а в логах зайвий.
        ciphertext=None,
        transport=row.transport,
        reply_to_id=row.reply_to_id,
        delivery_state=row.delivery_state,
        attachment_state=attachment_state,
        sent_at=row.sent_at,
        edited_at=row.edited_at,
        deleted_at=row.deleted_at,
    )


async def _attachment_states(
    session: AsyncSession, rows: list[MessengerMessage]
) -> dict[str, str]:
    """Стан перевезення вкладень для стрічки — одним запитом на всю пачку.

    Ключ у відповіді — id ПОВІДОМЛЕННЯ, а не блоба: клієнту треба знати стан
    бульбашки, і зшивати одне з одним він не мусить.
    """
    keys = _keys()
    by_blob: dict[str, list[str]] = {}
    for row in rows:
        if row.deleted_at:
            continue
        for blob_id in blob_ids_of(keys, row):
            by_blob.setdefault(blob_id, []).append(row.id)
    if not by_blob:
        return {}

    states = (
        await session.execute(
            select(MessengerBlob.blob_id, MessengerBlob.state).where(
                MessengerBlob.blob_id.in_(list(by_blob))
            )
        )
    ).all()
    out: dict[str, str] = {}
    for blob_id, state in states:
        for message_id in by_blob.get(blob_id, ()):
            out[message_id] = state
    return out


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageOut])
async def list_messages(
    conversation_id: str,
    after_seq: int = 0,
    limit: int = 200,
    user: User = Depends(get_user_or_device_user),
    session: AsyncSession = Depends(get_db),
) -> list[MessageOut]:
    await _owned_conversation(conversation_id, user, session)
    rows = (
        await session.execute(
            select(MessengerMessage)
            .where(
                MessengerMessage.conversation_id == conversation_id,
                MessengerMessage.seq > after_seq,
            )
            .order_by(MessengerMessage.seq)
            .limit(min(max(limit, 1), 500))
        )
    ).scalars().all()
    attachments = await _attachment_states(session, list(rows))
    return [_message_out(r, attachments.get(r.id)) for r in rows]


@router.post("/conversations/{conversation_id}/messages", response_model=MessageOut)
async def append_message(
    conversation_id: str,
    payload: MessageIn,
    user: User = Depends(get_user_or_device_user),
    session: AsyncSession = Depends(get_db),
) -> MessageOut:
    conversation = await _owned_conversation(conversation_id, user, session)

    # Повтор після обриву — не помилка. Віддаємо те, що вже лежить, і мовчимо.
    existing = (
        await session.execute(
            select(MessengerMessage).where(
                MessengerMessage.conversation_id == conversation_id,
                MessengerMessage.client_id == payload.client_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return _message_out(existing)

    # Історія лягає в базу запечатаною: файл бази сам по собі не має видавати
    # листування. Прив'язка до id рядка не дає переставити тіло в інше повідомлення.
    # id потрібен до запису: він входить в AAD запечатаного тіла, а дефолт
    # моделі спрацював би лише на flush, коли пломбувати вже пізно.
    row = MessengerMessage(
        id=str(uuid.uuid4()),
        conversation_id=conversation_id,
        client_id=payload.client_id,
        seq=conversation.next_seq,
        author_id=payload.author_id,
        author_name=payload.author_name,
        kind=payload.kind,
        body=None,
        ciphertext=None,
        transport=payload.transport,
        reply_to_id=payload.reply_to_id,
        sent_at=_now(),
    )
    if payload.body is not None:
        row.ciphertext = seal(_keys(), payload.body, aad=row.id.encode()).hex()
    conversation.next_seq += 1
    # Власник щойно сам це написав — читати тут нема чого.
    conversation.last_read_seq = row.seq
    conversation.updated_at = _now()
    session.add(row)
    await session.commit()
    await session.refresh(row)
    out = _message_out(row)

    # Розмова зі співрозмовником — готуємо кадр і віддаємо транспорту. Поки
    # транспорту немає, чесно кажемо queued: галочка «надіслано» в клієнті
    # означає «дійшло до вузла», а не «дійшло до людини».
    if conversation.contact_id is not None and payload.body is not None:
        try:
            # Тип везе сам кадр: інакше вузол-адресат побачив би JSON з ключем
            # як звичайний текст і показав людині службовий рядок замість фото.
            # Разом із типом їде client_id — спільне ім'я цього повідомлення на
            # обох вузлах. Без нього «видалити для всіх» не мало б за що взятись.
            prepared = await prepare_frame(
                session,
                _keys(),
                conversation,
                wrap_frame(payload.kind, payload.body, payload.client_id),
            )
        except OutboxError:
            prepared = None
            out.delivery = 'queued'
        if prepared is not None:
            contact = await session.get(MessengerContact, conversation.contact_id)
            address = contact.peer_address if contact else ""
            relay = (config.relay_url or "") if config.relay_enabled else ""
            sb_url, sb_key = supabase_road(config)
            delivered = await deliver(
                prepared.frame,
                peer_node_id=prepared.peer_node_id,
                from_node_id=_keys().node_id,
                peer_address=address or "",
                relay=relay,
                supabase_url=sb_url,
                supabase_key=sb_key,
                reply_address=config.messenger_public_address,
            )
            tried = bool(address or relay or sb_url)
            out.delivery = 'sent' if delivered else 'queued'
            row.delivery_state = out.delivery
            row.delivery_attempts = 1 if tried else 0
            row.last_attempt_at = _now() if tried else None
            # Не доїхало — кадр лишається при повідомленні, щоб повтор віз
            # той самий, а не шифрував наново і не роздвоював розмову.
            row.outbound_frame = None if delivered else prepared.frame.hex()
            await session.commit()

    # Інші пристрої власника мають побачити повідомлення без опитування —
    # телефон і ПК уже висять на цьому ж хабі, іншого каналу вигадувати не треба.
    await hub.broadcast(
        "messenger", "message:new", out.model_dump(mode="json"), user_id=user.id
    )
    return out


# ── Ідентичність і контакти ──────────────────────────────────────────────────


class IdentityOut(BaseModel):
    node_id: str
    bundle: dict
    #: Той самий ключ у стислому вигляді — для QR і для передачі голосом/руками.
    compact: str


@router.get("/identity", response_model=IdentityOut)
async def get_identity(_user: User = Depends(get_user_or_device_user)) -> IdentityOut:
    """Те, що вузол дає співрозмовнику, аби той міг почати розмову.

    Публічні частини — ділитися ними безпечно. Одноразовий prekey кожен виклик
    віддає новий, тому смикати це «про запас» не варто: запас скінченний.
    """
    from node.identity import key_path

    keys = _keys()
    # Обслуговуємо набір саме тут: bundle питають рідко, але щоразу перед тим,
    # як хтось почне нову розмову — кращого моменту для ротації немає.
    keys.rotate_if_stale()
    keys.forget_old_signed()
    if keys.one_time_low():
        keys.generate_one_time_prekeys(32)
    bundle = keys.publish_bundle()
    # Видали одноразовий ключ — запамʼятали. Інакше після рестарту він пішов би
    # ще комусь, а одноразовим він називається саме тому, що так не можна.
    keys.persist_prekeys(key_path().parent / "messenger_prekeys.bin")
    return IdentityOut(
        node_id=keys.node_id, bundle=bundle.to_dict(), compact=bundle.to_compact()
    )


class ContactIn(BaseModel):
    display_name: str = Field(min_length=1, max_length=120)
    #: Один із двох: розгорнутий bundle або стислий рядок із QR.
    bundle: Optional[dict] = None
    compact: Optional[str] = None
    #: Пряма адреса вузла, якщо відома. Немає — кадр чекатиме на ретранслятор.
    peer_address: Optional[str] = None


class ContactOut(BaseModel):
    id: str
    peer_node_id: str
    display_name: str
    peer_address: Optional[str]
    safety_number: str
    safety_number_pretty: str
    verified: bool
    session_ready: bool
    created_at: datetime


def _contact_out(row: MessengerContact) -> ContactOut:
    return ContactOut(
        id=row.id,
        peer_node_id=row.peer_node_id,
        display_name=row.display_name,
        peer_address=row.peer_address,
        safety_number=row.safety_number,
        safety_number_pretty=format_safety_number(row.safety_number),
        verified=row.verified_at is not None,
        session_ready=bool(row.session_blob),
        created_at=row.created_at,
    )


@router.get("/contacts", response_model=list[ContactOut])
async def list_contacts(
    user: User = Depends(get_user_or_device_user),
    session: AsyncSession = Depends(get_db),
) -> list[ContactOut]:
    rows = (
        await session.execute(
            select(MessengerContact)
            .where(MessengerContact.owner_user_id == user.id)
            .order_by(MessengerContact.created_at, MessengerContact.id)
        )
    ).scalars().all()
    return [_contact_out(r) for r in rows]


@router.post("/contacts", response_model=ContactOut, status_code=status.HTTP_201_CREATED)
async def add_contact(
    payload: ContactIn,
    user: User = Depends(get_user_or_device_user),
    session: AsyncSession = Depends(get_db),
) -> ContactOut:
    """Приймає bundle співрозмовника і одразу зводить крипто-сесію.

    Підписи в bundle перевіряються; але сам собою підпис не доводить, що це
    саме та людина — довіру дає лише звірене число, тому verified_at тут не
    ставиться нізащо.
    """
    keys = _keys()
    try:
        if payload.compact:
            bundle = PublicBundle.from_compact(payload.compact)
        elif payload.bundle:
            bundle = PublicBundle.from_dict(payload.bundle)
        else:
            raise UntrustedBundle("ключ не передано")
        bundle.verify()
    except (UntrustedBundle, KeyError, ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=f"неприйнятний bundle: {exc}") from exc

    if bundle.node_id == keys.node_id:
        raise HTTPException(status_code=400, detail="це власний вузол")

    existing = (
        await session.execute(
            select(MessengerContact).where(
                MessengerContact.owner_user_id == user.id,
                MessengerContact.peer_node_id == bundle.node_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return _contact_out(existing)

    number = safety_number(
        keys.identity_ed_public, keys.identity_dh_public,
        bundle.identity_ed, bundle.identity_dh,
    )
    peer_session = Session.initiate(keys, bundle, expected_node_id=bundle.node_id)
    row = MessengerContact(
        owner_user_id=user.id,
        peer_node_id=bundle.node_id,
        display_name=payload.display_name,
        peer_address=payload.peer_address,
        bundle_json=bundle.to_json(),
        session_blob=peer_session.serialize(keys).hex(),
        safety_number=number,
        created_at=_now(),
        updated_at=_now(),
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _contact_out(row)


@router.post("/contacts/{contact_id}/verify", response_model=ContactOut)
async def verify_contact(
    contact_id: str,
    user: User = Depends(get_user_or_device_user),
    session: AsyncSession = Depends(get_db),
) -> ContactOut:
    """Ставиться рукою власника після того, як число звірили голосом."""
    row = (
        await session.execute(
            select(MessengerContact).where(
                MessengerContact.id == contact_id,
                MessengerContact.owner_user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="contact not found")
    row.verified_at = _now()
    row.updated_at = _now()
    await session.commit()
    await session.refresh(row)
    return _contact_out(row)


# ── Приймальня для чужих вузлів ──────────────────────────────────────────────


class InboundFrame(BaseModel):
    frame: str
    #: node_id того, ХТО пише. Приймальня шукає за ним сесію.
    from_node_id: Optional[str] = None
    #: Куди нести відповідь, якщо відправник знає власну адресу.
    reply_address: Optional[str] = None


@router.post("/inbox")
async def receive_frame(
    payload: InboundFrame,
    request: Request,
    session: AsyncSession = Depends(get_db),
) -> dict:
    """Приймає зашифрований кадр від чужого вузла.

    Свідомо без JWT: відправник — інша людина, у неї немає і не може бути
    токена цього вузла. Автентичність дає сама криптографія — кадр або
    розшифровується сесією, або летить у 400. Токен тут був би слабшою
    перевіркою, ніж тег AEAD, і створював би ілюзію контролю.

    Не кожен кадр повертає повідомлення: службовий 'delete' міг прийти на те,
    чого в нас ніколи не було. Це прийнято й виконано, тож відповідь — 200 із
    порожньою вказівкою, а не 400: інакше відправник повторював би вічно.

    Кадр рації теж не стає рядком: він іде тим самим каналом, що й сигнали
    дзвінка, бо слухає його дзвінок, а не стрічка.
    """
    owner = (await session.execute(select(User.id).order_by(User.id))).scalars().first()
    if owner is None:
        raise HTTPException(status_code=503, detail="вузол ще не має власника")

    try:
        raw = bytes.fromhex(payload.frame)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="кадр не є шістнадцятковим") from exc

    # Відсікаємо сміття до крипти: спроба X3DH навмисне недешева, тож потік
    # безглуздих кадрів був би дешевим способом покласти вузол.
    try:
        inbox_guard.check(request.client.host if request.client else "?", len(raw))
    except GuardRejected as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc

    try:
        row = await accept_frame(
            session,
            _keys(),
            owner,
            raw,
            payload.from_node_id,
            reply_address=payload.reply_address,
        )
    except InboxError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if row is None:
        return {"accepted": True}

    if isinstance(row, RadioFrame):
        # Шматок голосу: віддаємо його каналу дзвінка й на цьому все. Ані рядка
        # в стрічці, ані оновлення прев'ю — розмову чують, а не читають.
        try:
            chunk = json.loads(row.body)
        except ValueError:
            raise HTTPException(status_code=400, detail="кадр рації не є JSON") from None
        await hub.broadcast(
            "call",
            "call:radio",
            {
                "kind": "radio",
                "call_id": str(chunk.get("call_id") or ""),
                "seq": int(chunk.get("seq") or 0),
                "audio_b64": str(chunk.get("audio_b64") or ""),
                "from_node_id": row.peer_node_id,
            },
            user_id=owner,
        )
        return {"accepted": True}

    attachments = await _attachment_states(session, [row])
    out = _message_out(row, attachments.get(row.id))
    # Видалення — не нове повідомлення. Окрема подія потрібна, щоб відкрита
    # вкладка одержувача замінила бульбашку надгробком, а не додала рядок.
    event = "message:deleted" if row.deleted_at else "message:new"
    await hub.broadcast(
        "messenger", event, out.model_dump(mode="json"), user_id=owner
    )
    return out.model_dump(mode="json")


# ── Черга і прибирання ───────────────────────────────────────────────────────


@router.get("/queue/status")
async def queue_status(
    user: User = Depends(get_user_or_device_user),
    session: AsyncSession = Depends(get_db),
) -> dict:
    """«N листів чекають» — видимість черги, якої вимагали і панелі, і аудит."""
    n = (
        await session.execute(
            select(func.count())
            .select_from(MessengerMessage)
            .join(
                MessengerConversation,
                MessengerConversation.id == MessengerMessage.conversation_id,
            )
            .where(
                MessengerConversation.owner_user_id == user.id,
                MessengerMessage.delivery_state == "queued",
            )
        )
    ).scalar_one()
    return {"queued": int(n)}


@router.post("/queue/flush")
async def queue_flush(
    user: User = Depends(get_user_or_device_user),
    session: AsyncSession = Depends(get_db),
) -> dict:
    """Кнопка «Повторити зараз»: людина не мусить чекати фонову смугу."""
    from messenger.redelivery import flush_queue

    from messenger.blobs import flush_blob_queue

    delivered = await flush_queue(session, _keys().node_id)
    blobs = await flush_blob_queue(session, _keys().node_id)
    return {"delivered": delivered, "blobs": blobs}


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: str,
    user: User = Depends(get_user_or_device_user),
    session: AsyncSession = Depends(get_db),
) -> dict:
    """Розмова зникає разом із вкладеннями — інакше вона зникає лише з очей."""
    row = await _owned_conversation(conversation_id, user, session)
    dropped = await purge_conversation_blobs(session, _keys(), conversation_id)
    await session.delete(row)
    await session.commit()
    return {"deleted": True, "blobs": dropped}


@router.post("/conversations/{conversation_id}/clear")
async def clear_history(
    conversation_id: str,
    user: User = Depends(get_user_or_device_user),
    session: AsyncSession = Depends(get_db),
) -> dict:
    """Історія зникає з ЦЬОГО вузла. Копію співрозмовника ми чіпати не можемо —
    і чесніше сказати це прямо, ніж вдавати всесвітнє видалення.

    «Зникає» тут означає диск, а не лише стрічку: разом із рядками йдуть байти
    вкладень і записи в messenger_blobs. Доти «очистити історію» лишала по
    собі мегабайти шифротексту й журнал перевезень — тобто саме те, від чого
    людина й хотіла позбутись.
    """
    row = await _owned_conversation(conversation_id, user, session)
    dropped = await purge_conversation_blobs(session, _keys(), conversation_id)
    result = await session.execute(
        MessengerMessage.__table__.delete().where(
            MessengerMessage.conversation_id == conversation_id
        )
    )
    row.last_read_seq = row.next_seq - 1
    row.updated_at = _now()
    await session.commit()
    return {"cleared": result.rowcount, "blobs": dropped}


@router.delete("/conversations/{conversation_id}/messages/{message_id}")
async def delete_message(
    conversation_id: str,
    message_id: str,
    for_everyone: bool = False,
    user: User = Depends(get_user_or_device_user),
    session: AsyncSession = Depends(get_db),
) -> dict:
    """Видаляє повідомлення. Для себе — назавжди; для всіх — ще й у нього.

    Дві різні обіцянки, і плутати їх не можна.

    «Для себе» — рядок і байти зникають з цього вузла, копія співрозмовника
    лишається. «Для всіх» — те саме тут, плюс службовий кадр kind='delete',
    який їде тією ж наскрізною дорогою, що й текст. Відправник бачить
    результат одразу; одержувач — коли кадр доїде. Якщо його вузол вимкнено,
    кадр чекає в черзі, і видалення станеться пізніше. Обіцяти миттєвість
    ми не можемо, тож і не обіцяємо.
    """
    conversation = await _owned_conversation(conversation_id, user, session)
    row = (
        await session.execute(
            select(MessengerMessage).where(
                MessengerMessage.conversation_id == conversation_id,
                MessengerMessage.id == message_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="message not found")

    if not for_everyone:
        # Локальне видалення: рядок іде цілком, байти — з нашого диска.
        dropped = await wipe_message(session, _keys(), row)
        await session.delete(row)
        await session.commit()
        return {"deleted": True, "for_everyone": False, "blobs": dropped}

    # Кадр треба зашифрувати ДО того, як ми зітремо тіло: сам кадр везе лише
    # ім'я цілі, але сесія має зрушитись рівно один раз, і робити це після
    # затирання означало б покластись на порядок, якого ніхто не гарантує.
    origin = origin_of(row)
    prepared = None
    if conversation.contact_id is not None and origin:
        try:
            prepared = await prepare_frame(
                session, _keys(), conversation, wrap_frame("delete", origin)
            )
        except OutboxError:
            prepared = None

    dropped = await tombstone(session, _keys(), row)

    delivered = False
    if prepared is not None:
        contact = await session.get(MessengerContact, conversation.contact_id)
        address = (contact.peer_address if contact else "") or ""
        relay = (config.relay_url or "") if config.relay_enabled else ""
        sb_url, sb_key = supabase_road(config)
        delivered = await deliver(
            prepared.frame,
            peer_node_id=prepared.peer_node_id,
            from_node_id=_keys().node_id,
            peer_address=address,
            relay=relay,
            supabase_url=sb_url,
            supabase_key=sb_key,
            reply_address=config.messenger_public_address,
        )
        if not delivered:
            # Той самий механізм, що й у звичайного повідомлення: кадр лежить
            # при рядку і чекає на смугу повторів. Вимкнений вузол одержувача
            # не скасовує видалення — лише відкладає його.
            row.outbound_frame = prepared.frame.hex()
            row.delivery_state = "queued"
            row.delivery_attempts = 1 if (address or relay) else 0
            row.last_attempt_at = _now() if (address or relay) else None

    conversation.updated_at = _now()
    await session.commit()
    await session.refresh(row)

    out = _message_out(row)
    await hub.broadcast(
        "messenger", "message:deleted", out.model_dump(mode="json"), user_id=user.id
    )
    return {
        "deleted": True,
        "for_everyone": True,
        "blobs": dropped,
        #: Чесно: кадр віддано вузлу співрозмовника чи ще чекає в черзі.
        "frame": "sent" if delivered else ("queued" if prepared is not None else "local"),
    }
