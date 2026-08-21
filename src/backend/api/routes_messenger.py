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

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.websocket_hub import hub
from db.database import get_db
from db.models import MessengerConversation, MessengerMessage, User
from messenger.crypto.at_rest import AtRestError, seal, unseal
from messenger.crypto.keys import KeyStore
from node.identity import node_id
from security.auth import get_current_user

_node_keys: KeyStore | None = None


def _keys() -> KeyStore:
    """Ключі вузла читаємо з диска один раз на процес."""
    global _node_keys
    if _node_keys is None:
        _node_keys = KeyStore.from_node()
    return _node_keys

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
    _user: User = Depends(get_current_user),
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


# ── Розмови ──────────────────────────────────────────────────────────────────


class ConversationIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    kind: str = "dm"
    circle: str = "all"
    handle: Optional[str] = None
    avatar: Optional[str] = None


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


def _conversation_out(row: MessengerConversation) -> ConversationOut:
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
    )


@router.get("/conversations", response_model=list[ConversationOut])
async def list_conversations(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> list[ConversationOut]:
    rows = (
        await session.execute(
            select(MessengerConversation)
            .where(MessengerConversation.owner_user_id == user.id)
            .order_by(MessengerConversation.updated_at.desc(), MessengerConversation.id)
        )
    ).scalars().all()
    return [_conversation_out(r) for r in rows]


class BootstrapIn(BaseModel):
    conversations: list[ConversationIn]


@router.post("/bootstrap", response_model=list[ConversationOut])
async def bootstrap_conversations(
    payload: BootstrapIn,
    user: User = Depends(get_current_user),
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
        return [_conversation_out(r) for r in existing]

    rows = [
        MessengerConversation(
            owner_user_id=user.id,
            title=c.title,
            kind=c.kind,
            circle=c.circle,
            handle=c.handle,
            avatar=c.avatar,
            created_at=_now(),
            updated_at=_now(),
        )
        for c in payload.conversations
    ]
    session.add_all(rows)
    await session.commit()
    # Віддаємо тим самим порядком, що й /conversations: інакше повторний виклик
    # поверне ті самі розмови інакше перемішаними, і клієнт вирішить, що щось змінилось.
    created = (
        await session.execute(
            select(MessengerConversation)
            .where(MessengerConversation.owner_user_id == user.id)
            .order_by(MessengerConversation.updated_at.desc(), MessengerConversation.id)
        )
    ).scalars().all()
    return [_conversation_out(r) for r in created]


@router.post(
    "/conversations", response_model=ConversationOut, status_code=status.HTTP_201_CREATED
)
async def create_conversation(
    payload: ConversationIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> ConversationOut:
    row = MessengerConversation(
        owner_user_id=user.id,
        title=payload.title,
        kind=payload.kind,
        circle=payload.circle,
        handle=payload.handle,
        avatar=payload.avatar,
        created_at=_now(),
        updated_at=_now(),
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _conversation_out(row)


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
    sent_at: datetime
    edited_at: Optional[datetime]
    deleted_at: Optional[datetime]


def _body_of(row: MessengerMessage) -> Optional[str]:
    """Тіло повідомлення лежить запечатаним; відкритий body лишився в старих рядках."""
    if not row.ciphertext:
        return row.body
    try:
        return unseal(_keys(), bytes.fromhex(row.ciphertext), aad=row.id.encode())
    except (AtRestError, ValueError):
        # Ключі вузла змінилися або рядок зіпсовано — краще порожньо, ніж вигадка.
        return None


def _message_out(row: MessengerMessage) -> MessageOut:
    return MessageOut(
        id=row.id,
        conversation_id=row.conversation_id,
        client_id=row.client_id,
        seq=row.seq,
        author_id=row.author_id,
        author_name=row.author_name,
        kind=row.kind,
        body=_body_of(row),
        # Назовні шифротекст не віддаємо: клієнту він ні до чого, а в логах зайвий.
        ciphertext=None,
        transport=row.transport,
        sent_at=row.sent_at,
        edited_at=row.edited_at,
        deleted_at=row.deleted_at,
    )


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageOut])
async def list_messages(
    conversation_id: str,
    after_seq: int = 0,
    limit: int = 200,
    user: User = Depends(get_current_user),
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
    return [_message_out(r) for r in rows]


@router.post("/conversations/{conversation_id}/messages", response_model=MessageOut)
async def append_message(
    conversation_id: str,
    payload: MessageIn,
    user: User = Depends(get_current_user),
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
        sent_at=_now(),
    )
    if payload.body is not None:
        row.ciphertext = seal(_keys(), payload.body, aad=row.id.encode()).hex()
    conversation.next_seq += 1
    conversation.updated_at = _now()
    session.add(row)
    await session.commit()
    await session.refresh(row)
    out = _message_out(row)

    # Інші пристрої власника мають побачити повідомлення без опитування —
    # телефон і ПК уже висять на цьому ж хабі, іншого каналу вигадувати не треба.
    await hub.broadcast(
        "messenger", "message:new", out.model_dump(mode="json"), user_id=user.id
    )
    return out
