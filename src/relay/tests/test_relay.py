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

import httpx
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
    hubmod.hub._mailboxes.clear()
    hubmod.hub._mail_hits.clear()


def _http(relay: str) -> httpx.AsyncClient:
    return httpx.AsyncClient(base_url=relay.replace("ws://", "http://"), timeout=5)


async def _post_letter(
    relay: str,
    node_id: str,
    frame: str = "de1c",
    *,
    from_node_id: str = "a" * 32,
    reply_address: str | None = None,
    ip: str = "203.0.113.7",
) -> httpx.Response:
    body = {"frame": frame, "from_node_id": from_node_id}
    if reply_address is not None:
        body["reply_address"] = reply_address
    async with _http(relay) as client:
        return await client.post(
            f"/relay/mailbox/{node_id}", json=body, headers={"x-forwarded-for": ip}
        )


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


async def test_a_letter_waits_until_the_node_arrives(relay: str, node: Node) -> None:
    posted = await _post_letter(relay, node.node_id, "0badc0de", reply_address="relay-2")
    assert posted.status_code == 202
    assert hubmod.hub.letter_count == 1

    control = await _register(relay, node)
    try:
        letter = json.loads(await asyncio.wait_for(control.recv(), 5))
        assert letter["t"] == "mailbox"
        assert letter["frame"] == "0badc0de"
        assert letter["from_node_id"] == "a" * 32
        assert letter["reply_address"] == "relay-2"
    finally:
        await control.close()


async def test_the_box_is_empty_after_it_is_handed_over(relay: str, node: Node) -> None:
    await _post_letter(relay, node.node_id, "0badc0de")
    first = await _register(relay, node)
    assert json.loads(await asyncio.wait_for(first.recv(), 5))["t"] == "mailbox"
    await first.close()

    second = await _register(relay, node)
    try:
        assert hubmod.hub.letter_count == 0
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(second.recv(), 0.5)
    finally:
        await second.close()


async def test_a_connected_node_gets_the_letter_at_once(relay: str, node: Node) -> None:
    control = await _register(relay, node)
    try:
        posted = await _post_letter(relay, node.node_id, "feed")
        assert posted.status_code == 202
        letter = json.loads(await asyncio.wait_for(control.recv(), 5))
        assert letter["t"] == "mailbox"
        assert letter["frame"] == "feed"
        assert letter["reply_address"] is None
        assert hubmod.hub.letter_count == 0
    finally:
        await control.close()


async def test_the_sender_never_learns_whether_the_node_is_home(relay: str, node: Node) -> None:
    away = await _post_letter(relay, node.node_id, "feed")
    control = await _register(relay, node)
    try:
        home = await _post_letter(relay, node.node_id, "feed")
        assert away.status_code == home.status_code == 202
        assert away.content == home.content
    finally:
        await control.close()


async def test_a_frame_too_big_is_refused(relay: str, node: Node) -> None:
    oversized = "ab" * (hubmod.MAILBOX_FRAME_LIMIT_BYTES + 1)
    refused = await _post_letter(relay, node.node_id, oversized)
    assert refused.status_code == 413
    assert hubmod.hub.letter_count == 0


async def test_an_overflowing_box_drops_the_oldest(
    relay: str, node: Node, monkeypatch
) -> None:
    monkeypatch.setattr(hubmod, "MAILBOX_MAX_LETTERS", 3)
    for i in range(5):
        assert (await _post_letter(relay, node.node_id, f"0{i}")).status_code == 202
    assert hubmod.hub.letter_count == 3

    control = await _register(relay, node)
    try:
        kept = [
            json.loads(await asyncio.wait_for(control.recv(), 5))["frame"] for _ in range(3)
        ]
        assert kept == ["02", "03", "04"]
    finally:
        await control.close()


async def test_a_stale_letter_is_never_handed_over(
    relay: str, node: Node, monkeypatch
) -> None:
    monkeypatch.setattr(hubmod, "MAILBOX_LETTER_TTL_S", 0.05)
    assert (await _post_letter(relay, node.node_id, "0badc0de")).status_code == 202
    await asyncio.sleep(0.2)

    control = await _register(relay, node)
    try:
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(control.recv(), 0.5)
    finally:
        await control.close()


async def test_a_flood_of_letters_from_one_address_stops(
    relay: str, node: Node, monkeypatch
) -> None:
    monkeypatch.setattr(hubmod, "MAILBOX_RATE_MAX", 3)
    for _ in range(3):
        posted = await _post_letter(relay, node.node_id, ip="198.51.100.4")
        assert posted.status_code == 202
    refused = await _post_letter(relay, node.node_id, ip="198.51.100.4")
    assert refused.status_code == 429


async def test_the_relay_refuses_to_become_a_warehouse(
    relay: str, node: Node, monkeypatch
) -> None:
    monkeypatch.setattr(hubmod, "MAILBOX_MAX_BOXES", 1)
    assert (await _post_letter(relay, "b" * 32, "0badc0de")).status_code == 202

    control = await _register(relay, node)
    try:
        # Відмова однакова й для того, хто вдома: місце міряємо до перевірки присутності.
        assert (await _post_letter(relay, node.node_id, "0badc0de")).status_code == 503
    finally:
        await control.close()
    assert hubmod.hub.mailbox_count == 1


async def test_health_counts_letters_without_naming_anyone(relay: str, node: Node) -> None:
    other = Node(ed25519.Ed25519PrivateKey.generate())
    await _post_letter(relay, node.node_id, "0badc0de")
    await _post_letter(relay, other.node_id, "0badc0de")

    async with _http(relay) as client:
        health = await client.get("/relay/health")
    assert health.status_code == 200
    assert health.json()["mailboxes"] == 2
    assert health.json()["letters"] == 2
    assert node.node_id not in health.text
    assert other.node_id not in health.text
