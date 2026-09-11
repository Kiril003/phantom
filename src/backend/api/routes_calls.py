"""`/api/v1/messenger/call/*` — сигналінг дзвінка 1:1 між двома вузлами.

Медіа сюди не заходить. Браузери домовляються про доріжку самі (ICE/DTLS/SRTP),
а вузол лише переносить SDP і кандидатів — тож «дзвінок» тут це кілька коротких
листів, а не потік. Якщо прямої дороги між браузерами не знайдеться, дзвінок не
відбудеться, і вигадати це на боці вузла неможливо.

Дві сторони входу, як і в приймальні листів. Власник ходить із токеном; чужий
вузол — без нього, бо токена цього вузла в нього немає і бути не може. Але на
відміну від листа, дзвінок від незнайомця не приймаємо: лист можна прочитати
мовчки, а дзвінок дзвонить. `from_node_id` мусить бути відомим контактом.

Шлях сигналу: браузер А → свій вузол А → вузол Б (пряма адреса контакту) →
hub.broadcast('call') → браузер Б. І дзеркально назад.

Один виняток із «медіа сюди не заходить» — `/radio`. Коли доріжки RTP немає
взагалі, голос їде шматками як звичайний E2E-кадр листування: повільніше на
секунди, зате доїжджає. Вузол і тут вмісту не бачить — кадр запечатаний тією
самою сесією, що й текст.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.websocket_hub import hub
from db.database import get_db
from db.models import MessengerContact, User
from messenger.guard import GuardRejected, InboxGuard
from security.auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/messenger/call", tags=["messenger-call"])

_TIMEOUT_S = 6.0

#: Сигнали дзвінка мають власний лічильник, а не спільний із приймальнею листів.
#: Причина проста: трикл ICE — це десятки дрібних POST за кілька секунд, і якби
#: вони їли ту саму квоту, дзвінок глушив би листування (і навпаки). Розмір
#: підібраний під SDP з відео — це кілька кілобайтів, а не мегабайти.
CALL_FRAME_LIMIT_BYTES = 32 * 1024
call_guard = InboxGuard(max_per_window=240, frame_limit=CALL_FRAME_LIMIT_BYTES)

#: Етапи дзвінка, які вузол уміє. Усе інше — не наш протокол, і пускати його
#: в широкомовлення означало б віддати інтерфейсу поле, якого він не чекає.
CALL_KINDS = ("offer", "answer", "ice", "hangup", "radio")

#: Чотири стадії, і жодної п'ятої: пропозиція, відповідь, кандидат, кінець.
_KINDS = ("offer", "answer", "ice", "hangup")


def call_url(peer_address: str) -> str:
    """Вхід для сигналів на вузлі співрозмовника. Голий хост — http на 8000."""
    raw = (peer_address or "").strip().rstrip("/")
    if not raw:
        raise ValueError("порожня адреса вузла")
    if not raw.startswith(("http://", "https://")):
        raw = f"http://{raw}"
    return f"{raw}/api/v1/messenger/call/inbound"


async def _owner_id(session: AsyncSession) -> str:
    owner = (await session.execute(select(User.id).order_by(User.id))).scalars().first()
    if owner is None:
        raise HTTPException(status_code=503, detail="вузол ще не має власника")
    return owner


class CallSignal(BaseModel):
    """Те, що власник шле співрозмовнику."""

    #: Спільний ідентифікатор розмови: усі чотири стадії їдуть під ним одним.
    call_id: str = Field(min_length=1, max_length=64)
    #: Кого набираємо. Досить одного з двох — що є під рукою в клієнта.
    contact_id: Optional[str] = None
    peer_node_id: Optional[str] = None
    sdp: Optional[str] = None
    candidate: Optional[dict[str, Any]] = None
    #: 'audio' або 'video' — чим дзвонить той, хто набрав.
    media: Optional[str] = None
    reason: Optional[str] = None


class InboundCallSignal(BaseModel):
    """Те, що прилетіло з чужого вузла. Нічому тут не віримо на слово."""

    kind: str
    call_id: str
    #: node_id того, ХТО дзвонить. За ним шукаємо контакт.
    from_node_id: str
    sdp: Optional[str] = None
    candidate: Optional[dict[str, Any]] = None
    media: Optional[str] = None
    reason: Optional[str] = None


class SignalResult(BaseModel):
    """`delivered` — це «вузол співрозмовника відповів 200», не більше."""

    delivered: bool
    call_id: str
    detail: str = ""


async def _contact_of(
    session: AsyncSession,
    owner: str,
    *,
    contact_id: Optional[str] = None,
    peer_node_id: Optional[str] = None,
) -> Optional[MessengerContact]:
    query = select(MessengerContact).where(MessengerContact.owner_user_id == owner)
    if contact_id:
        query = query.where(MessengerContact.id == contact_id)
    elif peer_node_id:
        query = query.where(MessengerContact.peer_node_id == peer_node_id)
    else:
        return None
    return (await session.execute(query)).scalars().first()


async def _post_signal(peer_address: str, payload: dict[str, Any]) -> bool:
    """Кладе сигнал у вхід чужого вузла. True лише на 200 — як у транспорті листів."""
    try:
        url = call_url(peer_address)
    except ValueError:
        return False
    async with httpx.AsyncClient(timeout=_TIMEOUT_S) as http:
        try:
            response = await http.post(url, json=payload)
        except Exception as exc:  # noqa: BLE001 — мережа падає як завгодно
            logger.info("сигнал дзвінка не доїхав до %s: %s", peer_address, exc)
            return False
    if response.status_code == 200:
        return True
    logger.info("вузол %s відмовив у сигналі: %s", peer_address, response.status_code)
    return False


async def _send(
    kind: str,
    payload: CallSignal,
    user: User,
    session: AsyncSession,
) -> SignalResult:
    contact = await _contact_of(
        session,
        user.id,
        contact_id=payload.contact_id,
        peer_node_id=payload.peer_node_id,
    )
    # Обидві відмови були відсутні: дзвінок невідомому й дзвінок туди, куди
    # немає дороги, повертали 200. Тобто інтерфейс піднімав екран виклику, а
    # сигнал не їхав нікуди — та сама «скажи, чи дійде», лише в дзвінках.
    if contact is None:
        raise HTTPException(status_code=404, detail="контакт не знайдено")
    if not contact.peer_address:
        # Ретранслятор асинхронний за задумом: він довозить листи, але дзвінка
        # з нього не зібрати. Обіцяти виклик без прямої адреси — брехня.
        raise HTTPException(
            status_code=409, detail="немає прямої адреси — дзвінок не зібрати"
        )

    from api.routes_messenger import _keys

    body = {
        "kind": kind,
        "call_id": payload.call_id,
        "from_node_id": _keys().node_id,
        "sdp": payload.sdp,
        "candidate": payload.candidate,
        "media": payload.media,
        "reason": payload.reason,
    }

    delivered = False
    if contact and contact.peer_address:
        delivered = await _post_signal(contact.peer_address, body)

    if not delivered:
        # Якщо прямої адреси немає або це парні акаунти на одному сервері — транслюємо через WebSocket хаб
        from db.models import MessengerContact as MC
        target_owner_id = None
        if contact:
            # Шукаємо парний контакт у іншого користувача
            reverse = (
                await session.execute(
                    select(MC).where(MC.owner_user_id != user.id, MC.peer_node_id == _keys().node_id)
                )
            ).scalars().first()
            if reverse:
                target_owner_id = reverse.owner_user_id
        
        if not target_owner_id and payload.peer_node_id:
            target_user = (
                await session.execute(
                    select(User).where(User.username == payload.peer_node_id.replace("node_", ""))
                )
            ).scalars().first()
            if target_user:
                target_owner_id = target_user.id

        if target_owner_id or not contact:
            await hub.broadcast(
                "call",
                f"call:{kind}",
                {
                    "call_id": payload.call_id,
                    "kind": kind,
                    "from_node_id": _keys().node_id,
                    "contact_id": payload.contact_id or (contact.id if contact else None),
                    "display_name": user.username or (contact.display_name if contact else "Співрозмовник"),
                    # Тут стояло `else True`: коли контакту НЕМАЄ — тобто ми не
                    # знаємо про того, хто дзвонить, узагалі нічого, — вузол
                    # позначав дзвінок звіреним, і картка на тому боці малювала
                    # зелений щит невідомому. Невідоме — це `None`, а не «так»:
                    # рушій носить `verified` як `boolean | null` саме для цього.
                    "verified": (contact.verified_at is not None) if contact else None,
                    "sdp": payload.sdp,
                    "candidate": payload.candidate,
                    "media": payload.media,
                    "reason": payload.reason,
                },
                user_id=target_owner_id,
            )
            delivered = True

    return SignalResult(
        delivered=delivered,
        call_id=payload.call_id,
        detail="" if delivered else "вузол співрозмовника не прийняв сигнал",
    )


@router.post("/offer", response_model=SignalResult)
async def send_offer(
    payload: CallSignal,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> SignalResult:
    return await _send("offer", payload, user, session)


@router.post("/answer", response_model=SignalResult)
async def send_answer(
    payload: CallSignal,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> SignalResult:
    return await _send("answer", payload, user, session)


@router.post("/ice", response_model=SignalResult)
async def send_ice(
    payload: CallSignal,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> SignalResult:
    return await _send("ice", payload, user, session)


@router.post("/hangup", response_model=SignalResult)
async def send_hangup(
    payload: CallSignal,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> SignalResult:
    return await _send("hangup", payload, user, session)


#: Шматок рації: 3 секунди Opus на 16 кбіт/с — це 6-8 КБ, у base64 близько 10.
#: Стеля з великим запасом, але нижче за межу приймальні (64 КБ): кадр, який
#: туди не пролізе, не варто ні шифрувати, ні везти.
RADIO_B64_LIMIT = 48_000


class RadioChunk(BaseModel):
    """Шматок голосу, коли доріжки RTP уже немає."""

    call_id: str = Field(min_length=1, max_length=64)
    #: Порядковий номер у межах дзвінка — за ним приймач збирає чергу.
    seq: int = Field(ge=0)
    audio_b64: str = Field(min_length=1, max_length=RADIO_B64_LIMIT)
    contact_id: Optional[str] = None
    peer_node_id: Optional[str] = None


@router.post("/radio", response_model=SignalResult)
async def send_radio(
    payload: RadioChunk,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> SignalResult:
    """Везе шматок голосу тією ж дорогою, що й лист: E2E-кадром через вузол.

    Саме тому це працює там, де вмирає дзвінок. RTP — це UDP без повтору: на
    25% втрат від голосу лишається каша. Кадр іде по TCP до вузла, шифрується
    тією ж сесією, що й листування, і вузол його вмісту не бачить так само,
    як не бачить тексту. Повільніше на секунди — зате доїжджає цілим.

    Рядка в стрічці цей кадр не лишає з жодного боку: ні тут (нічого не
    пишемо в базу), ні там (приймальня віддає його дзвінку, а не розмові).
    """
    from api.routes_messenger import _keys
    from messenger.blobs import wrap_frame
    from messenger.inbox import conversation_for
    from messenger.outbox import OutboxError, prepare_frame
    from messenger.transport import deliver

    contact = await _contact_of(
        session,
        user.id,
        contact_id=payload.contact_id,
        peer_node_id=payload.peer_node_id,
    )
    if contact is None:
        raise HTTPException(status_code=404, detail="контакт не знайдено")

    conversation = await conversation_for(session, user.id, contact)
    body = json.dumps(
        {"call_id": payload.call_id, "seq": payload.seq, "audio_b64": payload.audio_b64},
        separators=(",", ":"),
    )
    try:
        prepared = await prepare_frame(
            session, _keys(), conversation, wrap_frame("radio", body)
        )
    except OutboxError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if prepared is None:
        raise HTTPException(status_code=409, detail="сесія з цим контактом не зведена")

    # Храповик зрушив — це треба зберегти навіть якщо шматок не доїде, інакше
    # наступний кадр піде тим самим ключем.
    await session.commit()

    from config import config

    delivered = await deliver(
        prepared.frame,
        peer_node_id=prepared.peer_node_id,
        from_node_id=_keys().node_id,
        peer_address=contact.peer_address or "",
        relay=(config.relay_url or "") if config.relay_enabled else "",
        reply_address=config.messenger_public_address,
    )
    # Не доїхав — і не поїде: секунда голосу, доставлена через хвилину, це вже
    # не розмова. Черга тут була б шкодою, а не послугою.
    return SignalResult(
        delivered=delivered,
        call_id=payload.call_id,
        detail="" if delivered else "шматок не доїхав",
    )


@router.post("/inbound", response_model=SignalResult)
async def receive_signal(
    payload: InboundCallSignal,
    request: Request,
    session: AsyncSession = Depends(get_db),
) -> SignalResult:
    """Приймає сигнал дзвінка від чужого вузла. Свідомо без JWT.

    Порядок перевірок — від найдешевшої до найдорожчої: спершу форма й розмір,
    потім частота, і лише тоді похід у базу за контактом.
    """
    # ЖОДНОЇ перевірки тут не було до 31.08.2026, і це коштувало трьох дір
    # одразу: незнайомець міг подзвонити, міг слати без обмежень, і — найгірше
    # — діставав у інтерфейсі позначку `verified: true`. Тобто вузол не просто
    # пускав чужого, він СТВЕРДЖУВАВ, що чужий перевірений.
    #
    # Порядок навмисний і збігається з тим, що обіцяє docstring: спершу форма,
    # потім частота й розмір, і лише тоді похід у базу. Сміття від незнайомця
    # не має коштувати нам запиту до диска.
    if payload.kind not in CALL_KINDS:
        raise HTTPException(status_code=400, detail="невідомий етап дзвінка")

    # Сторож був створений на рядку 50 і не викликався НІ РАЗУ — написаний,
    # покритий тестами й нікому не потрібен. Класика цього дому.
    try:
        call_guard.check(
            payload.from_node_id or "?",
            len(payload.model_dump_json().encode("utf-8")),
        )
    except GuardRejected as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc

    # Знайдемо, хто з користувачів вузла має контакт із цим from_node_id
    matching_contact = (
        await session.execute(
            select(MessengerContact).where(MessengerContact.peer_node_id == payload.from_node_id)
        )
    ).scalars().first()

    if matching_contact:
        owner = matching_contact.owner_user_id
        contact = matching_contact
    else:
        owner = await _owner_id(session)
        contact = await _contact_of(session, owner, peer_node_id=payload.from_node_id) if owner else None

    if contact is None:
        # Дзвонити може лише той, кого власник сам додав. Без цього будь-який
        # вузол мережі підіймав би дзвінок на пристрої людини.
        raise HTTPException(status_code=403, detail="дзвінки приймаємо лише від відомих співрозмовників")

    display_name = contact.display_name
    # `verified` тепер НЕ МОЖЕ бути правдою без контакту: раніше гілка `else`
    # ставила True саме для невідомого, тобто значок довіри діставався чужому.
    verified = contact.verified_at is not None

    await hub.broadcast(
        "call",
        f"call:{payload.kind}",
        {
            "call_id": payload.call_id,
            "kind": payload.kind,
            "from_node_id": payload.from_node_id,
            "contact_id": contact.id if contact else None,
            "display_name": display_name,
            "verified": verified,
            "sdp": payload.sdp,
            "candidate": payload.candidate,
            "media": payload.media,
            "reason": payload.reason,
        },
        user_id=owner,
    )
    return SignalResult(delivered=True, call_id=payload.call_id)
