"""Хто фізично несе кадр до вузла співрозмовника.

Два шляхи, і обидва не потребують чужої хмари. Перший — пряма адреса: та сама
мережа, власний домен, тунель. Другий — ретранслятор PHANTOM, коли прямої
дороги немає (він сирий тунель, тож ним їде звичайний HTTP).

Тут навмисно немає жодного «як правило, дійшло». Функція повертає True лише
коли вузол-адресат відповів 200; усе інше — False, і повідомлення лишається
в стані queued, а не отримує галочку.
"""
from __future__ import annotations

import logging
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

__all__ = ["deliver", "deliver_direct", "deliver_via_relay", "inbox_url", "mailbox_url"]

_TIMEOUT_S = 8.0


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


async def deliver(
    frame: bytes,
    *,
    peer_node_id: str,
    from_node_id: str,
    peer_address: str = "",
    relay: str = "",
    reply_address: str = "",
) -> bool:
    """Одна дорога на вибір: спершу пряма, потім ретранслятор.

    Пряма швидша й нікому не показує метаданих, тож пробуємо її першою. Але
    вона є рідко: більшість людей за NAT або в мобільній мережі, де прямої
    адреси просто немає. Тоді лист лягає в скриньку на ретрансляторі — він
    возить непрозорі байти і вмісту не бачить.
    """
    if peer_address:
        if await deliver_direct(
            peer_address, peer_node_id, frame,
            from_node_id=from_node_id, reply_address=reply_address,
        ):
            return True
    if relay:
        return await deliver_via_relay(
            relay, peer_node_id, frame,
            from_node_id=from_node_id, reply_address=reply_address,
        )
    return False
