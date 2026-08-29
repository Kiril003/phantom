"""Сховок PH5 з боку ПК — та сама мова, якою говорить телефон.

ДЖЕРЕЛО ПРАВДИ — НЕ ЦЕЙ ФАЙЛ. Кожна константа й кожен порядок склеювання тут
переписані з `phantom-companion/core-net/.../peer/PeerRelay.kt`. Якщо колись
розійдуться — правий телефон, бо він уже в руках у людей. Розходження тут не
дає помилки: обидва боки просто рахують РІЗНІ адреси скриньок, обидва чесно
кладуть і чесно забирають, і обидва бачать порожньо. Тому кожна величина нижче
має посилання на рядок оригіналу, а тести ганяють зафіксовані вектори.

Сервер (platform-site/server/relay.py) бачить лише три речі: рядок-адресу,
шматок шифротексту сталої довжини і час. Ні ключів, ні імен, ні напрямку.

Що НЕ робить цей модуль: не ходить у мережу. Дорога — у `relay_courier.py`,
щоб протокол можна було перевіряти без сервера, а сервер міняти без протоколу.
"""
from __future__ import annotations

import base64
import hmac
import os
import random
import re
from dataclasses import dataclass
from hashlib import sha256
from typing import Iterable, Optional

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

# ── Константи контракту ──────────────────────────────────────────────────────
# Кожна — з PeerRelay.kt. Номери рядків станом на b417f416.

#: Розділювач полів. У Kotlin це літерал '' (PeerRelay.kt:67).
#: Узятий саме недрукований, щоб ім'я вузла не могло підробити межу поля.
SEP = "\x1f"

#: Додаткові дані GCM (PeerRelay.kt:68). Кадр, перекладений в іншу скриньку,
#: не відчиниться — адреса входить у автентифікацію, а не лише в маршрут.
AAD_PREFIX = "PH5"

MBOX = "mbox"  # PeerRelay.kt:69 — скринька для листа
ACK = "ack"  # PeerRelay.kt:70 — скринька для квитанції

#: PeerRelay.kt:74. Байт-у-байт, включно з пробілом і скісною.
INFO = b"PHANTOM OS/peer-relay-v1"

TAG_CHARS = 43  # PeerRelay.kt:44 — base64url без набивки від 32 байтів HMAC
FETCH_TAGS = 64  # PeerRelay.kt:47 — незмінна ширина вибірки
EPOCH_MS = 86_400_000  # PeerRelay.kt:39 — доба
LENGTH_PREFIX = 4  # PeerRelay.kt:72

#: Розміри ВІДКРИТОГО тексту перед шифруванням (PeerRelay.kt:59).
BUCKETS = (4_096, 16_384, 69_632)

IV_SIZE_BYTES = 12  # AesGcm.kt:33
GCM_TAG_BYTES = 16  # AesGcm.kt:36 — 128 біт
KEY_SIZE_BYTES = 32  # AesGcm.kt:30

#: Скільки важить конверт НА ДРОТІ. Виводиться арифметикою, а не переписується
#: руками: на сервері рівно ця помилка колись і сталася — середню корзину
#: набрали вручну й помилились на одну мітку.
OVERHEAD = IV_SIZE_BYTES + GCM_TAG_BYTES
BLOB_SIZES = tuple(b + OVERHEAD for b in BUCKETS)

_TAG_SHAPE = re.compile(rf"^[A-Za-z0-9_-]{{{TAG_CHARS}}}$")


class Kind:
    """Що саме лежить у скриньці — лист чи квитанція про нього."""

    LETTER = "LETTER"
    RECEIPT = "RECEIPT"


@dataclass(frozen=True)
class Mailbox:
    """Скринька однієї пари: з ким і під яким ключем."""

    peer_id: str
    relay_key: bytes


@dataclass(frozen=True)
class Slot:
    peer_id: str
    kind: str
    epoch: int


@dataclass(frozen=True)
class Plan:
    """Що спитати цим заходом і як прочитати відповідь."""

    tags: list[str]
    slots: dict[str, Slot]


@dataclass(frozen=True)
class Wrapped:
    blob: bytes
    nonce_b64: str


# ── Адреси ───────────────────────────────────────────────────────────────────


def epoch_of(now_ms: int) -> int:
    """Доба. Kotlin рахує Math.floorDiv; `//` у Python теж підлогова, і для
    від'ємних значень (час до 1970) вони збігаються — на відміну від int(a/b).
    """
    return now_ms // EPOCH_MS


def relay_key(pair_key: bytes, my_id: str, their_id: str) -> Optional[bytes]:
    """Ключ сховка — окремий від ключа пари, хоч і виводиться з нього.

    Сенс розділення (PeerRelay.kt:96): під цим ключем складаються адреси, які
    БАЧИТЬ чужий сервер. Ключ, яким ще й шифрують зміст, не має підписувати те,
    що видно збоку.

    Сіль симетрична — обидві сторони мусять дістати той самий ключ, не
    домовляючись, хто з них «перший». Порядок рядків у Kotlin — це
    String.compareTo, тобто по одиницях UTF-16; у Python — по кодових точках.
    Для ідентифікаторів з ASCII (а вузли саме такі) це те саме впорядкування.
    """
    if not pair_key or not my_id.strip() or not their_id.strip():
        return None
    if SEP in my_id or SEP in their_id:
        return None
    low, high = (my_id, their_id) if my_id <= their_id else (their_id, my_id)
    return HKDF(
        algorithm=hashes.SHA256(),
        length=KEY_SIZE_BYTES,
        salt=f"{low}{SEP}{high}".encode("utf-8"),
        info=INFO,
    ).derive(pair_key)


def _tag(key: bytes, verb: str, sender_id: str, recipient_id: str, epoch: int) -> Optional[str]:
    if not key or not sender_id.strip() or not recipient_id.strip():
        return None
    if SEP in sender_id or SEP in recipient_id:
        return None
    canonical = f"{verb}{SEP}{sender_id}{SEP}{recipient_id}{SEP}{epoch}"
    mac = hmac.new(key, canonical.encode("utf-8"), sha256).digest()
    return _b64url(mac)


def msg_tag(key: bytes, sender_id: str, recipient_id: str, epoch: int) -> Optional[str]:
    """Скринька, куди `sender_id` кладе слово для `recipient_id` у цю добу."""
    return _tag(key, MBOX, sender_id, recipient_id, epoch)


def ack_tag(key: bytes, sender_id: str, recipient_id: str, epoch: int) -> Optional[str]:
    """Скринька для квитанції.

    Порядок сторін ТОЙ САМИЙ, що в `msg_tag`, — квитанцію кладе адресат, а
    забирає автор, і обидва мусять назвати ту саму адресу, не домовляючись про
    напрямок. Переставиш аргументи — обидва будуть «праві» й обидва глухі.
    """
    return _tag(key, ACK, sender_id, recipient_id, epoch)


def is_tag(text: str) -> bool:
    return bool(_TAG_SHAPE.match(text or ""))


def decoy_tags(count: int) -> list[str]:
    """Вигадані адреси. Від справжніх не відрізняються нічим — те саме джерело
    випадковості, та сама довжина, — тож «у цього вузла мало друзів» з запиту
    не читається.
    """
    if count <= 0:
        return []
    return [_b64url(os.urandom(32)) for _ in range(count)]


# ── Конверт ──────────────────────────────────────────────────────────────────


def _aad(tag: str) -> bytes:
    return f"{AAD_PREFIX}{SEP}{tag}".encode("utf-8")


def wrap(payload: str, key: bytes, tag: str, nonce: Optional[bytes] = None) -> Optional[Wrapped]:
    """Кадр у вигляді, який сховок тримає.

    Добивка до однієї з трьох корзин — не оптимізація, а весь сенс: лист
    розчиняється в гурті листів такої самої довжини. Довжина справжнього
    тексту їде всередині шифротексту, а не назовні.
    """
    if not is_tag(tag):
        return None
    if len(key) != KEY_SIZE_BYTES:
        return None
    body = payload.encode("utf-8")
    bucket = next((b for b in BUCKETS if b >= LENGTH_PREFIX + len(body)), None)
    if bucket is None:
        return None  # Не вміщається навіть у найбільшу — не наша дорога.
    plain = bytearray(bucket)
    plain[0:LENGTH_PREFIX] = len(body).to_bytes(LENGTH_PREFIX, "big")
    plain[LENGTH_PREFIX:LENGTH_PREFIX + len(body)] = body
    iv = nonce if nonce is not None else os.urandom(IV_SIZE_BYTES)
    if len(iv) != IV_SIZE_BYTES:
        return None
    ct = AESGCM(key).encrypt(iv, bytes(plain), _aad(tag))
    return Wrapped(blob=iv + ct, nonce_b64=_b64(iv))


def unwrap(blob: bytes, key: bytes, tag: str) -> Optional[str]:
    """Зворотний бік. Будь-яка невідповідність — None, а не виняток: конверт
    приходить з мережі, і чужий сміттєвий байт не має валити захід за листами.
    """
    if not is_tag(tag) or len(blob) not in BLOB_SIZES or len(key) != KEY_SIZE_BYTES:
        return None
    iv, ct = blob[:IV_SIZE_BYTES], blob[IV_SIZE_BYTES:]
    try:
        plain = AESGCM(key).decrypt(iv, ct, _aad(tag))
    except Exception:
        return None  # Не наш конверт або підмінений — це нормальний стан.
    if len(plain) < LENGTH_PREFIX:
        return None
    length = int.from_bytes(plain[:LENGTH_PREFIX], "big")
    if length < 0 or length > len(plain) - LENGTH_PREFIX:
        return None
    try:
        return plain[LENGTH_PREFIX:LENGTH_PREFIX + length].decode("utf-8")
    except UnicodeDecodeError:
        return None


def nonce_of(blob: bytes) -> Optional[str]:
    """Nonce тієї копії, яку сховок віддав — квитанція прив'язується до неї."""
    if len(blob) not in BLOB_SIZES:
        return None
    return _b64(blob[:IV_SIZE_BYTES])


# ── Захід за листами ─────────────────────────────────────────────────────────


def plan(
    my_id: str,
    mailboxes: Iterable[Mailbox],
    now_ms: int,
    round_: int = 0,
    rng: Optional[random.Random] = None,
) -> Plan:
    """Що спитати цим заходом.

    Три доби — сьогодні, завтра, вчора — бо годинники розходяться, і лист,
    покладений о 23:59 їхнього часу, інакше загубився б до ранку.

    Коли скриньок більше, ніж `FETCH_TAGS` імен, вікно їде далі з кожним
    `round_`: жодна скринька не голодує, але лист від найдальшого в черзі може
    почекати ще один захід. Зменшити число імен було б дешевше — і саме воно
    тримає анонімність, тож зменшувати його не можна.
    """
    boxes = list(mailboxes)
    today = epoch_of(now_ms)
    all_slots: dict[str, Slot] = {}
    for epoch in (today, today + 1, today - 1):
        for box in boxes:
            # Лист МЕНІ: клав його сусід, тому sender=сусід, recipient=я.
            letter = msg_tag(box.relay_key, box.peer_id, my_id, epoch)
            if letter is not None:
                all_slots.setdefault(letter, Slot(box.peer_id, Kind.LETTER, epoch))
            # Квитанція МЕНІ: її кладе адресат, але порядок сторін той самий,
            # що був у листі — sender=я, recipient=сусід.
            receipt = ack_tag(box.relay_key, my_id, box.peer_id, epoch)
            if receipt is not None:
                all_slots.setdefault(receipt, Slot(box.peer_id, Kind.RECEIPT, epoch))

    ordered = list(all_slots.keys())
    if len(ordered) <= FETCH_TAGS:
        real = ordered
    else:
        start = (round_ * FETCH_TAGS) % len(ordered)
        real = [ordered[(start + i) % len(ordered)] for i in range(FETCH_TAGS)]

    tags = real + decoy_tags(FETCH_TAGS - len(real))
    # Справжні імена не мають стояти першими: порядок у запиті — теж підпис.
    (rng or random.SystemRandom()).shuffle(tags)
    return Plan(tags=tags, slots={t: all_slots[t] for t in real})


# ── Дрібниці кодування ───────────────────────────────────────────────────────


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii").rstrip("=")


__all__ = [
    "BLOB_SIZES",
    "BUCKETS",
    "FETCH_TAGS",
    "TAG_CHARS",
    "Kind",
    "Mailbox",
    "Plan",
    "Slot",
    "Wrapped",
    "ack_tag",
    "decoy_tags",
    "epoch_of",
    "is_tag",
    "msg_tag",
    "nonce_of",
    "plan",
    "relay_key",
    "unwrap",
    "wrap",
]
