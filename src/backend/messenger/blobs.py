"""Перевезення вкладень: вузол несе байти, але не знає, що в них.

Розділення тут навмисне і воно ж головне. Ключ до файла їде в ТІЛІ
повідомлення — тобто тим самим наскрізним кадром, що й текст, і лягає в базу
запечатаним. А шифротекст файла їде окремо, звичайним HTTP, і його може
бачити хто завгодно по дорозі — з нього однаково нічого не дістати.

Через це вузол-одержувач зберігає вкладення, якого не може прочитати, і це
не збіг, а вимога: місце зберігання не повинно давати доступ до вмісту.
Розшифрування відбувається в браузері власника, коли той відкриває розмову.

Тут немає жодного «майже доставлено». Блоб або підтверджений вузлом-адресатом
(state='sent'), або чесно лежить у черзі (state='queued') і чекає повтору.
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import MessengerBlob, MessengerContact, MessengerConversation

logger = logging.getLogger(__name__)

__all__ = [
    "BLOB_LIMIT_BYTES",
    "BlobRejected",
    "InboundBlobGuard",
    "MAX_BLOB_ATTEMPTS",
    "blob_dir",
    "blob_path",
    "delete_bytes",
    "flush_blob_queue",
    "inbound_blob_guard",
    "new_blob_id",
    "push_blob",
    "read_bytes",
    "request_from_peer",
    "sha256_hex",
    "store_bytes",
    "unwrap_frame",
    "wrap_frame",
]

#: Стеля одного вкладення. Не «скільки влізе», а скільки вузол готовий узяти
#: від незнайомця без жодного токена: приймальня блобів публічна за задумом.
BLOB_LIMIT_BYTES = 25 * 1024 * 1024

#: Після цього блоб лишається queued, але вузол перестає гатити в стіну.
#: Він не зникає — чекає, поки одержувач сам попросить.
MAX_BLOB_ATTEMPTS = 12

_TIMEOUT_S = 30.0
_BLOB_ID_RE = re.compile(r"^[0-9a-f]{32,64}$")


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ── Конверт кадру ────────────────────────────────────────────────────────────
#
# Текстовий кадр історично віз голий рядок, і ламати це не можна: у людей уже
# є зведені сесії й черга з готовими кадрами. Тож тип везе префікс, а старий
# кадр без префікса лишається текстом — розбір падає назад на 'text' сам.

_WIRE_MARK = "\x01phantom-kind:"


def wrap_frame(kind: str, body: str) -> str:
    """Готує відкритий текст кадру для типу, відмінного від тексту."""
    if kind == "text":
        return body
    return f"{_WIRE_MARK}{kind}\n{body}"


def unwrap_frame(plaintext: str) -> tuple[str, str]:
    """Розбирає кадр назад у (kind, body). Без префікса — це текст."""
    if not plaintext.startswith(_WIRE_MARK):
        return "text", plaintext
    head, _, body = plaintext.partition("\n")
    kind = head[len(_WIRE_MARK):].strip()
    # Тип приїхав ззовні — беремо лише те, що вміємо показати.
    if kind not in ("image", "file"):
        return "text", plaintext
    return kind, body


# ── Байти на диску ───────────────────────────────────────────────────────────


def blob_dir() -> Path:
    from paths import resolve_data_dir

    path = resolve_data_dir("workspace") / "messenger_blobs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def new_blob_id() -> str:
    """32 випадкові байти. Ідентифікатор не має нічого казати про вміст."""
    return os.urandom(32).hex()


def blob_path(blob_id: str) -> Path:
    """Шлях до блоба. Ідентифікатор приходить ззовні, тож перевіряється тут.

    Це єдине місце, де рядок з мережі стає іменем файла, — і саме тому
    перевірка стоїть тут, а не в кожному викликачі окремо.
    """
    if not _BLOB_ID_RE.match(blob_id or ""):
        raise ValueError("непридатний ідентифікатор блоба")
    return blob_dir() / blob_id


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def store_bytes(blob_id: str, data: bytes) -> str:
    """Кладе шифротекст на диск і повертає його відбиток.

    Запис іде через тимчасове імʼя: обірваний посеред запису файл не має
    вдавати цілий блоб, бо тоді перевірка відбитка впаде вже в браузері,
    коли пояснювати щось людині запізно.
    """
    target = blob_path(blob_id)
    tmp = target.with_name(f".{blob_id}.part")
    tmp.write_bytes(data)
    tmp.replace(target)
    return sha256_hex(data)


def read_bytes(blob_id: str) -> Optional[bytes]:
    path = blob_path(blob_id)
    if not path.exists():
        return None
    return path.read_bytes()


def delete_bytes(blob_id: str) -> bool:
    try:
        blob_path(blob_id).unlink()
        return True
    except (FileNotFoundError, ValueError):
        return False


# ── Захист публічної приймальні блобів ───────────────────────────────────────


class BlobRejected(Exception):
    """Блоб відкинуто до того, як його записали на диск."""


class InboundBlobGuard:
    """Приймальня блобів відкрита без токена — і саме тому має межі.

    Ліміти грубі навмисне: захистити диск від потоку, не заважаючи людині
    надіслати фото з відпустки.
    """

    def __init__(
        self,
        *,
        window_s: float = 60.0,
        max_per_window: int = 30,
        limit_bytes: int = BLOB_LIMIT_BYTES,
    ) -> None:
        self._window_s = window_s
        self._max = max_per_window
        self._limit = limit_bytes
        self._hits: dict[str, deque[float]] = {}

    def check(self, source: str, size: int, *, now: float | None = None) -> None:
        if size <= 0:
            raise BlobRejected("порожній блоб")
        if size > self._limit:
            raise BlobRejected("вкладення завелике для цього вузла")

        moment = time.monotonic() if now is None else now
        hits = self._hits.setdefault(source or "?", deque())
        while hits and moment - hits[0] > self._window_s:
            hits.popleft()
        if len(hits) >= self._max:
            raise BlobRejected("забагато вкладень з цієї адреси")
        hits.append(moment)

        if len(self._hits) > 1024:
            stale = [k for k, v in self._hits.items() if not v or moment - v[-1] > self._window_s]
            for key in stale:
                self._hits.pop(key, None)


inbound_blob_guard = InboundBlobGuard()


# ── Дорога до вузла співрозмовника ───────────────────────────────────────────


def _base(peer_address: str) -> str:
    raw = (peer_address or "").strip().rstrip("/")
    if not raw:
        raise ValueError("порожня адреса вузла")
    if not raw.startswith(("http://", "https://")):
        raw = f"http://{raw}"
    return raw


def inbound_url(peer_address: str) -> str:
    return f"{_base(peer_address)}/api/v1/messenger/files/inbound"


def outbound_request_url(peer_address: str) -> str:
    return f"{_base(peer_address)}/api/v1/messenger/files/outbound-request"


async def push_blob(
    peer_address: str,
    blob_id: str,
    data: bytes,
    *,
    from_node_id: str,
    client: Optional[httpx.AsyncClient] = None,
) -> bool:
    """Кладе шифротекст у приймальню вузла-адресата. True лише на 200."""
    try:
        url = inbound_url(peer_address)
    except ValueError:
        return False

    own = client is None
    http = client or httpx.AsyncClient(timeout=_TIMEOUT_S)
    try:
        response = await http.post(
            url,
            data={"blob_id": blob_id, "from_node_id": from_node_id},
            files={"blob": (blob_id, data, "application/octet-stream")},
        )
        if response.status_code == 200:
            return True
        logger.info("вузол не взяв вкладення %s: %s", blob_id[:8], response.status_code)
        return False
    except Exception as exc:  # noqa: BLE001 — мережа падає як завгодно
        logger.info("вкладення %s не доїхало: %s", blob_id[:8], exc)
        return False
    finally:
        if own:
            await http.aclose()


async def request_from_peer(
    peer_address: str,
    blob_id: str,
    *,
    from_node_id: str,
    reply_address: str = "",
    client: Optional[httpx.AsyncClient] = None,
) -> bool:
    """Просить вузол відправника надіслати блоб ще раз.

    Просимо, а не тягнемо: віддавати байти за самим лише ідентифікатором
    означало б зробити його паролем. Хай вузол-відправник сам звірить, що
    прохач — його співрозмовник, і сам штовхне блоб у нашу приймальню.
    """
    try:
        url = outbound_request_url(peer_address)
    except ValueError:
        return False

    own = client is None
    http = client or httpx.AsyncClient(timeout=_TIMEOUT_S)
    try:
        response = await http.post(
            url,
            json={
                "blob_id": blob_id,
                "from_node_id": from_node_id,
                "reply_address": reply_address,
            },
        )
        return response.status_code == 200 and bool(response.json().get("pushed"))
    except Exception as exc:  # noqa: BLE001
        logger.info("вузол не відгукнувся на прохання про %s: %s", blob_id[:8], exc)
        return False
    finally:
        if own:
            await http.aclose()


# ── Облік перевезень ─────────────────────────────────────────────────────────


async def record(
    session: AsyncSession,
    blob_id: str,
    *,
    direction: str,
    state: str,
    size: int,
    sha256: str,
    conversation_id: Optional[str] = None,
    peer_node_id: Optional[str] = None,
) -> MessengerBlob:
    row = await session.get(MessengerBlob, blob_id)
    if row is None:
        row = MessengerBlob(blob_id=blob_id, direction=direction, created_at=_now())
        session.add(row)
    row.state = state
    row.size = size
    row.sha256 = sha256
    if conversation_id:
        row.conversation_id = conversation_id
    if peer_node_id:
        row.peer_node_id = peer_node_id
    return row


async def flush_blob_queue(
    session: AsyncSession, own_node_id: str, *, limit: int = 20
) -> int:
    """Довозить вкладення, які не доїхали. Повертає кількість доставлених.

    Йде тією ж смугою, що й черга повідомлень: людина надіслала фото, воно не
    доїхало, і ніхто про це не мусить памʼятати руками.
    """
    rows = (
        await session.execute(
            select(MessengerBlob)
            .where(
                MessengerBlob.direction == "out",
                MessengerBlob.state == "queued",
                MessengerBlob.attempts < MAX_BLOB_ATTEMPTS,
            )
            .order_by(MessengerBlob.created_at)
            .limit(limit)
        )
    ).scalars().all()

    delivered = 0
    for row in rows:
        address = ""
        if row.conversation_id:
            conversation = await session.get(MessengerConversation, row.conversation_id)
            if conversation is not None and conversation.contact_id:
                contact = await session.get(MessengerContact, conversation.contact_id)
                if contact is not None:
                    address = contact.peer_address or ""
        if not address:
            # Прямої дороги немає — спроба нічого не дасть, лічильник не псуємо.
            # Ретранслятор блоби не возить: він тунель для кадрів, не для файлів.
            continue

        data = read_bytes(row.blob_id)
        if data is None:
            # Байти зникли з диска — вигадувати доставку нема з чого.
            row.state = "missing"
            continue

        row.attempts += 1
        row.last_attempt_at = _now()
        if await push_blob(address, row.blob_id, data, from_node_id=own_node_id):
            row.state = "sent"
            delivered += 1

    await session.commit()
    return delivered
