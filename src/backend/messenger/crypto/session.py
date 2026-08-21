"""Фасад сесії: назовні видно тільки encrypt(bytes) -> bytes і decrypt(bytes) -> bytes.

Кадр:
    "PHM1" | тип(1) | [преамбула(169), лише для типу prekey] | заголовок(40) | шифротекст

Преамбула їде доти, доки ініціатор не почує відповідь: до того моменту він не
знає, чи отримувач уже звів сесію, а без преамбули X3DH не відтворити. Увесь
префікс кадру входить в AAD, тому зрізати чи підмінити преамбулу по дорозі не
вийде — тег не зійдеться.
"""
from __future__ import annotations

import json
import os
import struct
from typing import Optional

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from messenger.crypto.keys import KEY_LEN, KeyStore, PublicBundle, SIG_LEN
from messenger.crypto.ratchet import DoubleRatchet
from messenger.crypto.x3dh import InitialMessage, initiate, respond

__all__ = [
    "MAGIC",
    "PREAMBLE_LEN",
    "Session",
    "SessionError",
    "TYPE_MESSAGE",
    "TYPE_PREKEY",
]

MAGIC = b"PHM1"
TYPE_PREKEY = 0x01
TYPE_MESSAGE = 0x02

_STATE_MAGIC = b"PHS1"
_STATE_VERSION = 1
_STATE_NONCE_LEN = 12
_STATE_INFO = b"phantom-messenger/session-state/v1"


def _state_key(store: KeyStore) -> bytes:
    """Ключ шифрування стану виводимо з X25519 вузла, а не тримаємо окремо."""
    return HKDF(
        algorithm=hashes.SHA256(), length=32, salt=None, info=_STATE_INFO
    ).derive(store.identity_dh_private.private_bytes_raw())


_TAIL = struct.Struct(">IBI")  # signed_prekey_id, є одноразовий, one_time_prekey_id
PREAMBLE_LEN = KEY_LEN * 3 + SIG_LEN + _TAIL.size
_PREFIX_LEN = len(MAGIC) + 1


class SessionError(Exception):
    """Кадр не належить цій сесії або зіпсований на рівні обгортки."""


def _pack_preamble(initial: InitialMessage) -> bytes:
    has_one_time = initial.one_time_prekey_id is not None
    return (
        initial.identity_ed
        + initial.identity_dh
        + initial.identity_dh_sig
        + initial.ephemeral
        + _TAIL.pack(
            initial.signed_prekey_id,
            1 if has_one_time else 0,
            initial.one_time_prekey_id if has_one_time else 0,
        )
    )


def _unpack_preamble(raw: bytes) -> InitialMessage:
    if len(raw) != PREAMBLE_LEN:
        raise SessionError(f"преамбула мусить бути {PREAMBLE_LEN} байтів")
    cursor = 0

    def take(size: int) -> bytes:
        nonlocal cursor
        chunk = raw[cursor:cursor + size]
        cursor += size
        return chunk

    identity_ed = take(KEY_LEN)
    identity_dh = take(KEY_LEN)
    identity_dh_sig = take(SIG_LEN)
    ephemeral = take(KEY_LEN)
    signed_prekey_id, has_one_time, one_time_prekey_id = _TAIL.unpack(raw[cursor:])
    if has_one_time not in (0, 1):
        raise SessionError("зіпсований прапорець одноразового prekey")
    return InitialMessage(
        identity_ed=identity_ed,
        identity_dh=identity_dh,
        identity_dh_sig=identity_dh_sig,
        ephemeral=ephemeral,
        signed_prekey_id=signed_prekey_id,
        one_time_prekey_id=one_time_prekey_id if has_one_time else None,
    )


def _split(wire: bytes) -> tuple[int, bytes, bytes]:
    if not isinstance(wire, (bytes, bytearray)):
        raise TypeError("кадр мусить бути байтами")
    wire = bytes(wire)
    if len(wire) < _PREFIX_LEN or wire[:len(MAGIC)] != MAGIC:
        raise SessionError("це не кадр месенджера PHANTOM")
    kind = wire[len(MAGIC)]
    if kind == TYPE_MESSAGE:
        return kind, b"", wire[_PREFIX_LEN:]
    if kind == TYPE_PREKEY:
        end = _PREFIX_LEN + PREAMBLE_LEN
        if len(wire) < end:
            raise SessionError("prekey-кадр обірваний на преамбулі")
        return kind, wire[_PREFIX_LEN:end], wire[end:]
    raise SessionError(f"невідомий тип кадру {kind}")


class Session:
    """Одна розмова з одним співрозмовником. Не потокобезпечна."""

    def __init__(
        self,
        ratchet: DoubleRatchet,
        peer_identity_ed: bytes,
        peer_identity_dh: bytes,
        preamble: Optional[bytes] = None,
    ) -> None:
        self._ratchet = ratchet
        self._peer_identity_ed = bytes(peer_identity_ed)
        self._peer_identity_dh = bytes(peer_identity_dh)
        self._preamble = preamble

    @property
    def peer_identity_ed(self) -> bytes:
        return self._peer_identity_ed

    @property
    def peer_identity_dh(self) -> bytes:
        return self._peer_identity_dh

    @property
    def peer_node_id(self) -> str:
        from messenger.crypto.keys import node_id_of

        return node_id_of(self._peer_identity_ed)

    @property
    def established(self) -> bool:
        """True, коли співрозмовник підтвердив сесію відповіддю."""
        return self._preamble is None

    @classmethod
    def initiate(
        cls,
        store: KeyStore,
        bundle: PublicBundle,
        expected_node_id: Optional[str] = None,
    ) -> "Session":
        agreed, initial = initiate(store, bundle, expected_node_id=expected_node_id)
        ratchet = DoubleRatchet.for_initiator(
            agreed.secret, bundle.signed_prekey, agreed.associated_data
        )
        return cls(
            ratchet,
            bundle.identity_ed,
            bundle.identity_dh,
            preamble=_pack_preamble(initial),
        )

    @classmethod
    def accept(cls, store: KeyStore, wire: bytes) -> tuple["Session", bytes]:
        """Приймає перший prekey-кадр і одразу віддає відкритий текст."""
        kind, preamble, body = _split(wire)
        if kind != TYPE_PREKEY:
            raise SessionError("сесія починається з prekey-кадру")
        initial = _unpack_preamble(preamble)
        agreed = respond(store, initial)
        ratchet = DoubleRatchet.for_responder(
            agreed.secret,
            store.signed_prekey_private(initial.signed_prekey_id),
            agreed.associated_data,
        )
        plaintext = ratchet.decrypt(body, aad=_aad_prefix(kind, preamble))
        if initial.one_time_prekey_id is not None:
            store.consume_one_time(initial.one_time_prekey_id)
        session = cls(ratchet, initial.identity_ed, initial.identity_dh)
        return session, plaintext

    def encrypt(self, plaintext: bytes) -> bytes:
        if not isinstance(plaintext, (bytes, bytearray)):
            raise TypeError("шифруємо байти: рядок кодуй сам, щоб не гадати кодування")
        kind = TYPE_PREKEY if self._preamble is not None else TYPE_MESSAGE
        preamble = self._preamble or b""
        prefix = _aad_prefix(kind, preamble)
        return prefix + self._ratchet.encrypt(bytes(plaintext), aad=prefix)

    def decrypt(self, wire: bytes) -> bytes:
        kind, preamble, body = _split(wire)
        if kind == TYPE_PREKEY:
            initial = _unpack_preamble(preamble)
            if initial.identity_ed != self._peer_identity_ed or (
                initial.identity_dh != self._peer_identity_dh
            ):
                raise SessionError("преамбула називає іншу особу, ніж ця сесія")
        plaintext = self._ratchet.decrypt(body, aad=_aad_prefix(kind, preamble))
        # Відповідь дійшла — далі преамбулу можна не тягнути.
        self._preamble = None
        return plaintext

    def serialize(self, store: KeyStore) -> bytes:
        """Стан сесії у вигляді, який можна покласти в базу вузла.

        Блоб шифрується ключем, виведеним з довготривалого X25519 вузла. База
        сама по собі лежить на диску відкритою, тож викрадений файл бази без
        ключів вузла не дає читати листування.
        """
        payload = {
            "v": _STATE_VERSION,
            "peer_ed": self._peer_identity_ed.hex(),
            "peer_dh": self._peer_identity_dh.hex(),
            "preamble": self._preamble.hex() if self._preamble else None,
            "ratchet": self._ratchet.export_state(),
        }
        raw = json.dumps(payload, separators=(",", ":")).encode()
        nonce = os.urandom(_STATE_NONCE_LEN)
        sealed = AESGCM(_state_key(store)).encrypt(nonce, raw, _STATE_MAGIC)
        return _STATE_MAGIC + nonce + sealed

    @classmethod
    def restore(cls, store: KeyStore, blob: bytes) -> "Session":
        if not blob.startswith(_STATE_MAGIC):
            raise SessionError("це не збережений стан сесії")
        nonce = blob[len(_STATE_MAGIC) : len(_STATE_MAGIC) + _STATE_NONCE_LEN]
        body = blob[len(_STATE_MAGIC) + _STATE_NONCE_LEN :]
        try:
            raw = AESGCM(_state_key(store)).decrypt(nonce, body, _STATE_MAGIC)
        except InvalidTag as exc:
            # Або блоб зіпсовано, або він від іншого вузла — читати не можна.
            raise SessionError("стан сесії не розшифровується цим вузлом") from exc
        payload = json.loads(raw)
        if payload.get("v") != _STATE_VERSION:
            raise SessionError("невідома версія збереженого стану сесії")
        return cls(
            DoubleRatchet.from_state(payload["ratchet"]),
            bytes.fromhex(payload["peer_ed"]),
            bytes.fromhex(payload["peer_dh"]),
            preamble=bytes.fromhex(payload["preamble"]) if payload["preamble"] else None,
        )


def _aad_prefix(kind: int, preamble: bytes) -> bytes:
    return MAGIC + bytes([kind]) + preamble
