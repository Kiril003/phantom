"""Double Ratchet: DH-храповик між чергами повідомлень, симетричний — усередині.

DH-храповик міняє корінь на кожній зміні напряму, тож витік ключа не відкриває
ні минулу, ні майбутню чергу. Симетричний храповик просуває ланцюг на кожне
повідомлення і ключ одразу забуває.

Порядок доставки мережа не гарантує, тому пропущені ключі відкладаються в
skipped і чекають свого кадру. Стан рухається лише після того, як GCM-тег
зійшовся: підроблений кадр не має права зіпсувати живу сесію.
"""
from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import Optional

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes, hmac
from cryptography.hazmat.primitives.asymmetric.x25519 import (
    X25519PrivateKey,
    X25519PublicKey,
)
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from messenger.crypto.keys import KEY_LEN, x25519_public_raw

__all__ = [
    "AuthenticationFailed",
    "DoubleRatchet",
    "HEADER_LEN",
    "Header",
    "MAX_SKIP",
    "RatchetError",
    "SkipLimitExceeded",
]

HEADER_LEN = KEY_LEN + 8
MAX_SKIP = 1000  # скільки пропущених ключів терпимо в одній черзі
MAX_SKIPPED_STORE = 2000  # і скільки тримаємо всього, щоб не з'їсти пам'ять
_TAG_LEN = 16
_NONCE_LEN = 12

_ROOT_INFO = b"PHANTOM OS/messenger-ratchet-root-v1"
_MESSAGE_INFO = b"PHANTOM OS/messenger-ratchet-message-v1"
_CHAIN_MESSAGE = b"\x01"
_CHAIN_NEXT = b"\x02"


class RatchetError(Exception):
    """Храповик не може обробити кадр."""


class AuthenticationFailed(RatchetError):
    """Тег не зійшовся: кадр підроблено, пошкоджено або він не з цієї сесії."""


class SkipLimitExceeded(RatchetError):
    """Номер повідомлення надто далеко попереду — далі це вже вичерпання пам'яті."""


@dataclass(frozen=True)
class Header:
    dh: bytes
    pn: int
    n: int

    def pack(self) -> bytes:
        if len(self.dh) != KEY_LEN:
            raise RatchetError("публічний ключ храповика мусить бути 32 байти")
        return self.dh + struct.pack(">II", self.pn, self.n)

    @classmethod
    def unpack(cls, raw: bytes) -> "Header":
        if len(raw) != HEADER_LEN:
            raise RatchetError(f"заголовок мусить бути {HEADER_LEN} байтів")
        pn, n = struct.unpack(">II", raw[KEY_LEN:])
        return cls(dh=bytes(raw[:KEY_LEN]), pn=pn, n=n)


@dataclass
class _State:
    dh_self: X25519PrivateKey
    dh_remote: Optional[bytes]
    root_key: bytes
    ck_send: Optional[bytes]
    ck_recv: Optional[bytes]
    n_send: int
    n_recv: int
    n_prev: int
    skipped: dict[tuple[bytes, int], bytes]

    def export(self) -> dict:
        return {
            "dh_self": self.dh_self.private_bytes_raw().hex(),
            "dh_remote": self.dh_remote.hex() if self.dh_remote else None,
            "root_key": self.root_key.hex(),
            "ck_send": self.ck_send.hex() if self.ck_send else None,
            "ck_recv": self.ck_recv.hex() if self.ck_recv else None,
            "n_send": self.n_send,
            "n_recv": self.n_recv,
            "n_prev": self.n_prev,
            # Пропущені ключі несуть можливість прочитати повідомлення, які ще
            # летять поза порядком. Загубимо їх — і після рестарту вони мертві.
            "skipped": [[dh.hex(), n, mk.hex()] for (dh, n), mk in self.skipped.items()],
        }

    @classmethod
    def restore(cls, raw: dict) -> "_State":
        return cls(
            dh_self=X25519PrivateKey.from_private_bytes(bytes.fromhex(raw["dh_self"])),
            dh_remote=bytes.fromhex(raw["dh_remote"]) if raw["dh_remote"] else None,
            root_key=bytes.fromhex(raw["root_key"]),
            ck_send=bytes.fromhex(raw["ck_send"]) if raw["ck_send"] else None,
            ck_recv=bytes.fromhex(raw["ck_recv"]) if raw["ck_recv"] else None,
            n_send=int(raw["n_send"]),
            n_recv=int(raw["n_recv"]),
            n_prev=int(raw["n_prev"]),
            skipped={
                (bytes.fromhex(dh), int(n)): bytes.fromhex(mk)
                for dh, n, mk in raw.get("skipped", [])
            },
        )

    def clone(self) -> "_State":
        return _State(
            dh_self=self.dh_self,
            dh_remote=self.dh_remote,
            root_key=self.root_key,
            ck_send=self.ck_send,
            ck_recv=self.ck_recv,
            n_send=self.n_send,
            n_recv=self.n_recv,
            n_prev=self.n_prev,
            skipped=dict(self.skipped),
        )


def _dh(private: X25519PrivateKey, remote: bytes) -> bytes:
    try:
        return private.exchange(X25519PublicKey.from_public_bytes(remote))
    except ValueError as exc:
        raise AuthenticationFailed("X25519-обмін відхилено") from exc


def _kdf_root(root_key: bytes, dh_out: bytes) -> tuple[bytes, bytes]:
    material = HKDF(
        algorithm=hashes.SHA256(), length=64, salt=root_key, info=_ROOT_INFO
    ).derive(dh_out)
    return material[:32], material[32:]


def _kdf_chain(chain_key: bytes) -> tuple[bytes, bytes]:
    """Повертає (наступний ланцюговий ключ, ключ повідомлення)."""
    def tag(label: bytes) -> bytes:
        mac = hmac.HMAC(chain_key, hashes.SHA256())
        mac.update(label)
        return mac.finalize()

    return tag(_CHAIN_NEXT), tag(_CHAIN_MESSAGE)


def _message_material(message_key: bytes) -> tuple[bytes, bytes]:
    material = HKDF(
        algorithm=hashes.SHA256(),
        length=KEY_LEN + _NONCE_LEN,
        salt=b"\x00" * 32,
        info=_MESSAGE_INFO,
    ).derive(message_key)
    # Ключ повідомлення унікальний, тож і nonce унікальний — лічильник не потрібен.
    return material[:KEY_LEN], material[KEY_LEN:]


class DoubleRatchet:
    def __init__(self, state: _State, associated_data: bytes) -> None:
        self._state = state
        self._ad = bytes(associated_data)

    def export_state(self) -> dict:
        """Стан храповика у вигляді, придатному для запису на диск.

        Це найчутливіше, що є в месенджері: маючи цей словник, можна читати
        подальше листування. Назовні він має їхати тільки зашифрованим.
        """
        return {"ad": self._ad.hex(), "state": self._state.export()}

    @classmethod
    def from_state(cls, raw: dict) -> "DoubleRatchet":
        return cls(_State.restore(raw["state"]), bytes.fromhex(raw["ad"]))

    @classmethod
    def for_initiator(
        cls, root_key: bytes, remote_dh: bytes, associated_data: bytes
    ) -> "DoubleRatchet":
        if len(root_key) != KEY_LEN or len(remote_dh) != KEY_LEN:
            raise RatchetError("корінь і ключ співрозмовника мусять бути 32 байти")
        dh_self = X25519PrivateKey.generate()
        root, ck_send = _kdf_root(root_key, _dh(dh_self, bytes(remote_dh)))
        return cls(
            _State(
                dh_self=dh_self,
                dh_remote=bytes(remote_dh),
                root_key=root,
                ck_send=ck_send,
                ck_recv=None,
                n_send=0,
                n_recv=0,
                n_prev=0,
                skipped={},
            ),
            associated_data,
        )

    @classmethod
    def for_responder(
        cls, root_key: bytes, dh_self: X25519PrivateKey, associated_data: bytes
    ) -> "DoubleRatchet":
        if len(root_key) != KEY_LEN:
            raise RatchetError("корінь мусить бути 32 байти")
        return cls(
            _State(
                dh_self=dh_self,
                dh_remote=None,
                root_key=bytes(root_key),
                ck_send=None,
                ck_recv=None,
                n_send=0,
                n_recv=0,
                n_prev=0,
                skipped={},
            ),
            associated_data,
        )

    @property
    def can_send(self) -> bool:
        return self._state.ck_send is not None

    @property
    def sending_public(self) -> bytes:
        return x25519_public_raw(self._state.dh_self)

    def snapshot(self) -> "DoubleRatchet":
        """Копія стану — потрібна тестам forward secrecy, не транспорту."""
        return DoubleRatchet(self._state.clone(), self._ad)

    def encrypt(self, plaintext: bytes, aad: bytes = b"") -> bytes:
        if not isinstance(plaintext, (bytes, bytearray)):
            raise TypeError("шифруємо байти, не рядок")
        state = self._state
        if state.ck_send is None:
            raise RatchetError(
                "черга відправки ще не заведена: отримувач мусить спершу "
                "прийняти повідомлення ініціатора"
            )
        state.ck_send, message_key = _kdf_chain(state.ck_send)
        header = Header(
            dh=x25519_public_raw(state.dh_self), pn=state.n_prev, n=state.n_send
        ).pack()
        state.n_send += 1
        key, nonce = _message_material(message_key)
        return header + AESGCM(key).encrypt(
            nonce, bytes(plaintext), self._ad + aad + header
        )

    def decrypt(self, wire: bytes, aad: bytes = b"") -> bytes:
        if not isinstance(wire, (bytes, bytearray)):
            raise TypeError("розшифровуємо байти")
        wire = bytes(wire)
        if len(wire) < HEADER_LEN + _TAG_LEN:
            raise AuthenticationFailed("кадр коротший за заголовок із тегом")
        raw_header = wire[:HEADER_LEN]
        body = wire[HEADER_LEN:]
        header = Header.unpack(raw_header)

        trial = self._state.clone()
        message_key = trial.skipped.pop((header.dh, header.n), None)
        if message_key is None:
            if trial.dh_remote is None or header.dh != trial.dh_remote:
                _skip_to(trial, header.pn)
                _dh_ratchet(trial, header.dh)
            _skip_to(trial, header.n)
            if trial.ck_recv is None:
                raise AuthenticationFailed("черги прийому немає")
            trial.ck_recv, message_key = _kdf_chain(trial.ck_recv)
            trial.n_recv += 1

        key, nonce = _message_material(message_key)
        try:
            plaintext = AESGCM(key).decrypt(nonce, body, self._ad + aad + raw_header)
        except InvalidTag as exc:
            raise AuthenticationFailed("тег не зійшовся") from exc

        self._state = trial
        return plaintext


def _skip_to(state: _State, until: int) -> None:
    if state.ck_recv is None or state.dh_remote is None:
        return
    if until - state.n_recv > MAX_SKIP:
        raise SkipLimitExceeded(
            f"пропуск {until - state.n_recv} повідомлень перевищує ліміт {MAX_SKIP}"
        )
    while state.n_recv < until:
        state.ck_recv, message_key = _kdf_chain(state.ck_recv)
        state.skipped[(state.dh_remote, state.n_recv)] = message_key
        state.n_recv += 1
    while len(state.skipped) > MAX_SKIPPED_STORE:
        state.skipped.pop(next(iter(state.skipped)))


def _dh_ratchet(state: _State, remote_dh: bytes) -> None:
    state.n_prev = state.n_send
    state.n_send = 0
    state.n_recv = 0
    state.dh_remote = remote_dh
    state.root_key, state.ck_recv = _kdf_root(
        state.root_key, _dh(state.dh_self, remote_dh)
    )
    state.dh_self = X25519PrivateKey.generate()
    state.root_key, state.ck_send = _kdf_root(
        state.root_key, _dh(state.dh_self, remote_dh)
    )
