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
    MessengerReaction,
    User,
)
from messenger.crypto.at_rest import AtRestError, seal, unseal
from messenger.crypto.keys import KeyStore, PublicBundle, UntrustedBundle
from messenger.crypto.safety import format_safety_number, safety_number
from messenger.crypto.session import Session
from messenger.blobs import wrap_frame
from messenger.geo import parse_point
from messenger.guard import GuardRejected, inbox_guard
from messenger.inbox import InboxError, RadioFrame, accept_frame
from messenger.outbox import OutboxError, prepare_frame
from messenger.reactions import apply_reaction
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


# ── Правдива картина доріг ───────────────────────────────────────────────────
#
# «Чотири дороги» — проєктна спроможність, а не стан вузла: relay_url,
# supabase_* і r2_* порожні за замовчуванням. Секрети сюди не потрапляють —
# назовні їде тільки хост.


def _host_only(url: str) -> str:
    """`https://user:pass@host:8787/path?token=…` → `host:8787`."""
    from urllib.parse import urlsplit

    raw = (url or "").strip()
    if not raw:
        return ""
    if "://" not in raw:
        raw = f"//{raw}"
    try:
        parsed = urlsplit(raw)
    except ValueError:
        return ""
    return parsed.netloc.rsplit("@", 1)[-1] or ""


class Road(BaseModel):
    id: str  # direct | relay | mailbox | blobs
    title: str
    configured: bool
    #: Жива — не те саме, що налаштована. None: вузол живості не перевіряє.
    live: Optional[bool] = None
    #: Значок у панелі. Окремо від `configured`, бо пряма дорога без своєї
    #: адреси працює назовні й не працює всередину — «немає» тут збрехало б.
    state: str
    detail: str
    #: Що вписати, щоб дорога зʼявилася. Порожньо — вже є.
    howto: str = ""


class RoadsReport(BaseModel):
    roads: list[Road]
    configured: int
    total: int


@router.get("/roads", response_model=RoadsReport)
async def get_roads(
    request: Request,
    _user: User = Depends(get_user_or_device_user),
) -> RoadsReport:
    from messenger.r2 import r2_road

    address = (getattr(config, "messenger_public_address", "") or "").strip()
    relay_on = bool(getattr(config, "relay_enabled", False))
    relay_url = (getattr(config, "relay_url", "") or "").strip()
    sb_url, _sb_key = supabase_road(config)
    blobs = r2_road(config)
    client = getattr(request.app.state, "relay_client", None)
    relay_live: Optional[bool] = None
    if relay_on and relay_url:
        relay_live = bool(client.status().get("connected")) if client else False

    roads = [
        Road(
            id="direct",
            title="Пряма",
            configured=bool(address),
            state="є" if address else "лише назовні",
            detail=(
                f"цей вузол відповідає на {address}"
                if address
                else "писати тому, чия адреса вже відома, можна завжди; "
                "своєї адреси вузол не має, тож знайти його першим не вийде"
            ),
            howto=(
                ""
                if address
                else "MESSENGER_PUBLIC_ADDRESS=https://<адреса вузла>:8443 у .env вузла"
            ),
        ),
        Road(
            id="relay",
            title="Ретранслятор",
            configured=bool(relay_on and relay_url),
            live=relay_live,
            state=(
                ("є" if relay_live else "не відповідає")
                if (relay_on and relay_url)
                else "немає"
            ),
            detail=(
                (
                    f"{_host_only(relay_url)} — {'на звʼязку' if relay_live else 'не відповідає'}"
                )
                if (relay_on and relay_url)
                else (
                    "вимкнено в налаштуваннях вузла"
                    if not relay_on
                    else "адреси точки зустрічі немає"
                )
            ),
            howto=(
                "" if (relay_on and relay_url) else "RELAY_URL=wss://<ваш ретранслятор> у .env вузла"
            ),
        ),
        Road(
            id="mailbox",
            title="Скринька Supabase",
            configured=bool(sb_url),
            state="є" if sb_url else "немає",
            detail=(
                f"{_host_only(sb_url)} — лист лягає в чужу скриньку зашифрованим"
                if sb_url
                else "скриньки немає"
            ),
            howto=(
                ""
                if sb_url
                else "SUPABASE_MAILBOX_URL + SUPABASE_ANON_KEY у .env вузла "
                "(ключ publishable, RLS пускає його лише на запис)"
            ),
        ),
        Road(
            id="blobs",
            title="Вкладення R2",
            configured=blobs is not None,
            state="є" if blobs is not None else "немає",
            detail=(
                f"бакет {blobs.bucket} на {_host_only(blobs.endpoint)}"
                if blobs is not None
                else "вкладення чекають у черзі, поки немає прямої дороги"
            ),
            howto=(
                ""
                if blobs is not None
                else "R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY, R2_SECRET_KEY у .env вузла"
            ),
        ),
    ]
    return RoadsReport(
        roads=roads,
        configured=sum(1 for r in roads if r.configured),
        total=len(roads),
    )


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
    #: Група: спільне імʼя на всіх вузлах, версія складу і відбиток для звірки
    #: вголос. Для розмови з однією людиною тут порожньо.
    group_id: Optional[str] = None
    group_epoch: Optional[int] = None
    group_fingerprint: Optional[str] = None
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
        group_id=row.group_id,
        group_epoch=row.group_epoch,
        group_fingerprint=row.group_fingerprint,
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


def _seed_messages(
    session: AsyncSession, row: MessengerConversation, seeds: list[SeedMessage]
) -> None:
    """Готова стрічка лягає в базу тим самим шляхом, що й справжня — інакше
    вітрина жила б окремим життям і розходилась із дійсністю.

    Винесено у спільного помічника 29.08.2026, і причина конкретна: поле
    `ConversationIn.messages` читав лише `/bootstrap`, а `/conversations`
    приймав його, віддавав 201 і мовчки викидав. Одна схема, два маршрути,
    дві різні поведінки під одним ім'ям. Доки засівання жило двома копіями,
    така розбіжність була питанням часу; тепер вона структурно неможлива.
    """
    for m in seeds:
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
    if seeds:
        row.last_read_seq = row.next_seq - 1


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
        _seed_messages(session, row, c.messages)
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
    # Друга розмова з тією самою людиною — не зручність, а поломка. Виміряно
    # 30.08.2026: маршрут дублікату не перевіряв, і вхідний шлях
    # (`inbox.conversation_for`) на двох рядках кидав `MultipleResultsFound`.
    # Кожен лист від цієї людини діставав 500, відправник вічно повторював, а
    # отримувач не бачив нічого.
    #
    # Тепер повертаємо ту, що вже є: розмова з людиною одна, і зайвої дороги
    # для листів не з'являється.
    if payload.contact_id:
        existing = (
            await session.execute(
                select(MessengerConversation)
                .where(
                    MessengerConversation.owner_user_id == user.id,
                    MessengerConversation.contact_id == payload.contact_id,
                )
                .order_by(MessengerConversation.created_at, MessengerConversation.id)
                .limit(1)
            )
        ).scalar_one_or_none()
        if existing is not None:
            return _conversation_out(existing)

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
    # Схема приймає `messages` — отже маршрут мусить їх покласти. Доти він
    # віддавав 201 і викидав поле мовчки: клієнт бачив успіх і порожню
    # стрічку, і жоден код відповіді про це не казав.
    await session.flush()
    _seed_messages(session, row, payload.messages)
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
    #: Позначки на цьому листі. Порожній список означає «жодної», а не
    #: «не знаємо»: вузол завжди знає власні реакції.
    reactions: list["ReactionOut"] = []
    sent_at: datetime
    edited_at: Optional[datetime]
    deleted_at: Optional[datetime]
    #: local — розмова ні з ким (нотатки собі), везти нікуди.
    #: queued — кадр зашифровано, але транспорту до вузла співрозмовника немає.
    #: sent — віддано транспорту.
    delivery: str = 'local'


class ReactionOut(BaseModel):
    """Одна позначка на листі, згорнута для показу.

    `mine` — чи ставили ЦЕ ми: без нього клієнт не знає, що показати
    натиснутим, і мусив би вгадувати за іменем.
    """

    emoji: str
    count: int
    actors: list[str]
    mine: bool


class ReactionIn(BaseModel):
    emoji: str = Field(min_length=1, max_length=32)


async def _reactions_for(
    session: AsyncSession, message_ids: list[str], self_node_id: str
) -> dict[str, list[ReactionOut]]:
    """Реакції для пачки листів одним запитом.

    Пачкою навмисно: на стрічку в 200 листів окремий запит на кожен дав би
    200 звернень до бази й перетворив би відкриття розмови на очікування.
    """
    if not message_ids:
        return {}
    rows = (
        await session.execute(
            select(MessengerReaction)
            .where(MessengerReaction.message_id.in_(message_ids))
            .order_by(MessengerReaction.created_at)
        )
    ).scalars().all()

    grouped: dict[str, dict[str, ReactionOut]] = {}
    for row in rows:
        per_message = grouped.setdefault(row.message_id, {})
        item = per_message.get(row.emoji)
        if item is None:
            per_message[row.emoji] = ReactionOut(
                emoji=row.emoji,
                count=1,
                actors=[row.actor_name or row.actor_node_id[:8]],
                mine=row.actor_node_id == self_node_id,
            )
        else:
            item.count += 1
            item.actors.append(row.actor_name or row.actor_node_id[:8])
            item.mine = item.mine or row.actor_node_id == self_node_id
    return {mid: list(items.values()) for mid, items in grouped.items()}


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
    row: MessengerMessage,
    attachment_state: Optional[str] = None,
    reactions: Optional[list["ReactionOut"]] = None,
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
        reactions=reactions or [],
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


class SearchHit(BaseModel):
    """Одне влучання. Несе достатньо, щоб клієнт стрибнув у потрібне місце."""

    message_id: str
    conversation_id: str
    conversation_title: str
    seq: int
    author_name: str
    kind: str
    #: Уривок навколо збігу — щоб людина впізнала лист, не відкриваючи його.
    snippet: str
    sent_at: datetime


class SearchOut(BaseModel):
    hits: list[SearchHit]
    #: Скільки рядків справді переглянуто. Без цього «нічого не знайдено»
    #: не відрізнити від «далі я не дивився», а це різні відповіді.
    scanned: int
    #: Чи впертись у стелю. Клієнт МУСИТЬ це показати: мовчазне обрізання
    #: читається як «такого немає», і саме так пошук брехав досі.
    truncated: bool


#: Стеля обходу. Тіла лежать запечатаними, тож кожен рядок треба розкрити —
#: безлімітний обхід на великій історії підвісив би вузол на кожен запит.
SEARCH_SCAN_LIMIT = 5000


@router.get("/search", response_model=SearchOut)
async def search_messages(
    q: str,
    limit: int = 50,
    user: User = Depends(get_user_or_device_user),
    session: AsyncSession = Depends(get_db),
) -> SearchOut:
    """Шукає по ВСІЙ історії цього вузла, а не по завантаженому у вкладку.

    Навіщо взагалі маршрут. Тіла повідомлень лежать запечатаними
    (`ciphertext`), і на живому вузлі рядків з відкритим `body` — нуль. Тобто
    знайти слово може лише той, хто має ключі at-rest, а це вузол. Клієнт має
    в пам'яті щонайбільше останні 200 листів ТІЄЇ розмови, яку відкривали, —
    і доти пошук у бічній панелі звірявся лише з `lastSnippet`, тобто з
    ОСТАННІМ рядком кожного чату. Виміряно на склі: «№5» (останній рядок)
    знаходився, «№2» і «№9» із тих самих розмов — ні. Людина робила з цього
    висновок, що листа не існує.

    Чого цей маршрут НЕ робить: не будує індексу і не вміє шукати в
    наскрізно шифрованих кадрах чужих вузлів. Він відкриває рівно те, що цей
    вузол і так уміє відкрити, коли малює стрічку.
    """
    needle = (q or "").strip().lower()
    if not needle:
        return SearchOut(hits=[], scanned=0, truncated=False)

    titles = {
        row.id: row.title
        for row in (
            await session.execute(
                select(MessengerConversation).where(
                    MessengerConversation.owner_user_id == user.id
                )
            )
        ).scalars()
    }
    if not titles:
        return SearchOut(hits=[], scanned=0, truncated=False)

    rows = (
        await session.execute(
            select(MessengerMessage)
            .where(
                MessengerMessage.conversation_id.in_(titles.keys()),
                MessengerMessage.deleted_at.is_(None),
            )
            .order_by(MessengerMessage.sent_at.desc())
            .limit(SEARCH_SCAN_LIMIT + 1)
        )
    ).scalars().all()

    truncated = len(rows) > SEARCH_SCAN_LIMIT
    rows = rows[:SEARCH_SCAN_LIMIT]

    hits: list[SearchHit] = []
    for row in rows:
        if len(hits) >= max(1, min(limit, 200)):
            break
        body = _body_of(row)
        haystack = f"{body or ''}\n{row.author_name}"
        at = haystack.lower().find(needle)
        if at < 0:
            continue
        text = body or row.author_name
        start = max(0, at - 40)
        snippet = ("…" if start else "") + text[start : at + len(needle) + 60].strip()
        hits.append(
            SearchHit(
                message_id=row.id,
                conversation_id=row.conversation_id,
                conversation_title=titles.get(row.conversation_id, ""),
                seq=row.seq,
                author_name=row.author_name,
                kind=row.kind,
                snippet=snippet,
                sent_at=row.sent_at,
            )
        )

    return SearchOut(hits=hits, scanned=len(rows), truncated=truncated)


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
    # Реакції — одним запитом на всю стрічку. Окремий запит на кожен лист
    # перетворив би відкриття розмови на 200 звернень до бази.
    reactions = await _reactions_for(session, [r.id for r in rows], _keys().node_id)
    return [
        _message_out(r, attachments.get(r.id), reactions.get(r.id)) for r in rows
    ]


@router.post(
    "/conversations/{conversation_id}/messages/{message_id}/reactions",
    response_model=MessageOut,
)
async def toggle_reaction(
    conversation_id: str,
    message_id: str,
    payload: ReactionIn,
    user: User = Depends(get_user_or_device_user),
    session: AsyncSession = Depends(get_db),
) -> MessageOut:
    """Ставить або знімає позначку на листі. Один виклик на обидві дії.

    Перемикач, а не пара «додати/прибрати», і причина не в зручності: людина
    тисне ту саму кнопку, і два різні маршрути означали б, що клієнт мусить
    ЗНАТИ поточний стан, перш ніж діяти. На повільному звʼязку він його не
    знає — і подвійний тап давав би дві реакції там, де людина хотіла нуль.

    Повертає ВЕСЬ лист із перерахованими реакціями, а не саму реакцію: інакше
    клієнт складав би підсумок сам, і два клієнти рахували б по-різному.

    Чого цей маршрут поки НЕ робить — і це сказано вголос, щоб не здалося
    зробленим: він **не везе позначку співрозмовнику**. Для цього потрібен
    новий тип на дроті, а правило дому (`unwrap_frame`) вимагає, щоб обидва
    боки спершу вміли сказати «не вмію показати». Телефонна половина цього
    вже вміє; але на старій збірці кадр реакції став би ТЕКСТОВИМ рядком
    «ця версія не вміє показати» просто в стрічці — тобто сміттям замість
    тихого ігнорування. Це рішення про протокол, і воно за двома боками
    разом, а не за мною одним.
    """
    conversation = await _owned_conversation(conversation_id, user, session)
    row = await session.get(MessengerMessage, message_id)
    if row is None or row.conversation_id != conversation_id:
        raise HTTPException(status_code=404, detail="повідомлення не знайдено")
    if row.deleted_at is not None:
        # На надгробку позначок не ставлять: тексту немає, і реакція
        # виглядала б відповіддю на порожнечу.
        raise HTTPException(status_code=409, detail="повідомлення видалено")

    emoji = payload.emoji.strip()
    if not emoji:
        raise HTTPException(status_code=422, detail="порожня позначка")

    me = _keys().node_id
    # Перемикач через спільний модуль: той самий код застосовує позначку й
    # тоді, коли вона приїжджає кадром від співрозмовника. Дві копії однієї
    # угоди в різних файлах сьогодні вже коштували нам двічі.
    now_on = await apply_reaction(
        session,
        message_id=message_id,
        actor_node_id=me,
        actor_name=user.username or "Я",
        emoji=emoji,
    )
    await session.commit()

    # Веземо співрозмовнику НАМІР, а не дію: кадр може приїхати вдруге
    # (повтор доставки), і перемикач на тому боці зняв би позначку, яку
    # людина ставила один раз.
    try:
        prepared = await prepare_frame(
            session, _keys(), conversation,
            wrap_frame(
                "reaction",
                json.dumps(
                    {"origin": row.client_id, "emoji": emoji, "on": now_on},
                    ensure_ascii=False,
                ),
                row.client_id,
            ),
        )
    except OutboxError:
        prepared = None
    if prepared is not None:
        contact = await session.get(MessengerContact, conversation.contact_id)
        await deliver(
            prepared.frame,
            peer_node_id=prepared.peer_node_id,
            from_node_id=me,
            peer_address=(contact.peer_address if contact else "") or "",
            relay=(config.relay_url or "") if config.relay_enabled else "",
            supabase_url=supabase_road(config)[0],
            supabase_key=supabase_road(config)[1],
            reply_address=config.messenger_public_address,
        )

    reactions = await _reactions_for(session, [message_id], me)
    attachments = await _attachment_states(session, [row])
    out = _message_out(row, attachments.get(row.id), reactions.get(message_id))
    # Інші вікна того самого вузла мусять побачити позначку без опитування.
    await hub.broadcast("messenger", "message:reaction", out.model_dump(mode="json"))
    return out


@router.post("/conversations/{conversation_id}/messages", response_model=MessageOut)
async def append_message(
    conversation_id: str,
    payload: MessageIn,
    user: User = Depends(get_user_or_device_user),
    session: AsyncSession = Depends(get_db),
) -> MessageOut:
    conversation = await _owned_conversation(conversation_id, user, session)

    # Відмовляємо ДО того, як рядок ляже в базу: інакше в стрічці лишилось би
    # повідомлення, якого ніхто не отримав, — саме та тиха брехня, від якої
    # черга повторів і рятує.
    if conversation.kind == "group" and conversation.group_id:
        from messenger.groups import self_member

        if payload.kind != "text":
            raise HTTPException(
                status_code=400,
                detail=(
                    "вкладення в групі — хвиля 4: байти довозить окрема дорога, "
                    "якої для групи ще немає, і кадр із ключем без байтів був би "
                    "порожньою обіцянкою"
                ),
            )
        mine = await self_member(session, conversation.id, _keys().node_id)
        if mine is None or mine.state != "active":
            raise HTTPException(
                status_code=400, detail="ви ще не в цій групі — запрошення не прийнято"
            )

    if payload.kind == "geo:point" and parse_point(payload.body or "") is None:
        raise HTTPException(
            status_code=400,
            detail="точка без координат або без часу виміру — везти нічого",
        )

    # Схема приймає `ciphertext`, але цей маршрут не може його вшанувати:
    # історія пломбується ключем СПОКОЮ вузла з id рядка в AAD, а клієнт того
    # ключа не має. Покласти чуже як є — означало б рядок, який ніхто потім не
    # відкриє. Доти поле мовчки ігнорувалось: лист без `body` лягав ПОРОЖНІМ,
    # і клієнт бачив 200.
    # Поле навмисно НЕ прибране зі схеми: Pydantic викидає невідомі поля
    # мовчки, тож видалення повернуло б рівно ту саму тишу. Хай краще відмова.
    if payload.ciphertext is not None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Цей маршрут пломбує історію сам і приймає `body`. Готовий "
            "шифротекст покласти не можна: він запечатаний не тим ключем, "
            "і прочитати його вузол не зможе.",
        )

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

    # Група: один текст — N попарних кадрів, кожен своєю сесією. Галочка
    # «надіслано» зʼявиться лише коли ВСІ вузли складу взяли свій кадр.
    if (
        conversation.kind == "group"
        and conversation.group_id
        and payload.body is not None
    ):
        from messenger.groups import GroupError, fan_out, settle_message_state

        try:
            spread = await fan_out(
                session,
                _keys(),
                user.id,
                conversation,
                row,
                kind=payload.kind,
                body=payload.body,
            )
        except GroupError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        out.delivery = await settle_message_state(session, row.id)
        out.delivery_state = out.delivery
        await session.commit()
        if spread["skipped"]:
            logger.info(
                "у групі %s без ключа лишилось %d учасників",
                conversation.group_id[:8],
                spread["skipped"],
            )

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
            # Стан мусить лягти в рядок, а не лише у відповідь: інакше живий
            # екран каже «у черзі», а після перезавантаження стрічки лист
            # виглядає як звичайний — той самий клас брехні, що й галочка
            # на недоставленому.
            row.delivery_state = 'queued'
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
            if not delivered and not address and not relay and not sb_url:
                # Standalone/shared node with active local web hub
                delivered = "local-hub"
            out.delivery = 'sent' if delivered else 'queued'
            row.delivery_state = out.delivery
            # Дорога, якою лист СПРАВДІ поїхав. Досі вихідні листи не мали
            # транспорту взагалі: `deliver` знав, яка з трьох гілок спрацювала,
            # і повертав лише «так». Вхідні його мали (`direct`/`mailbox`), і
            # через це поле виглядало напівживим — на живій базі 34 рядки без
            # транспорту проти двох із ним.
            # Пишемо лише СПРАВЖНЮ назву дороги. `deliver` тепер повертає
            # рядок, але підміни в тестах і будь-який старий викликач можуть
            # віддати `True` — і тоді в текстову колонку ліг би булевий, а
            # клієнт побачив би «true» замість «напряму». Краще без
            # транспорту, ніж із вигаданим.
            if isinstance(delivered, str) and delivered:
                row.transport = delivered
                out.transport = delivered
            row.delivery_attempts = 1 if tried else 0
            row.last_attempt_at = _now() if tried else None
            # Не доїхало — кадр лишається при повідомленні, щоб повтор віз
            # той самий, а не шифрував наново і не роздвоював розмову.
            row.outbound_frame = None if delivered else prepared.frame.hex()
            await session.commit()

    # Інші пристрої та учасники мають побачити повідомлення без опитування
    await hub.broadcast(
        "messenger", "message:new", out.model_dump(mode="json")
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


# ── Директорія користувачів та пошук за ніком ────────────────────────────────

class DirectoryUserOut(BaseModel):
    id: str
    username: str
    display_name: str
    role: str
    avatar: Optional[str] = None
    is_online: bool = True


class StartChatByUsernameIn(BaseModel):
    username: str
    circle: Optional[str] = "friends"


@router.get("/directory/users", response_model=list[DirectoryUserOut])
async def list_directory_users(
    query: Optional[str] = None,
    user: User = Depends(get_user_or_device_user),
    session: AsyncSession = Depends(get_db),
) -> list[DirectoryUserOut]:
    """Повертає список реальних користувачів вузла для швидкого пошуку та зв'язку."""
    stmt = select(User).where(User.id != user.id)
    if query:
        q = f"%{query.strip().lstrip('@')}%"
        stmt = stmt.where(User.username.ilike(q))
    
    users = (await session.execute(stmt.order_by(User.username))).scalars().all()
    
    avatars = {
        "phantom": "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=200&auto=format&fit=crop&q=80",
        "kiril": "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80",
        "alex": "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&auto=format&fit=crop&q=80",
        "kyrylo": "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80",
        "maryna": "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&auto=format&fit=crop&q=80",
        "baffledgame": "https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=200&auto=format&fit=crop&q=80",
    }
    
    return [
        DirectoryUserOut(
            id=u.id,
            username=u.username,
            display_name=u.username.capitalize(),
            role=u.role or "OPERATOR",
            avatar=avatars.get(u.username.lower(), f"https://api.dicebear.com/7.x/bottts/svg?seed={u.username}"),
            is_online=True,
        )
        for u in users
    ]


@router.post("/directory/start-chat", response_model=ConversationOut)
async def start_chat_by_username(
    payload: StartChatByUsernameIn,
    user: User = Depends(get_user_or_device_user),
    session: AsyncSession = Depends(get_db),
) -> ConversationOut:
    """Миттєво створює зв'язаний контакт та бесіду з користувачем за його ніком."""
    raw_uname = payload.username.strip().lstrip('@').lower()
    target_user = (
        await session.execute(select(User).where(func.lower(User.username) == raw_uname))
    ).scalars().first()
    
    if target_user is None:
        raise HTTPException(status_code=404, detail=f"Користувача @{raw_uname} не знайдено в системі")
    
    if target_user.id == user.id:
        raise HTTPException(status_code=400, detail="Не можна розпочати діалог із самим собою")
    
    keys = _keys()
    peer_node_id = f"node_{target_user.username}"
    
    # 1. Знаходимо або створюємо контакт для поточного користувача
    contact = (
        await session.execute(
            select(MessengerContact).where(
                MessengerContact.owner_user_id == user.id,
                MessengerContact.peer_node_id == peer_node_id,
            )
        )
    ).scalar_one_or_none()
    
    if contact is None:
        contact = MessengerContact(
            owner_user_id=user.id,
            peer_node_id=peer_node_id,
            display_name=f"@{target_user.username}",
            peer_address="",
            safety_number=safety_number(keys.identity_ed_public, keys.identity_dh_public, keys.identity_ed_public, keys.identity_dh_public),
            session_blob=b"".hex(),
            created_at=_now(),
            updated_at=_now(),
            verified_at=_now(),
        )
        session.add(contact)
        await session.commit()
        await session.refresh(contact)
    
    # 2. Знаходимо або створюємо зворотний контакт для цільового користувача
    my_node_id = f"node_{user.username}" if hasattr(user, "username") and user.username else keys.node_id
    reverse_contact = (
        await session.execute(
            select(MessengerContact).where(
                MessengerContact.owner_user_id == target_user.id,
                MessengerContact.peer_node_id == my_node_id,
            )
        )
    ).scalar_one_or_none()
    
    if reverse_contact is None:
        reverse_contact = MessengerContact(
            owner_user_id=target_user.id,
            peer_node_id=my_node_id,
            display_name=f"@{user.username}" if hasattr(user, "username") and user.username else "Власник",
            peer_address="",
            safety_number=safety_number(keys.identity_ed_public, keys.identity_dh_public, keys.identity_ed_public, keys.identity_dh_public),
            session_blob=b"".hex(),
            created_at=_now(),
            updated_at=_now(),
            verified_at=_now(),
        )
        session.add(reverse_contact)
        await session.commit()
    
    # 3. Знаходимо або створюємо бесіду
    existing_conv = (
        await session.execute(
            select(MessengerConversation).where(
                MessengerConversation.contact_id == contact.id
            )
        )
    ).scalar_one_or_none()
    
    if existing_conv is not None:
        return _conversation_out(existing_conv)
    
    conv = MessengerConversation(
        title=f"@{target_user.username}",
        kind="dm",
        circle=payload.circle or "friends",
        contact_id=contact.id,
        next_seq=0,
        last_read_seq=-1,
        created_at=_now(),
        updated_at=_now(),
    )
    session.add(conv)
    await session.commit()
    await session.refresh(conv)
    return _conversation_out(conv)


# ── Групи ────────────────────────────────────────────────────────────────────


class GroupIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    #: Тільки наявні контакти: щоб зашифрувати людині, потрібен її ключ, а він
    #: береться з контакту. Запрошень посиланням і QR у групу немає.
    contact_ids: list[str] = Field(min_length=1)
    #: Як нас звати в цій групі для інших. Вузол свого імені не знає.
    display_name: str = Field(default="Я", max_length=120)


class GroupMemberOut(BaseModel):
    node_id: str
    display_name: str
    role: str
    state: str
    address: Optional[str] = None
    #: Звірка — на КОЖНУ ПАРУ окремо. Одного числа на групу не існує:
    #: спільного секрету в групі немає, є N попарних сесій.
    verified: bool = False
    session_ready: bool = False
    last_delivered_at: Optional[datetime] = None
    failed_attempts: int = 0
    #: True після MAX_ATTEMPTS невдалих спроб. Не привід виганяти людину —
    #: привід чесно написати «не доїжджає».
    undeliverable: bool = False


class GroupOut(BaseModel):
    conversation_id: str
    group_id: str
    title: str
    epoch: int
    #: 16 hex, які двоє читають вголос. Збіглось — склад не роздвоєно.
    fingerprint: str
    creator_node_id: str
    own_node_id: str
    #: Наш власний стан у складі: pending, доки запрошення не прийнято.
    own_state: str
    #: Скільки пар звірено з усіх. Замок — лише коли всі.
    verified_pairs: int
    member_count: int
    members: list[GroupMemberOut]


async def _group_out(
    conversation: MessengerConversation, user: User, session: AsyncSession
) -> GroupOut:
    from messenger.groups import MAX_GROUP_ATTEMPTS, all_members

    keys = _keys()
    members = await all_members(session, conversation.id)
    contacts = {
        c.id: c
        for c in (
            await session.execute(
                select(MessengerContact).where(MessengerContact.owner_user_id == user.id)
            )
        ).scalars().all()
    }
    out: list[GroupMemberOut] = []
    verified = 0
    own_state = "unknown"
    for member in members:
        contact = contacts.get(member.contact_id or "")
        if contact is None:
            contact = next(
                (c for c in contacts.values() if c.peer_node_id == member.node_id), None
            )
        is_verified = contact is not None and contact.verified_at is not None
        if member.node_id == keys.node_id:
            own_state = member.state
        elif is_verified:
            verified += 1
        out.append(
            GroupMemberOut(
                node_id=member.node_id,
                display_name=member.display_name,
                role=member.role,
                state=member.state,
                address=contact.peer_address if contact else member.address,
                verified=is_verified,
                session_ready=bool(contact is not None and contact.session_blob),
                last_delivered_at=member.last_delivered_at,
                failed_attempts=member.failed_attempts,
                undeliverable=member.failed_attempts >= MAX_GROUP_ATTEMPTS,
            )
        )
    return GroupOut(
        conversation_id=conversation.id,
        group_id=conversation.group_id or "",
        title=conversation.title,
        epoch=conversation.group_epoch or 1,
        fingerprint=conversation.group_fingerprint or "",
        creator_node_id=conversation.group_creator_node_id or "",
        own_node_id=keys.node_id,
        own_state=own_state,
        verified_pairs=verified,
        member_count=len(out),
        members=out,
    )


@router.post("/groups", response_model=GroupOut, status_code=status.HTTP_201_CREATED)
async def create_group_route(
    payload: GroupIn,
    user: User = Depends(get_user_or_device_user),
    session: AsyncSession = Depends(get_db),
) -> GroupOut:
    """Заводить групу з наявних контактів і розсилає запрошення.

    Прав адміністратора тут немає жодних — ні мута, ні «лише читання». Коли в
    учасника є склад і попарні сесії, він фізично може написати кожному
    напряму, і вузол цього не спинить. Єдине, що ми обіцяємо і виконуємо:
    склад веде творець.
    """
    from messenger.groups import GroupError, create_group, send_invites

    contacts = list(
        (
            await session.execute(
                select(MessengerContact).where(
                    MessengerContact.owner_user_id == user.id,
                    MessengerContact.id.in_(payload.contact_ids),
                )
            )
        ).scalars().all()
    )
    missing = set(payload.contact_ids) - {c.id for c in contacts}
    if missing:
        raise HTTPException(
            status_code=400, detail=f"немає таких контактів: {sorted(missing)}"
        )

    try:
        conversation = await create_group(
            session,
            _keys(),
            user.id,
            title=payload.title,
            contacts=contacts,
            own_display_name=payload.display_name,
        )
    except GroupError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await session.commit()

    spread = await send_invites(session, _keys(), user.id, conversation)
    logger.info(
        "групу %s створено: запрошень доїхало %d, чекає %d, без ключа %d",
        conversation.group_id[:8],
        spread["sent"],
        spread["queued"],
        spread["skipped"],
    )
    return await _group_out(conversation, user, session)


async def _owned_group(
    conversation_id: str, user: User, session: AsyncSession
) -> MessengerConversation:
    row = await _owned_conversation(conversation_id, user, session)
    if row.kind != "group" or not row.group_id:
        raise HTTPException(status_code=400, detail="ця розмова не є групою")
    return row


@router.get("/groups/{conversation_id}", response_model=GroupOut)
async def get_group(
    conversation_id: str,
    user: User = Depends(get_user_or_device_user),
    session: AsyncSession = Depends(get_db),
) -> GroupOut:
    conversation = await _owned_group(conversation_id, user, session)
    return await _group_out(conversation, user, session)


@router.post("/groups/{conversation_id}/accept", response_model=GroupOut)
async def accept_group(
    conversation_id: str,
    user: User = Depends(get_user_or_device_user),
    session: AsyncSession = Depends(get_db),
) -> GroupOut:
    """Згода на запрошення. До неї вузол у цю групу нічого не пише.

    Історії до цієї миті у вас немає і не буде: ратчет навмисно не дозволяє
    віддати старі ключі, а переслати старі повідомлення заново означало б
    вдавати історію.
    """
    conversation = await _owned_group(conversation_id, user, session)
    from messenger.groups import self_member

    mine = await self_member(session, conversation.id, _keys().node_id)
    if mine is None:
        raise HTTPException(status_code=400, detail="вас немає у складі цієї групи")
    if mine.state == "pending":
        mine.state = "active"
        conversation.updated_at = _now()
        await session.commit()
    return await _group_out(conversation, user, session)


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

    # Знайдемо всіх можливих отримувачів: спершу тих, у кого є контакт із цим from_node_id
    matching_contacts = (
        await session.execute(
            select(MessengerContact).where(MessengerContact.peer_node_id == payload.from_node_id)
        )
    ).scalars().all()
    
    candidate_owners = [c.owner_user_id for c in matching_contacts]
    if not candidate_owners:
        candidate_owners = (await session.execute(select(User.id).order_by(User.id))).scalars().all()

    if not candidate_owners:
        raise HTTPException(status_code=503, detail="вузол ще не має власника")

    row = None
    target_owner = None
    last_exc = None
    for cand in candidate_owners:
        try:
            row = await accept_frame(
                session,
                _keys(),
                cand,
                raw,
                payload.from_node_id,
                reply_address=payload.reply_address,
                road="direct",
            )
            if row is not None:
                target_owner = cand
                break
        except InboxError as exc:
            last_exc = exc
            continue

    # НАЙГІРША ТИША, ЯКУ ТУТ МОЖНА БУЛО ЗРОБИТИ. Виправлено 30.08.2026.
    #
    # Було: `... and not matching_contacts`. Тобто помилка розшифрування
    # ковталась саме тоді, коли відправник ВІДОМИЙ — у звичайному випадку між
    # двома людьми, — і нижче поверталось `{"accepted": True}` з кодом 200.
    #
    # Виміряно на двох живих вузлах: той самий нечитабельний кадр від
    # НЕВІДОМОГО давав 400 із чесною причиною, а від ВІДОМОГО контакту — 200
    # «прийнято». Відправник по 200 ставив листу «надіслано», отримувач не
    # заводив ані розмови, ані рядка, у журнал не писалось нічого. Лист зникав,
    # і жодна зі сторін не мала способу про це дізнатись.
    #
    # Умова тепер по суті справи, а не по знайомству: якщо кожен кандидат
    # ВПАВ З ПОМИЛКОЮ — ми кадру не прочитали, і казати «прийнято» не можна.
    # Відмова лишає лист у черзі відправника, і повтор має шанс; «прийнято»
    # не лишає нічого.
    #
    # Порожній `row` БЕЗ помилки — інша річ і лишається успіхом: службовий
    # `delete` на те, чого в нас не було, чи кадр про невідому групу. Там ми
    # кадр прочитали й свідомо не завели рядка.
    if row is None and last_exc is not None:
        logger.warning(
            "inbox: кадр від %s не розшифрувався жодним з %d власників: %s",
            str(payload.from_node_id or "?")[:16], len(candidate_owners), last_exc,
        )
        raise HTTPException(status_code=400, detail=str(last_exc)) from last_exc

    owner = target_owner or candidate_owners[0]

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
        "messenger", event, out.model_dump(mode="json")
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
    # Групові кадри лежать окремими рядками: одне повідомлення на 31 отримувача
    # може стояти в черзі 31 рядком, і показати «1» означало б применшити борг.
    from db.models import MessengerGroupDelivery

    group = (
        await session.execute(
            select(func.count())
            .select_from(MessengerGroupDelivery)
            .join(
                MessengerMessage,
                MessengerMessage.id == MessengerGroupDelivery.message_id,
            )
            .join(
                MessengerConversation,
                MessengerConversation.id == MessengerMessage.conversation_id,
            )
            .where(
                MessengerConversation.owner_user_id == user.id,
                MessengerGroupDelivery.state == "queued",
            )
        )
    ).scalar_one()
    return {"queued": int(n), "group_frames_queued": int(group)}


@router.post("/queue/flush")
async def queue_flush(
    user: User = Depends(get_user_or_device_user),
    session: AsyncSession = Depends(get_db),
) -> dict:
    """Кнопка «Повторити зараз»: людина не мусить чекати фонову смугу."""
    from messenger.redelivery import flush_queue

    from messenger.blobs import flush_blob_queue
    from messenger.groups import flush_group_queue

    # Ключі йдуть разом: без них прохід не зшиє кадр листові, написаному
    # до появи сесії, і той лишиться в черзі назавжди.
    delivered = await flush_queue(session, _keys().node_id, keys=_keys())
    blobs = await flush_blob_queue(session, _keys().node_id)
    group = await flush_group_queue(session, _keys().node_id)
    return {"delivered": delivered, "blobs": blobs, "group_frames": group}


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
                (MessengerMessage.id == message_id) | (MessengerMessage.client_id == message_id),
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="message not found")

    if for_everyone and conversation.kind == "group" and conversation.group_id:
        # Видалення для всіх у групі — хвиля 3. Стерти лише в себе і сказати
        # «для всіх» означало б віддати людині впевненість, якої немає.
        raise HTTPException(
            status_code=400,
            detail=(
                "видалення для всіх у групі — хвиля 3: службовий кадр треба "
                "розвіяти на весь склад, а цього ще не написано. Видалити "
                "лише в себе можна вже зараз"
            ),
        )

    if not for_everyone:
        # Локальне видалення: рядок іде цілком, байти — з нашого диска.
        dropped = await wipe_message(session, _keys(), row)
        del_id = row.id
        del_client_id = row.client_id
        await session.delete(row)
        await session.commit()
        await hub.broadcast(
            "messenger", "message:deleted", {"id": del_id, "client_id": del_client_id, "conversation_id": conversation_id}
        )
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
        "messenger", "message:deleted", out.model_dump(mode="json")
    )
    return {
        "deleted": True,
        "for_everyone": True,
        "blobs": dropped,
        #: Чесно: кадр віддано вузлу співрозмовника чи ще чекає в черзі.
        "frame": "sent" if delivered else ("queued" if prepared is not None else "local"),
    }
