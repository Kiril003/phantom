"""
Phase 9.2 — MCP discovery + adapter tests.

Stub MCP server is a tiny inline Python script that handles list_tools and
call_tool with canned responses. Lets us exercise the full transport without
requiring an external MCP server install.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import textwrap

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase09-2-mcp")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


# A complete one-shot MCP server: serves list_tools then call_tool, prints to
# stdout, exits when stdin closes.
_STUB_SERVER_SCRIPT = textwrap.dedent("""
    import sys, json
    TOOLS = [
        {
            "name": "echo",
            "description": "echo the args back",
            "parameters": {
                "type": "object",
                "properties": {"text": {"type": "string"}},
                "required": ["text"],
            },
            "risk_level": 1,
        },
        {
            "name": "add",
            "description": "add two numbers",
            "parameters": {
                "type": "object",
                "properties": {
                    "a": {"type": "integer"}, "b": {"type": "integer"}
                },
                "required": ["a", "b"],
            },
            "risk_level": 1,
        },
    ]
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        try:
            req = json.loads(line)
        except Exception:
            continue
        method = req.get("method")
        params = req.get("params") or {}
        if method == "list_tools":
            sys.stdout.write(json.dumps({"id": req.get("id"), "result": {"tools": TOOLS}}) + "\\n")
        elif method == "call_tool":
            name = params.get("name")
            args = params.get("arguments") or {}
            if name == "echo":
                sys.stdout.write(json.dumps({"id": req.get("id"), "result": {"echoed": args.get("text", "")}}) + "\\n")
            elif name == "add":
                sys.stdout.write(json.dumps({"id": req.get("id"), "result": {"sum": int(args.get("a", 0)) + int(args.get("b", 0))}}) + "\\n")
            else:
                sys.stdout.write(json.dumps({"id": req.get("id"), "error": f"unknown_tool:{name}"}) + "\\n")
        else:
            sys.stdout.write(json.dumps({"id": req.get("id"), "error": f"unknown_method:{method}"}) + "\\n")
        sys.stdout.flush()
""")


_STUB_EMPTY_SERVER_SCRIPT = textwrap.dedent("""
    import sys, json
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        req = json.loads(line)
        if req.get("method") == "list_tools":
            sys.stdout.write(json.dumps({"id": req.get("id"), "result": {"tools": []}}) + "\\n")
        else:
            sys.stdout.write(json.dumps({"id": req.get("id"), "result": {}}) + "\\n")
        sys.stdout.flush()
""")


_STUB_TIMEOUT_SERVER_SCRIPT = textwrap.dedent("""
    import sys, json, time
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        # never reply
        time.sleep(60)
""")


def _stub_command(script: str) -> list[str]:
    return [sys.executable, "-c", script]


# ═════════════════════════════════════════════════════════════════════════════
# 1. Discovery + adapter wiring
# ═════════════════════════════════════════════════════════════════════════════


class TestDiscovery:
    @pytest.mark.asyncio
    async def test_discovery_registers_tools(self, monkeypatch):
        from agent.mcp.discovery import discover_all, shutdown_all
        from agent.actions.registry import ActionRegistry
        from config import config

        monkeypatch.setattr(config, "agent_mcp_servers", [
            {"name": "stub", "transport": "stdio",
             "command": _stub_command(_STUB_SERVER_SCRIPT),
             "default_risk": 1, "enabled": True, "timeout_s": 5.0},
        ])
        reg = ActionRegistry()
        before = set(reg.names())
        try:
            counts = await discover_all(registry_=reg)
            assert counts == {"stub": 2}
            after = set(reg.names())
            assert "mcp.stub.echo" in after
            assert "mcp.stub.add" in after
            assert (after - before) == {"mcp.stub.echo", "mcp.stub.add"}
        finally:
            await shutdown_all(registry_=reg)
        # After shutdown, adapters are gone.
        assert "mcp.stub.echo" not in reg.names()

    @pytest.mark.asyncio
    async def test_disabled_server_skipped(self, monkeypatch):
        from agent.mcp.discovery import discover_all, shutdown_all
        from agent.actions.registry import ActionRegistry
        from config import config

        monkeypatch.setattr(config, "agent_mcp_servers", [
            {"name": "off", "transport": "stdio",
             "command": _stub_command(_STUB_SERVER_SCRIPT),
             "default_risk": 1, "enabled": False},
        ])
        reg = ActionRegistry()
        try:
            counts = await discover_all(registry_=reg)
            assert counts == {"off": 0}
        finally:
            await shutdown_all(registry_=reg)


# ═════════════════════════════════════════════════════════════════════════════
# 2. Adapter call + timeout
# ═════════════════════════════════════════════════════════════════════════════


class TestAdapter:
    @pytest.mark.asyncio
    async def test_adapter_call_tool_round_trip(self, monkeypatch):
        from agent.mcp.discovery import discover_all, shutdown_all
        from agent.actions.registry import ActionRegistry
        from agent.actions.base import ActionContext
        from config import config

        monkeypatch.setattr(config, "agent_mcp_servers", [
            {"name": "stub", "transport": "stdio",
             "command": _stub_command(_STUB_SERVER_SCRIPT),
             "default_risk": 1, "enabled": True, "timeout_s": 5.0},
        ])
        reg = ActionRegistry()
        try:
            await discover_all(registry_=reg)
            cls = reg.get("mcp.stub.echo")
            assert cls is not None
            action = cls(text="hello mcp")
            ctx = ActionContext(task_id="t", step_idx=0,
                                workspace_dir="/tmp", runtime=None)
            result = await action.execute(ctx)
            assert result.ok is True
            assert result.output == {"echoed": "hello mcp"}
        finally:
            await shutdown_all(registry_=reg)

    @pytest.mark.asyncio
    async def test_adapter_handles_timeout(self, monkeypatch):
        from agent.mcp.discovery import discover_all, shutdown_all
        from agent.mcp.adapter import McpStdioClient, build_adapter
        from agent.actions.registry import ActionRegistry
        from agent.actions.base import ActionContext
        from config import config

        # Use a server that ACK's list_tools but stalls on call_tool by
        # composing its own client + adapter (bypassing discovery's
        # always-success list_tools requirement).
        ack_tool = {
            "name": "stall",
            "description": "stalls",
            "parameters": {"type": "object", "properties": {}},
            "risk_level": 1,
        }
        client = McpStdioClient(
            name="timeoutsrv",
            command=_stub_command(_STUB_TIMEOUT_SERVER_SCRIPT),
        )
        await client.connect()
        try:
            cls = build_adapter(
                server_name="timeoutsrv", tool=ack_tool, client=client,
                default_risk=1, timeout_s=0.5,
            )
            action = cls()
            ctx = ActionContext(task_id="t", step_idx=0,
                                workspace_dir="/tmp", runtime=None)
            result = await action.execute(ctx)
            assert result.ok is False
            assert result.error_class == "timeout"
        finally:
            await client.close()


# ═════════════════════════════════════════════════════════════════════════════
# 3. MCP disabled / empty-config path
# ═════════════════════════════════════════════════════════════════════════════


class TestMcpDisabled:
    @pytest.mark.asyncio
    async def test_no_mcp_servers_means_no_actions_registered(self, monkeypatch):
        from agent.mcp.discovery import discover_all
        from agent.actions.registry import ActionRegistry
        from config import config

        monkeypatch.setattr(config, "agent_mcp_servers", [])
        reg = ActionRegistry()
        before = set(reg.names())
        counts = await discover_all(registry_=reg)
        after = set(reg.names())
        assert counts == {}
        assert before == after
