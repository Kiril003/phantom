"""Реєстр вузлів і зшивання сокетів. Сліпий: бачить лише байти TLS."""
from __future__ import annotations

import asyncio
import base64
import hashlib
import os
import secrets
import time
from dataclasses import dataclass, field
from typing import Any, Optional

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric import ed25519

NODE_CHALLENGE_CONTEXT = b"phantom-relay-node-v1"
NODE_ID_LEN = 32

MAX_NODES = int(os.environ.get("RELAY_MAX_NODES", "512"))
MAX_SESSIONS_PER_NODE = int(os.environ.get("RELAY_MAX_SESSIONS_PER_NODE", "64"))
MAX_SESSIONS_PER_IP = int(os.environ.get("RELAY_MAX_SESSIONS_PER_IP", "32"))
IP_RATE_WINDOW_S = float(os.environ.get("RELAY_IP_RATE_WINDOW_S", "60"))
IP_RATE_MAX = int(os.environ.get("RELAY_IP_RATE_MAX", "60"))
TICKET_TTL_S = float(os.environ.get("RELAY_TICKET_TTL_S", "15"))
HANDSHAKE_TIMEOUT_S = float(os.environ.get("RELAY_HANDSHAKE_TIMEOUT_S", "10"))


class RelayError(Exception):
    def __init__(self, message: str, *, code: int) -> None:
        super().__init__(message)
        self.code = code


def node_id_for(pub_raw: bytes) -> str:
    return hashlib.sha256(pub_raw).hexdigest()[:NODE_ID_LEN]


def verify_node_hello(nonce: bytes, pub_b64: str, sig_b64: str) -> str:
    try:
        pub_raw = base64.b64decode(pub_b64, validate=True)
        sig_raw = base64.b64decode(sig_b64, validate=True)
    except Exception as exc:
        raise RelayError("bad base64", code=4400) from exc
    if len(pub_raw) != 32:
        raise RelayError("bad pubkey length", code=4400)
    try:
        ed25519.Ed25519PublicKey.from_public_bytes(pub_raw).verify(
            sig_raw, NODE_CHALLENGE_CONTEXT + nonce
        )
    except (InvalidSignature, ValueError) as exc:
        raise RelayError("bad signature", code=4401) from exc
    return node_id_for(pub_raw)


@dataclass
class Ticket:
    ticket: str
    node_id: str
    client_ip: str
    created_at: float = field(default_factory=time.monotonic)
    node_socket: asyncio.Future = field(default_factory=asyncio.Future)
    finished: asyncio.Event = field(default_factory=asyncio.Event)

    def is_expired(self, now: Optional[float] = None) -> bool:
        now = now if now is not None else time.monotonic()
        return (now - self.created_at) > TICKET_TTL_S


@dataclass
class Node:
    node_id: str
    socket: Any
    connected_at: float = field(default_factory=time.monotonic)
    sessions: int = 0
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class RelayHub:
    def __init__(self) -> None:
        self._nodes: dict[str, Node] = {}
        self._tickets: dict[str, Ticket] = {}
        self._ip_hits: dict[str, list[float]] = {}
        self._ip_sessions: dict[str, int] = {}
        self._lock = asyncio.Lock()

    @property
    def node_count(self) -> int:
        return len(self._nodes)

    @property
    def session_count(self) -> int:
        return sum(n.sessions for n in self._nodes.values())

    async def register_node(self, node_id: str, socket: Any) -> Optional[Any]:
        async with self._lock:
            if node_id not in self._nodes and len(self._nodes) >= MAX_NODES:
                raise RelayError("relay full", code=4503)
            previous = self._nodes.get(node_id)
            self._nodes[node_id] = Node(node_id=node_id, socket=socket)
            return previous.socket if previous is not None else None

    async def unregister_node(self, node_id: str, socket: Any) -> None:
        async with self._lock:
            current = self._nodes.get(node_id)
            if current is not None and current.socket is socket:
                self._nodes.pop(node_id, None)

    async def node_socket(self, node_id: str) -> Optional[Any]:
        async with self._lock:
            node = self._nodes.get(node_id)
            return node.socket if node is not None else None

    async def notify_open(self, node_id: str, ticket: str) -> None:
        async with self._lock:
            node = self._nodes.get(node_id)
        if node is None:
            raise RelayError("node offline", code=4404)
        async with node.send_lock:
            await node.socket.send_json({"t": "open", "ticket": ticket})

    async def notify_ping(self, node_id: str, socket: Any) -> None:
        async with self._lock:
            node = self._nodes.get(node_id)
        if node is None or node.socket is not socket:
            raise RelayError("node gone", code=4404)
        async with node.send_lock:
            await node.socket.send_json({"t": "ping"})

    def _rate_ok_locked(self, ip: str, now: float) -> bool:
        hits = [t for t in self._ip_hits.get(ip, []) if now - t < IP_RATE_WINDOW_S]
        if len(hits) >= IP_RATE_MAX:
            self._ip_hits[ip] = hits
            return False
        hits.append(now)
        self._ip_hits[ip] = hits
        return True

    def _prune_locked(self, now: float) -> None:
        for key in [t for t, tk in self._tickets.items() if tk.is_expired(now)]:
            self._tickets.pop(key, None)
        for ip in [i for i, hits in self._ip_hits.items() if not hits]:
            self._ip_hits.pop(ip, None)

    async def open_ticket(self, node_id: str, client_ip: str) -> Ticket:
        now = time.monotonic()
        async with self._lock:
            self._prune_locked(now)
            node = self._nodes.get(node_id)
            if node is None:
                raise RelayError("node offline", code=4404)
            if not self._rate_ok_locked(client_ip, now):
                raise RelayError("too many attempts", code=4429)
            if node.sessions >= MAX_SESSIONS_PER_NODE:
                raise RelayError("node session limit", code=4429)
            if self._ip_sessions.get(client_ip, 0) >= MAX_SESSIONS_PER_IP:
                raise RelayError("ip session limit", code=4429)
            ticket = Ticket(
                ticket=secrets.token_urlsafe(32),
                node_id=node_id,
                client_ip=client_ip,
            )
            self._tickets[ticket.ticket] = ticket
            node.sessions += 1
            self._ip_sessions[client_ip] = self._ip_sessions.get(client_ip, 0) + 1
            return ticket

    async def close_ticket(self, ticket: Ticket) -> None:
        async with self._lock:
            self._tickets.pop(ticket.ticket, None)
            node = self._nodes.get(ticket.node_id)
            if node is not None and node.sessions > 0:
                node.sessions -= 1
            left = self._ip_sessions.get(ticket.client_ip, 0) - 1
            if left > 0:
                self._ip_sessions[ticket.client_ip] = left
            else:
                self._ip_sessions.pop(ticket.client_ip, None)
        ticket.finished.set()

    async def claim_ticket(self, raw: str) -> Ticket:
        async with self._lock:
            ticket = self._tickets.get(raw)
            if ticket is None or ticket.is_expired():
                raise RelayError("unknown ticket", code=4404)
            if ticket.node_socket.done():
                raise RelayError("ticket already used", code=4409)
            return ticket


hub = RelayHub()
