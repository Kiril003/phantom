"""Ретранслятор мусить зшивати байти й не пускати чужих."""
from __future__ import annotations

import asyncio
import base64
import json
import socket
import sys
import threading
import time
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import hub as hubmod  # noqa: E402
import main as mainmod  # noqa: E402
from hub import NODE_CHALLENGE_CONTEXT, RelayError, node_id_for, verify_node_hello  # noqa: E402


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


async def _closed_code(awaitable) -> int:
    with pytest.raises(ConnectionClosed) as excinfo:
        await asyncio.wait_for(awaitable, 5)
    received = excinfo.value.rcvd
    return received.code if received is not None else -1


class Node:
    def __init__(self, key: ed25519.Ed25519PrivateKey) -> None:
        self.key = key

    @property
    def pub_b64(self) -> str:
        raw = self.key.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw
        )
        return base64.b64encode(raw).decode("ascii")

    @property
    def node_id(self) -> str:
        return node_id_for(base64.b64decode(self.pub_b64))

    def sign(self, nonce: bytes) -> str:
        return base64.b64encode(self.key.sign(NODE_CHALLENGE_CONTEXT + nonce)).decode("ascii")


@pytest.fixture
def node() -> Node:
    return Node(ed25519.Ed25519PrivateKey.generate())


@pytest.fixture(scope="module")
def relay():
    import uvicorn

    port = _free_port()
    config = uvicorn.Config(mainmod.app, host="127.0.0.1", port=port, log_level="error")
    server = uvicorn.Server(config)
    server.install_signal_handlers = lambda: None
    thread = threading.Thread(target=server.run, daemon=True, name="relay-test")
    thread.start()
    deadline = time.monotonic() + 10
    while not server.started and time.monotonic() < deadline:
        time.sleep(0.02)
    assert server.started, "ретранслятор не піднявся"
    try:
        yield f"ws://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(timeout=5)


@pytest.fixture(autouse=True)
def clean_hub():
    yield
    hubmod.hub._nodes.clear()
    hubmod.hub._tickets.clear()
    hubmod.hub._ip_sessions.clear()
    hubmod.hub._ip_hits.clear()


async def _register(base: str, node: Node):
    ws = await connect(f"{base}/relay/node")
    challenge = json.loads(await ws.recv())
    assert challenge["t"] == "challenge"
    nonce = base64.b64decode(challenge["nonce"])
    await ws.send(json.dumps({"t": "hello", "pub": node.pub_b64, "sig": node.sign(nonce)}))
    ready = json.loads(await ws.recv())
    assert ready["t"] == "ready"
    assert ready["node_id"] == node.node_id
    return ws


def test_node_id_is_derived_from_the_key(node: Node) -> None:
    assert node_id_for(base64.b64decode(node.pub_b64)) == node.node_id
    assert len(node.node_id) == 32


def test_a_forged_signature_never_registers(node: Node) -> None:
    other = ed25519.Ed25519PrivateKey.generate()
    nonce = b"x" * 32
    forged = base64.b64encode(other.sign(NODE_CHALLENGE_CONTEXT + nonce)).decode("ascii")
    with pytest.raises(RelayError):
        verify_node_hello(nonce, node.pub_b64, forged)


def test_a_signature_for_another_nonce_is_refused(node: Node) -> None:
    with pytest.raises(RelayError):
        verify_node_hello(b"a" * 32, node.pub_b64, node.sign(b"b" * 32))


async def test_bytes_cross_the_relay_untouched(relay: str, node: Node) -> None:
    control = await _register(relay, node)
    try:
        client = await connect(f"{relay}/relay/client?node_id={node.node_id}")
        opened = json.loads(await asyncio.wait_for(control.recv(), 5))
        assert opened["t"] == "open"
        session = await connect(f"{relay}/relay/node/session?ticket={opened['ticket']}")

        payload = bytes(range(256)) * 8
        await client.send(payload)
        assert await asyncio.wait_for(session.recv(), 5) == payload

        back = b"\x16\x03\x01" + b"tls-ish" * 100
        await session.send(back)
        assert await asyncio.wait_for(client.recv(), 5) == back

        await client.close()
        await session.close()
    finally:
        await control.close()


async def test_a_client_for_an_absent_node_is_turned_away(relay: str) -> None:
    ws = await connect(f"{relay}/relay/client?node_id={'0' * 32}")
    assert await _closed_code(ws.recv()) == 4404


async def test_a_ticket_burns_after_one_use(relay: str, node: Node) -> None:
    control = await _register(relay, node)
    try:
        client = await connect(f"{relay}/relay/client?node_id={node.node_id}")
        opened = json.loads(await asyncio.wait_for(control.recv(), 5))
        first = await connect(f"{relay}/relay/node/session?ticket={opened['ticket']}")
        second = await connect(f"{relay}/relay/node/session?ticket={opened['ticket']}")
        assert await _closed_code(second.recv()) in (4404, 4409)
        await client.close()
        await first.close()
    finally:
        await control.close()


async def test_a_reconnecting_node_replaces_its_old_socket(relay: str, node: Node) -> None:
    first = await _register(relay, node)
    second = await _register(relay, node)
    try:
        assert await _closed_code(first.recv()) == 4409
        assert hubmod.hub.node_count == 1
    finally:
        await second.close()


async def test_the_node_never_dials_back_and_the_client_is_released(
    relay: str, node: Node, monkeypatch
) -> None:
    monkeypatch.setattr(mainmod, "HANDSHAKE_TIMEOUT_S", 0.3)
    control = await _register(relay, node)
    try:
        client = await connect(f"{relay}/relay/client?node_id={node.node_id}")
        await asyncio.wait_for(control.recv(), 5)
        assert await _closed_code(client.recv()) == 4504
        assert hubmod.hub.session_count == 0
    finally:
        await control.close()


async def test_one_ip_cannot_hoard_sessions(relay: str, node: Node, monkeypatch) -> None:
    monkeypatch.setattr(hubmod, "MAX_SESSIONS_PER_IP", 2)
    control = await _register(relay, node)
    opened: list = []
    try:
        for _ in range(2):
            opened.append(await connect(f"{relay}/relay/client?node_id={node.node_id}"))
            await asyncio.wait_for(control.recv(), 5)
        refused = await connect(f"{relay}/relay/client?node_id={node.node_id}")
        assert await _closed_code(refused.recv()) == 4429
    finally:
        for ws in opened:
            await ws.close()
        await control.close()
