"""Шифрований слухач на мережевих адресах. Відкритий HTTP лишається на
loopback, тож у мережу відкритим текстом не йде нічого, а порт — той самий."""
from __future__ import annotations

import asyncio
import ipaddress
import logging
import socket
from typing import Any, Optional

logger = logging.getLogger(__name__)

_SKIP_IFACE_PREFIXES = ("lo", "docker", "br-", "veth", "virbr", "tun", "tap")
_REBIND_CHECK_S = 20.0


def lan_addresses() -> list[str]:
    try:
        import psutil
    except ImportError:
        return []
    out: list[str] = []
    for name, addrs in psutil.net_if_addrs().items():
        if name.startswith(_SKIP_IFACE_PREFIXES):
            continue
        for a in addrs:
            if getattr(a.family, "name", "") != "AF_INET":
                continue
            try:
                ip = ipaddress.ip_address(a.address)
            except ValueError:
                continue
            if ip.is_loopback or ip.is_link_local:
                continue
            out.append(a.address)
    return sorted(set(out))


class TlsListener:
    def __init__(self, app: Any, port: int, cert: str, key: str) -> None:
        self._app = app
        self._port = port
        self._cert = cert
        self._key = key
        self._server: Optional[Any] = None
        self._task: Optional[asyncio.Task] = None
        self._watch: Optional[asyncio.Task] = None
        self._bound: list[str] = []

    @property
    def bound(self) -> list[str]:
        return list(self._bound)

    @property
    def port(self) -> int:
        return self._port

    def _sockets(self, hosts: list[str]) -> list[socket.socket]:
        made: list[socket.socket] = []
        for host in hosts:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind((host, self._port))
                s.listen(2048)
                s.set_inheritable(True)
            except OSError as exc:
                s.close()
                logger.warning("TLS: %s:%d не зайняти (%s)", host, self._port, exc)
                continue
            made.append(s)
            self._bound.append(host)
        return made

    async def start(self) -> None:
        import uvicorn

        hosts = lan_addresses()
        if not hosts:
            raise RuntimeError("мережевих адрес немає")
        self._bound = []
        sockets = self._sockets(hosts)
        if not sockets:
            raise RuntimeError(f"порт {self._port} зайнятий на всіх адресах")

        config = uvicorn.Config(
            self._app,
            ssl_certfile=self._cert,
            ssl_keyfile=self._key,
            lifespan="off",
            log_level="warning",
            access_log=False,
        )
        self._server = uvicorn.Server(config)
        self._server.install_signal_handlers = lambda: None
        self._task = asyncio.create_task(
            self._server.serve(sockets=sockets), name="tls_listener"
        )
        await self._wait_until_up()
        logger.info("TLS: %s на порту %d", ", ".join(self._bound), self._port)
        self._watch = asyncio.create_task(self._rebind_loop(), name="tls_rebind")

    async def _wait_until_up(self, timeout_s: float = 10.0) -> None:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout_s
        while loop.time() < deadline:
            if self._task is not None and self._task.done():
                exc = self._task.exception()
                if isinstance(exc, SystemExit):
                    raise RuntimeError(f"порт {self._port} зайнятий") from None
                raise exc if exc else RuntimeError("слухач стих одразу")
            if getattr(self._server, "started", False):
                return
            await asyncio.sleep(0.1)
        raise TimeoutError(f"слухач на :{self._port} не піднявся")

    async def _rebind_loop(self) -> None:
        while True:
            await asyncio.sleep(_REBIND_CHECK_S)
            try:
                if lan_addresses() == self._bound:
                    continue
                logger.info("TLS: адреси змінились — перепідключаюсь")
                await self._stop_server()
                await self.start()
                return
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("TLS: перепідключення не вдалось (%s)", exc)

    async def _stop_server(self) -> None:
        if self._server is not None:
            self._server.should_exit = True
        if self._task is not None:
            try:
                await asyncio.wait_for(asyncio.shield(self._task), timeout=3.0)
            except (asyncio.TimeoutError, asyncio.CancelledError, Exception):
                self._task.cancel()
        self._bound = []

    async def stop(self) -> None:
        if self._watch is not None:
            self._watch.cancel()
        await self._stop_server()


async def start_tls_listener(app: Any) -> Optional[TlsListener]:
    import os

    from config import config

    port = int(getattr(config, "pair_tls_port", 0) or 0)
    if not port:
        return None
    if port == int(getattr(config, "port", 0) or 0):
        # Ми стоїмо в lifespan, uvicorn свій сокет ще не відкрив. Сісти на
        # LAN-адресу цього ж порту — значить забрати його в самого себе.
        logger.error(
            "TLS: pair_tls_port збігається з port (%d) — слухач не піднімаю, "
            "інакше uvicorn не стартує. Постав PAIR_TLS_PORT окремо (8443).",
            port,
        )
        return None
    if os.environ.get("PYTEST_CURRENT_TEST") or os.environ.get("PHANTOM_SKIP_TLS"):
        return None

    from security.tls_identity import ensure_node_cert

    cert, key = await asyncio.to_thread(ensure_node_cert, lan_addresses())
    listener = TlsListener(app, port, str(cert), str(key))
    await listener.start()
    return listener


__all__ = ["TlsListener", "start_tls_listener", "lan_addresses"]
