"""Захист приймальні від того, хто просто хоче її завалити.

Приймальня публічна за задумом — інакше чужа людина не змогла б написати.
Але кожен кадр коштує спроби X3DH, а вона навмисне не дешева. Тож треба
відсікати сміття до крипти, а не після неї.

Ліміти тут свідомо грубі: захистити вузол від потоку, не заважаючи живому
листуванню. Це не заміна ретранслятору з його тікетами — це нижня межа.
"""
from __future__ import annotations

import time
from collections import deque

__all__ = ["FRAME_LIMIT_BYTES", "GuardRejected", "InboxGuard", "inbox_guard"]

#: Кадр текстового повідомлення — сотні байтів. Мегабайт означає, що це не текст.
FRAME_LIMIT_BYTES = 64 * 1024

_WINDOW_S = 60.0
_MAX_PER_WINDOW = 120
_MAX_TRACKED_SOURCES = 4096


class GuardRejected(Exception):
    """Кадр відкинуто до спроби розшифрування."""


class InboxGuard:
    def __init__(
        self,
        *,
        window_s: float = _WINDOW_S,
        max_per_window: int = _MAX_PER_WINDOW,
        frame_limit: int = FRAME_LIMIT_BYTES,
    ) -> None:
        self._window_s = window_s
        self._max = max_per_window
        self._frame_limit = frame_limit
        self._hits: dict[str, deque[float]] = {}

    def check(self, source: str, frame_len: int, *, now: float | None = None) -> None:
        if frame_len <= 0:
            raise GuardRejected("порожній кадр")
        if frame_len > self._frame_limit:
            raise GuardRejected("кадр завеликий для повідомлення")

        moment = time.monotonic() if now is None else now
        hits = self._hits.setdefault(source or "?", deque())
        while hits and moment - hits[0] > self._window_s:
            hits.popleft()
        if len(hits) >= self._max:
            raise GuardRejected("забагато кадрів з цієї адреси")
        hits.append(moment)

        # Словник не має рости нескінченно: хто давно мовчить, того забуваємо.
        if len(self._hits) > _MAX_TRACKED_SOURCES:
            stale = [k for k, v in self._hits.items() if not v or moment - v[-1] > self._window_s]
            for key in stale:
                self._hits.pop(key, None)


inbox_guard = InboxGuard()
