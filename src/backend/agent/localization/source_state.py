"""Хто саме відповів на це питання — і чи він свій.

Навіщо. Мапу продають як офлайнову, а «Поруч», пошук адреси й маршрут за
замовчуванням ходили на три ЧУЖІ публічні сервіси, зашиті літералами в
адаптерах. Виміряно 03.09.2026 на машині власника: його локальний
Nominatim живий (127.0.0.1:8088 віддає справжні українські результати), а
жоден адаптер до нього не ходить; локального Overpass немає взагалі.

Статус (`ok`/`unreachable`/`disabled`) каже, чи джерело відповіло. Це поле
каже, ХТО відповів — бо «порожньо в околиці» від власного вузла і те саме
від чужого демо-сервера означають для людини різні речі, і різні дії.

Свій/чужий визначаємо за адресою, а не за прапорцем: прапорець можна
забути перемкнути, а адреса — це те, куди запит справді піде.
"""
from __future__ import annotations

import ipaddress
from typing import Any
from urllib.parse import urlparse


def _is_local(host: str) -> bool:
    """Локальний = петля або приватна мережа. LAN сюди входить навмисно:
    Nominatim на 192.168.x.x у тій самій кімнаті — це стек власника, а не
    третя сторона, і казати про нього «публічний» було б неправдою."""
    if not host:
        return False
    if host in ("localhost", "phantom.local") or host.endswith(".local"):
        return True
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return False
    return addr.is_loopback or addr.is_private


def describe_source(url: str, public_name: str, local_name: str) -> dict[str, Any]:
    """{name, local, base} для поля `*_source` у відповідях мапи.

    `base` — хост із портом і без шляху: показувати шлях означало б світити
    у скло ключі, якщо вони колись зʼявляться в запиті.
    """
    parsed = urlparse(url or "")
    host = parsed.hostname or ""
    local = _is_local(host)
    base = parsed.netloc or url or ""
    return {
        "name": local_name if local else public_name,
        "local": local,
        "base": base,
    }
