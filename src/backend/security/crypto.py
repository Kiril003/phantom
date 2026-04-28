"""PII encryption — Fernet-over-HKDF(JWT_SECRET_KEY).

Day-4 Phase-3 Wave-1 / Block CRYPTO-1.
Closes U6-ID-C1 (audit-2026-05-01-day4) — `crypto.py` was missing.

ADR-CRP-001 — Fernet (AES-128-CBC + HMAC-SHA256). Defer AES-256-GCM to Day-5.
ADR-CRP-002 — HKDF-SHA256 derives the Fernet key from `config.jwt_secret_key`
              with a static, versioned salt `b"phantom-pii-v1"` and domain-
              separated info `b"phantom-os/pii-encryption"`. Single-secret
              operator UX, salt-versioned for Day-5 rotation.
ADR-CRP-003 — `decrypt_pii` raises `cryptography.fernet.InvalidToken` on
              tamper *or* on `JWT_SECRET_KEY` rotation. Loud failure beats
              silent quarantine — operator must run a re-encrypt migration
              before rotating in production.

The whole helper is intentionally tiny (~50 LOC) so threat-modeling can
audit it on one screen. Performance budget: ≤100 µs round-trip on Radxa.
See `docs/architecture/profile-cards.md` §5 for the frozen interface and
§7 for the performance budget.
"""
from __future__ import annotations

import base64

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

__all__ = ["encrypt_pii", "decrypt_pii", "derive_data_key", "InvalidToken"]

# HKDF parameters frozen by ADR-CRP-002. The `-v1` suffix on the salt is the
# rotation hatch: Day-5 may bump derivation parameters by introducing
# `b"phantom-pii-v2"` plus a one-shot re-encrypt migration script. The salt
# is NOT secret — it is a domain separator.
_HKDF_SALT = b"phantom-pii-v1"
_HKDF_INFO = b"phantom-os/pii-encryption"
_KEY_LENGTH = 32


def derive_data_key() -> bytes:
    """32-byte key derived from `config.jwt_secret_key` via HKDF-SHA256.

    Re-derives every call (no module-level cache). HKDF over a 32-byte
    secret is ~5 µs on Radxa — orders of magnitude below Fernet.encrypt's
    ~30 µs — so caching would not move the needle and would hide rotation
    bugs (a cached key persists past a `JWT_SECRET_KEY` reload).

    Raises:
        RuntimeError: when `config.jwt_secret_key` is empty. Test runs
            and fresh installs that forget to set the env var SHOULD fail
            loudly here rather than encrypt under a derivable empty key.
    """
    # Imported inside the function so this module stays import-safe even
    # when `config.py` cannot be loaded (e.g., during isolated unit tests
    # that monkeypatch the config object).
    from config import config

    if not config.jwt_secret_key:
        raise RuntimeError(
            "jwt_secret_key is unset; cannot derive PII encryption key. "
            "Set JWT_SECRET_KEY in the environment or .env file."
        )
    return HKDF(
        algorithm=hashes.SHA256(),
        length=_KEY_LENGTH,
        salt=_HKDF_SALT,
        info=_HKDF_INFO,
    ).derive(config.jwt_secret_key.encode("utf-8"))


def _fernet() -> Fernet:
    """Build a fresh Fernet instance from the current derived key.

    Fresh on every call so rotation events are observable instantly — the
    next `encrypt_pii`/`decrypt_pii` after a `JWT_SECRET_KEY` change picks
    up the new key without a process restart.
    """
    return Fernet(base64.urlsafe_b64encode(derive_data_key()))


def encrypt_pii(plaintext: bytes | str) -> str:
    """Encrypt PII into a URL-safe base64 Fernet token (ASCII string).

    Strings are encoded as UTF-8 before encryption. The returned token is
    safe to store directly in a SQLAlchemy `Text` column.
    """
    if isinstance(plaintext, str):
        plaintext = plaintext.encode("utf-8")
    return _fernet().encrypt(plaintext).decode("ascii")


def decrypt_pii(token: str) -> str:
    """Decrypt a Fernet token back to its UTF-8 plaintext.

    Raises:
        cryptography.fernet.InvalidToken: token tampered, truncated, or
            encrypted under a different `JWT_SECRET_KEY`. Per ADR-CRP-003
            the route layer turns this into HTTP 503 with header
            `X-Error-Code: PII_KEY_ROTATION_REQUIRED` for whole-DB rotation
            events, or per-row `decrypt_error: "tamper"` for single-row
            corruption.
    """
    return _fernet().decrypt(token.encode("ascii")).decode("utf-8")
