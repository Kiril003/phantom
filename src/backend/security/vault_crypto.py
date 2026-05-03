"""
Phase 25-A — Vault crypto.

AES-256-GCM with per-field nonces, derived per-user from
`config.jwt_secret_key` so a stolen DB without the JWT secret yields
no plaintext. Domain-separated from `security/crypto.py` (which is
PII Fernet) by HKDF `info` string `b"phantom-os/vault-card-v1/user/<uid>"`.

Why a separate module:
  • crypto.py uses Fernet (AES-128-CBC + HMAC) — mature for PII at rest.
  • vault_crypto.py uses AEAD (AES-256-GCM) — needed because the Vault
    stores arbitrary secrets (passwords, API keys, seed phrases) where
    associated-data binding (`aad`) lets us authenticate the card_id +
    field_name alongside the ciphertext, preventing field-swap attacks
    inside a leaked DB row.

Threat model NOT covered (out of Phase 25-A scope):
  • DB exfiltration WITH the JWT_SECRET_KEY in hand → all rows decrypt.
    Mitigation: rotate JWT_SECRET_KEY → run the migration script once
    Day-5 ships it. Same constraint as `security/crypto.py`.
  • Memory dump while a vault_reveal is in flight → plaintext lives in
    process memory for the duration of the action. Mitigation deferred
    to Day-6 (mlock + zeroize after use).
  • OS-level keylogger inserting keystrokes during reveal → out of scope
    for an embedded device's own threat model.

Storage format for one field:
    base64url(nonce[12] || ciphertext_with_tag)
  Nonce is randomly generated per encryption — NEVER reused with the
  same key. AAD = `card_id|field_name` so a row that is moved between
  cards or fields fails decryption (raises `InvalidVaultToken`).
"""
from __future__ import annotations

import base64
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF


__all__ = [
    "encrypt_field",
    "decrypt_field",
    "derive_user_vault_key",
    "InvalidVaultToken",
    "VaultKeyUnavailable",
]


# Domain-separator. Bumping the version triggers a re-encrypt migration.
_HKDF_SALT = b"phantom-vault-v1"
_HKDF_INFO_PREFIX = b"phantom-os/vault-card-v1/user/"
_KEY_LENGTH = 32  # AES-256
_NONCE_LENGTH = 12  # GCM standard


class InvalidVaultToken(Exception):
    """Tampered ciphertext, wrong AAD, or wrong key (e.g. JWT rotated)."""


class VaultKeyUnavailable(Exception):
    """JWT secret unset — vault crypto cannot operate."""


def derive_user_vault_key(user_id: str | int) -> bytes:
    """Derive a 32-byte AES key from the JWT secret bound to a user_id.

    Per-user derivation means a vault row's key depends on WHICH user
    owns it. Two users sharing a deployment cannot peek at each other's
    cards even via DB read — they don't have each other's derived key.

    Re-derives on every call (no cache). HKDF over a 32-byte secret is
    ~5 µs on Radxa, so caching would not move the needle and would hide
    JWT rotation bugs.
    """
    from config import config

    if not config.jwt_secret_key:
        raise VaultKeyUnavailable(
            "jwt_secret_key is unset; cannot derive vault keys. "
            "Set JWT_SECRET_KEY in the environment or .env file."
        )

    info = _HKDF_INFO_PREFIX + str(user_id).encode("utf-8")
    return HKDF(
        algorithm=hashes.SHA256(),
        length=_KEY_LENGTH,
        salt=_HKDF_SALT,
        info=info,
    ).derive(config.jwt_secret_key.encode("utf-8"))


def _aad(card_id: str, field_name: str) -> bytes:
    """Authenticated-but-not-encrypted binding so a leaked row that is
    moved between cards / fields fails decryption with InvalidTag.

    The format is intentionally simple — `card_id|field_name` — so an
    operator running a manual rotation script can construct it without
    parsing JSON metadata."""
    return f"{card_id}|{field_name}".encode("utf-8")


def encrypt_field(
    *,
    user_id: str | int,
    card_id: str,
    field_name: str,
    plaintext: str | bytes,
) -> str:
    """Encrypt a single field. Returns a URL-safe base64 string suitable
    for direct storage in a SQLAlchemy `Text` column.

    A fresh random nonce is generated per call. Nonce reuse with the
    same (key, AAD) tuple would compromise GCM's confidentiality, so
    `os.urandom(12)` is mandatory — never use a counter, never use a
    deterministic derivation."""
    if isinstance(plaintext, str):
        plaintext = plaintext.encode("utf-8")
    key = derive_user_vault_key(user_id)
    aesgcm = AESGCM(key)
    nonce = os.urandom(_NONCE_LENGTH)
    ct = aesgcm.encrypt(nonce, plaintext, _aad(card_id, field_name))
    return base64.urlsafe_b64encode(nonce + ct).decode("ascii")


def decrypt_field(
    *,
    user_id: str | int,
    card_id: str,
    field_name: str,
    token: str,
) -> str:
    """Decrypt a vault field. Returns the UTF-8 plaintext.

    Raises:
        InvalidVaultToken: ciphertext tampered, AAD mismatch (row moved
            between cards/fields), or JWT_SECRET_KEY rotated. Loud
            failure — operators must run the rotation migration before
            rotating in production.
        VaultKeyUnavailable: JWT secret missing.
    """
    try:
        blob = base64.urlsafe_b64decode(token.encode("ascii"))
    except Exception as exc:
        raise InvalidVaultToken(f"token is not valid base64: {exc}") from exc
    if len(blob) <= _NONCE_LENGTH:
        raise InvalidVaultToken("token too short to contain nonce + ciphertext")

    nonce = blob[:_NONCE_LENGTH]
    ct = blob[_NONCE_LENGTH:]
    key = derive_user_vault_key(user_id)
    aesgcm = AESGCM(key)
    try:
        plaintext = aesgcm.decrypt(nonce, ct, _aad(card_id, field_name))
    except InvalidTag as exc:
        raise InvalidVaultToken(
            "AEAD verification failed — token is tampered, AAD mismatch, "
            "or JWT_SECRET_KEY rotated since encryption."
        ) from exc
    return plaintext.decode("utf-8")
