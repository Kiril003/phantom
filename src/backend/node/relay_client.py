"""Вузол сам дзвонить на ретранслятор, тож NAT і фаєрвол ролі не грають."""
from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import logging
import ssl
from typing import Any, Callable, Optional
from urllib.parse import urlsplit

from node.identity import node_id, public_b64, sign_relay_challenge

logger = logging.getLogger(__name__)

_BACKOFF_START_S = 1.0
_BACKOFF_MAX_S = 60.0
_HELLO_TIMEOUT_S = 10.0
_MAX_SESSIONS = 64
_CHUNK = 64 * 1024


def _ws_base(url: str) -> str:
    raw = (url or "").strip().rstrip("/")
    if raw.startswith("https://"):
        return "wss://" + raw[len("https://"):]
    if raw.startswith("http://"):
        return "ws://" + raw[len("http://"):]
    return raw


def public_base(url: str) -> str:
    raw = (url or "").strip().rstrip("/")
    if raw.startswith("wss://"):
        return "https://" + raw[len("wss://"):]
    if raw.startswith("ws://"):
        return "http://" + raw[len("ws://"):]
    return raw


class RelayClient:
    def __init__(
        self,
        relay_url: str,
        local_target: Callable[[], Optional[tuple[str, int]]],
    ) -> None:
        self._url = _ws_base(relay_url)
        self._local_target = local_target
        self._task: Optional[asyncio.Task] = None
        self._sessions: set[asyncio.Task] = set()
        self._mailbox: set[asyncio.Task] = set()
        self._connected = False
        self._stopping = False
        self._last_error = ""

    @property
    def connected(self) -> bool:
        return self._connected

    @property
    def node_id(self) -> str:
        return node_id()

    @property
    def relay_url(self) -> str:
        return self._url

    def status(self) -> dict[str, Any]:
        return {
            "connected": self._connected,
            "node_id": self.node_id,
            "relay": public_base(self._url),
            "sessions": len(self._sessions),
            "last_error": self._last_error,
        }

    async def start(self) -> None:
        if self._task is not None:
            return
        self._stopping = False
        self._task = asyncio.create_task(self._control_loop(), name="relay_control")

    async def stop(self) -> None:
        self._stopping = True
        for task in list(self._sessions) + list(self._mailbox):
            task.cancel()
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._task
            self._task = None
        self._connected = False

    def _ssl_context(self) -> Optional[ssl.SSLContext]:
        return ssl.create_default_context() if self._url.startswith("wss://") else None

    async def _control_loop(self) -> None:
        from websockets.asyncio.client import connect

        backoff = _BACKOFF_START_S
        while not self._stopping:
            try:
                async with connect(
                    f"{self._url}/relay/node",
                    ssl=self._ssl_context(),
                    open_timeout=_HELLO_TIMEOUT_S,
                    ping_interval=20,
                    ping_timeout=20,
                    max_size=None,
                ) as ws:
                    await self._handshake(ws)
                    self._connected = True
                    self._last_error = ""
                    backoff = _BACKOFF_START_S
                    logger.info(
                        "ретранслятор: вузол %s на %s",
                        self.node_id,
                        public_base(self._url),
                    )
                    await self._serve(ws)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                reason = str(exc) or exc.__class__.__name__
                # Та сама причина щохвилини — це шум, а не новина.
                level = logging.DEBUG if reason == self._last_error else logging.INFO
                self._last_error = reason
                logger.log(level, "ретранслятор недоступний (%s)", reason)
            self._connected = False
            if self._stopping:
                return
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, _BACKOFF_MAX_S)

    async def _handshake(self, ws: Any) -> None:
        challenge = json.loads(await asyncio.wait_for(ws.recv(), _HELLO_TIMEOUT_S))
        if challenge.get("t") != "challenge":
            raise RuntimeError(f"неочікуване вітання: {challenge!r}")
        nonce = base64.b64decode(challenge["nonce"])
        await ws.send(
            json.dumps(
                {
                    "t": "hello",
                    "pub": public_b64(),
                    "sig": sign_relay_challenge(nonce),
                }
            )
        )
        ready = json.loads(await asyncio.wait_for(ws.recv(), _HELLO_TIMEOUT_S))
        if ready.get("t") != "ready":
            raise RuntimeError(f"ретранслятор не пустив: {ready!r}")

    async def _serve(self, ws: Any) -> None:
        async for raw in ws:
            try:
                message = json.loads(raw)
            except (TypeError, ValueError):
                continue
            kind = message.get("t")
            if kind == "mailbox":
                # Лист, який ретранслятор притримав, поки нас не було в мережі.
                # Розбирати його тут нічим: вміст зашифрований, і ретранслятор
                # його теж не бачив. Просто передаємо в приймальню месенджера.
                # Посилання тримаємо самі: цикл подій тримає задачі слабко,
                # і збирач сміття здатен зжерти лист до того, як він ляже.
                letter = asyncio.create_task(
                    _accept_mailbox(message), name="relay_mailbox"
                )
                self._mailbox.add(letter)
                letter.add_done_callback(self._mailbox.discard)
                continue
            if kind != "open":
                continue
            ticket = str(message.get("ticket", ""))
            if not ticket or len(self._sessions) >= _MAX_SESSIONS:
                continue
            task = asyncio.create_task(self._session(ticket), name="relay_session")
            self._sessions.add(task)
            task.add_done_callback(self._sessions.discard)

    async def _session(self, ticket: str) -> None:
        from websockets.asyncio.client import connect

        target = self._local_target()
        if target is None:
            logger.warning("ретранслятор: власного шифрованого слухача немає")
            return
        try:
            async with connect(
                f"{self._url}/relay/node/session?ticket={ticket}",
                ssl=self._ssl_context(),
                open_timeout=_HELLO_TIMEOUT_S,
                ping_interval=20,
                ping_timeout=20,
                max_size=None,
            ) as ws:
                reader, writer = await asyncio.open_connection(target[0], target[1])
                try:
                    await self._pump(ws, reader, writer)
                finally:
                    writer.close()
                    with contextlib.suppress(Exception):
                        await writer.wait_closed()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.debug("сесія ретранслятора обірвалась: %s", exc)

    async def _pump(self, ws: Any, reader: Any, writer: Any) -> None:
        up = asyncio.create_task(self._ws_to_socket(ws, writer))
        down = asyncio.create_task(self._socket_to_ws(reader, ws))
        _, pending = await asyncio.wait(
            {up, down}, return_when=asyncio.FIRST_COMPLETED
        )
        for task in pending:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    async def _ws_to_socket(self, ws: Any, writer: Any) -> None:
        with contextlib.suppress(Exception):
            async for frame in ws:
                if isinstance(frame, str):
                    frame = frame.encode("utf-8")
                writer.write(frame)
                await writer.drain()

    async def _socket_to_ws(self, reader: Any, ws: Any) -> None:
        with contextlib.suppress(Exception):
            while True:
                chunk = await reader.read(_CHUNK)
                if not chunk:
                    return
                await ws.send(chunk)


_client: Optional[RelayClient] = None


def current() -> Optional[RelayClient]:
    return _client


async def _accept_mailbox(message: dict[str, Any]) -> None:
    """Кладе лист зі скриньки ретранслятора у стрічку власника."""
    frame_hex = str(message.get("frame", ""))
    if not frame_hex:
        return
    try:
        from sqlalchemy import select

        from api.routes_messenger import _keys
        from db.database import AsyncSessionLocal
        from db.models import User
        from messenger.inbox import accept_frame

        async with AsyncSessionLocal() as session:
            owner = (
                await session.execute(select(User.id).order_by(User.id))
            ).scalars().first()
            if owner is None:
                return
            await accept_frame(
                session,
                _keys(),
                owner,
                bytes.fromhex(frame_hex),
                message.get("from_node_id"),
                reply_address=message.get("reply_address"),
                road="mailbox",
            )
    except Exception as exc:  # noqa: BLE001 — чужий лист не має валити зʼєднання
        logger.info("лист зі скриньки не прийнявся: %s", exc)


async def start_relay_client(app: Any) -> Optional[RelayClient]:
    global _client

    import os

    from config import config

    if os.environ.get("PYTEST_CURRENT_TEST") or os.environ.get("PHANTOM_SKIP_RELAY"):
        return None
    if not bool(getattr(config, "relay_enabled", False)):
        return None
    url = (getattr(config, "relay_url", "") or "").strip()
    if not url:
        return None

    def target() -> Optional[tuple[str, int]]:
        listener = getattr(app.state, "tls_listener", None)
        if listener is None or not listener.bound:
            return None
        return listener.bound[0], listener.port

    _client = RelayClient(url, target)
    await _client.start()
    return _client


async def stop_relay_client() -> None:
    global _client

    if _client is not None:
        await _client.stop()
        _client = None


__all__ = [
    "RelayClient",
    "current",
    "public_base",
    "start_relay_client",
    "stop_relay_client",
]
