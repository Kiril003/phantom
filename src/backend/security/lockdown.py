"""Phase 37 / Wave-2 — Lockdown Controller.
Manages software panic/lockdown state, tracks in-flight critical transactions (commit gates), and executes safe, time-bounded pefrpheral shutdowns.
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Callable, Awaitable, Optional, Any

logger = logging.getLogger(__name__)


class LockdownController:
    """Manages emergency lockdown status and critical section execution gating."""
    def __init__(self, terminate_io_callback: Callable[[], Awaitable[None]], referee: Optional[Any] = None):
        self._lockdown_event = asyncio.Event()
        self._in_flight_critical = 0
        self._in_flight_cond = asyncio.Condition()
        self._terminate_io = terminate_io_callback
        self.referee = referee

    @property
    def is_active(self) -> bool:
        return self._lockdown_event.is_set()

    @asynccontextmanager
    async def critical_section(self):
        """Atomic check-then-increment of in-flight critical tasks under lock condition."""
        async with self._in_flight_cond:
            if self.is_active:
                raise PermissionError("Access Denied: System is currently in Lockdown.")
            self._in_flight_critical += 1

        try:
            yield
        finally:
            async with self._in_flight_cond:
                self._in_flight_critical -= 1
                if self._in_flight_critical == 0:
                    self._in_flight_cond.notify_all()

    async def trigger(self, reason: str) -> None:
        """Triggers lockdown, cancels referee output channels, drains in-flight transactions (50ms), and stops IO."""
        if self.is_active:
            return

        logger.critical("LOCKDOWN ACTIVE: %s. Starting critical transaction drain...", reason)
        self._lockdown_event.set()

        # 1. Notify the output referee to wipe the stack/slots immediately
        if self.referee:
            try:
                await self.referee.on_lockdown()
            except Exception as exc:
                logger.error("Error notifying referee of lockdown: %s", exc)

        # 2. Give in-flight transactions up to 50ms to finish or abort cleanly
        try:
            async with asyncio.timeout(0.05):  # 50 ms limit
                async with self._in_flight_cond:
                    while self._in_flight_critical > 0:
                        await self._in_flight_cond.wait()
            logger.info("Lockdown: critical sections drained cleanly.")
        except TimeoutError:
            logger.error("Lockdown: drain timed out. Terminating I/O immediately with in-flight transactions active!")

        # 3. Cut physical connections/actuators
        try:
            await self._terminate_io()
        except Exception as exc:
            logger.error("Error executing I/O termination callback: %s", exc)

    def re_arm(self) -> None:
        """Manually resets the lockdown state (requires operator credentials)."""
        self._lockdown_event.clear()
        if self.referee:
            try:
                self.referee.on_re_arm()
            except Exception as exc:
                logger.error("Error notifying referee on re_arm: %s", exc)
        logger.info("System re-armed. Lockdown state cleared.")


async def _default_terminate_io() -> None:
    logger.warning("Emergency Lockdown: Default/dummy peripheral I/O termination triggered.")


# Singleton instance
lockdown_controller = LockdownController(terminate_io_callback=_default_terminate_io)

