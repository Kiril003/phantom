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
        # Audit-2026-04-28 F-31: hold a strong reference to every async
        # handler task so CPython's GC cannot collect it mid-flight.
        # `asyncio.ensure_future(coro)` returns a Task that is otherwise
        # only weakly tracked by the loop; PEP guidance and the asyncio
        # docs both say "store a strong ref". Tasks remove themselves
        # from this set via `add_done_callback`.
        self._pending_tasks: set[asyncio.Task] = set()

    def subscribe(self, event: str, handler: Handler) -> Callable[[], None]:
        """Subscribe to an event. Returns an unsubscribe callable."""
        self._handlers.setdefault(event, []).append(handler)

        def unsubscribe() -> None:
            handlers = self._handlers.get(event, [])
            if handler in handlers:
                handlers.remove(handler)

        return unsubscribe

    def _track(self, task: asyncio.Task, event: str) -> None:
        self._pending_tasks.add(task)

        def _on_done(t: asyncio.Task) -> None:
            self._pending_tasks.discard(t)
            if t.cancelled():
                return
            exc = t.exception()
            if exc is not None:
                logger.error("EventBus async handler error [%s]: %s", event, exc)

        task.add_done_callback(_on_done)

    def emit(self, event: str, data: Any = None) -> None:
        """
        Fire event synchronously — schedules coroutine handlers as asyncio tasks,
        calls sync handlers inline.
        """
        for handler in list(self._handlers.get(event, [])):
            try:
                result = handler(data)
                if asyncio.iscoroutine(result):
                    try:
                        task = asyncio.create_task(result)
                    except RuntimeError:
                        # No running loop (called from sync context with no
                        # event loop) — fall back to ensure_future on the
                        # default policy and accept the GC risk for that
                        # edge case.
                        task = asyncio.ensure_future(result)
                    self._track(task, event)
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
