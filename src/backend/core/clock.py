from __future__ import annotations

import asyncio
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Generator


class PhantomClock:
    def __init__(self) -> None:
        self._mode: str = "system"  # "system" | "virtual"
        self._virtual_time: float = 0.0
        self._speed: float = 0.0

    @property
    def mode(self) -> str:
        return self._mode

    def now(self) -> datetime:
        """Return tz-aware UTC datetime representation of the current clock time."""
        if self._mode == "virtual":
            return datetime.fromtimestamp(self._virtual_time, tz=timezone.utc)
        return datetime.now(tz=timezone.utc)

    def time(self) -> float:
        """Return the current clock time as a float unix timestamp."""
        if self._mode == "virtual":
            return self._virtual_time
        return time.time()

    def advance(self, seconds: float) -> None:
        """Advance the virtual clock by a specific number of seconds."""
        if self._mode == "virtual":
            self._virtual_time += seconds
        else:
            # In system mode, advance has no effect on system time, but we warn or ignore
            pass

    def set_time(self, target: datetime | float) -> None:
        """Freeze/set the clock to a specific time and switch to virtual mode."""
        self._mode = "virtual"
        if isinstance(target, datetime):
            if target.tzinfo is None:
                # If naive, assume UTC
                target = target.replace(tzinfo=timezone.utc)
            self._virtual_time = target.timestamp()
        else:
            self._virtual_time = float(target)

    def reset(self) -> None:
        """Revert clock to system time mode."""
        self._mode = "system"
        self._virtual_time = 0.0
        self._speed = 0.0

    async def sleep(self, seconds: float) -> None:
        """Sleep wrapper. In virtual mode, it advances time instantly and yields control.

        In system mode, it delegates to asyncio.sleep.
        """
        if self._mode == "virtual":
            self.advance(seconds)
            await asyncio.sleep(0)
        else:
            await asyncio.sleep(seconds)

    @contextmanager
    def virtual_time(
        self, start_time: datetime | float | None = None, speed: float = 0.0
    ) -> Generator[PhantomClock, None, None]:
        """Context manager to run code in virtual time mode.

        Restores previous clock state on exit.
        """
        old_mode = self._mode
        old_virtual_time = self._virtual_time
        old_speed = self._speed

        self._mode = "virtual"
        self._speed = speed
        if start_time is not None:
            self.set_time(start_time)
        else:
            # Set to current system time if none provided
            self._virtual_time = time.time()

        try:
            yield self
        finally:
            self._mode = old_mode
            self._virtual_time = old_virtual_time
            self._speed = old_speed


# Global singleton instance
clock = PhantomClock()
