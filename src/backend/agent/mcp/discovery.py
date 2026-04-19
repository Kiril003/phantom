"""
MCP discovery — reads `agent_mcp_servers` config, connects to each enabled
server, enumerates tools, registers dynamic adapters in ActionRegistry.

Phase 9.2.2 (F-04): discovery now runs in parallel with per-server timeout
so a single hanging MCP server can't wedge backend startup. Failures on
individual servers log WARN and skip that server only.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from config import config

from ..actions.registry import registry as default_registry
from .adapter import McpError, McpStdioClient, McpTimeout, build_adapter

logger = logging.getLogger(__name__)


# Per-server live client handles, keyed by server name.
_active_clients: dict[str, McpStdioClient] = {}
# Per-server registered action class names.
_registered_action_names: dict[str, list[str]] = {}


# Phase 9.2.2 — hard ceiling on per-server startup. Even if `timeout_s` in the
# server config is generous (for individual call_tool requests), discovery
# itself must finish quickly or the server is skipped.
_DISCOVER_PER_SERVER_TIMEOUT_S = 10.0


async def discover_all(*, registry_=None) -> dict[str, int]:
    """Connect each enabled server in parallel, enumerate tools, register
    adapters. Returns {server_name: tool_count} for what actually loaded.

    Phase 9.2.2 (F-04):
    - Per-server discovery wrapped in `asyncio.wait_for` so one bad server
      can't block startup beyond `_DISCOVER_PER_SERVER_TIMEOUT_S`.
    - All servers attempted concurrently via `asyncio.gather` — total
      discovery latency is `max(per_server)` instead of `sum(per_server)`.
    - Failures isolated: one server crashing leaves the rest registered.
    """
    reg = registry_ or default_registry
    servers = list(config.agent_mcp_servers or [])
    if not servers:
        return {}

    tasks = [
        asyncio.create_task(_safe_discover_one(s, reg), name=f"mcp_discover_{s.get('name', '?')}")
        for s in servers
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    out: dict[str, int] = {}
    succeeded: list[str] = []
    failed: list[str] = []
    for cfg, result in zip(servers, results):
        name = str(cfg.get("name", "?"))
        if isinstance(result, BaseException):
            logger.warning("MCP %s: discovery raised %s — skipping", name, result)
            failed.append(f"{name}: {type(result).__name__}")
            continue
        out[name] = result
        if result > 0:
            succeeded.append(f"{name}({result})")
        elif cfg.get("enabled", False):
            failed.append(f"{name}: 0 tools")
    if succeeded or failed:
        logger.info(
            "MCP discovery complete: %d/%d server(s) online: [%s]%s",
            len(succeeded), len([s for s in servers if s.get("enabled", False)]),
            ", ".join(succeeded) or "none",
            (f". Failed: [{', '.join(failed)}]" if failed else ""),
        )
    return out


async def _safe_discover_one(server_cfg: dict, reg) -> int:
    """Wrap _discover_one in a per-server timeout. Re-raises on failure so
    the caller's gather() can collect the exception."""
    name = str(server_cfg.get("name") or "?")
    try:
        return await asyncio.wait_for(
            _discover_one(server_cfg, reg),
            timeout=_DISCOVER_PER_SERVER_TIMEOUT_S,
        )
    except asyncio.TimeoutError as exc:
        raise McpTimeout(
            f"mcp {name}: discovery exceeded {_DISCOVER_PER_SERVER_TIMEOUT_S}s"
        ) from exc


async def _discover_one(server_cfg: dict, reg) -> int:
    if not server_cfg.get("enabled", False):
        return 0
    name = str(server_cfg.get("name") or "")
    if not name:
        raise ValueError("MCP server config missing 'name'")
    transport = str(server_cfg.get("transport") or "stdio")
    if transport != "stdio":
        raise ValueError(f"MCP transport {transport!r} not supported in 9.2 (stdio only)")
    command = server_cfg.get("command")
    if not command:
        raise ValueError(f"MCP server {name!r}: stdio transport needs 'command'")

    client = McpStdioClient(name=name, command=command)
    await client.connect()
    try:
        tools = await client.list_tools()
    except (McpError, McpTimeout):
        await client.close()
        raise

    default_risk = int(server_cfg.get("default_risk", 3))
    timeout_s = float(server_cfg.get("timeout_s", 30.0))

    registered: list[str] = []
    for tool in tools or []:
        try:
            cls = build_adapter(
                server_name=name,
                tool=tool,
                client=client,
                default_risk=default_risk,
                timeout_s=timeout_s,
            )
        except Exception as exc:
            logger.warning("MCP %s: skipping malformed tool %s: %s", name, tool, exc)
            continue
        reg._by_name[cls.name] = cls
        registered.append(cls.name)

    _active_clients[name] = client
    _registered_action_names[name] = registered
    logger.info("MCP %s: registered %d tool(s)", name, len(registered))
    return len(registered)


async def shutdown_all(*, registry_=None) -> None:
    """Close every active client and de-register their adapters."""
    reg = registry_ or default_registry
    for name, action_names in list(_registered_action_names.items()):
        for action_name in action_names:
            reg._by_name.pop(action_name, None)
    _registered_action_names.clear()
    for name, client in list(_active_clients.items()):
        try:
            await client.close()
        except Exception as exc:
            logger.debug("MCP %s shutdown raised: %s", name, exc)
    _active_clients.clear()


__all__ = ["discover_all", "shutdown_all"]
