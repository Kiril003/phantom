"""Запечатування локальної історії.

Наскрізне шифрування захищає повідомлення в дорозі, але власну копію розмови
вузол мусить уміти прочитати — інакше відправник втрачає своє ж листування
(храповик навмисне не дає розшифрувати те, що ти сам надіслав).

Тому історія на диску лежить під окремим замком: ключ виводиться з
довготривалого X25519 вузла, який у базі не зберігається. Викрадений файл бази
без ключів вузла не дає прочитати нічого.
"""
from __future__ import annotations

import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from messenger.crypto.keys import KeyStore

__all__ = ["AtRestError", "seal", "unseal"]

_MAGIC = b"PHB1"
_NONCE_LEN = 12
_INFO = b"phantom-messenger/history-at-rest/v1"


class AtRestError(Exception):
    """Блоб не належить цьому вузлу або зіпсований."""


def _key(store: KeyStore) -> bytes:
    return HKDF(
        algorithm=hashes.SHA256(), length=32, salt=None, info=_INFO
    ).derive(store.identity_dh_private.private_bytes_raw())


def seal(store: KeyStore, plaintext: str, aad: bytes = b"") -> bytes:
    nonce = os.urandom(_NONCE_LEN)
    sealed = AESGCM(_key(store)).encrypt(nonce, plaintext.encode(), _MAGIC + aad)
    return _MAGIC + nonce + sealed


def unseal(store: KeyStore, blob: bytes, aad: bytes = b"") -> str:
    if not blob.startswith(_MAGIC):
        raise AtRestError("це не запечатана історія")
    nonce = blob[len(_MAGIC) : len(_MAGIC) + _NONCE_LEN]
    body = blob[len(_MAGIC) + _NONCE_LEN :]
    try:
        return AESGCM(_key(store)).decrypt(nonce, body, _MAGIC + aad).decode()
    except InvalidTag as exc:
        raise AtRestError("історія не розшифровується цим вузлом") from exc
