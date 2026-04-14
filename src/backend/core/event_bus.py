"""
EventBus — asyncio internal pub/sub.
Handlers are coroutines or sync callables.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable, Coroutine

logger = logging.getLogger(__name__)

Handler = Callable[..., Any]


class EventBus:
    def __init__(self) -> None:
        self._handlers: dict[str, list[Handler]] = {}

    def subscribe(self, event: str, handler: Handler) -> Callable[[], None]:
        """Subscribe to an event. Returns an unsubscribe callable."""
        self._handlers.setdefault(event, []).append(handler)

        def unsubscribe() -> None:
            handlers = self._handlers.get(event, [])
            if handler in handlers:
                handlers.remove(handler)

        return unsubscribe

    def emit(self, event: str, data: Any = None) -> None:
        """
        Fire event synchronously — schedules coroutine handlers as asyncio tasks,
        calls sync handlers inline.
        """
        for handler in list(self._handlers.get(event, [])):
            try:
                result = handler(data)
                if asyncio.iscoroutine(result):
                    asyncio.ensure_future(result)
            except Exception as exc:
                logger.error("EventBus handler error [%s]: %s", event, exc)

    async def emit_async(self, event: str, data: Any = None) -> None:
        """Fire event and await all coroutine handlers."""
        coros: list[Coroutine] = []
        for handler in list(self._handlers.get(event, [])):
            try:
                result = handler(data)
                if asyncio.iscoroutine(result):
                    coros.append(result)
            except Exception as exc:
                logger.error("EventBus sync handler error [%s]: %s", event, exc)

        if coros:
            results = await asyncio.gather(*coros, return_exceptions=True)
            for i, res in enumerate(results):
                if isinstance(res, Exception):
                    logger.error("EventBus async handler error [%s] #%d: %s", event, i, res)

    def clear(self, event: str | None = None) -> None:
        if event is None:
            self._handlers.clear()
        else:
            self._handlers.pop(event, None)


# Singleton
event_bus = EventBus()
