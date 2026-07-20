"""
Long-lived task supervision (rebuild P1-4, brief 02 §2 A-2/A-3).

Fire-and-forget ``asyncio.create_task`` calls hold no reference (the task
can be GC'd mid-flight) and swallow exceptions silently. Every long-lived
loop should instead be owned here: the Supervisor keeps a strong
reference, logs crashes, restarts with exponential backoff, and
quarantines a task that keeps dying so a broken subsystem degrades
loudly instead of spinning an error loop forever.

Usage::

    from core.supervisor import supervisor

    supervisor.spawn("context_loop", _context_loop)            # restartable
    supervisor.track("oneshot_backfill", asyncio.create_task(f()))  # adopt only

The full lifespan decomposition into Service objects is a later phase
(brief 02 P5-4); this module is the ownership seam it will build on.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Coroutine, Optional

logger = logging.getLogger(__name__)

# A run that survives this long is considered healthy: its consecutive-
# failure count resets, so an occasional crash after hours of uptime
# never accumulates toward quarantine.
_HEALTHY_RUN_S = 300.0


@dataclass
class _Record:
    name: str
    task: Optional[asyncio.Task] = None
    restart: bool = True
    state: str = "running"  # running | stopped | quarantined | cancelled
    restarts: int = 0
    consecutive_failures: int = 0
    last_error: Optional[str] = None
    started_at: float = field(default_factory=time.monotonic)


class Supervisor:
    def __init__(
        self,
        *,
        backoff_initial_s: float = 1.0,
        backoff_max_s: float = 60.0,
        quarantine_after: int = 5,
    ) -> None:
        self._backoff_initial_s = backoff_initial_s
        self._backoff_max_s = backoff_max_s
        self._quarantine_after = quarantine_after
        self._records: dict[str, _Record] = {}
        self._shutting_down = False

    # ── Public API ────────────────────────────────────────────────────────

    def spawn(
        self,
        name: str,
        factory: Callable[[], Coroutine[Any, Any, Any]],
        *,
        restart: bool = True,
    ) -> asyncio.Task:
        """Own a long-lived coroutine. ``factory`` is called (fresh
        coroutine each attempt); on crash the task restarts with
        exponential backoff until quarantined. Returns the wrapper task
        (cancel it to stop this unit — cancellation is not restarted).
        """
        rec = _Record(name=name, restart=restart)
        rec.task = asyncio.create_task(self._run(rec, factory), name=f"sup:{name}")
        self._records[name] = rec
        return rec.task

    def track(self, name: str, task: asyncio.Task) -> asyncio.Task:
        """Adopt an externally created task: strong reference + crash
        logging, no restart. For one-shots that must not vanish silently."""
        rec = _Record(name=name, task=task, restart=False)
        self._records[name] = rec

        def _done(t: asyncio.Task) -> None:
            if t.cancelled():
                rec.state = "cancelled"
                return
            exc = t.exception()
            if exc is not None:
                rec.state = "stopped"
                rec.last_error = f"{type(exc).__name__}: {exc}"
                logger.error("Tracked task %r died: %s", name, exc, exc_info=exc)
            else:
                rec.state = "stopped"

        task.add_done_callback(_done)
        return task

    def status(self) -> list[dict[str, Any]]:
        return [
            {
                "name": r.name,
                "state": r.state,
                "restarts": r.restarts,
                "consecutive_failures": r.consecutive_failures,
                "last_error": r.last_error,
            }
            for r in self._records.values()
        ]

    async def shutdown(self) -> None:
        """Cancel every owned task and await them. Idempotent."""
        self._shutting_down = True
        tasks = [r.task for r in self._records.values() if r.task and not r.task.done()]
        for t in tasks:
            t.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        for r in self._records.values():
            if r.state == "running":
                r.state = "cancelled"

    # ── Internals ─────────────────────────────────────────────────────────

    async def _run(
        self, rec: _Record, factory: Callable[[], Coroutine[Any, Any, Any]]
    ) -> None:
        while True:
            rec.started_at = time.monotonic()
            try:
                await factory()
                # Clean return: a long-lived loop chose to stop. Honour it.
                rec.state = "stopped"
                logger.info("Supervised task %r returned; not restarting", rec.name)
                return
            except asyncio.CancelledError:
                rec.state = "cancelled"
                raise
            except Exception as exc:  # noqa: BLE001
                run_s = time.monotonic() - rec.started_at
                if run_s > _HEALTHY_RUN_S:
                    rec.consecutive_failures = 0
                rec.consecutive_failures += 1
                rec.restarts += 1
                rec.last_error = f"{type(exc).__name__}: {exc}"
                self._count_restart(rec.name)
                logger.error(
                    "Supervised task %r crashed (run %.1fs, failure %d/%d): %s",
                    rec.name, run_s, rec.consecutive_failures,
                    self._quarantine_after, exc, exc_info=exc,
                )
                if self._shutting_down or not rec.restart:
                    rec.state = "stopped"
                    return
                if rec.consecutive_failures >= self._quarantine_after:
                    rec.state = "quarantined"
                    logger.error(
                        "Supervised task %r QUARANTINED after %d consecutive "
                        "failures — subsystem degraded until restart",
                        rec.name, rec.consecutive_failures,
                    )
                    return
                delay = min(
                    self._backoff_max_s,
                    self._backoff_initial_s * (2 ** (rec.consecutive_failures - 1)),
                )
                await asyncio.sleep(delay)

    @staticmethod
    def _count_restart(name: str) -> None:
        try:
            from observability import supervisor_restarts_total
            supervisor_restarts_total.inc(task=name)
        except Exception:  # noqa: BLE001 — metrics must never break supervision
            pass


# Process-wide singleton, matching the codebase's singleton convention
# (config, hub, context_engine, …).
supervisor = Supervisor()
