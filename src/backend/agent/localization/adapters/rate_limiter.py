"""
Phase 9.4b — tiny local rate limiters used by external-service adapters.

Deliberately NOT a general-purpose package. Two flavours:

* :class:`DailyRateLimiter`  — N calls per rolling 24 h window (ipapi).
* :class:`PerSecondRateLimiter` — at least `interval_s` seconds between
  consecutive calls (Nominatim, Overpass).

Both are async-safe via a per-instance lock. They intentionally do not
persist across restarts — running out of budget across a restart boundary
is a rare, acceptable loss of counter state.
"""
from __future__ import annotations

import asyncio
import time
from collections import deque
from typing import Deque


class DailyRateLimiter:
    """Sliding-window counter: reject the (N+1)-th call in any 24 h window."""

    def __init__(self, max_per_day: int) -> None:
        self._max = max(1, int(max_per_day))
        self._timestamps: Deque[float] = deque()
        self._lock = asyncio.Lock()

    def _prune(self, now: float) -> None:
        horizon = now - 86400.0
        while self._timestamps and self._timestamps[0] < horizon:
            self._timestamps.popleft()

    def can_request(self) -> bool:
        now = time.time()
        self._prune(now)
        return len(self._timestamps) < self._max

    def mark_request(self) -> None:
        now = time.time()
        self._prune(now)
        self._timestamps.append(now)

    def remaining(self) -> int:
        self._prune(time.time())
        return max(0, self._max - len(self._timestamps))

    def reset(self) -> None:
        self._timestamps.clear()

    async def acquire(self) -> bool:
        """Atomic can/mark — returns True and marks, False without marking."""
        async with self._lock:
            if not self.can_request():
                return False
            self.mark_request()
            return True


class PerSecondRateLimiter:
    """Token-bucket-ish: at least ``interval_s`` seconds between calls.

    Callers use :meth:`wait` to transparently sleep the remainder.
    """

    def __init__(self, max_per_second: float = 1.0) -> None:
        self._interval_s = 1.0 / max(0.01, float(max_per_second))
        self._last_at: float = 0.0
        self._lock = asyncio.Lock()

    async def wait(self) -> None:
        async with self._lock:
            now = time.monotonic()
            delta = now - self._last_at
            if delta < self._interval_s:
                await asyncio.sleep(self._interval_s - delta)
            self._last_at = time.monotonic()

    def reset(self) -> None:
        self._last_at = 0.0


__all__ = ["DailyRateLimiter", "PerSecondRateLimiter"]
