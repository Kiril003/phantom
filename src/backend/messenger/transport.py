"""Хто фізично несе кадр до вузла співрозмовника.

Дороги за порядком чесності: пряма адреса (та сама мережа, власний домен,
тунель), ретранслятор PHANTOM (сирий тунель, ним їде звичайний HTTP),
Supabase-скринька (чужа хмара, якій ми довіряємо лише непрозорий конверт) —
і остання, сховок PH5: єдина дорога, розгорнута й увімкнена за
замовчуванням. Їй ми показуємо ще менше, ніж хмарі, — 43-символьну адресу,
яку вміють скласти лише двоє, і шифротекст сталої довжини.

Тут навмисно немає жодного «як правило, дійшло». Функція повертає True лише
коли вузол-адресат відповів 200; усе інше — False, і повідомлення лишається
в стані queued, а не отримує галочку.
"""
from __future__ import annotations

import base64
import json
import logging
import time
from typing import Any, Optional

import httpx
from cryptography.hazmat.primitives import serialization

from messenger.crypto.keys import PublicBundle
from node import peer_channel
from node import peer_relay as pr
from node.relay_courier import Held, Offline, RelayCourier

logger = logging.getLogger(__name__)

__all__ = [
    "deliver",
    "deliver_direct",
    "deliver_via_drop",
    "deliver_via_relay",
    "deliver_via_supabase",
    "drop_pair_key",
    "drop_pair_key_of",
    "drop_road",
    "inbox_url",
    "mailbox_url",
    "note_store_answered",
    "store_answered_last_time",
    "supabase_mailbox_endpoint",
    "supabase_road",
]

_TIMEOUT_S = 8.0
#: Стеля колонки frame у таблиці messenger_mailbox: конверт понад неї база
#: відкине, тож чесніше не нести його зовсім і сказати False одразу.
SUPABASE_LETTER_MAX = 131072


def inbox_url(peer_address: str) -> str:
    """Приймальня вузла за його адресою. Голий хост означає http на 8000."""
    raw = (peer_address or "").strip().rstrip("/")
    if not raw:
        raise ValueError("порожня адреса вузла")
    if not raw.startswith(("http://", "https://")):
        raw = f"http://{raw}"
    return f"{raw}/api/v1/messenger/inbox"


async def deliver_direct(
    peer_address: str,
    peer_node_id: str,
    frame: bytes,
    *,
    from_node_id: str,
    reply_address: str = "",
    client: Optional[httpx.AsyncClient] = None,
) -> bool:
    """Кладе кадр у приймальню вузла за прямою адресою.

    У листі їде НАШ node_id, а не адресатів: приймальня шукає сесію за тим,
    хто пише. Спершу тут летів peer_node_id — і вузол-адресат шукав контакт
    за власним ідентифікатором, не знаходив і відмовляв. Видно це стало лише
    на двох справді запущених вузлах.
    """
    url = inbox_url(peer_address)
    payload = {"frame": frame.hex(), "from_node_id": from_node_id}
    # Кажемо адресату, куди нести відповідь. Без цього перший лист — вулиця з
    # одностороннім рухом: людина отримає ключ, але відповісти не зможе.
    if reply_address:
        payload["reply_address"] = reply_address
    own = client is None
    http = client or httpx.AsyncClient(timeout=_TIMEOUT_S)
    try:
        response = await http.post(url, json=payload)
        if response.status_code == 200:
            return True
        logger.info("вузол %s відмовив: %s", peer_node_id, response.status_code)
        return False
    except Exception as exc:  # noqa: BLE001 — мережа падає як завгодно
        logger.info("до вузла %s не достукались: %s", peer_node_id, exc)
        return False
    finally:
        if own:
            await http.aclose()


def mailbox_url(relay: str, peer_node_id: str) -> str:
    """Скринька адресата на ретрансляторі."""
    raw = (relay or "").strip().rstrip("/")
    if not raw:
        raise ValueError("порожня адреса ретранслятора")
    if raw.startswith("wss://"):
        raw = "https://" + raw[len("wss://"):]
    elif raw.startswith("ws://"):
        raw = "http://" + raw[len("ws://"):]
    elif not raw.startswith(("http://", "https://")):
        raw = f"https://{raw}"
    return f"{raw}/relay/mailbox/{peer_node_id}"


async def deliver_via_relay(
    relay: str,
    peer_node_id: str,
    frame: bytes,
    *,
    from_node_id: str,
    reply_address: str = "",
    client: Optional[httpx.AsyncClient] = None,
) -> bool:
    """Кладе кадр у скриньку адресата на ретрансляторі.

    Тут «доставлено» означає «ретранслятор прийняв», а не «людина прочитала».
    Ретранслятор возить непрозорі байти й не має розуміти, що в них.
    """
    url = mailbox_url(relay, peer_node_id)
    payload = {"frame": frame.hex(), "from_node_id": from_node_id}
    if reply_address:
        payload["reply_address"] = reply_address
    own = client is None
    http = client or httpx.AsyncClient(timeout=_TIMEOUT_S)
    try:
        response = await http.post(url, json=payload)
        if response.status_code in (200, 202):
            return True
        logger.info("ретранслятор не взяв лист для %s: %s", peer_node_id, response.status_code)
        return False
    except Exception as exc:  # noqa: BLE001
        logger.info("до ретранслятора не достукались: %s", exc)
        return False
    finally:
        if own:
            await http.aclose()


def supabase_mailbox_endpoint(url: str) -> str:
    """Таблиця messenger_mailbox за адресою проєкту Supabase."""
    raw = (url or "").strip().rstrip("/")
    if not raw:
        raise ValueError("порожня адреса скриньки Supabase")
    if not raw.startswith(("http://", "https://")):
        raw = f"https://{raw}"
    return f"{raw}/rest/v1/messenger_mailbox"


def supabase_road(config: Any) -> tuple[str, str]:
    """Адреса і ключ четвертої дороги; («», «») — дороги немає."""
    url = (getattr(config, "supabase_mailbox_url", "") or "").strip()
    key = (getattr(config, "supabase_anon_key", "") or "").strip()
    if url and key:
        return url, key
    return "", ""


async def deliver_via_supabase(
    url: str,
    anon_key: str,
    peer_node_id: str,
    frame: bytes,
    *,
    from_node_id: str,
    reply_address: str = "",
    client: Optional[httpx.AsyncClient] = None,
) -> bool:
    """Кладе конверт у Supabase-скриньку адресата.

    У колонці frame їде той самий конверт, що й у скриньку ретранслятора:
    шифротекст кадру плюс імʼя відправника, без якого адресат не знайде
    сесію. Ключ publishable за задумом — RLS пускає його лише на insert,
    прочитати чужу скриньку ним не можна.
    """
    endpoint = supabase_mailbox_endpoint(url)
    envelope: dict[str, str] = {"frame": frame.hex(), "from_node_id": from_node_id}
    if reply_address:
        envelope["reply_address"] = reply_address
    letter = json.dumps(envelope, separators=(",", ":"))
    if len(letter) > SUPABASE_LETTER_MAX:
        logger.info(
            "лист для %s завеликий для скриньки Supabase: %d", peer_node_id, len(letter)
        )
        return False
    own = client is None
    http = client or httpx.AsyncClient(timeout=_TIMEOUT_S)
    try:
        response = await http.post(
            endpoint,
            json={"recipient_node_id": peer_node_id, "frame": letter},
            headers={
                "apikey": anon_key,
                "Authorization": f"Bearer {anon_key}",
                "Prefer": "return=minimal",
            },
        )
        if response.status_code in (200, 201, 204):
            return True
        logger.info(
            "скринька Supabase не взяла лист для %s: %s",
            peer_node_id,
            response.status_code,
        )
        return False
    except Exception as exc:  # noqa: BLE001
        logger.info("до скриньки Supabase не достукались: %s", exc)
        return False
    finally:
        if own:
            await http.aclose()


# ── Сховок PH5 ───────────────────────────────────────────────────────────────


def drop_road(config: Any) -> str:
    """Адреса сховка PH5; «» — дороги немає.

    Обидва поля конфігу мусять сказати «так»: вимкнений прапорець із
    заповненою адресою — це «не ходи», а не «спробуй про всяк випадок».
    """
    if not getattr(config, "relay_store_enabled", False):
        return ""
    return (getattr(config, "relay_store_url", "") or "").strip()


def _pair_key(keys: Any, their_dh: bytes, their_node_id: str) -> bytes:
    my_raw = keys.identity_dh_private.private_bytes(
        serialization.Encoding.Raw,
        serialization.PrivateFormat.Raw,
        serialization.NoEncryption(),
    )
    their_b64 = base64.b64encode(their_dh).decode("ascii")
    return peer_channel.channel_key(my_raw, their_b64, keys.node_id, their_node_id) or b""


def drop_pair_key(keys: Any, bundle_json: str) -> bytes:
    """Ключ пари для адрес сховка; b"" — ключа не скласти, дороги немає.

    Той самий рецепт, яким телефон рахує pairKey для PH5 (PeerChannel.kt,
    переписаний у `node/peer_channel.py`): ECDH довготривалих identity-X25519
    обох вузлів → HKDF із сіллю з упорядкованих імен. Кожен бік складає його
    з того, що вже має — свій приватний ключ і bundle співрозмовника, — не
    домовляючись. Тому адресат, рахуючи адреси СВОЇХ скриньок, назве саме ту,
    під яку ми поклали лист.

    Це навмисно НЕ ключ храповика: стан сесії їде вперед із кожним кадром, а
    адреса скриньки мусить стояти на місці, інакше сторони розійдуться мовчки.
    """
    try:
        bundle = PublicBundle.from_json(bundle_json or "")
        pair = _pair_key(keys, bundle.identity_dh, bundle.node_id)
    except Exception as exc:  # noqa: BLE001 — кривий bundle не має валити відправку
        # Гучно, а не мовчки: без цього ключа дороги просто «немає», і ніхто
        # не дізнався б, чому листи саме цього контакта не їдуть у сховок.
        logger.warning("ключ пари для сховка не склався: %s", exc)
        return b""
    return pair


def drop_pair_key_of(keys: Any, contact: Any) -> bytes:
    """Ключ пари для контакта: з bundle, а без нього — із сесії; b"" — немає.

    Контакт, заведений із ВХІДНОГО кадру, bundle не має (`inbox.accept_frame`
    пише порожній рядок), але сесія з ним тримає той самий довготривалий
    X25519 співрозмовника — а адресі сховка більше й не треба. Без цієї гілки
    людина, яка першою написала нам удома, лишалась би без дороги, щойно
    хтось із двох поїхав.
    """
    bundle_json = getattr(contact, "bundle_json", "") or ""
    if bundle_json:
        pair = drop_pair_key(keys, bundle_json)
        if pair:
            return pair
    blob = getattr(contact, "session_blob", None)
    if not blob:
        return b""
    try:
        from messenger.crypto.session import Session

        peer = Session.restore(keys, bytes.fromhex(blob))
        return _pair_key(keys, peer.peer_identity_dh, peer.peer_node_id)
    except Exception as exc:  # noqa: BLE001 — зіпсована сесія не має валити список
        logger.warning("ключ пари для сховка не склався із сесії: %s", exc)
        return b""


# ── Чи відповідав сховок ─────────────────────────────────────────────────────
#
# `road_ahead` мусить сказати «дороги немає» ДО того, як людина напише, а
# сховок — єдина дорога, якої не видно з конфігу: адреса вписана завжди, а чи
# відповідає сервер, знає лише той, хто в нього ходив. Тому кожен похід —
# покласти чи забрати — лишає тут один факт: відповів чи мовчав. Без факту
# (None) дорога вважається наявною: конфіг каже «є», спростувати ще не було чим.
_store_last: Optional[tuple[str, bool]] = None


def _store_id(store_url: str) -> str:
    return (store_url or "").strip().rstrip("/")


def note_store_answered(store_url: str, answered: bool) -> None:
    """Записати наслідок походу. Будь-яка відповідь сервера — «відповів»,
    навіть відмова: дорога є, просто лист не взяли; мовчання — «ні»."""
    global _store_last
    _store_last = (_store_id(store_url), answered)


def store_answered_last_time(store_url: str) -> Optional[bool]:
    """True/False — останній похід у ЦЕЙ сховок; None — ще не ходили."""
    if _store_last is None or _store_last[0] != _store_id(store_url):
        return None
    return _store_last[1]


async def deliver_via_drop(
    store_url: str,
    pair_key: bytes,
    peer_node_id: str,
    frame: bytes,
    *,
    from_node_id: str,
    reply_address: str = "",
    now_ms: Optional[int] = None,
    client: Optional[httpx.AsyncClient] = None,
) -> bool:
    """Кладе конверт у сховок PH5.

    Сховок бачить менше за всіх: 43-символьну адресу, яку вміють скласти лише
    двоє, і шифротекст сталої довжини. Ні імен вузлів, ні напрямку, ні
    справжнього розміру листа. Усередині конверта — той самий JSON, що їде в
    скриньку ретранслятора і в Supabase: адресат розбирає всі дороги одним
    кодом.

    True означає «сховок прийняв і назвав строк зберігання» (Held), а не
    «людина отримала»: по лист адресат прийде сам, за адресою, яку зможе
    скласти лише він.
    """
    relay_key = pr.relay_key(pair_key, from_node_id, peer_node_id)
    if relay_key is None:
        logger.info("ключ сховка для %s не вивівся", peer_node_id)
        return False
    epoch = pr.epoch_of(int(time.time() * 1000) if now_ms is None else now_ms)
    tag = pr.msg_tag(relay_key, from_node_id, peer_node_id, epoch)
    if tag is None:
        logger.info("адреса скриньки у сховку для %s не склалась", peer_node_id)
        return False
    envelope: dict[str, str] = {"frame": frame.hex(), "from_node_id": from_node_id}
    if reply_address:
        envelope["reply_address"] = reply_address
    wrapped = pr.wrap(json.dumps(envelope, separators=(",", ":")), relay_key, tag)
    if wrapped is None:
        # Не вліз навіть у найбільшу корзину — чесніше не нести зовсім, ніж
        # згодувати сховку конверт, який він однаково відкине.
        logger.info("лист для %s завеликий для сховка", peer_node_id)
        return False
    try:
        outcome = await RelayCourier(store_url, client=client).drop(tag, wrapped.blob)
    except Exception as exc:  # noqa: BLE001 — мережа падає як завгодно
        note_store_answered(store_url, False)
        logger.info("до сховка не достукались: %s", exc)
        return False
    # Мовчання і відмова — різні факти: після відмови дорога є, після тиші — ні.
    note_store_answered(store_url, not isinstance(outcome, Offline))
    if isinstance(outcome, Held):
        return True
    # Кожна відмова названа (Busy/Full/Refused/Offline) — і жодна не доставка.
    logger.info(
        "сховок не взяв лист для %s: %s", peer_node_id, outcome.__class__.__name__
    )
    return False


async def deliver(
    frame: bytes,
    *,
    peer_node_id: str,
    from_node_id: str,
    peer_address: str = "",
    relay: str = "",
    supabase_url: str = "",
    supabase_key: str = "",
    reply_address: str = "",
    drop_url: str = "",
    drop_key: bytes = b"",
) -> str:
    """Дороги по черзі: пряма, ретранслятор, Supabase-скринька, сховок PH5.

    ПОВЕРТАЄ ІМ'Я ДОРОГИ, а не `True`. Досі функція знала, яка з трьох гілок
    спрацювала, і викидала це знання — тож у вихідного листа поле `transport`
    лишалось порожнім назавжди, хоч у вхідного воно заповнюється (`direct`
    для прямої дороги, `mailbox` для скриньки). Виміряно на живій базі: 34
    рядки без транспорту проти двох із ним.
    Порожній рядок означає «не поїхало» і лишається хибним значенням, тож усі
    наявні `if await deliver(...)` працюють без правок.

    Пряма швидша й нікому не показує метаданих, тож пробуємо її першою. Але
    вона є рідко: більшість людей за NAT або в мобільній мережі, де прямої
    адреси просто немає. Тоді лист лягає в скриньку на ретрансляторі — він
    возить непрозорі байти і вмісту не бачить. Коли мовчить і ретранслятор,
    лишається чужа хмара — Supabase-скринька з тим самим непрозорим конвертом.

    Сховок PH5 — остання дорога, але в розгорнутій конфігурації ЄДИНА:
    `relay_url` порожній навмисно (WS-тунелю немає на сервері), Supabase
    порожній, тож без прямої адреси лист досі не мав жодної дороги і лягав у
    чергу назавжди. `drop_key` тут — ключ ПАРИ (див. `drop_pair_key`), а не
    ключ конверта: адресу скриньки і ключ конверта дорога виводить сама.
    """
    if peer_address:
        if await deliver_direct(
            peer_address, peer_node_id, frame,
            from_node_id=from_node_id, reply_address=reply_address,
        ):
            return "direct"
    if relay:
        if await deliver_via_relay(
            relay, peer_node_id, frame,
            from_node_id=from_node_id, reply_address=reply_address,
        ):
            return "relay"
    if supabase_url and supabase_key:
        parked = await deliver_via_supabase(
            supabase_url, supabase_key, peer_node_id, frame,
            from_node_id=from_node_id, reply_address=reply_address,
        )
        if parked:
            return "cloud"
        # Хмара мовчить — це ще не кінець: лишається сховок. Досі тут стояло
        # `return ""`, і будь-яка дорога після хмари була б недосяжною.
    if drop_url and drop_key:
        if await deliver_via_drop(
            drop_url, drop_key, peer_node_id, frame,
            from_node_id=from_node_id, reply_address=reply_address,
        ):
            return "drop"
    return ""
