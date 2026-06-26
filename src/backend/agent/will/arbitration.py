from __future__ import annotations

from contextlib import asynccontextmanager


class IntentBusy(Exception):
    """Raised when an intent holder is requested but the mutex is held."""


class IntentMutex:
    def __init__(self) -> None:
        self._holder: str | None = None

    @property
    def held_by(self) -> str | None:
        return self._holder

    def try_acquire(self, holder: str) -> bool:
        if self._holder is not None:
            return False
        self._holder = holder
        return True

    def release(self, holder: str) -> None:
        if self._holder == holder:
            self._holder = None

    @asynccontextmanager
    async def hold(self, holder: str):
        if not self.try_acquire(holder):
            raise IntentBusy(f"intent held by {self._holder!r}")
        try:
            yield
        finally:
            self.release(holder)


intent_mutex = IntentMutex()
