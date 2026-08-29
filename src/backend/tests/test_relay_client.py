"""Вузол дзвонить на ретранслятор сам і возить байти у власний слухач."""
from __future__ import annotations

import asyncio
import contextlib
import socket
import sys
import threading
import time
from pathlib import Path

import pytest
from websockets.asyncio.client import connect

_RELAY_DIR = Path(__file__).resolve().parents[2] / "relay"

from node.relay_client import RelayClient, public_base  # noqa: E402


def _load_relay():
    """Модулі ретранслятора звуться так само, як бекендні — вантажу за шляхом."""
    import importlib.util

    def load(name: str, filename: str):
        if name in sys.modules:
            return sys.modules[name]
        spec = importlib.util.spec_from_file_location(name, _RELAY_DIR / filename)
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
        return module

    hub_module = load("hub", "hub.py")
    return hub_module, load("relay_main", "main.py")


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@pytest.fixture(scope="module")
def relay():
    import uvicorn

    hubmod, relay_main = _load_relay()

    port = _free_port()
    config = uvicorn.Config(relay_main.app, host="127.0.0.1", port=port, log_level="error")
    server = uvicorn.Server(config)
    server.install_signal_handlers = lambda: None
    thread = threading.Thread(target=server.run, daemon=True, name="relay-under-test")
    thread.start()
    deadline = time.monotonic() + 10
    while not server.started and time.monotonic() < deadline:
        time.sleep(0.02)
    assert server.started
    try:
        yield f"ws://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(timeout=5)
        hubmod.hub._nodes.clear()
        hubmod.hub._tickets.clear()


@pytest.fixture
async def echo():
    """Стоїть замість власного шифрованого слухача вузла."""

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            while True:
                chunk = await reader.read(4096)
                if not chunk:
                    return
                writer.write(b"echo:" + chunk)
                await writer.drain()
        finally:
            writer.close()

    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    host, port = server.sockets[0].getsockname()[:2]
    async with server:
        yield (host, port)


async def _wait_connected(client: RelayClient, timeout: float = 10.0) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        if client.connected:
            return
        await asyncio.sleep(0.05)
    raise AssertionError(f"вузол не дійшов до ретранслятора: {client.status()}")


def test_public_base_turns_a_socket_url_into_an_address() -> None:
    assert public_base("wss://relay.example") == "https://relay.example"
    assert public_base("ws://127.0.0.1:8787/") == "http://127.0.0.1:8787"


def test_node_id_is_stable_across_instances(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("PHANTOM_DATA_DIR", str(tmp_path))
    first = RelayClient("ws://unused", lambda: None).node_id
    second = RelayClient("ws://unused", lambda: None).node_id
    assert first == second
    assert len(first) == 32


async def test_the_node_registers_and_carries_bytes_home(relay: str, echo) -> None:
    client = RelayClient(relay, lambda: echo)
    await client.start()
    try:
        await _wait_connected(client)
        assert client.status()["connected"] is True

        phone = await connect(f"{relay}/relay/client?node_id={client.node_id}")
        try:
            await phone.send(b"hello-from-the-outside")
            assert await asyncio.wait_for(phone.recv(), 10) == b"echo:hello-from-the-outside"
        finally:
            await phone.close()
    finally:
        await client.stop()


async def test_two_phones_get_independent_pipes(relay: str, echo) -> None:
    client = RelayClient(relay, lambda: echo)
    await client.start()
    try:
        await _wait_connected(client)
        first = await connect(f"{relay}/relay/client?node_id={client.node_id}")
        second = await connect(f"{relay}/relay/client?node_id={client.node_id}")
        try:
            await first.send(b"one")
            await second.send(b"two")
            assert await asyncio.wait_for(first.recv(), 10) == b"echo:one"
            assert await asyncio.wait_for(second.recv(), 10) == b"echo:two"
        finally:
            await first.close()
            await second.close()
    finally:
        await client.stop()


async def test_without_a_local_listener_no_session_is_served(relay: str) -> None:
    client = RelayClient(relay, lambda: None)
    await client.start()
    try:
        await _wait_connected(client)
        phone = await connect(f"{relay}/relay/client?node_id={client.node_id}")
        try:
            with pytest.raises(Exception):
                await asyncio.wait_for(phone.recv(), 12)
        finally:
            await phone.close()
    finally:
        await client.stop()


async def test_a_dead_relay_does_not_kill_the_node(echo) -> None:
    client = RelayClient(f"ws://127.0.0.1:{_free_port()}", lambda: echo)
    await client.start()
    try:
        await asyncio.sleep(1.5)
        assert client.connected is False
        assert client.status()["last_error"]
    finally:
        await client.stop()


class _OneShotWs:
    """Сокет, що видихає готовий перелік рядків і замовкає."""

    def __init__(self, frames: list[str]) -> None:
        self._frames = list(frames)

    def __aiter__(self) -> "_OneShotWs":
        return self

    async def __anext__(self) -> str:
        if not self._frames:
            raise StopAsyncIteration
        return self._frames.pop(0)


async def test_a_mailbox_letter_is_held_until_it_lands(monkeypatch) -> None:
    """Задачу листа тримає сам вузол — інакше збирач сміття зʼїсть її на льоту."""
    import gc
    import json

    import node.relay_client as relay_client

    delivered = asyncio.Event()
    seen: list[dict] = []

    async def slow_accept(message: dict) -> None:
        await asyncio.sleep(0.05)
        seen.append(message)
        delivered.set()

    monkeypatch.setattr(relay_client, "_accept_mailbox", slow_accept)

    client = RelayClient("ws://unused", lambda: None)
    await client._serve(_OneShotWs([json.dumps({"t": "mailbox", "frame": "0a0b"})]))

    assert len(client._mailbox) == 1
    gc.collect()

    await asyncio.wait_for(delivered.wait(), 5)
    assert seen == [{"t": "mailbox", "frame": "0a0b"}]
    await asyncio.sleep(0)
    assert client._mailbox == set()


async def test_stopping_the_node_lets_go_of_pending_letters(monkeypatch) -> None:
    """Зупинка вузла не лишає по собі підвішених задач зі скриньки."""
    import json

    import node.relay_client as relay_client

    async def never_ending(message: dict) -> None:
        await asyncio.Event().wait()

    monkeypatch.setattr(relay_client, "_accept_mailbox", never_ending)

    client = RelayClient("ws://unused", lambda: None)
    await client._serve(_OneShotWs([json.dumps({"t": "mailbox", "frame": "ff"})]))
    letter = next(iter(client._mailbox))

    await client.stop()
    with contextlib.suppress(asyncio.CancelledError):
        await letter
    await asyncio.sleep(0)
    assert letter.cancelled()
    assert client._mailbox == set()
