"""`/api/v1/messenger/files/*` — вкладення месенджера.

Файл їде двома дорогами, і це головне, що варто тут розуміти.

Ключ до нього лежить у тілі повідомлення й летить наскрізним кадром разом із
текстом. Байти — окремо, звичайним HTTP, і навмисне без жодного захисту
транспорту: вони вже шифротекст. Вузол-одержувач зберігає вкладення, яке не
може прочитати; розшифрування відбувається в браузері власника.

Тому приймальня блобів публічна — у співрозмовника немає й не може бути
токена цього вузла. Замість токена стоїть інше: блоб беруть лише від того,
кого власник уже має в контактах, і лише в межах розміру.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    Response,
    UploadFile,
    status,
)
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import config
from db.database import get_db
from db.models import (
    MessengerBlob,
    MessengerContact,
    MessengerConversation,
    User,
)
from messenger.blobs import (
    BLOB_LIMIT_BYTES,
    BlobRejected,
    inbound_blob_guard,
    new_blob_id,
    push_blob,
    read_bytes,
    record,
    request_from_peer,
    store_bytes,
)
from security.auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/messenger/files", tags=["messenger"])


def _keys():
    from api.routes_messenger import _keys as node_keys

    return node_keys()


class BlobOut(BaseModel):
    blob_id: str
    size: int
    #: Відбиток ШИФРОТЕКСТУ. Браузер звіряє його перед розшифруванням.
    sha256: str
    #: stored | queued | sent | missing — стан перевезення, не вмісту.
    state: str


async def _contact_of(
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


async def _owned_blob(
    blob_id: str, user: User, session: AsyncSession
) -> MessengerBlob:
    """Рядок блоба, якщо він належить власнику цього вузла.

    Належність доводиться не самим ідентифікатором — інакше він став би
    паролем, — а розмовою або контактом, які вже прив'язані до власника.
    """
    row = await session.get(MessengerBlob, blob_id)
    if row is None:
        raise HTTPException(status_code=404, detail="вкладення не знайдено")

    if row.conversation_id:
        conversation = await session.get(MessengerConversation, row.conversation_id)
        if conversation is not None and conversation.owner_user_id == user.id:
            return row
    if row.peer_node_id:
        contact = await _contact_of(session, user.id, row.peer_node_id)
        if contact is not None:
            return row
    raise HTTPException(status_code=404, detail="вкладення не знайдено")


# ── Власник: покласти, забрати, дізнатись стан ───────────────────────────────


@router.post("/upload", response_model=BlobOut)
async def upload_blob(
    conversation_id: str = Form(...),
    blob: UploadFile = File(...),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> BlobOut:
    """Приймає ВЖЕ зашифрований браузером файл і везе його співрозмовнику.

    Вузол не бачив ані відкритого файла, ані ключа: браузер шифрує до
    завантаження, а ключ кладе в тіло повідомлення. Тут лише байти.
    """
    conversation = await session.get(MessengerConversation, conversation_id)
    if conversation is None or conversation.owner_user_id != user.id:
        raise HTTPException(status_code=404, detail="розмову не знайдено")

    data = await blob.read()
    if not data:
        raise HTTPException(status_code=400, detail="порожнє вкладення")
    if len(data) > BLOB_LIMIT_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="вкладення завелике",
        )

    blob_id = new_blob_id()
    digest = store_bytes(blob_id, data)

    # Розмова ні з ким (нотатки собі) — везти нікуди, і це не помилка.
    peer_node_id = ""
    address = ""
    if conversation.contact_id:
        contact = await session.get(MessengerContact, conversation.contact_id)
        if contact is not None:
            peer_node_id = contact.peer_node_id
            address = contact.peer_address or ""

    state = "stored"
    attempts = 0
    if peer_node_id:
        # Ретранслятор возить кадри, не файли. Немає прямої адреси — блоб
        # чесно лягає в чергу і чекає, а не вдає доставленим.
        state = "queued"
        if address:
            attempts = 1
            if await push_blob(
                address, blob_id, data, from_node_id=_keys().node_id
            ):
                state = "sent"

    row = await record(
        session,
        blob_id,
        direction="out",
        state=state,
        size=len(data),
        sha256=digest,
        conversation_id=conversation_id,
        peer_node_id=peer_node_id or None,
    )
    row.attempts = attempts
    await session.commit()

    return BlobOut(blob_id=blob_id, size=len(data), sha256=digest, state=state)


# Літеральні шляхи оголошені до `/{blob_id}` — інакше він з'їв би їх обидва.


class OutboundRequest(BaseModel):
    blob_id: str
    from_node_id: str
    reply_address: str = ""


@router.post("/inbound")
async def receive_blob(
    request: Request,
    blob_id: str = Form(...),
    from_node_id: str = Form(...),
    blob: UploadFile = File(...),
    session: AsyncSession = Depends(get_db),
) -> dict:
    """Приймає шифротекст вкладення від чужого вузла.

    Свідомо без JWT: у співрозмовника немає токена цього вузла. Але й не для
    всіх підряд — беремо лише від того, кого власник уже вніс у контакти.
    Незнайомець не має права класти байти на чужий диск.
    """
    owner = (await session.execute(select(User.id).order_by(User.id))).scalars().first()
    if owner is None:
        raise HTTPException(status_code=503, detail="вузол ще не має власника")

    contact = await _contact_of(session, owner, from_node_id)
    if contact is None:
        raise HTTPException(
            status_code=403, detail="вкладення приймаємо лише від відомих співрозмовників"
        )

    # Відсікаємо завелике до читання в память: заявлений розмір — привід
    # відмовити одразу, а не після того, як воно вже лягло на диск.
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > BLOB_LIMIT_BYTES + 4096:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="вкладення завелике для цього вузла",
        )

    data = await blob.read()
    try:
        inbound_blob_guard.check(from_node_id, len(data))
    except BlobRejected as exc:
        code = (
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
            if len(data) > BLOB_LIMIT_BYTES
            else status.HTTP_429_TOO_MANY_REQUESTS
        )
        raise HTTPException(status_code=code, detail=str(exc)) from exc

    try:
        digest = store_bytes(blob_id, data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    conversation = (
        await session.execute(
            select(MessengerConversation).where(
                MessengerConversation.owner_user_id == owner,
                MessengerConversation.contact_id == contact.id,
            )
        )
    ).scalar_one_or_none()

    await record(
        session,
        blob_id,
        direction="in",
        state="stored",
        size=len(data),
        sha256=digest,
        conversation_id=conversation.id if conversation is not None else None,
        peer_node_id=from_node_id,
    )
    await session.commit()
    # Вузол зберіг те, чого не може прочитати: ключ їде в тілі повідомлення.
    return {"stored": True, "size": len(data), "sha256": digest}


@router.post("/outbound-request")
async def resend_blob(
    payload: OutboundRequest,
    request: Request,
    session: AsyncSession = Depends(get_db),
) -> dict:
    """Співрозмовник просить надіслати вкладення ще раз.

    Байти за самим лише ідентифікатором ми не віддаємо — інакше він став би
    паролем. Замість цього звіряємо, що прохач і є той, кому це вкладення
    призначалось, і штовхаємо блоб у ЙОГО приймальню.
    """
    owner = (await session.execute(select(User.id).order_by(User.id))).scalars().first()
    if owner is None:
        raise HTTPException(status_code=503, detail="вузол ще не має власника")

    try:
        inbound_blob_guard.check(payload.from_node_id, 1)
    except BlobRejected as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc

    contact = await _contact_of(session, owner, payload.from_node_id)
    if contact is None:
        raise HTTPException(status_code=403, detail="невідомий співрозмовник")

    row = await session.get(MessengerBlob, payload.blob_id)
    if row is None or row.direction != "out" or row.peer_node_id != payload.from_node_id:
        raise HTTPException(status_code=404, detail="такого вкладення для вас немає")

    data = read_bytes(payload.blob_id)
    if data is None:
        row.state = "missing"
        await session.commit()
        raise HTTPException(status_code=410, detail="байтів вкладення вже немає")

    address = contact.peer_address or payload.reply_address or ""
    if not address:
        raise HTTPException(status_code=409, detail="адреса вашого вузла невідома")

    row.attempts += 1
    pushed = await push_blob(
        address, payload.blob_id, data, from_node_id=_keys().node_id
    )
    if pushed:
        row.state = "sent"
    await session.commit()
    return {"pushed": pushed}


@router.get("/{blob_id}/status", response_model=BlobOut)
async def blob_status(
    blob_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> BlobOut:
    row = await _owned_blob(blob_id, user, session)
    return BlobOut(
        blob_id=row.blob_id, size=row.size, sha256=row.sha256, state=row.state
    )


@router.post("/{blob_id}/request", response_model=BlobOut)
async def ask_again(
    blob_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> BlobOut:
    """«Запитати ще раз» — прохання до вузла відправника надіслати блоб знову."""
    row = await session.get(MessengerBlob, blob_id)
    peer_node_id = row.peer_node_id if row is not None else None
    conversation_id = row.conversation_id if row is not None else None

    # Блоб міг не доїхати ЖОДНОГО разу — тоді рядка про нього тут ще немає,
    # і єдина зачіпка приходить від клієнта: розмова, у якій він стоїть.
    if peer_node_id is None:
        raise HTTPException(status_code=404, detail="про це вкладення вузол ще не знає")

    contact = await _contact_of(session, user.id, peer_node_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="вкладення не знайдено")

    address = contact.peer_address or ""
    if not address:
        raise HTTPException(
            status_code=409, detail="прямої адреси вузла співрозмовника немає"
        )

    ok = await request_from_peer(
        address,
        blob_id,
        from_node_id=_keys().node_id,
        reply_address=config.messenger_public_address,
    )
    refreshed = await session.get(MessengerBlob, blob_id)
    if refreshed is not None:
        await session.refresh(refreshed)
    state = "stored" if ok and refreshed is not None else (
        refreshed.state if refreshed is not None else "queued"
    )
    return BlobOut(
        blob_id=blob_id,
        size=refreshed.size if refreshed else 0,
        sha256=refreshed.sha256 if refreshed else "",
        state=state,
    )


@router.get("/{blob_id}")
async def fetch_blob(
    blob_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> Response:
    """Віддає шифротекст браузеру власника. Розшифрує його браузер, не вузол."""
    row = await _owned_blob(blob_id, user, session)
    data = read_bytes(row.blob_id)
    if data is None:
        raise HTTPException(status_code=404, detail="байтів вкладення немає")
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={
            # Тип і імʼя навмисне не оголошуємо: вузол їх не знає, вони живуть
            # у тілі повідомлення. Тут — просто непрозорі байти.
            "Cache-Control": "no-store",
            "X-Blob-Sha256": row.sha256,
        },
    )
