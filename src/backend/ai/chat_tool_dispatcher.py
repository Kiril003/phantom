"""
PHANTOM OS — Phase 17a chat tool dispatcher (Day-2 D2-A5 consolidated).

This module USED to ship a parallel implementation of the 5 read-only
chat tools. The Day-2 audit (`docs/audit-2026-04-29-day2/FINDINGS.md`,
finding D2-A5) flagged that as architectural drift: ``ai/tool_executor``
already implements the same 5 tools and IS the production code path
(consumed by ``gemini_provider.call_with_tools``). Two implementations
of the same tool means two places to fix every bug, two shapes for the
LLM to learn, two security surfaces.

Day-2 H-5 removes the duplication. The 5 chat tools now delegate to
``tool_executor.execute_tool``; this dispatcher is a thin envelope
adapter so the (future) Phase 17b chat ``call_with_tools`` loop can
keep its result-dict contract::

    {"ok": bool, "name": str, "result"|"error": ..., "elapsed_ms": int}

Phase 17b will likely call ``tool_executor.execute_tool`` directly via
``ai_router.call_with_tools`` — at that point this shim becomes
optional. Until then it's the test surface for the Phase 17a fixture
work and the contract-test enforcement of name-set parity.
"""
from __future__ import annotations

import logging
import time
from typing import Any, Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


# ── Public API ────────────────────────────────────────────────────────────────


# Names the chat path is allowed to expose. Subset of tool_executor's
# catalog: the deferred tools (search_web, get/create_calendar_event)
# carry security risk and need the Tier C hardening before they go to
# the LLM. Phase 17b's call_with_tools loop filters its tool catalog
# through this set.
_CHAT_SAFE_TOOL_NAMES: tuple[str, ...] = (
    "search_locationhistory",
    "query_temporal_anchors",
    "recall_memory_facts",
    "get_system_metrics",
    "get_sensor_status",
)


_DispatchHandler = Callable[..., Awaitable[Any]]


def _make_delegate(name: str) -> _DispatchHandler:
    """Build a handler that forwards to ``tool_executor.execute_tool``
    and returns the tool_executor result dict unchanged. The dispatcher
    layer above this strips the envelope into the chat-friendly
    ``{ok, name, result|error, elapsed_ms}`` shape.
    """
    async def _h(*, args: dict[str, Any], user_id: str, db: AsyncSession) -> dict[str, Any]:  # noqa: ARG001
        # `db` is accepted for API compatibility with the Phase 17a
        # signature (`dispatch(... db=)`) but tool_executor opens its
        # own session via _session_factory — passing the live request
        # session would deadlock SQLite under concurrent writes.
        from ai.tool_executor import execute_tool

        return await execute_tool(name, args, user_id)
    _h.__name__ = f"_delegate_{name}"
    return _h


_HANDLERS: dict[str, _DispatchHandler] = {
    name: _make_delegate(name) for name in _CHAT_SAFE_TOOL_NAMES
}


async def dispatch(
    name: str,
    args: dict[str, Any] | None = None,
    *,
    user_id: str,
    db: AsyncSession,
) -> dict[str, Any]:
    """Run the named chat tool. Returns ``{ok, name, result|error, elapsed_ms}``.

    Never raises — failures are captured as ``ok=False``. The caller
    embeds the dict in the next LLM turn or surfaces it on a debug
    channel.
    """
    handler = _HANDLERS.get(name)
    started = time.monotonic()
    if handler is None:
        return _err(name, started, f"unknown_tool:{name}")
    try:
        raw = await handler(args=args or {}, user_id=user_id, db=db)
    except Exception as exc:  # noqa: BLE001
        logger.warning("chat_tool_dispatcher: %s failed: %s", name, exc)
        return _err(name, started, f"{type(exc).__name__}: {exc}"[:200])

    elapsed_ms = int((time.monotonic() - started) * 1000)

    # tool_executor returns either {"ok": True, ...payload...} or
    # {"error": ..., "error_kind": ...}. Translate to the chat shape.
    if isinstance(raw, dict) and raw.get("ok") is True:
        # Strip the envelope — the LLM only needs the payload + a sane
        # success flag. Drop tool_executor's internal `_elapsed_ms`
        # since we surface our own elapsed_ms at this layer.
        payload = {
            k: v for k, v in raw.items() if k not in ("ok", "_elapsed_ms")
        }
        return {
            "ok": True,
            "name": name,
            "result": payload,
            "elapsed_ms": elapsed_ms,
        }
    if isinstance(raw, dict) and "error" in raw:
        return _err(
            name,
            started,
            f"{raw.get('error_kind', 'error')}:{raw.get('error', '')}"[:200],
        )

    # Handler was monkeypatched to return something we can't classify
    # (e.g. a Phase 17a test stand-in). Pass it through as raw `result`
    # so the test can introspect its own shape.
    return {
        "ok": True,
        "name": name,
        "result": raw,
        "elapsed_ms": elapsed_ms,
    }


def _err(name: str, started: float, message: str) -> dict[str, Any]:
    return {
        "ok": False,
        "name": name,
        "error": message,
        "elapsed_ms": int((time.monotonic() - started) * 1000),
    }


def supported_tools() -> list[str]:
    """Names of tools this dispatcher knows. Phase 17b wiring uses this
    to filter the CHAT_DATA_TOOLS catalog passed to the LLM, so deferred
    tools aren't advertised before they're handled."""
    return sorted(_HANDLERS.keys())


__all__ = ["dispatch", "supported_tools"]
