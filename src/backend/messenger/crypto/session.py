"""Фасад сесії: назовні видно тільки encrypt(bytes) -> bytes і decrypt(bytes) -> bytes.

Кадр:
    "PHM1" | тип(1) | [преамбула(169), лише для типу prekey] | заголовок(40) | шифротекст

Преамбула їде доти, доки ініціатор не почує відповідь: до того моменту він не
знає, чи отримувач уже звів сесію, а без преамбули X3DH не відтворити. Увесь
префікс кадру входить в AAD, тому зрізати чи підмінити преамбулу по дорозі не
вийде — тег не зійдеться.
"""
from __future__ import annotations

import struct
from typing import Optional

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

    def serialize(self) -> bytes:
        raise NotImplementedError(
            "збереження стану храповика між рестартами не реалізовано"
        )

    @classmethod
    def restore(cls, blob: bytes) -> "Session":
        raise NotImplementedError(
            "відновлення стану храповика між рестартами не реалізовано"
        )


def _aad_prefix(kind: int, preamble: bytes) -> bytes:
    return MAGIC + bytes([kind]) + preamble
