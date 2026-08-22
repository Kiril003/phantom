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
"""
from __future__ import annotations

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
    if contact is None:
        raise HTTPException(status_code=404, detail="контакт не знайдено")
    if not contact.peer_address:
        # Ретранслятор возить листи у скриньку — з нього дзвінок не збереш:
        # він асинхронний за задумом. Тож кажемо прямо, а не «спробуйте пізніше».
        raise HTTPException(
            status_code=409, detail="у контакта немає прямої адреси вузла — дзвінок неможливий"
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
    delivered = await _post_signal(contact.peer_address, body)
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
    owner = await _owner_id(session)

    if payload.kind not in _KINDS:
        raise HTTPException(status_code=400, detail="невідома стадія дзвінка")

    # Міряємо саме те, що доведеться нести далі в хаб, а не заявлений
    # Content-Length: заголовок пише той, хто стукає.
    size = len(payload.model_dump_json().encode())
    try:
        call_guard.check(request.client.host if request.client else "?", size)
    except GuardRejected as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc

    contact = await _contact_of(session, owner, peer_node_id=payload.from_node_id)
    if contact is None:
        # Незнайомець не має права дзвонити: лист можна прочитати й забути,
        # а дзвінок вимагає уваги просто фактом свого існування.
        raise HTTPException(status_code=403, detail="дзвінки приймаємо лише від контактів")

    # Ім'я підставляє цей вузол зі свого контакту, а не той, хто дзвонить:
    # інакше будь-хто представлявся б ким завгодно просто в полі payload.
    await hub.broadcast(
        "call",
        f"call:{payload.kind}",
        {
            "call_id": payload.call_id,
            "kind": payload.kind,
            "from_node_id": payload.from_node_id,
            "contact_id": contact.id,
            "display_name": contact.display_name,
            "verified": contact.verified_at is not None,
            "sdp": payload.sdp,
            "candidate": payload.candidate,
            "media": payload.media,
            "reason": payload.reason,
        },
        user_id=owner,
    )
    return SignalResult(delivered=True, call_id=payload.call_id)
