"""Хто фізично несе кадр до вузла співрозмовника.

Дороги за порядком чесності: пряма адреса (та сама мережа, власний домен,
тунель), ретранслятор PHANTOM (сирий тунель, ним їде звичайний HTTP), і
остання — Supabase-скринька: чужа хмара, якій ми довіряємо лише непрозорий
конверт, коли перші дві дороги мовчать.

Тут навмисно немає жодного «як правило, дійшло». Функція повертає True лише
коли вузол-адресат відповів 200; усе інше — False, і повідомлення лишається
в стані queued, а не отримує галочку.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

__all__ = [
    "deliver",
    "deliver_direct",
    "deliver_via_relay",
    "deliver_via_supabase",
    "inbox_url",
    "mailbox_url",
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
) -> str:
    """Дороги по черзі: пряма, ретранслятор, Supabase-скринька.

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
        return "cloud" if parked else ""
    return ""
