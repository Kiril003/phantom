"""
The ONE ToolRegistry (G1.1) — single dispatch surface for every tool.

Absorbs ai/tool_executor.py's dispatch contract verbatim: NEVER raises,
returns {"ok": True, ...} or {"error", "error_kind"}, wall-clock guard
per call, one audit line per invocation ('invoked tool=<name>' is the
grep contract from Phase 10.3 Gate 6).
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from .common import _args_snippet, _err
from .spec import Handler, ToolSpec

logger = logging.getLogger(__name__)

TOOL_TIMEOUT_S: float = 30.0
MAX_TOOL_CALLS_PER_TURN: int = 5


class ToolRegistry:
    def __init__(self) -> None:
        self._specs: dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec) -> None:
        if spec.name in self._specs:
            raise ValueError(f"duplicate tool declaration: {spec.name}")
        self._specs[spec.name] = spec

    def get(self, name: str) -> ToolSpec | None:
        return self._specs.get(name)

    def specs(self, view: str | None = None) -> list[ToolSpec]:
        if view is None:
            return list(self._specs.values())
        return [s for s in self._specs.values() if view in s.views]

    def names(self, view: str | None = None) -> list[str]:
        return [s.name for s in self.specs(view)]

    def declarations(self, view: str = "data") -> list[dict[str, Any]]:
        return [s.declaration() for s in self.specs(view)]


_default = ToolRegistry()

# Test-patchable dispatch table — the same contract ai.tool_executor._HANDLERS
# had: mutate an entry and execute_tool dispatches through the stand-in.
_HANDLERS: dict[str, Handler] = {}


def _build() -> None:
    from .families import ALL_TOOLS

    for spec in ALL_TOOLS:
        _default.register(spec)
        if spec.handler is not None:
            _HANDLERS[spec.name] = spec.handler


_build()


def registry() -> ToolRegistry:
    return _default


def register_specs(specs: list[ToolSpec]) -> None:
    """Late registration (agent bridge, synthesized capabilities)."""
    for spec in specs:
        if _default.get(spec.name) is not None:
            continue
        _default.register(spec)
        if spec.handler is not None:
            _HANDLERS[spec.name] = spec.handler


async def execute_tool(
    tool_name: str,
    args: dict[str, Any] | None,
    user_id: str,
    *,
    timeout_s: float | None = None,
) -> dict[str, Any]:
    """
    Dispatch a tool call. NEVER raises — always returns a result dict.

    On success: ``{"ok": True, ...}``.
    On failure: ``{"error": "...", "error_kind": "..."}``.

    The effective timeout is, in order:
      1. ``timeout_s`` argument (explicit override).
      2. the ToolSpec's declared ``timeout_s`` (network IO bumps).
      3. ``TOOL_TIMEOUT_S`` default.
    """
    handler = _HANDLERS.get(tool_name)
    if handler is None:
        return _err("unknown_tool", f"no handler for tool '{tool_name}'")

    safe_args = dict(args) if isinstance(args, dict) else {}
    snippet = _args_snippet(safe_args)
    logger.info(
        "tool_registry: invoked tool=%s user=%s args=%s",
        tool_name, user_id, snippet,
    )
    spec = _default.get(tool_name)
    effective_timeout = (
        timeout_s
        if timeout_s is not None
        else (spec.timeout_s if spec and spec.timeout_s is not None else TOOL_TIMEOUT_S)
    )
    t0 = time.monotonic()
    try:
        result = await asyncio.wait_for(
            handler(safe_args, user_id),
            timeout=effective_timeout,
        )
    except asyncio.TimeoutError:
        logger.warning(
            "tool_registry: %s timed out after %.1fs", tool_name, effective_timeout
        )
        return _err(
            "timeout",
            f"tool '{tool_name}' exceeded {effective_timeout:.1f}s",
        )
    except Exception as exc:
        logger.exception("tool_registry: %s raised", tool_name)
        return _err("exception", f"{type(exc).__name__}: {exc}")

    elapsed_ms = int((time.monotonic() - t0) * 1000)
    if isinstance(result, dict):
        result.setdefault("_elapsed_ms", elapsed_ms)
        logger.info(
            "tool_registry: %s %s in %dms",
            tool_name,
            "ok" if result.get("ok") else f"error={result.get('error_kind')}",
            elapsed_ms,
        )
        return result
    return _err("exception", f"tool '{tool_name}' returned non-dict: {type(result).__name__}")


__all__ = [
    "ToolRegistry",
    "registry",
    "register_specs",
    "execute_tool",
    "TOOL_TIMEOUT_S",
    "MAX_TOOL_CALLS_PER_TURN",
]
