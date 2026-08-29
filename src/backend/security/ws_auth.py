"""Токен для WebSocket їде під-протоколом, а не в query string.

Чому не `?token=`: адресний рядок — це не секретне місце. Його пише в лог
uvicorn (`"WebSocket /ws?token=…" [accepted]`), його бачить будь-який
проксі, він осідає в історії й у метриках. Панель раунду 4 нарахувала
двадцять пʼять повних JWT у логах вузла за один прогін — і це не ефект
debug-режиму, шлях запиту логується завжди.

Чому саме під-протокол, а не «перший кадр після відкриття»: під-протокол
живе в самому рукостисканні, тож вузол вирішує «свій/чужий» ДО `accept()` —
не треба ні тримати неавторизоване зʼєднання, ні вигадувати таймаут, ні
міняти цикл читання. Алфавіт JWT (base64url і крапка) цілком лежить у
дозволених для під-протоколу символах RFC 6455, тож токен їде як є.
Той самий трюк робить kube-apiserver.

Сумісність: `?token=` ще приймається (мобільний клієнт на ньому), але
позначений застарілим і на кожному використанні пише попередження — без
самого токена в тексті, звісно.
"""
from __future__ import annotations

import logging
from typing import Optional

from starlette.websockets import WebSocket

logger = logging.getLogger(__name__)

#: Клієнт пропонує рівно дві позиції: цей маркер і одразу за ним токен.
#: Версія в назві — щоб колись можна було змінити формат, не ламаючи старих.
BEARER_SUBPROTOCOL = "phantom.bearer.v1"


def extract_ws_token(
    ws: WebSocket, query_token: Optional[str] = None
) -> tuple[Optional[str], Optional[str]]:
    """Дістає токен із рукостискання.

    Повертає `(token, subprotocol_to_echo)`. Друге значення треба віддати
    в `ws.accept(subprotocol=…)`: браузер розриває зʼєднання, якщо сервер
    не підтвердив жодного із запропонованих під-протоколів.
    """
    offered = _offered_subprotocols(ws)
    for index, item in enumerate(offered):
        if item == BEARER_SUBPROTOCOL and index + 1 < len(offered):
            candidate = offered[index + 1]
            if candidate:
                return candidate, BEARER_SUBPROTOCOL

    if query_token:
        # Не пишемо ні токен, ні його довжину — тільки факт.
        logger.warning(
            "WS auth via deprecated ?token= query string (path=%s). "
            "Client should offer the %r subprotocol instead — the query "
            "string lands in access logs.",
            ws.scope.get("path", "?"),
            BEARER_SUBPROTOCOL,
        )
        return query_token, None

    return None, None


def _offered_subprotocols(ws: WebSocket) -> list[str]:
    scoped = ws.scope.get("subprotocols")
    if scoped:
        return [str(item).strip() for item in scoped if str(item).strip()]
    raw = ws.headers.get("sec-websocket-protocol") or ""
    return [part.strip() for part in raw.split(",") if part.strip()]


__all__ = ["BEARER_SUBPROTOCOL", "extract_ws_token"]
