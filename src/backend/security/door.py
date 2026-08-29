"""Одноразовий квиток на вхід — щоб скрипт запуску відчиняв браузер залогіненим.

Квиток живе 3 хвилини, згорає з першого пред'явлення, у пам'яті лежить лише
його SHA-256. Просити квиток може той, хто прочитав ключ дверей із файла 0600
у теці вузла — тобто той самий користувач ОС, що й так володіє базою. Без
`PHANTOM_DOOR_KEY_FILE` маршрутів дверей не існує.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import secrets
import time
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

TICKET_TTL_S = 180
_KEY_ENV = "PHANTOM_DOOR_KEY_FILE"

_tickets: dict[str, float] = {}
_door_key: Optional[str] = None


def _digest(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _purge() -> None:
    now = time.monotonic()
    for key in [k for k, dies in _tickets.items() if dies <= now]:
        del _tickets[key]


def issue_ticket(ttl_s: int = TICKET_TTL_S) -> str:
    _purge()
    raw = secrets.token_urlsafe(32)
    _tickets[_digest(raw)] = time.monotonic() + ttl_s
    return raw


def redeem_ticket(raw: str) -> bool:
    """Один раз True, далі завжди False."""
    _purge()
    if not raw:
        return False
    wanted = _digest(raw)
    matched: Optional[str] = None
    for stored in _tickets:
        # compare_digest на кожному записі: словниковий пошук зупиняється рано.
        if hmac.compare_digest(stored, wanted):
            matched = stored
    if matched is None:
        return False
    del _tickets[matched]
    return True


def forget_all() -> None:
    _tickets.clear()


def key_file() -> Optional[Path]:
    raw = os.environ.get(_KEY_ENV, "").strip()
    return Path(raw).expanduser() if raw else None


def enabled() -> bool:
    return key_file() is not None


def install_key() -> Optional[Path]:
    """Свіжий ключ дверей у файл 0600. Перезапуск вузла робить старий недійсним."""
    global _door_key
    path = key_file()
    if path is None:
        return None
    key = secrets.token_urlsafe(32)
    try:
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        # Права на створенні, не після: інакше є вікно, коли ключ читає будь-хто.
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        try:
            os.write(fd, key.encode("utf-8"))
        finally:
            os.close(fd)
        os.chmod(path, 0o600)
    except OSError as exc:
        logger.warning("двері: ключ не записався у %s — %s", path, exc)
        return None
    _door_key = key
    logger.info("двері: ключ покладено у %s", path)
    return path


def key_matches(presented: Optional[str]) -> bool:
    if not _door_key or not presented:
        return False
    return hmac.compare_digest(_door_key, presented)
