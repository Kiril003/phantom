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

__all__ = ["deliver_direct", "inbox_url"]

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
