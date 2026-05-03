"""
Phase 25-A — Vault crypto + DB models.

Verifies:
  • AES-256-GCM round-trip for vault fields
  • Per-user key derivation (user A cannot decrypt user B's tokens)
  • AAD binding (a token moved between cards or fields fails decryption)
  • Nonce uniqueness across encryptions of the same plaintext
  • Domain separation from PII Fernet (vault_crypto != crypto.encrypt_pii)
  • JWT_SECRET_KEY rotation invalidates all tokens (loud failure)
  • DB models declared with the right columns and indexes
"""
from __future__ import annotations

import os

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase25a-vault")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


# ─── 1. Crypto round-trip ────────────────────────────────────────────────────


class TestCryptoRoundTrip:
    def test_round_trip_string(self) -> None:
        from security.vault_crypto import decrypt_field, encrypt_field
        token = encrypt_field(
            user_id="alice", card_id="card-1", field_name="password",
            plaintext="hunter2",
        )
        assert isinstance(token, str)
        assert token != "hunter2"
        plaintext = decrypt_field(
            user_id="alice", card_id="card-1", field_name="password",
            token=token,
        )
        assert plaintext == "hunter2"

    def test_round_trip_unicode(self) -> None:
        """Ukrainian + emoji + control chars must survive."""
        from security.vault_crypto import decrypt_field, encrypt_field
        secret = "Пароль: пе́рший — \n\t рядок 🔐"
        token = encrypt_field(
            user_id="bob", card_id="c", field_name="f", plaintext=secret,
        )
        assert decrypt_field(
            user_id="bob", card_id="c", field_name="f", token=token,
        ) == secret

    def test_round_trip_bytes(self) -> None:
        from security.vault_crypto import decrypt_field, encrypt_field
        # Random binary that is valid UTF-8 (high-bit-clear)
        secret = bytes(range(32, 127))
        token = encrypt_field(
            user_id="u", card_id="c", field_name="f", plaintext=secret,
        )
        assert decrypt_field(
            user_id="u", card_id="c", field_name="f", token=token,
        ) == secret.decode("utf-8")


# ─── 2. AAD binding ──────────────────────────────────────────────────────────


class TestAADBinding:
    def test_wrong_card_id_fails(self) -> None:
        from security.vault_crypto import (
            InvalidVaultToken, decrypt_field, encrypt_field,
        )
        token = encrypt_field(
            user_id="u", card_id="card-A", field_name="password",
            plaintext="secret",
        )
        with pytest.raises(InvalidVaultToken):
            decrypt_field(
                user_id="u", card_id="card-B", field_name="password",
                token=token,
            )

    def test_wrong_field_name_fails(self) -> None:
        """AAD binds card_id|field_name — moving a token from `password`
        to `notes` slot must fail decryption."""
        from security.vault_crypto import (
            InvalidVaultToken, decrypt_field, encrypt_field,
        )
        token = encrypt_field(
            user_id="u", card_id="card", field_name="password",
            plaintext="secret",
        )
        with pytest.raises(InvalidVaultToken):
            decrypt_field(
                user_id="u", card_id="card", field_name="notes",
                token=token,
            )


# ─── 3. Per-user isolation ──────────────────────────────────────────────────


class TestPerUserIsolation:
    def test_user_a_cannot_decrypt_user_b_token(self) -> None:
        from security.vault_crypto import (
            InvalidVaultToken, decrypt_field, encrypt_field,
        )
        token = encrypt_field(
            user_id="alice", card_id="card", field_name="password",
            plaintext="alice-secret",
        )
        with pytest.raises(InvalidVaultToken):
            decrypt_field(
                user_id="bob", card_id="card", field_name="password",
                token=token,
            )

    def test_derived_keys_differ_per_user(self) -> None:
        from security.vault_crypto import derive_user_vault_key
        ka = derive_user_vault_key("user-a")
        kb = derive_user_vault_key("user-b")
        assert ka != kb
        assert len(ka) == 32 and len(kb) == 32

    def test_derived_key_stable_for_same_user(self) -> None:
        from security.vault_crypto import derive_user_vault_key
        assert derive_user_vault_key("u") == derive_user_vault_key("u")

    def test_user_id_is_stringified(self) -> None:
        """A user_id passed as int and as str must yield the SAME key —
        callers that read user_id from DB (int PK) and from JWT (str)
        must not get separate keys."""
        from security.vault_crypto import derive_user_vault_key
        assert derive_user_vault_key("123") == derive_user_vault_key(123)


# ─── 4. Nonce uniqueness ────────────────────────────────────────────────────


class TestNonceUniqueness:
    def test_same_plaintext_yields_distinct_tokens(self) -> None:
        """Two encryptions of the same plaintext under the same key+AAD
        MUST yield different ciphertexts (fresh nonce per call). Without
        this, an attacker observing many encryptions could detect that
        two cards share a password."""
        from security.vault_crypto import encrypt_field
        kw = dict(user_id="u", card_id="c", field_name="f", plaintext="x")
        tokens = {encrypt_field(**kw) for _ in range(20)}
        assert len(tokens) == 20  # all distinct


# ─── 5. JWT rotation discipline ─────────────────────────────────────────────


class TestJWTRotation:
    def test_rotated_secret_invalidates_token(self, monkeypatch) -> None:
        from security.vault_crypto import (
            InvalidVaultToken, decrypt_field, encrypt_field,
        )
        from config import config

        original = config.jwt_secret_key
        token = encrypt_field(
            user_id="u", card_id="c", field_name="f",
            plaintext="written under old key",
        )
        try:
            monkeypatch.setattr(config, "jwt_secret_key", "rotated-new-secret-DIFFERENT")
            with pytest.raises(InvalidVaultToken):
                decrypt_field(
                    user_id="u", card_id="c", field_name="f", token=token,
                )
        finally:
            monkeypatch.setattr(config, "jwt_secret_key", original)

    def test_empty_secret_raises_distinct_error(self, monkeypatch) -> None:
        from security.vault_crypto import (
            VaultKeyUnavailable, derive_user_vault_key,
        )
        from config import config
        monkeypatch.setattr(config, "jwt_secret_key", "")
        with pytest.raises(VaultKeyUnavailable):
            derive_user_vault_key("u")


# ─── 6. Domain separation from PII Fernet ───────────────────────────────────


class TestDomainSeparation:
    def test_vault_token_is_not_a_fernet_token(self) -> None:
        """Vault uses base64url(nonce||ct||tag); Fernet uses URL-safe b64
        of `version||timestamp||IV||ct||hmac`. They MUST be visibly
        distinct so accidental cross-decryption attempts fail loud."""
        from security.crypto import decrypt_pii, encrypt_pii
        from security.vault_crypto import encrypt_field

        pii = encrypt_pii("xx")
        vault = encrypt_field(
            user_id="u", card_id="c", field_name="f", plaintext="xx",
        )
        # Fernet tokens always start with the URL-safe encoding of
        # version byte 0x80 ('g'). Vault tokens start with whatever
        # urandom produced — overwhelmingly NOT 'g'. Sample many
        # vault encryptions to be sure.
        prefixes = {encrypt_field(
            user_id="u", card_id="c", field_name="f", plaintext="x",
        )[0] for _ in range(50)}
        assert pii.startswith("g") or pii.startswith("Z")  # Fernet header
        # Vault token character distribution should NOT collapse to one
        # specific Fernet-header byte.
        assert len(prefixes) > 1

        # A vault token must NOT decrypt as a Fernet token.
        from cryptography.fernet import InvalidToken
        with pytest.raises(InvalidToken):
            decrypt_pii(vault)


# ─── 7. Tampering detection ─────────────────────────────────────────────────


class TestTampering:
    def test_truncated_token_rejected(self) -> None:
        from security.vault_crypto import (
            InvalidVaultToken, decrypt_field, encrypt_field,
        )
        token = encrypt_field(
            user_id="u", card_id="c", field_name="f", plaintext="hello",
        )
        with pytest.raises(InvalidVaultToken):
            decrypt_field(
                user_id="u", card_id="c", field_name="f", token=token[:8],
            )

    def test_garbage_token_rejected(self) -> None:
        from security.vault_crypto import (
            InvalidVaultToken, decrypt_field,
        )
        with pytest.raises(InvalidVaultToken):
            decrypt_field(
                user_id="u", card_id="c", field_name="f",
                token="this is not even base64!!",
            )

    def test_flipped_byte_in_ciphertext_rejected(self) -> None:
        """Single bit-flip in the ciphertext body MUST fail GCM tag check."""
        import base64

        from security.vault_crypto import (
            InvalidVaultToken, decrypt_field, encrypt_field,
        )
        token = encrypt_field(
            user_id="u", card_id="c", field_name="f", plaintext="hello",
        )
        blob = bytearray(base64.urlsafe_b64decode(token.encode("ascii")))
        # Flip the last byte (part of the GCM tag).
        blob[-1] ^= 0x01
        bad = base64.urlsafe_b64encode(bytes(blob)).decode("ascii")
        with pytest.raises(InvalidVaultToken):
            decrypt_field(
                user_id="u", card_id="c", field_name="f", token=bad,
            )


# ─── 8. DB models ───────────────────────────────────────────────────────────


class TestVaultModels:
    def test_vault_card_columns_present(self) -> None:
        from db.models import VaultCard
        cols = {c.name for c in VaultCard.__table__.columns}
        for required in (
            "id", "owner_user_id", "kind", "label", "fields_json",
            "tags_json", "ai_writable", "deleted_at",
            "created_at", "updated_at", "last_accessed_at",
        ):
            assert required in cols, f"VaultCard missing column {required!r}"

    def test_vault_card_owner_fk_to_users(self) -> None:
        from db.models import VaultCard
        col = VaultCard.__table__.columns["owner_user_id"]
        fks = list(col.foreign_keys)
        assert len(fks) == 1
        assert fks[0].column.table.name == "users"

    def test_vault_audit_columns_present(self) -> None:
        from db.models import VaultAuditEntry
        cols = {c.name for c in VaultAuditEntry.__table__.columns}
        for required in (
            "id", "user_id", "card_id", "action", "actor",
            "details_json", "created_at",
        ):
            assert required in cols, (
                f"VaultAuditEntry missing column {required!r}"
            )

    def test_useful_indexes_declared(self) -> None:
        """Hot paths: (owner, kind) for filtered listing,
        (owner, deleted_at) for active-only queries, audit by card."""
        from db.models import VaultCard, VaultAuditEntry
        card_idx_names = {idx.name for idx in VaultCard.__table_args__}
        assert "ix_vault_cards_owner_kind" in card_idx_names
        assert "ix_vault_cards_active" in card_idx_names
        audit_idx_names = {idx.name for idx in VaultAuditEntry.__table_args__}
        assert "ix_vault_audit_card" in audit_idx_names
        assert "ix_vault_audit_user_action" in audit_idx_names
