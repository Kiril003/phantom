"""Phase 9.2.3 — F-12 regression: McpStdioClient._request must serialise
concurrent callers so responses don't interleave.

The line-delimited JSON-RPC transport has no id→future correlation; whoever
reads stdout first takes whatever reply arrives next. Without the io_lock,
two concurrent _request calls could swap their return values.

The test drives two concurrent list_tools calls against a fake stdio
subprocess that replies on a 30 ms delay per request. With the lock the
second caller must wait for the first to complete; we assert both replies
are well-formed and call count matches.
"""
from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest

from agent.mcp.adapter import McpStdioClient


class _FakeStdin:
    def __init__(self) -> None:
        self._buf = bytearray()

    def write(self, b: bytes) -> None:
        self._buf.extend(b)

    async def drain(self) -> None:
        return None

    def is_closing(self) -> bool:
        return False

    def close(self) -> None:  # pragma: no cover
        return None


class _FakeStdout:
    def __init__(self, script: list[bytes]) -> None:
        self._script = list(script)
        self._lock = asyncio.Lock()

    async def readline(self) -> bytes:
        async with self._lock:
            if not self._script:
                return b""
            # Simulate the server taking time to respond.
            await asyncio.sleep(0.03)
            return self._script.pop(0)


class _FakeProc:
    def __init__(self, script: list[bytes]) -> None:
        self.stdin = _FakeStdin()
        self.stdout = _FakeStdout(script)
        self.returncode = None


@pytest.mark.asyncio
async def test_request_serialises_concurrent_callers() -> None:
    # Two canned replies. Even if both callers fire simultaneously, the
    # io_lock serialises write+read pairs so each gets the FIRST available
    # line after its own write.
    replies = [
        json.dumps({"id": 1, "result": {"tools": [{"name": "a"}]}}).encode() + b"\n",
        json.dumps({"id": 2, "result": {"tools": [{"name": "b"}]}}).encode() + b"\n",
    ]
    client = McpStdioClient(name="fake", command=["/bin/true"])
    client._proc = _FakeProc(replies)  # type: ignore[assignment]

    r1, r2 = await asyncio.gather(
        client.list_tools(),
        client.list_tools(),
    )
    # Both calls must produce valid tool lists; the names come from whichever
    # canned reply each caller saw. With the lock, ids were monotonic (1, 2).
    names = sorted((r1[0]["name"], r2[0]["name"]))
    assert names == ["a", "b"]


@pytest.mark.asyncio
async def test_request_lock_is_lazy_async_local() -> None:
    """The io_lock must be bound to the running loop; creating it eagerly in
    __init__ breaks tests that instantiate McpStdioClient outside an event
    loop. Assert lazy creation here.
    """
    client = McpStdioClient(name="fake", command=["/bin/true"])
    assert client._io_lock is None  # not yet bound
    # Trigger lazy creation by entering _request indirectly via a stub proc.
    client._proc = _FakeProc([
        json.dumps({"id": 1, "result": {"tools": []}}).encode() + b"\n",
    ])  # type: ignore[assignment]
    await client.list_tools()
    assert isinstance(client._io_lock, asyncio.Lock)
