"""Перевезення вкладень: дорогами їде тільки шифротекст.

Файл шифрується в браузері, а вузлу віддається вже запечатаним. Ключ до нього
їде в тілі повідомлення, і саме тіло вузол запечатує сесійним кадром до вузла
співрозмовника. Тому все, що між вузлами — ретранслятор, скринька, чужий
канал, — бачить лише непрозорі байти.

Власний вузол — довірений пристрій: він тримає ключі й проходить через тіло
повідомлення, як телефон проходить через ваші чати. Розшифрування самого
файла все одно робить браузер власника, а вузол зберігає шифротекст.

Тут немає жодного «майже доставлено». Блоб або підтверджений вузлом-адресатом
(state='sent'), або лежить у хмарі й чекає, поки адресат прокинеться і забере
його сам (state='parked'), або чесно лишається в черзі (state='queued'), коли
хмарної дороги немає взагалі.
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
from messenger.r2 import R2Road, object_key, park_object, r2_road

logger = logging.getLogger(__name__)

__all__ = [
    "BLOB_LIMIT_BYTES",
    "BlobRejected",
    "GROUP_TOKEN_LIMIT",
    "InboundBlobGuard",
    "MAX_BLOB_ATTEMPTS",
    "ORIGIN_LIMIT",
    "BLOB_KINDS",
    "SERVICE_KINDS",
    "SERVICE_TOKEN",
    "WIRE_KINDS",
    "blob_dir",
    "blob_path",
    "delete_bytes",
    "flush_blob_queue",
    "inbound_blob_guard",
    "new_blob_id",
    "park_blob",
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
# Кадр без префікса лишається текстом — старий формат розбирається сам собою.
#
# Крім типу конверт везе origin: client_id повідомлення на вузлі ВІДПРАВНИКА.
# Без нього наскрізне видалення неможливе в принципі: одержувач вигадує своє
# ім'я рядка (`in_…`), і сказати «зітри саме те» немає чим. Origin — єдина
# спільна назва одного повідомлення на двох вузлах, тому й їде поруч із типом.

_WIRE_MARK = "\x01phantom-kind:"

#: Довше за це origin не буває: колонка client_id тримає 64 символи разом
#: із префіксом `in_`, і обрізати ім'я вже після приїзду було б пізно.
ORIGIN_LIMIT = 60

#: `g={gid}:{gseq}` — 32 hex групи, двокрапка і лічильник. Довше не буває, а
#: обрізати цей токен уже після приїзду означало б відкрити кадр не тій групі.
GROUP_TOKEN_LIMIT = 48

#: Типи, які вузол уміє показати або виконати. Усе інше з дроту — текст.
#: 'radio' нічого не показує: це шматок голосу для живого дзвінка, і саме тому
#: він мусить бути тут — інакше приймальня визнала б його невідомим і поклала
#: б у стрічку як текст, тобто 8 КБ base64 замість розмови.
#:
#: 'group:invite' — запрошення до групи: склад і bundle кожного учасника. У
#: стрічку воно не лягає, як і 'delete', — воно ВИКОНУЄТЬСЯ. Решти групових
#: типів (member/leave/rename) тут навмисне немає: їх ще не написано, а
#: оголосити тип, який вузол не виконує, означало б обіцяти неіснуюче.
#:
#: 'geo:point' — разова точка {lat, lon, at, acc?, label?}. Їде наявними
#: дорогами і тією ж сесією, що й текст: 30 байтів пролазять там, де фото вже
#: неможливе. Решти гео-типів (share/tick/stop/meet/mark) тут поки немає — це
#: наступні хвилі контракту.
WIRE_KINDS = (
    "text", "image", "file", "delete", "radio", "group:invite", "geo:point",
    #: Позначка на чужому листі. Службовий кадр: рядка не додає, лише міняє
    #: наявний. Увімкнено 31.08.2026 разом з ознакою `s=1` у конверті — без неї
    #: стара збірка поклала б у стрічку рядок «не вмію показати», тобто сміття
    #: посеред розмови замість тихого ігнорування.
    "reaction",
)

#: Типи, тіло яких тримає `blob_id`, тобто байти на диску.
#:
#: Раніше цей перелік жив ДВІЧІ й дослівно — у `purge.blob_ids_of` і в запиті
#: `redelivery`, обидва рази як `("image", "file")`. Дві копії однієї угоди в
#: різних файлах розходяться при першій же зміні, і розходяться ТИХО: тип, що
#: випав із першої, лишає байти на диску назавжди; тип, що випав із другої,
#: ніколи не дошлеться після невдачі.
#:
#: `voice` тут З'ЯВИВСЯ НАПЕРЕД, до свого входження у `WIRE_KINDS`. Це
#: свідомо: поки голосових кадрів немає, рядок нічого не робить, а в день
#: увімкнення типу життєвий цикл блоба вже на місці. Зворотний порядок —
#: увімкнути тип і згадати про прибирання потім — і дав би обидві тихі
#: поломки одночасно.
BLOB_KINDS = ("image", "file", "voice")

#: Кадри, які НЕ стають рядком у стрічці: вони щось роблять із наявним листом.
#:
#: Такий кадр несе в конверті ознаку `s=1`, і саме вона рятує майбутні збірки.
#: Без неї приймач, побачивши незнайомий тип, кладе в стрічку рядок «ця версія
#: не вміє показати» — для реакції чи іншої службової дії це **сміття посеред
#: розмови**, гірше за відсутність можливості. З ознакою невідомий службовий
#: кадр відкидається ТИХО, як і має бути.
#:
#: Ознака виводиться з ТИПУ, а не передається параметром: параметр викликач
#: забуде, і кадр поїде без неї — а помітно це стане лише на чужій збірці.
#:
#: Чого ознака НЕ рятує: збірку, яка про саму ознаку ще не знає. Вона
#: побачить незнайомий тип і видасть той самий рядок. Тобто це захист для
#: ВСІХ МАЙБУТНІХ збірок, а не для наявних; наявна на світі одна, і саме тому
#: зараз єдиний момент, коли ця зміна конверта коштує нуль.
SERVICE_KINDS = ("delete", "reaction")

#: Токен ознаки службового кадру в конверті. Саме в конверті, а не в тілі:
#: тіло читають ПІСЛЯ розбору типу, тобто запізно — рішення «мовчки відкинути»
#: треба ухвалити раніше, ніж ми зрозуміли, що типу не знаємо.
SERVICE_TOKEN = "s=1"


def wrap_frame(kind: str, body: str, origin_id: str = "", group: str = "") -> str:
    """Готує відкритий текст кадру: тип, origin, група і тіло.

    Текст без origin і без групи їде голим рядком — рівно як їхав, доки
    конверта не було.

    Третій токен `g={gid}:{gseq}` і є вся різниця між груповим кадром і
    особистим: тип, сесія й дорога однакові, тож text/image/file/delete
    працюють у групі без окремих типів на кожен.
    """
    # Відмовляємось явно, а не покладаємось на дисципліну викликача. Досі
    # `wrap_frame` брав що завгодно: тип, якого немає в переліку, спокійно
    # виїжджав на дріт і на тому кінці ставав сміттям. Тепер невідповідність
    # видно тут — у відправника, під час розробки, — а не в чужій стрічці.
    if kind not in WIRE_KINDS:
        raise ValueError(
            f"тип кадру «{kind}» не з переліку WIRE_KINDS — на тому кінці його "
            "не покажуть. Додати тип можна лише разом із обома боками: "
            "див. правило в unwrap_frame."
        )
    origin = (origin_id or "").strip()[:ORIGIN_LIMIT]
    token = (group or "").strip()[:GROUP_TOKEN_LIMIT]
    if kind == "text" and not origin and not token:
        return body
    head = kind
    if origin:
        head += f" {origin}"
    if token:
        head += f" g={token}"
    if kind in SERVICE_KINDS:
        head += f" {SERVICE_TOKEN}"
    return f"{_WIRE_MARK}{head}\n{body}"


def unwrap_frame(plaintext: str) -> tuple[str, str, str, str]:
    """Розбирає кадр у (kind, body, origin, group). Без префікса — це текст.

    Групу впізнаємо за префіксом `g=`, а не за місцем у рядку: старий кадр має
    два токени і розбирається рівно як раніше, тож сумісність на дроті не
    ламається навіть із вузлом, який про групи ще не знає.
    """
    if not plaintext.startswith(_WIRE_MARK):
        return "text", plaintext, "", ""
    head, _, body = plaintext.partition("\n")
    tokens = head[len(_WIRE_MARK):].strip().split()
    kind = tokens[0] if tokens else ""
    origin = ""
    group = ""
    service = False
    for token in tokens[1:]:
        if token.startswith("g="):
            group = token[2:]
        elif token == SERVICE_TOKEN:
            service = True
        elif not origin:
            origin = token
    # Тип приїхав ззовні і ця версія його не знає.
    #
    # Було: `return "text", plaintext, "", ""` — тобто співрозмовникові на
    # екран лягав СИРИЙ КАДР, у кращому разі JSON. Для людини це не «клієнт
    # не вміє показати», а «повідомлення зламане»: у першому випадку вона
    # оновлюється, у другому вирішує, що зламався продукт.
    #
    # І це не косметика, а ПЕРЕДУМОВА розширення протоколу. У день, коли ми
    # додамо новий тип у WIRE_KINDS, кожен, хто лишився на старій збірці,
    # побачить сміття — і виглядатиме це нашою поломкою, а не його старою
    # версією. ПРАВИЛО: перш ніж додавати тип у WIRE_KINDS, обидва боки
    # мусять уміти чесно сказати «не вмію показати». Телефонну половину
    # ставить Чат 3 окремо.
    #
    # Тіло тут свідомо НЕ зберігається: місця, куди його покласти так, щоб
    # новіша версія потім прочитала, у кадрі немає. З'явиться поле версії —
    # з'явиться і збереження; доти чесніше втратити вміст, ніж показати його
    # як зламаний текст.
    if kind not in WIRE_KINDS and service:
        # Службовий кадр невідомого типу. Він не мав ставати рядком навіть
        # тоді, коли ми його розуміємо, — тож і незрозумілий не має лишати
        # НІЧОГО: ні тексту, ні порожньої бульбашки, ні місця під неї.
        # Порожній тип — умовний знак «мовчки відкинь» для `accept_frame`.
        return "", "", "", ""
    if kind not in WIRE_KINDS:
        safe = "".join(ch for ch in kind if ch.isalnum() or ch in "-_:")[:32]
        return (
            "text",
            f"Повідомлення типу «{safe or 'невідомий'}» — ця версія не вміє його "
            "показати. Оновіть застосунок, щоб побачити вміст.",
            "",
            "",
        )
    return kind, body, origin[:ORIGIN_LIMIT], group[:GROUP_TOKEN_LIMIT]


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


async def park_blob(
    blob_id: str,
    data: bytes,
    peer_node_id: str,
    *,
    road: Optional[R2Road] = None,
    client: Optional[httpx.AsyncClient] = None,
) -> bool:
    """Кладе шифротекст у хмару під імʼям `<node_id адресата>/<blob_id>`.

    Дорога для тих випадків, де прямої немає взагалі: вимкнений телефон, NAT,
    мобільна мережа. Хмарі дістаються самі байти — ключ до них їде окремо, у
    тілі повідомлення. Немає креденшелів — немає й дороги, і це чесне False.
    """
    if road is None:
        from config import config

        road = r2_road(config)
    if road is None or not peer_node_id:
        return False
    try:
        key = object_key(peer_node_id, blob_id)
    except ValueError as exc:
        logger.info("хмарне імʼя для вкладення не склалось: %s", exc)
        return False
    return await park_object(road, key, data, client=client)


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

    Дороги за порядком: пряма адреса, а коли вона мовчить або її немає —
    хмара. Повернене число рахує лише те, що взяв ВУЗОЛ адресата: блоб, який
    ліг у хмару, ще не в людини, і додавати його сюди означало б повторити ту
    саму брехню, заради якої цю дорогу й будували.
    """
    from config import config

    road = r2_road(config)
    rows = (
        await session.execute(
            select(MessengerBlob)
            .where(
                MessengerBlob.direction == "out",
                # Припарковане теж повертається сюди: якщо в адресата немає
                # креденшелів, він ніколи не забере блоб із хмари, і пряма
                # дорога лишається єдиною, що може його довезти.
                MessengerBlob.state.in_(("queued", "parked")),
                MessengerBlob.attempts < MAX_BLOB_ATTEMPTS,
            )
            .order_by(MessengerBlob.created_at)
            .limit(limit)
        )
    ).scalars().all()

    delivered = 0
    parked = 0
    for row in rows:
        address = ""
        if row.conversation_id:
            conversation = await session.get(MessengerConversation, row.conversation_id)
            if conversation is not None and conversation.contact_id:
                contact = await session.get(MessengerContact, conversation.contact_id)
                if contact is not None:
                    address = contact.peer_address or ""
        in_cloud = row.state == "parked"
        if not address and (road is None or in_cloud):
            # Робити нічого: або дороги немає взагалі, або блоб уже в хмарі й
            # класти його туди вдруге означало б платити за те саме двічі.
            # Ретранслятор блоби не возить — він тунель для кадрів.
            continue

        data = read_bytes(row.blob_id)
        if data is None:
            # Байти зникли з диска. Для припаркованого це нічого не міняє —
            # його копія лежить у хмарі й на адресата чекає саме вона.
            if not in_cloud:
                row.state = "missing"
            continue

        row.attempts += 1
        row.last_attempt_at = _now()
        if address and await push_blob(
            address, row.blob_id, data, from_node_id=own_node_id
        ):
            row.state = "sent"
            delivered += 1
            continue
        if not in_cloud and road is not None and row.peer_node_id and await park_blob(
            row.blob_id, data, row.peer_node_id, road=road
        ):
            # Байти чекають в хмарі: адресат забере їх сам, і для цього наш
            # вузол уже не потрібен — можна вимикати телефон.
            row.state = "parked"
            parked += 1

    await session.commit()
    if parked:
        logger.info("вкладень лягло в хмару: %d", parked)
    return delivered
