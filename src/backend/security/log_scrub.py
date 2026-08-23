"""Другий рубіж: секрет не має права опинитися в лозі відкритим текстом.

Перший рубіж — не класти токен у те, що логується (див. `security/ws_auth.py`:
токен їде під-протоколом, а не в query string). Але перший рубіж — це
дисципліна коду, а дисципліна ламається: досить одного `?token=` у новому
клієнті або одного `logger.debug("headers=%s", headers)`, і повний JWT знову
лягає на диск. Тому фільтр стоїть НИЖЧЕ за всі виклики логування й затирає
секрети в самому `LogRecord`.

Куди його чіпляють: на логери uvicorn (у них `propagate=False` і власний
хендлер, тож кореневий фільтр їх не бачить) і на хендлери кореня (через них
проходить усе, що спливло від застосунку). Фільтр мутує запис і завжди
повертає True — він нічого не ковтає, лише маскує.
"""
from __future__ import annotations

import logging
import re
from typing import Any

MASK = "***"

#: Дешевий попередній фільтр. Регулярки нижче коштують помітно дорожче за
#: пошук підрядка, а sqlalchemy-echo сипле тисячами рядків на хвилину —
#: тож спершу питаємо «чи взагалі є на що дивитися».
_TRIGGER = re.compile(r"token|key|secret|passw|bearer|authoriz|eyJ", re.IGNORECASE)

_RULES: tuple[tuple[re.Pattern[str], str], ...] = (
    # `?token=…`, `&access_token=…`, `refresh_token=…` — головний винуватець:
    # uvicorn пише повний шлях запиту разом із query string.
    (
        re.compile(
            r"((?:access[_-]?|refresh[_-]?|id[_-]?|auth[_-]?|device[_-]?)?token"
            r"(?:%3D|=))[^\s&\"'<>#,)\]]+",
            re.IGNORECASE,
        ),
        r"\1" + MASK,
    ),
    # apikey= / api_key= / api-key= / secret= / password= — той самий клас.
    (
        re.compile(
            r"((?:api[_-]?key|apikey|client[_-]?secret|secret|password|passwd|pwd)"
            r"(?:%3D|=))[^\s&\"'<>#,)\]]+",
            re.IGNORECASE,
        ),
        r"\1" + MASK,
    ),
    # `Authorization: Bearer …` і `authorization=Bearer …` у дампах заголовків.
    (
        re.compile(
            r"(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s\"'<>,)\]]+",
            re.IGNORECASE,
        ),
        r"\1" + MASK,
    ),
    # Голий `Bearer <jwt>` без назви заголовка.
    (re.compile(r"\bbearer\s+[A-Za-z0-9._~+/=-]{8,}", re.IGNORECASE), "Bearer " + MASK),
    # Останній невід: будь-що у формі JWT, у якому б полі воно не спливло.
    # Саме ця гілка ловить рядки, де токен пишуть без жодного префікса.
    (
        re.compile(r"\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}"),
        MASK,
    ),
)


def scrub(text: str) -> str:
    """Замінює секрети в рядку на `***`. Ідемпотентна."""
    if not _TRIGGER.search(text):
        return text
    for pattern, repl in _RULES:
        text = pattern.sub(repl, text)
    return text


def _scrub_value(value: Any) -> Any:
    if isinstance(value, str):
        return scrub(value)
    if isinstance(value, (bytes, bytearray)):
        try:
            decoded = value.decode("utf-8", "replace")
        except Exception:  # pragma: no cover — decode('replace') не кидає
            return value
        cleaned = scrub(decoded)
        return value if cleaned == decoded else cleaned.encode("utf-8")
    return value


class SecretScrubFilter(logging.Filter):
    """Затирає токени/ключі в `record.msg` і `record.args`.

    Працює по аргументах, а не по вже зібраному рядку, бо `uvicorn.access`
    логує шаблоном `'%s - "%s %s HTTP/%s" %d'`, і шлях із query string
    приїжджає саме аргументом.
    """

    def filter(self, record: logging.LogRecord) -> bool:  # type: ignore[override]
        if isinstance(record.msg, str):
            record.msg = scrub(record.msg)
        args = record.args
        if isinstance(args, tuple):
            cleaned = tuple(_scrub_value(a) for a in args)
            if cleaned != args:
                record.args = cleaned
        elif isinstance(args, dict):
            record.args = {k: _scrub_value(v) for k, v in args.items()}
        # Готовий текст винятку теж може містити URL із токеном.
        if record.exc_text:
            record.exc_text = scrub(record.exc_text)
        return True


#: Логери, у яких власний хендлер і `propagate=False` — кореневий хендлер
#: їхніх записів не бачить, тож фільтр треба вішати адресно.
_STANDALONE_LOGGERS = (
    "uvicorn",
    "uvicorn.access",
    "uvicorn.error",
    "uvicorn.asgi",
    "hypercorn.access",
    "hypercorn.error",
    "gunicorn.access",
    "gunicorn.error",
)


def _has_filter(target: Any) -> bool:
    return any(isinstance(f, SecretScrubFilter) for f in getattr(target, "filters", ()))


def install_log_scrubber() -> None:
    """Чіпляє фільтр скрізь, куди може дійти секрет. Ідемпотентна.

    Викликати варто двічі: одразу після `basicConfig` (щоб накрити старт) і
    ще раз під час складання застосунку — uvicorn перебудовує своє логування
    з `dictConfig`, і хоч фільтри логерів воно не чистить, хендлери — чистить.
    """
    root = logging.getLogger()
    if not _has_filter(root):
        root.addFilter(SecretScrubFilter())
    for handler in root.handlers:
        if not _has_filter(handler):
            handler.addFilter(SecretScrubFilter())

    for name in _STANDALONE_LOGGERS:
        logger = logging.getLogger(name)
        if not _has_filter(logger):
            logger.addFilter(SecretScrubFilter())
        for handler in logger.handlers:
            if not _has_filter(handler):
                handler.addFilter(SecretScrubFilter())


__all__ = ["MASK", "SecretScrubFilter", "install_log_scrubber", "scrub"]
