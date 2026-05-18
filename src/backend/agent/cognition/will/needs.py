"""
Phase 17a.5 — Information-Need Resolution.

When the agent doesn't know something, it tries (in priority order):

  1. Strategic memory (ChromaDB episodes) — has this question already been
     answered for this user / similar context?
  2. Web research — iterative search to ≥3 corroborating sources (delegated
     to `agent/actions/research.py`).
  3. Ask the user — via a typed `InfoNeed` prompt.

This module owns the resolver state machine + a small in-memory pending
registry (`info_need_registry`) so the AskUser action can `await` the
operator's reply via the API endpoint.

The InfoNeed pydantic shapes themselves live in `agent/schemas.py` (so the
TS mirror in `shared/types/agent.ts` is colocated with the rest of the agent
contract).
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any

from ...schemas import InfoNeed, InfoNeedKind, InfoNeedResponse

logger = logging.getLogger(__name__)


@dataclass
class _PendingNeed:
    info_need: InfoNeed
    future: asyncio.Future
    created_at: float
    resolution_history: list[str] = field(default_factory=list)


class InfoNeedRegistry:
    """In-memory registry of pending InfoNeeds awaiting operator reply.

    The runtime keeps a singleton instance (see `info_need_registry` below).
    `AskUser` action calls `register()` then awaits the future; the API
    endpoint `POST /agent/task/{id}/info-response` calls `resolve()`.

    Persistence is intentionally absent: pending needs don't survive a server
    restart — the loop will simply re-fire them when the task resumes.
    """

    def __init__(self) -> None:
        self._needs: dict[str, _PendingNeed] = {}

    def register(self, info_need: InfoNeed) -> asyncio.Future:
        loop = asyncio.get_event_loop()
        future: asyncio.Future = loop.create_future()
        self._needs[info_need.id] = _PendingNeed(
            info_need=info_need,
            future=future,
            created_at=loop.time(),
        )
        return future

    def resolve(self, response: InfoNeedResponse) -> bool:
        pending = self._needs.pop(response.info_need_id, None)
        if pending is None:
            return False
        if pending.future.done():
            return False
        try:
            pending.future.set_result(response)
        except Exception as exc:
            logger.debug("info_need future already done: %s", exc)
        return True

    def cancel(self, info_need_id: str, reason: str = "cancelled") -> bool:
        pending = self._needs.pop(info_need_id, None)
        if pending is None:
            return False
        if pending.future.done():
            return False
        pending.future.set_exception(asyncio.CancelledError(reason))
        return True

    def cancel_for_task(self, task_id: str) -> int:
        n = 0
        for nid in list(self._needs.keys()):
            if self._needs[nid].info_need.task_id == task_id:
                if self.cancel(nid, reason=f"task {task_id} ended"):
                    n += 1
        return n

    def list_for_task(self, task_id: str) -> list[InfoNeed]:
        return [
            p.info_need for p in self._needs.values()
            if p.info_need.task_id == task_id
        ]

    def get(self, info_need_id: str) -> InfoNeed | None:
        pending = self._needs.get(info_need_id)
        return pending.info_need if pending else None

    def __len__(self) -> int:
        return len(self._needs)


# Singleton — used by both AskUser action + the routes_agent endpoint.
info_need_registry = InfoNeedRegistry()


# ── Resolver helpers ────────────────────────────────────────────────────────


@dataclass
class ResolutionResult:
    answer: Any
    source: str  # "memory" | "web" | "user" | "default"
    confidence: float = 0.5
    raw: Any | None = None


async def resolve_information_need(
    info_need: InfoNeed,
    *,
    ai_router: Any | None = None,
    memory_lookup: Any | None = None,
    web_research: Any | None = None,
    on_emit: Any | None = None,
    timeout_s: float | None = None,
) -> ResolutionResult:
    """Try cache → web → ask-user, in order. The first to produce a non-empty
    answer wins. If all fail and the InfoNeed has a `default`, that's used
    with `source='default'`.

    Pluggable callables (all optional):
      * memory_lookup(info_need) -> Any | None
      * web_research(info_need) -> Any | None
      * on_emit(info_need) -> None — broadcast hook (WS) before awaiting user
    """
    # 1) Memory.
    if (
        info_need.resolution_strategy in {"ask", "search_first_then_ask"}
        and memory_lookup is not None
    ):
        try:
            cached = await _maybe_await(memory_lookup, info_need)
            if cached is not None:
                return ResolutionResult(answer=cached, source="memory", confidence=0.7)
        except Exception as exc:
            logger.debug("info_need memory lookup failed: %s", exc)

    # 2) Web research.
    if info_need.resolution_strategy == "search_first_then_ask" and web_research is not None:
        try:
            digest = await _maybe_await(web_research, info_need)
            if digest is not None:
                return ResolutionResult(
                    answer=digest, source="web", confidence=0.6, raw=digest,
                )
        except Exception as exc:
            logger.debug("info_need web research failed: %s", exc)

    # 3) Ask user.
    future = info_need_registry.register(info_need)
    if on_emit is not None:
        try:
            await _maybe_await(on_emit, info_need)
        except Exception as exc:
            logger.debug("info_need on_emit broadcast failed: %s", exc)

    try:
        if timeout_s is not None:
            response: InfoNeedResponse = await asyncio.wait_for(future, timeout=timeout_s)
        else:
            response = await future
    except asyncio.CancelledError:
        if info_need.default is not None:
            return ResolutionResult(answer=info_need.default, source="default")
        raise
    except asyncio.TimeoutError:
        info_need_registry.cancel(info_need.id, reason="timeout")
        if info_need.default is not None:
            return ResolutionResult(answer=info_need.default, source="default")
        raise

    return ResolutionResult(answer=response.answer, source="user", confidence=1.0, raw=response)


async def _maybe_await(fn: Any, *args: Any, **kwargs: Any) -> Any:
    res = fn(*args, **kwargs) if callable(fn) else fn
    if asyncio.iscoroutine(res):
        return await res
    return res


# ── Validation helpers (response shape per kind) ────────────────────────────


def validate_response(info_need: InfoNeed, answer: Any) -> tuple[bool, str | None]:
    """Light-weight validation. Returns (ok, error_message)."""
    kind: InfoNeedKind = info_need.kind
    if info_need.required and answer in (None, "", []):
        if info_need.default is None:
            return False, "value required"
    if kind == "single_choice":
        if not isinstance(answer, str):
            return False, "single_choice expects string id"
        if info_need.options and answer not in {o.id for o in info_need.options}:
            return False, f"unknown option {answer!r}"
    elif kind == "multi_choice":
        if not isinstance(answer, list):
            return False, "multi_choice expects list of ids"
        valid_ids = {o.id for o in info_need.options}
        if info_need.options:
            for a in answer:
                if a not in valid_ids:
                    return False, f"unknown option {a!r}"
    elif kind == "range":
        try:
            v = float(answer)
        except Exception:
            return False, "range expects number"
        if info_need.range_min is not None and v < info_need.range_min:
            return False, f"value below min {info_need.range_min}"
        if info_need.range_max is not None and v > info_need.range_max:
            return False, f"value above max {info_need.range_max}"
    elif kind == "confirm":
        if not isinstance(answer, bool):
            return False, "confirm expects bool"
    elif kind == "file_pick":
        if not isinstance(answer, (str, list)):
            return False, "file_pick expects path string or list"
    elif kind == "visual_pick":
        if not isinstance(answer, str):
            return False, "visual_pick expects option id"
        if info_need.options and answer not in {o.id for o in info_need.options}:
            return False, f"unknown option {answer!r}"
    return True, None


__all__ = [
    "InfoNeedRegistry",
    "info_need_registry",
    "ResolutionResult",
    "resolve_information_need",
    "validate_response",
]
