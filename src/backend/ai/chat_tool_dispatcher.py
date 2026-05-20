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

import asyncio
import logging
import time
from typing import Any, Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from config import config

logger = logging.getLogger(__name__)


# ── Public API ────────────────────────────────────────────────────────────────


# Names the chat path is allowed to expose. Subset of tool_executor's
# catalog. Phase 17b note: create_alarm / create_calendar_event /
# create_timer are now enabled — their executors are fully implemented
# and DB-backed; the original "Tier C" deferral was placeholder intent,
# not an active security constraint.
_CHAT_SAFE_TOOL_NAMES: tuple[str, ...] = (
    "search_nearby_places",
    "search_locationhistory",
    "query_temporal_anchors",
    "recall_memory_facts",
    "get_system_metrics",
    "get_sensor_status",
    "get_my_location",
    "get_internal_state",
    # ── Phase 19: Write tools unlocked ──────────────────────────────
    "create_alarm",
    "set_alarm_active",
    "delete_alarm",
    "list_alarms",
    "create_timer",
    "cancel_timer",
    "list_timers",
    "create_calendar_event",
    "update_calendar_event",
    "delete_calendar_event",
    "get_calendar_events",
    "search_web",
    # Phase 17b — chat-driven Custom Agent management.
    "studio_list_agents",
    "studio_get_agent",
    "studio_create_agent",
    "studio_run_agent",
    "studio_delete_agent",
    "studio_card_catalog",
    # Phase 17b-chat-2 — chat-driven editing of an existing agent.
    "studio_update_agent",
    "studio_add_card",
    "studio_remove_card",
    "studio_link_cards",
    "studio_add_recipient",
    "studio_remove_recipient",
    "studio_set_inputs_schema",
    # Phase 25-C — Personal Vault chat-driven CRUD.
    "vault_list",
    "vault_get",
    "vault_create",
    "vault_update",
    "vault_delete",
    "vault_restore",
    # Phase 25-D — HIGH RISK reveal of secret plaintext. Caller is
    # expected to justify each reveal in the call args; every reveal
    # is audited with actor="ai" so the operator can review.
    "vault_reveal",
    # Day-5: Execute terminal commands directly from chat (God mode)
    "run_terminal_command",
    # Phase 30: Maps & Routing
    "map.plan_route",
    # Phase 30: Delegation
    "agent.delegate",
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

    Day-2 D2-R1 + D2-R3 (audit-2026-04-29): every attempt writes one
    row to ``ai_tool_use_log`` with user_id ALWAYS populated (so
    per-tenant queries don't drop chat-tool rows the way they used to
    drop chat-prompt rows whenever ``chat_prompt_logging_enabled`` was
    off), plus the truncated args dict and a short result summary.
    Audit failures never block the dispatch.
    """
    handler = _HANDLERS.get(name)
    started = time.monotonic()
    if handler is None:
        out = _err(name, started, f"unknown_tool:{name}")
        await _audit_dispatch(name, args, user_id, out)
        return out
    # Day-2 D2-D1: per-call wall-clock cap. tool_executor's own
    # asyncio.wait_for guards the SQL/IO step inside execute_tool, but
    # a stand-in handler installed by tests or by future Phase 17b paths
    # that bypass tool_executor would otherwise be unbounded. The
    # dispatcher therefore enforces its own ceiling unconditionally.
    try:
        timeout_s = float(config.chat_tool_call_timeout_s)
        if timeout_s <= 0:
            timeout_s = 10.0
        raw = await asyncio.wait_for(
            handler(args=args or {}, user_id=user_id, db=db),
            timeout=timeout_s,
        )
    except asyncio.TimeoutError:
        logger.warning(
            "chat_tool_dispatcher: %s exceeded %.1fs ceiling",
            name, timeout_s,
        )
        out = _err(name, started, f"timeout:{timeout_s:.1f}s")
        await _audit_dispatch(name, args, user_id, out)
        return out
    except Exception as exc:  # noqa: BLE001
        logger.warning("chat_tool_dispatcher: %s failed: %s", name, exc)
        out = _err(name, started, f"{type(exc).__name__}: {exc}"[:200])
        await _audit_dispatch(name, args, user_id, out)
        return out

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
        out = {
            "ok": True,
            "name": name,
            "result": payload,
            "elapsed_ms": elapsed_ms,
        }
        await _audit_dispatch(name, args, user_id, out)
        return out
    if isinstance(raw, dict) and "error" in raw:
        out = _err(
            name,
            started,
            f"{raw.get('error_kind', 'error')}:{raw.get('error', '')}"[:200],
        )
        await _audit_dispatch(name, args, user_id, out)
        return out

    # Handler was monkeypatched to return something we can't classify
    # (e.g. a Phase 17a test stand-in). Pass it through as raw `result`
    # so the test can introspect its own shape.
    out = {
        "ok": True,
        "name": name,
        "result": raw,
        "elapsed_ms": elapsed_ms,
    }
    await _audit_dispatch(name, args, user_id, out)
    return out


def _err(name: str, started: float, message: str) -> dict[str, Any]:
    return {
        "ok": False,
        "name": name,
        "error": message,
        "elapsed_ms": int((time.monotonic() - started) * 1000),
    }


def _summarise_result(out: dict[str, Any]) -> str:
    """Short operator-readable verdict for the audit row.

    Examples:
      ``ok rows=12``   — a 12-row results list landed
      ``ok``           — success without an obvious row-count
      ``error invalid_args:hours_ago must be …`` — failure
    """
    if out.get("ok") is True:
        result = out.get("result")
        if isinstance(result, dict):
            for row_key in ("count", "results"):
                v = result.get(row_key)
                if isinstance(v, int):
                    return f"ok rows={v}"
                if isinstance(v, list):
                    return f"ok rows={len(v)}"
        return "ok"
    err = out.get("error", "")[:160]
    return f"error {err}"


async def _audit_dispatch(
    name: str,
    args: dict[str, Any] | None,
    user_id: str,
    out: dict[str, Any],
) -> None:
    """Best-effort audit row for one dispatch attempt.

    D2-R3: user_id is ALWAYS set (no chat_prompt_logging gate). D2-R1:
    args + summary land on the row so a later operator review can see
    what the LLM asked for and what it got back without re-reading the
    upstream prompt log.

    Failures are swallowed — telemetry must never block the chat turn.
    """
    try:
        import json as _json
        from ai.tool_use_audit import write_log

        try:
            args_json = _json.dumps(args or {}, ensure_ascii=False, default=str)
        except Exception:
            args_json = "<unencodable>"
        ok = bool(out.get("ok"))
        elapsed_ms = int(out.get("elapsed_ms", 0))
        if ok:
            error_kind = None
            error_message = None
        else:
            err = str(out.get("error", ""))
            head, _, tail = err.partition(":")
            error_kind = head.strip() or "error"
            error_message = (tail.strip() or err)[:1000]

        await write_log(
            task_id=None,
            step_idx=None,
            provider="chat",
            model="",
            tool_name=name,
            success=ok,
            error_kind=error_kind,
            error_message=error_message,
            elapsed_ms=elapsed_ms,
            retry_count=1,
            user_id=user_id,
            tool_args_json=args_json,
            tool_result_summary=_summarise_result(out),
        )
    except Exception as exc:  # noqa: BLE001
        logger.debug("chat_tool_dispatcher audit suppressed: %s", exc)


def supported_tools() -> list[str]:
    """Names of tools this dispatcher knows. Phase 17b wiring uses this
    to filter the CHAT_DATA_TOOLS catalog passed to the LLM, so deferred
    tools aren't advertised before they're handled."""
    return sorted(_HANDLERS.keys())


__all__ = ["dispatch", "supported_tools"]
