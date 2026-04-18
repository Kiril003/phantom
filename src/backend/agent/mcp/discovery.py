"""
MCP discovery — reads `agent_mcp_servers` config, connects to each enabled
server, enumerates tools, registers dynamic adapters in ActionRegistry.

Failure on any single server logs WARN and continues. Runtime stays operable
without MCP.
"""
from __future__ import annotations

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


async def discover_all(*, registry_=None) -> dict[str, int]:
    """Connect each enabled server, enumerate tools, register adapters.

    Returns {server_name: tool_count} for what actually loaded.
    """
    reg = registry_ or default_registry
    out: dict[str, int] = {}
    servers = list(config.agent_mcp_servers or [])
    for server_cfg in servers:
        try:
            count = await _discover_one(server_cfg, reg)
            out[str(server_cfg.get("name", "?"))] = count
        except Exception as exc:
            logger.warning("MCP discover failed for %s: %s", server_cfg.get("name"), exc)
    return out


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
    except (McpError, McpTimeout) as exc:
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
        # Register into the live ActionRegistry so the planner sees it next loop.
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
