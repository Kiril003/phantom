"""Довготривалі ключі месенджера: identity, signed prekey, одноразові prekeys.

Корінь довіри — той самий Ed25519 вузла (node/identity.py), яким вузол
підписується перед ретранслятором. Ed25519 не вміє DH, тож поруч живе
довготривала X25519-пара, і Ed25519 її підписує: хто звірив node_id
співрозмовника, той без окремого каналу довіряє і його DH-ключу.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import struct
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from cryptography.exceptions import InvalidSignature, InvalidTag
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives.asymmetric.x25519 import (
    X25519PrivateKey,
    X25519PublicKey,
)

__all__ = [
    "BUNDLE_VERSION",
    "IDENTITY_DH_CONTEXT",
    "SIGNED_PREKEY_CONTEXT",
    "KeyStore",
    "MessengerKeyError",
    "PreKeyUnavailable",
    "PublicBundle",
    "SignedPreKey",
    "UntrustedBundle",
    "ed25519_public_raw",
    "load_ed25519_public",
    "load_x25519_public",
    "signed_prekey_payload",
    "x25519_public_raw",
]

BUNDLE_VERSION = 1
NODE_ID_LEN = 32  # як у node.identity.node_id() — та сама адреса вузла
KEY_LEN = 32
SIG_LEN = 64
DEFAULT_ONE_TIME_COUNT = 32

IDENTITY_DH_CONTEXT = b"PHANTOM OS/messenger-identity-dh-v1"
SIGNED_PREKEY_CONTEXT = b"PHANTOM OS/messenger-signed-prekey-v1"

_IDENTITY_DH_KEY_NAME = "messenger_identity_x25519.key"


class MessengerKeyError(Exception):
    """Базова помилка ключового матеріалу месенджера."""


class UntrustedBundle(MessengerKeyError):
    """Bundle не проходить перевірку підписів або належить не тому вузлу."""


class PreKeyUnavailable(MessengerKeyError):
    """Запитаний prekey невідомий або вже витрачений."""


def x25519_public_raw(key: X25519PrivateKey | X25519PublicKey) -> bytes:
    pub = key.public_key() if isinstance(key, X25519PrivateKey) else key
    return pub.public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw
    )


def ed25519_public_raw(key: Ed25519PrivateKey | Ed25519PublicKey) -> bytes:
    pub = key.public_key() if isinstance(key, Ed25519PrivateKey) else key
    return pub.public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw
    )


def load_x25519_public(raw: bytes) -> X25519PublicKey:
    if not isinstance(raw, (bytes, bytearray)) or len(raw) != KEY_LEN:
        raise MessengerKeyError(f"X25519-ключ мусить бути {KEY_LEN} байтів")
    return X25519PublicKey.from_public_bytes(bytes(raw))


def load_ed25519_public(raw: bytes) -> Ed25519PublicKey:
    if not isinstance(raw, (bytes, bytearray)) or len(raw) != KEY_LEN:
        raise MessengerKeyError(f"Ed25519-ключ мусить бути {KEY_LEN} байтів")
    return Ed25519PublicKey.from_public_bytes(bytes(raw))


def signed_prekey_payload(key_id: int, public: bytes) -> bytes:
    """Підпис накриває і номер, і сам ключ — інакше prekey можна перенумерувати."""
    return SIGNED_PREKEY_CONTEXT + struct.pack(">I", key_id) + public


def node_id_of(identity_ed: bytes) -> str:
    return hashlib.sha256(identity_ed).hexdigest()[:NODE_ID_LEN]


def _b64e(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def _b64d(text: Any, field: str) -> bytes:
    if not isinstance(text, str):
        raise UntrustedBundle(f"поле {field} мусить бути рядком base64")
    try:
        return base64.b64decode(text, validate=True)
    except (ValueError, TypeError) as exc:
        raise UntrustedBundle(f"поле {field} не є base64") from exc


@dataclass(frozen=True)
class SignedPreKey:
    key_id: int
    private: X25519PrivateKey
    signature: bytes
    created_at: float

    @property
    def public(self) -> bytes:
        return x25519_public_raw(self.private)


_COMPACT_VERSION = 1
_PREKEY_MAGIC = b"PHK1"
_PREKEY_VERSION = 1
_PREKEY_NONCE_LEN = 12
_AT_REST_INFO = b"phantom-messenger/prekeys-at-rest/v1"


@dataclass(frozen=True)
class PublicBundle:
    """Те, що вузол віддає назовні. Приватного матеріалу тут немає."""

    identity_ed: bytes
    identity_dh: bytes
    identity_dh_sig: bytes
    signed_prekey_id: int
    signed_prekey: bytes
    signed_prekey_sig: bytes
    one_time_prekey_id: Optional[int] = None
    one_time_prekey: Optional[bytes] = None

    @property
    def node_id(self) -> str:
        return node_id_of(self.identity_ed)

    def to_compact(self) -> str:
        """Той самий ключ, але вдвічі коротший — щоб влізти в скануваний QR.

        JSON з base64 займає під шістсот символів: QR виходить такий щільний,
        що телефон бере його через раз. Тут поля лежать бінарно у фіксованому
        порядку, тож розміри й так відомі, а назви полів не потрібні зовсім.
        """
        has_otp = self.one_time_prekey is not None
        blob = (
            bytes([_COMPACT_VERSION, 1 if has_otp else 0])
            + self.identity_ed
            + self.identity_dh
            + self.identity_dh_sig
            + struct.pack(">I", self.signed_prekey_id)
            + self.signed_prekey
            + self.signed_prekey_sig
        )
        if has_otp:
            blob += struct.pack(">I", self.one_time_prekey_id or 0) + (
                self.one_time_prekey or b""
            )
        return base64.urlsafe_b64encode(blob).decode().rstrip("=")

    @classmethod
    def from_compact(cls, text: str) -> "PublicBundle":
        raw = (text or "").strip()
        if not raw:
            raise UntrustedBundle("порожній ключ")
        try:
            blob = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
        except Exception as exc:  # noqa: BLE001
            raise UntrustedBundle("ключ не читається як base64") from exc

        head = 2 + KEY_LEN * 2 + SIG_LEN + 4 + KEY_LEN + SIG_LEN
        if len(blob) < head:
            raise UntrustedBundle("ключ закороткий")
        if blob[0] != _COMPACT_VERSION:
            raise UntrustedBundle(f"невідома версія ключа: {blob[0]}")

        cursor = 2
        def take(size: int) -> bytes:
            nonlocal cursor
            chunk = blob[cursor : cursor + size]
            cursor += size
            return chunk

        identity_ed = take(KEY_LEN)
        identity_dh = take(KEY_LEN)
        identity_dh_sig = take(SIG_LEN)
        signed_id = struct.unpack(">I", take(4))[0]
        signed_prekey = take(KEY_LEN)
        signed_sig = take(SIG_LEN)

        one_time_id: Optional[int] = None
        one_time: Optional[bytes] = None
        if blob[1]:
            if len(blob) < cursor + 4 + KEY_LEN:
                raise UntrustedBundle("одноразовий ключ обірваний")
            one_time_id = struct.unpack(">I", take(4))[0]
            one_time = take(KEY_LEN)

        return cls(
            identity_ed=identity_ed,
            identity_dh=identity_dh,
            identity_dh_sig=identity_dh_sig,
            signed_prekey_id=signed_id,
            signed_prekey=signed_prekey,
            signed_prekey_sig=signed_sig,
            one_time_prekey_id=one_time_id,
            one_time_prekey=one_time,
        )

    def verify(self, expected_node_id: Optional[str] = None) -> None:
        """Кидає UntrustedBundle. Мовчазне повернення = bundle прийнято."""
        for name, raw, size in (
            ("identity_ed", self.identity_ed, KEY_LEN),
            ("identity_dh", self.identity_dh, KEY_LEN),
            ("identity_dh_sig", self.identity_dh_sig, SIG_LEN),
            ("signed_prekey", self.signed_prekey, KEY_LEN),
            ("signed_prekey_sig", self.signed_prekey_sig, SIG_LEN),
        ):
            if not isinstance(raw, (bytes, bytearray)) or len(raw) != size:
                raise UntrustedBundle(f"{name}: очікувалось {size} байтів")
        if (self.one_time_prekey_id is None) != (self.one_time_prekey is None):
            raise UntrustedBundle("одноразовий prekey без номера або навпаки")
        if self.one_time_prekey is not None and len(self.one_time_prekey) != KEY_LEN:
            raise UntrustedBundle(f"one_time_prekey: очікувалось {KEY_LEN} байтів")

        # Спершу — чи це взагалі той вузол, з яким ми збирались говорити.
        # Зловмисник може принести цілком самоузгоджений bundle власного вузла.
        if expected_node_id is not None and expected_node_id != self.node_id:
            raise UntrustedBundle(
                f"bundle належить вузлу {self.node_id}, а не {expected_node_id}"
            )

        ed = load_ed25519_public(self.identity_ed)
        try:
            ed.verify(self.identity_dh_sig, IDENTITY_DH_CONTEXT + self.identity_dh)
        except InvalidSignature as exc:
            raise UntrustedBundle("identity-DH не підписаний цим Ed25519") from exc
        try:
            ed.verify(
                self.signed_prekey_sig,
                signed_prekey_payload(self.signed_prekey_id, self.signed_prekey),
            )
        except InvalidSignature as exc:
            raise UntrustedBundle("signed prekey не підписаний цим Ed25519") from exc

    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "v": BUNDLE_VERSION,
            "node_id": self.node_id,
            "identity_ed": _b64e(self.identity_ed),
            "identity_dh": _b64e(self.identity_dh),
            "identity_dh_sig": _b64e(self.identity_dh_sig),
            "signed_prekey_id": self.signed_prekey_id,
            "signed_prekey": _b64e(self.signed_prekey),
            "signed_prekey_sig": _b64e(self.signed_prekey_sig),
        }
        if self.one_time_prekey is not None:
            data["one_time_prekey_id"] = self.one_time_prekey_id
            data["one_time_prekey"] = _b64e(self.one_time_prekey)
        return data

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), separators=(",", ":"), sort_keys=True)

    @classmethod
    def from_dict(cls, data: Any) -> "PublicBundle":
        if not isinstance(data, dict):
            raise UntrustedBundle("bundle мусить бути об'єктом")
        if data.get("v") != BUNDLE_VERSION:
            raise UntrustedBundle(f"версія bundle {data.get('v')!r} не підтримується")
        try:
            spk_id = int(data["signed_prekey_id"])
        except (KeyError, TypeError, ValueError) as exc:
            raise UntrustedBundle("signed_prekey_id відсутній або не число") from exc
        opk_id = data.get("one_time_prekey_id")
        opk = data.get("one_time_prekey")
        try:
            return cls(
                identity_ed=_b64d(data["identity_ed"], "identity_ed"),
                identity_dh=_b64d(data["identity_dh"], "identity_dh"),
                identity_dh_sig=_b64d(data["identity_dh_sig"], "identity_dh_sig"),
                signed_prekey_id=spk_id,
                signed_prekey=_b64d(data["signed_prekey"], "signed_prekey"),
                signed_prekey_sig=_b64d(
                    data["signed_prekey_sig"], "signed_prekey_sig"
                ),
                one_time_prekey_id=int(opk_id) if opk_id is not None else None,
                one_time_prekey=(
                    _b64d(opk, "one_time_prekey") if opk is not None else None
                ),
            )
        except KeyError as exc:
            raise UntrustedBundle(f"у bundle бракує поля {exc.args[0]!r}") from exc

    @classmethod
    def from_json(cls, text: str) -> "PublicBundle":
        try:
            return cls.from_dict(json.loads(text))
        except (TypeError, ValueError) as exc:
            raise UntrustedBundle("bundle не є коректним JSON") from exc


class KeyStore:
    """Приватний ключовий матеріал одного вузла."""

    def __init__(
        self,
        ed_private: Ed25519PrivateKey,
        identity_dh: Optional[X25519PrivateKey] = None,
        one_time_count: int = DEFAULT_ONE_TIME_COUNT,
    ) -> None:
        self._ed = ed_private
        self._identity_dh = identity_dh or X25519PrivateKey.generate()
        self._identity_dh_sig = self._ed.sign(
            IDENTITY_DH_CONTEXT + x25519_public_raw(self._identity_dh)
        )
        self._signed: dict[int, SignedPreKey] = {}
        self._current_signed_id = 0
        self._next_signed_id = 1
        self._one_time: dict[int, X25519PrivateKey] = {}
        self._issued: set[int] = set()
        self._next_one_time_id = 1
        self.rotate_signed_prekey()
        self.generate_one_time_prekeys(one_time_count)

    @classmethod
    def generate(cls, one_time_count: int = DEFAULT_ONE_TIME_COUNT) -> "KeyStore":
        """Ключі лише в пам'яті — для тестів і для ще не збереженого профілю."""
        return cls(Ed25519PrivateKey.generate(), one_time_count=one_time_count)

    @classmethod
    def from_node(cls, one_time_count: int = DEFAULT_ONE_TIME_COUNT) -> "KeyStore":
        """Ed25519 бере з node/identity.py, X25519-identity тримає поруч на диску.

        Identity-DH мусить пережити рестарт: інакше кожен запуск міняв би
        associated data сесій, і всі вже погоджені сесії тихо перестали б
        розшифровуватись.
        """
        from node.identity import key_path, load_or_create_key

        ed = load_or_create_key()
        dh_path = key_path().parent / _IDENTITY_DH_KEY_NAME
        return cls(ed, _load_or_create_identity_dh(dh_path), one_time_count)

    @property
    def identity_ed_public(self) -> bytes:
        return ed25519_public_raw(self._ed)

    @property
    def identity_dh_public(self) -> bytes:
        return x25519_public_raw(self._identity_dh)

    @property
    def identity_dh_private(self) -> X25519PrivateKey:
        return self._identity_dh

    @property
    def identity_dh_signature(self) -> bytes:
        return self._identity_dh_sig

    @property
    def node_id(self) -> str:
        return node_id_of(self.identity_ed_public)

    @property
    def one_time_available(self) -> int:
        return len(self._one_time) - len(self._issued)

    def rotate_signed_prekey(self) -> SignedPreKey:
        key_id = self._next_signed_id
        self._next_signed_id += 1
        private = X25519PrivateKey.generate()
        public = x25519_public_raw(private)
        spk = SignedPreKey(
            key_id=key_id,
            private=private,
            signature=self._ed.sign(signed_prekey_payload(key_id, public)),
            created_at=time.time(),
        )
        # Старі покоління лишаються: сесії, погоджені на попередній prekey,
        # ще в польоті і мусять доїхати.
        self._signed[key_id] = spk
        self._current_signed_id = key_id
        return spk

    def generate_one_time_prekeys(self, count: int) -> list[int]:
        if count < 0:
            raise ValueError("count мусить бути невід'ємним")
        created: list[int] = []
        for _ in range(count):
            key_id = self._next_one_time_id
            self._next_one_time_id += 1
            self._one_time[key_id] = X25519PrivateKey.generate()
            created.append(key_id)
        return created

    def signed_prekey_private(self, key_id: int) -> X25519PrivateKey:
        spk = self._signed.get(key_id)
        if spk is None:
            raise PreKeyUnavailable(f"signed prekey {key_id} невідомий")
        return spk.private

    def one_time_private(self, key_id: int) -> X25519PrivateKey:
        key = self._one_time.get(key_id)
        if key is None:
            raise PreKeyUnavailable(f"одноразовий prekey {key_id} вже витрачений")
        return key

    def consume_one_time(self, key_id: int) -> None:
        """Витрачаємо ключ лише після того, як повідомлення справді відкрилось."""
        self._one_time.pop(key_id, None)
        self._issued.discard(key_id)

    def publish_bundle(self, with_one_time: bool = True) -> PublicBundle:
        spk = self._signed[self._current_signed_id]
        opk_id: Optional[int] = None
        opk_pub: Optional[bytes] = None
        if with_one_time:
            for key_id in sorted(self._one_time):
                if key_id not in self._issued:
                    opk_id = key_id
                    opk_pub = x25519_public_raw(self._one_time[key_id])
                    self._issued.add(key_id)
                    break
        return PublicBundle(
            identity_ed=self.identity_ed_public,
            identity_dh=self.identity_dh_public,
            identity_dh_sig=self._identity_dh_sig,
            signed_prekey_id=spk.key_id,
            signed_prekey=spk.public,
            signed_prekey_sig=spk.signature,
            one_time_prekey_id=opk_id,
            one_time_prekey=opk_pub,
        )

    #: Скільки живе підписаний prekey, поки не поступиться новому.
    SIGNED_PREKEY_MAX_AGE_S = 7 * 24 * 3600
    #: Скільки старе покоління ще приймається: рівно стільки, скільки може
    #: летіти перший кадр від того, хто взяв bundle раніше.
    SIGNED_PREKEY_RETENTION_S = 30 * 24 * 3600

    def rotate_if_stale(self, *, now: Optional[float] = None) -> bool:
        """Міняє підписаний prekey, коли він застарів.

        Без ротації один скомпрометований ключ відкривав би нові сесії вічно —
        саме те, від чого має захищати форвард-секретність.
        """
        moment = time.time() if now is None else now
        current = self._signed.get(self._current_signed_id)
        if current is not None and moment - current.created_at < self.SIGNED_PREKEY_MAX_AGE_S:
            return False
        self.rotate_signed_prekey()
        return True

    def forget_old_signed(self, *, now: Optional[float] = None) -> int:
        """Викидає покоління, якими вже ніхто не може скористатись."""
        moment = time.time() if now is None else now
        stale = [
            key_id
            for key_id, spk in self._signed.items()
            if key_id != self._current_signed_id
            and moment - spk.created_at > self.SIGNED_PREKEY_RETENTION_S
        ]
        for key_id in stale:
            self._signed.pop(key_id, None)
        return len(stale)

    def one_time_low(self, threshold: int = 8) -> bool:
        """Запас одноразових ключів на межі — час поповнити."""
        return self.one_time_available < threshold

    def persist_prekeys(self, path: Path) -> None:
        """Prekey-набір мусить пережити рестарт.

        Інакше після перезапуску вузол не має приватних частин ключів, які вже
        роздав у своєму bundle, — і кожен, хто саме зараз пише йому вперше,
        отримує нечитабельну сесію. Файл шифруємо тим самим ключем, що й стан
        сесій: він виводиться з X25519 вузла і на диску окремо не лежить.

        `_issued` теж їде на диск: інакше після рестарту той самий одноразовий
        prekey міг би піти двом різним співрозмовникам.
        """
        payload = {
            "v": _PREKEY_VERSION,
            "next_signed_id": self._next_signed_id,
            "current_signed_id": self._current_signed_id,
            "signed": [
                {
                    "key_id": spk.key_id,
                    "private": spk.private.private_bytes_raw().hex(),
                    "signature": spk.signature.hex(),
                    "created_at": spk.created_at,
                }
                for spk in self._signed.values()
            ],
            "next_one_time_id": self._next_one_time_id,
            "one_time": {
                str(key_id): priv.private_bytes_raw().hex()
                for key_id, priv in self._one_time.items()
            },
            "issued": sorted(self._issued),
        }
        raw = json.dumps(payload, separators=(",", ":")).encode()
        nonce = os.urandom(_PREKEY_NONCE_LEN)
        sealed = AESGCM(self._at_rest_key()).encrypt(nonce, raw, _PREKEY_MAGIC)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(_PREKEY_MAGIC + nonce + sealed)
        path.chmod(0o600)

    def restore_prekeys(self, path: Path) -> None:
        blob = path.read_bytes()
        if not blob.startswith(_PREKEY_MAGIC):
            raise MessengerKeyError(f"{path} — це не prekey-набір")
        nonce = blob[len(_PREKEY_MAGIC) : len(_PREKEY_MAGIC) + _PREKEY_NONCE_LEN]
        body = blob[len(_PREKEY_MAGIC) + _PREKEY_NONCE_LEN :]
        try:
            raw = AESGCM(self._at_rest_key()).decrypt(nonce, body, _PREKEY_MAGIC)
        except InvalidTag as exc:
            raise MessengerKeyError("prekey-набір не розшифровується цим вузлом") from exc
        payload = json.loads(raw)
        if payload.get("v") != _PREKEY_VERSION:
            raise MessengerKeyError("невідома версія prekey-набору")

        self._signed = {
            int(item["key_id"]): SignedPreKey(
                key_id=int(item["key_id"]),
                private=X25519PrivateKey.from_private_bytes(bytes.fromhex(item["private"])),
                signature=bytes.fromhex(item["signature"]),
                created_at=float(item["created_at"]),
            )
            for item in payload["signed"]
        }
        self._current_signed_id = int(payload["current_signed_id"])
        self._next_signed_id = int(payload["next_signed_id"])
        self._one_time = {
            int(key_id): X25519PrivateKey.from_private_bytes(bytes.fromhex(priv))
            for key_id, priv in payload["one_time"].items()
        }
        self._next_one_time_id = int(payload["next_one_time_id"])
        self._issued = {int(i) for i in payload.get("issued", [])}

    def _at_rest_key(self) -> bytes:
        return HKDF(
            algorithm=hashes.SHA256(), length=32, salt=None, info=_AT_REST_INFO
        ).derive(self._identity_dh.private_bytes_raw())


def _load_or_create_identity_dh(path: Path) -> X25519PrivateKey:
    if path.exists():
        key = serialization.load_pem_private_key(path.read_bytes(), password=None)
        if isinstance(key, X25519PrivateKey):
            return key
        raise MessengerKeyError(f"{path} містить не X25519-ключ")
    key = X25519PrivateKey.generate()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    path.chmod(0o600)
    return key
