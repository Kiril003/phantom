"""Один ключ Ed25519 на вузол: маніфест і ретранслятор беруть його звідси."""
from __future__ import annotations

import base64
import hashlib
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

from paths import resolve_data_dir

_KEY_NAME = "node_ed25519.key"
NODE_ID_LEN = 32
RELAY_CHALLENGE_CONTEXT = b"phantom-relay-node-v1"


def key_path() -> Path:
    d = resolve_data_dir("identity")
    d.mkdir(parents=True, exist_ok=True)
    return d / _KEY_NAME


def load_or_create_key() -> Ed25519PrivateKey:
    p = key_path()
    if p.exists():
        key = serialization.load_pem_private_key(p.read_bytes(), password=None)
        if isinstance(key, Ed25519PrivateKey):
            return key
    key = Ed25519PrivateKey.generate()
    p.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    p.chmod(0o600)
    return key


def public_raw(pub: Ed25519PublicKey | None = None) -> bytes:
    pub = pub if pub is not None else load_or_create_key().public_key()
    return pub.public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw
    )


def public_hex(pub: Ed25519PublicKey | None = None) -> str:
    return public_raw(pub).hex()


def public_b64() -> str:
    return base64.b64encode(public_raw()).decode("ascii")


def node_id() -> str:
    """Публічна адреса вузла на ретрансляторі — не вгадується, не є секретом."""
    return hashlib.sha256(public_raw()).hexdigest()[:NODE_ID_LEN]


def sign_relay_challenge(nonce: bytes) -> str:
    signature = load_or_create_key().sign(RELAY_CHALLENGE_CONTEXT + nonce)
    return base64.b64encode(signature).decode("ascii")
