"""
McpClient + McpToolAdapter.

Minimal line-delimited JSON RPC over stdio. The real MCP spec includes
capabilities negotiation, notifications, etc. — out of scope for 9.2 which
only needs list_tools + call_tool to prove the extension point.

McpToolAdapter is a dynamically-generated Action subclass — one per discovered
tool. The adapter forwards `args_as_dict()` into the live MCP client.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from typing import Any, ClassVar, Type

from pydantic import Field, create_model

from ..actions.base import Action, ActionContext
from ..schemas import ActionResult, Precondition, RiskLevel

logger = logging.getLogger(__name__)


class McpError(Exception):
    """Raised by McpClient on protocol-level failures."""


class McpTimeout(McpError):
    pass


# ── Client ────────────────────────────────────────────────────────────────────


class McpStdioClient:
    """Spawns an MCP server as a subprocess; talks line-delimited JSON."""

    def __init__(self, *, name: str, command: str | list[str]) -> None:
        self.name = name
        self.command = command if isinstance(command, list) else command.split()
        self._proc: asyncio.subprocess.Process | None = None
        self._next_id = 1
        # Phase 9.2.3 (F-12): serialise write+readline pairs so two coroutines
        # calling _request concurrently can't swap each other's replies. The
        # line-delimited JSON-RPC transport has no id→future correlation; the
        # reader takes whatever arrives next on stdout, which is only safe
        # while exactly one request is in flight at a time.
        self._io_lock: asyncio.Lock | None = None

    @property
    def connected(self) -> bool:
        return self._proc is not None and self._proc.returncode is None

    async def connect(self, timeout: float = 10.0) -> None:
        """Phase 9.2.2 (F-04): wrap subprocess spawn in `asyncio.wait_for` so
        a hanging MCP server can no longer block backend startup.
        """
        if self.connected:
            return
        try:
            self._proc = await asyncio.wait_for(
                asyncio.create_subprocess_exec(
                    *self.command,
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                ),
                timeout=timeout,
            )
        except asyncio.TimeoutError as exc:
            self._proc = None
            raise McpTimeout(
                f"mcp {self.name}: subprocess spawn exceeded {timeout}s"
            ) from exc

    async def close(self) -> None:
        if self._proc is None:
            return
        with contextlib.suppress(Exception):
            if self._proc.stdin and not self._proc.stdin.is_closing():
                self._proc.stdin.close()
        with contextlib.suppress(Exception):
            self._proc.terminate()
        with contextlib.suppress(asyncio.TimeoutError, ProcessLookupError):
            await asyncio.wait_for(self._proc.wait(), timeout=2.0)
        self._proc = None

    async def _request(self, method: str, params: dict | None = None,
                       timeout: float = 30.0) -> dict:
        if not self.connected:
            await self.connect()
        assert self._proc is not None and self._proc.stdin and self._proc.stdout
        # Phase 9.2.3 (F-12): hold the io_lock across the write+readline pair
        # so concurrent calls cannot swap each other's replies.
        if self._io_lock is None:
            self._io_lock = asyncio.Lock()
        async with self._io_lock:
            msg_id = self._next_id
            self._next_id += 1
            payload = {"id": msg_id, "method": method, "params": params or {}}
            line = (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")
            self._proc.stdin.write(line)
            await self._proc.stdin.drain()
            try:
                raw = await asyncio.wait_for(self._proc.stdout.readline(), timeout=timeout)
            except asyncio.TimeoutError as exc:
                raise McpTimeout(f"mcp {self.name}: no reply within {timeout}s") from exc
            if not raw:
                raise McpError(f"mcp {self.name}: connection closed mid-call")
            try:
                decoded = json.loads(raw.decode("utf-8"))
            except json.JSONDecodeError as exc:
                raise McpError(f"mcp {self.name}: invalid JSON {exc}") from exc
            if "error" in decoded:
                raise McpError(f"mcp {self.name}: {decoded['error']}")
            return decoded.get("result") or decoded

    async def list_tools(self) -> list[dict]:
        result = await self._request("list_tools", timeout=10.0)
        tools = result.get("tools") if isinstance(result, dict) else result
        return list(tools or [])

    async def call_tool(self, *, name: str, arguments: dict,
                        timeout: float = 30.0) -> Any:
        result = await self._request(
            "call_tool",
            {"name": name, "arguments": arguments},
            timeout=timeout,
        )
        return result


# ── Adapter ───────────────────────────────────────────────────────────────────


_RISK_MAP = {1: RiskLevel.SAFE, 3: RiskLevel.LOW, 5: RiskLevel.MEDIUM, 7: RiskLevel.HIGH}


def _risk_from_int(n: int) -> RiskLevel:
    if n in _RISK_MAP:
        return _RISK_MAP[n]
    if n <= 1:
        return RiskLevel.SAFE
    if n <= 3:
        return RiskLevel.LOW
    if n <= 5:
        return RiskLevel.MEDIUM
    return RiskLevel.HIGH


def _python_type_for(json_type: str) -> Any:
    return {
        "string": str, "integer": int, "number": float,
        "boolean": bool, "array": list, "object": dict,
    }.get(json_type, str)


def build_adapter(
    *,
    server_name: str,
    tool: dict,
    client: McpStdioClient,
    default_risk: int = 3,
    timeout_s: float = 30.0,
) -> Type[Action]:
    """Construct a dynamic McpToolAdapter Action subclass for one MCP tool."""
    tool_name = str(tool.get("name") or tool.get("tool_name") or "")
    if not tool_name:
        raise ValueError("MCP tool missing name")

    description = str(tool.get("description") or "")
    risk = _risk_from_int(int(tool.get("risk_level", default_risk)))

    # Build dynamic Pydantic fields from JSON Schema parameters.
    schema = tool.get("parameters") or tool.get("inputSchema") or {}
    properties = (schema.get("properties") or {}) if isinstance(schema, dict) else {}
    required = (schema.get("required") or []) if isinstance(schema, dict) else []

    fields: dict[str, tuple[Any, Any]] = {}
    for pname, pdef in properties.items():
        ptype = _python_type_for(str(pdef.get("type") or "string"))
        default = ... if pname in required else pdef.get("default", None)
        fields[pname] = (ptype, Field(default, description=str(pdef.get("description", ""))))

    base_action_name = f"mcp.{server_name}.{tool_name}"
    bound_client = client
    bound_tool_name = tool_name
    bound_timeout = timeout_s

    async def _execute(self, ctx: ActionContext) -> ActionResult:
        import time as _time
        t0 = _time.monotonic()
        try:
            args = self.model_dump(exclude_none=False)
        except Exception:
            args = {}
        try:
            result = await bound_client.call_tool(
                name=bound_tool_name, arguments=args, timeout=bound_timeout,
            )
            return ActionResult(
                ok=True, output=result,
                elapsed_ms=int((_time.monotonic() - t0) * 1000),
                side_effects=[f"mcp:{server_name}:{bound_tool_name}"],
            )
        except McpTimeout as exc:
            return ActionResult(
                ok=False, error=f"mcp_timeout: {exc}",
                error_class="timeout",
                elapsed_ms=int((_time.monotonic() - t0) * 1000),
            )
        except McpError as exc:
            return ActionResult(
                ok=False, error=f"mcp_error: {exc}",
                error_class="mcp_error",
                elapsed_ms=int((_time.monotonic() - t0) * 1000),
            )

    def _preconditions(self) -> list[Precondition]:
        return []

    cls_name = (
        "McpAdapter_"
        + server_name.replace(".", "_").replace("-", "_")
        + "_"
        + tool_name.replace(".", "_").replace("-", "_")
    )

    cls: Type[Action] = create_model(
        cls_name,
        __base__=Action,
        **fields,
    )  # type: ignore[call-overload]
    # Class-vars
    cls.name = base_action_name  # type: ignore[assignment]
    cls.risk_level = risk  # type: ignore[assignment]
    cls.execute = _execute  # type: ignore[method-assign]
    cls.preconditions = _preconditions  # type: ignore[method-assign]
    # ABC-meta has already locked __abstractmethods__ at class creation —
    # since we just installed a concrete `execute`, clear the lock so
    # instantiation is allowed.
    cls.__abstractmethods__ = frozenset()  # type: ignore[attr-defined]
    return cls


__all__ = ["McpStdioClient", "McpError", "McpTimeout", "build_adapter"]
