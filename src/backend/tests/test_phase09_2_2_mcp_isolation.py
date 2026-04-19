"""
Phase 9.2.2 — F-04 MCP discovery: per-server timeout + parallel + isolation.

Verifies one bad MCP server can't block backend startup. The previous
implementation was sequential with no per-server timeout, so a hanging
server in slot 0 would prevent every later server from being registered
and would block startup entirely.
"""
from __future__ import annotations

import asyncio
import os
import time

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase09-2-2-mcp")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


# ═════════════════════════════════════════════════════════════════════════════
# 1. Per-server timeout in McpStdioClient.connect
# ═════════════════════════════════════════════════════════════════════════════


class TestConnectTimeout:
    @pytest.mark.asyncio
    async def test_connect_timeout_raises_mcp_timeout(self, monkeypatch):
        from agent.mcp import adapter as _ad
        from agent.mcp.adapter import McpStdioClient, McpTimeout

        async def fake_create(*a, **kw):
            await asyncio.sleep(60)  # would block forever

        monkeypatch.setattr(_ad.asyncio, "create_subprocess_exec", fake_create)

        client = McpStdioClient(name="hanging", command=["never"])
        with pytest.raises(McpTimeout):
            await client.connect(timeout=0.1)


# ═════════════════════════════════════════════════════════════════════════════
# 2. Discovery — one server hangs, others succeed
# ═════════════════════════════════════════════════════════════════════════════


class TestDiscoveryIsolation:
    @pytest.mark.asyncio
    async def test_hanging_server_does_not_block_others(self, monkeypatch):
        from agent.mcp import discovery as _disc

        # Override the timeout so the test runs quickly.
        monkeypatch.setattr(_disc, "_DISCOVER_PER_SERVER_TIMEOUT_S", 0.5)

        called_for: list[str] = []

        async def fake_discover_one(server_cfg, reg):
            name = server_cfg["name"]
            called_for.append(name)
            if name == "hanging":
                await asyncio.sleep(60)
                return 0
            if name == "fast-broken":
                raise RuntimeError("simulated failure")
            return 3  # fast-ok

        monkeypatch.setattr(_disc, "_discover_one", fake_discover_one)
        monkeypatch.setattr(_disc.config, "agent_mcp_servers", [
            {"name": "hanging", "enabled": True, "command": "x"},
            {"name": "fast-broken", "enabled": True, "command": "x"},
            {"name": "fast-ok", "enabled": True, "command": "x"},
        ])

        t0 = time.monotonic()
        out = await _disc.discover_all()
        elapsed = time.monotonic() - t0

        # Hanging server hits the per-server timeout (0.5s); others succeed.
        # Total time should be near max, NOT sum of all timeouts.
        assert elapsed < 2.0, f"discovery took {elapsed:.2f}s, expected near max(0.5)"
        assert out.get("fast-ok") == 3
        # All three were attempted.
        assert set(called_for) == {"hanging", "fast-broken", "fast-ok"}

    @pytest.mark.asyncio
    async def test_failed_server_logged_and_skipped(self, monkeypatch, caplog):
        import logging as _lg
        from agent.mcp import discovery as _disc

        async def fake_discover_one(server_cfg, reg):
            raise RuntimeError(f"{server_cfg['name']} died at startup")

        monkeypatch.setattr(_disc, "_discover_one", fake_discover_one)
        monkeypatch.setattr(_disc.config, "agent_mcp_servers", [
            {"name": "broken", "enabled": True, "command": "x"},
        ])

        with caplog.at_level(_lg.WARNING, logger="agent.mcp.discovery"):
            out = await _disc.discover_all()

        assert "broken" not in out
        assert any("broken" in rec.message for rec in caplog.records)

    @pytest.mark.asyncio
    async def test_all_servers_fail_does_not_crash_startup(self, monkeypatch):
        from agent.mcp import discovery as _disc

        async def fake_discover_one(server_cfg, reg):
            raise RuntimeError("everything broken")

        monkeypatch.setattr(_disc, "_discover_one", fake_discover_one)
        monkeypatch.setattr(_disc.config, "agent_mcp_servers", [
            {"name": "a", "enabled": True, "command": "x"},
            {"name": "b", "enabled": True, "command": "x"},
        ])

        # Should NOT raise — backend continues without MCP tools.
        out = await _disc.discover_all()
        assert out == {}
