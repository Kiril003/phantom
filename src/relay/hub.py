"""Реєстр вузлів, зшивання сокетів і скриньки для тих, хто не застав адресата.

Сліпий: бачить лише байти TLS і непрозорі кадри, які возить далі не читаючи.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import os
import secrets
import time
from collections import deque
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

#: Стеля кадру така сама, як у приймальні вузла (messenger/guard.py): текст — це сотні байтів.
MAILBOX_FRAME_LIMIT_BYTES = int(os.environ.get("RELAY_MAILBOX_FRAME_LIMIT_BYTES", str(64 * 1024)))
MAILBOX_MAX_LETTERS = int(os.environ.get("RELAY_MAILBOX_MAX_LETTERS", "200"))
MAILBOX_MAX_BOXES = int(os.environ.get("RELAY_MAILBOX_MAX_BOXES", "1024"))
MAILBOX_LETTER_TTL_S = float(os.environ.get("RELAY_MAILBOX_LETTER_TTL_S", "86400"))
MAILBOX_RATE_WINDOW_S = float(os.environ.get("RELAY_MAILBOX_RATE_WINDOW_S", "60"))
MAILBOX_RATE_MAX = int(os.environ.get("RELAY_MAILBOX_RATE_MAX", "30"))
MAILBOX_REPLY_ADDRESS_MAX = 256


class RelayError(Exception):
    # code — код закриття сокета, а для скриньки (вона живе на POST) код HTTP.
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


def check_node_id(value: str) -> str:
    # Незнайомий node_id ключем у пам'яті стає лише коли він схожий на справжній.
    if len(value) != NODE_ID_LEN or any(c not in "0123456789abcdef" for c in value):
        raise RelayError("bad node id", code=400)
    return value


def check_frame(frame: str) -> None:
    """Розмір і те, що це hex. Всередину не заглядаємо — там не наше."""
    if len(frame) > 2 * MAILBOX_FRAME_LIMIT_BYTES:
        raise RelayError("frame too large", code=413)
    try:
        size = len(bytes.fromhex(frame))
    except ValueError as exc:
        raise RelayError("frame is not hex", code=400) from exc
    if size == 0:
        raise RelayError("empty frame", code=400)
    if size > MAILBOX_FRAME_LIMIT_BYTES:
        raise RelayError("frame too large", code=413)


@dataclass
class Letter:
    frame: str
    from_node_id: str
    reply_address: Optional[str]
    created_at: float = field(default_factory=time.monotonic)

    def is_expired(self, now: Optional[float] = None) -> bool:
        now = now if now is not None else time.monotonic()
        return (now - self.created_at) > MAILBOX_LETTER_TTL_S

    def as_message(self) -> dict:
        return {
            "t": "mailbox",
            "frame": self.frame,
            "from_node_id": self.from_node_id,
            "reply_address": self.reply_address,
        }


def _bump_hits(
    hits: dict[str, list[float]], key: str, now: float, window: float, limit: int
) -> bool:
    fresh = [t for t in hits.get(key, []) if now - t < window]
    if len(fresh) >= limit:
        hits[key] = fresh
        return False
    fresh.append(now)
    hits[key] = fresh
    return True


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


async def _send_quietly(node: Node, message: dict) -> bool:
    # Вузол міг відпасти між перевіркою і відправкою — тоді лист лягає у скриньку.
    try:
        async with node.send_lock:
            await node.socket.send_json(message)
        return True
    except Exception:
        return False


class RelayHub:
    def __init__(self) -> None:
        self._nodes: dict[str, Node] = {}
        self._tickets: dict[str, Ticket] = {}
        self._ip_hits: dict[str, list[float]] = {}
        self._ip_sessions: dict[str, int] = {}
        self._mailboxes: dict[str, deque[Letter]] = {}
        self._mail_hits: dict[str, list[float]] = {}
        self._lock = asyncio.Lock()

    @property
    def node_count(self) -> int:
        return len(self._nodes)

    @property
    def session_count(self) -> int:
        return sum(n.sessions for n in self._nodes.values())

    @property
    def mailbox_count(self) -> int:
        return len(self._mailboxes)

    @property
    def letter_count(self) -> int:
        return sum(len(box) for box in self._mailboxes.values())

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
        return _bump_hits(self._ip_hits, ip, now, IP_RATE_WINDOW_S, IP_RATE_MAX)

    def _mail_rate_ok_locked(self, ip: str, now: float) -> bool:
        return _bump_hits(self._mail_hits, ip, now, MAILBOX_RATE_WINDOW_S, MAILBOX_RATE_MAX)

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

    def _prune_mail_locked(self, now: float) -> None:
        for node_id in list(self._mailboxes):
            box = self._mailboxes[node_id]
            while box and box[0].is_expired(now):
                box.popleft()
            if not box:
                self._mailboxes.pop(node_id, None)
        for ip in [i for i, hits in self._mail_hits.items() if not hits]:
            self._mail_hits.pop(ip, None)

    async def post_letter(
        self,
        node_id: str,
        frame: str,
        from_node_id: str,
        reply_address: Optional[str],
        sender_ip: str,
    ) -> None:
        check_node_id(node_id)
        check_node_id(from_node_id)
        check_frame(frame)
        if reply_address is not None and len(reply_address) > MAILBOX_REPLY_ADDRESS_MAX:
            raise RelayError("reply address too long", code=400)

        letter = Letter(frame=frame, from_node_id=from_node_id, reply_address=reply_address)
        now = time.monotonic()
        async with self._lock:
            self._prune_mail_locked(now)
            if not self._mail_rate_ok_locked(sender_ip, now):
                raise RelayError("too many letters", code=429)
            # Місце під скриньку міряємо ДО того, як дивитись, чи адресат на місці:
            # інакше відмова на переповненні розказала б відправнику про присутність.
            if node_id not in self._mailboxes and len(self._mailboxes) >= MAILBOX_MAX_BOXES:
                raise RelayError("mailbox store full", code=503)
            node = self._nodes.get(node_id)

        if node is not None and await _send_quietly(node, letter.as_message()):
            return

        async with self._lock:
            # Замок відпускали на час доставки — місце могли зайняти без нас.
            if node_id not in self._mailboxes and len(self._mailboxes) >= MAILBOX_MAX_BOXES:
                raise RelayError("mailbox store full", code=503)
            box = self._mailboxes.setdefault(node_id, deque())
            box.append(letter)
            # Переповнення жертвує найстарішим: свіже слово потрібніше за вчорашнє.
            while len(box) > MAILBOX_MAX_LETTERS:
                box.popleft()

    async def flush_mailbox(self, node_id: str, socket: Any) -> int:
        now = time.monotonic()
        async with self._lock:
            node = self._nodes.get(node_id)
            if node is None or node.socket is not socket:
                return 0
            box = self._mailboxes.pop(node_id, None)
        if box is None:
            return 0
        letters = [letter for letter in box if not letter.is_expired(now)]
        async with node.send_lock:
            for letter in letters:
                await node.socket.send_json(letter.as_message())
        return len(letters)

    async def claim_ticket(self, raw: str) -> Ticket:
        async with self._lock:
            ticket = self._tickets.get(raw)
            if ticket is None or ticket.is_expired():
                raise RelayError("unknown ticket", code=4404)
            if ticket.node_socket.done():
                raise RelayError("ticket already used", code=4409)
            return ticket


hub = RelayHub()
