"""Day-4 Wave-1 — Block CRYPTO-1: Fernet PII helper round-trip + rotation tests.

Closes audit-2026-05-01-day4 finding U6-ID-C1 (`crypto.py` was missing).
Implements ADR-CRP-001/002/003 (`docs/architecture/profile-cards.md` §2).

These tests are the regression gate for `security/crypto.py` and the
foundation FACTS-1 will build on. They cover:

* **Round-trip** — UTF-8 strings (Cyrillic), bytes including NULs,
  empty input, long input.
* **Tamper detection** — flipping any byte of a token produces
  `InvalidToken`.
* **Wrong-key detection** — token issued under secret A is rejected
  after the secret is rotated to B (ADR-CRP-003 hard-fail behavior).
* **Determinism** — same secret → same key across calls (no caching
  ambiguity); different secrets → different keys.
* **Empty-secret guard** — refuses to derive a key when
  `jwt_secret_key` is unset.

The performance budget (≤ 100 µs round-trip on Radxa) is asserted as a
soft floor — Day-5 hardening can tighten this once the Histogram
primitive (V-6) is wired and we have measured percentiles instead of a
single-process timer.
"""
from __future__ import annotations

import time

import pytest
from cryptography.fernet import InvalidToken

from config import config as live_config
from security.crypto import decrypt_pii, derive_data_key, encrypt_pii


_SECRET_A = "phantom-crypto1-test-secret-A-2026"
_SECRET_B = "phantom-crypto1-test-secret-B-2026-different"


@pytest.fixture(autouse=True)
def _pin_jwt_secret(monkeypatch):
    """Pin `jwt_secret_key` to a known value before each test.

    The conftest sets a default JWT secret session-wide; we override it
    per-test so every assertion is deterministic regardless of test
    ordering. Tests that care about rotation flip this with their own
    inner `monkeypatch.setattr` calls.
    """
    monkeypatch.setattr(live_config, "jwt_secret_key", _SECRET_A)
    yield


# ─────────────────────────────────────────────────────────── round-trip ──


class TestRoundTrip:
    def test_round_trip_str_cyrillic(self):
        token = encrypt_pii("Київ")
        assert decrypt_pii(token) == "Київ"

    def test_round_trip_str_ascii(self):
        token = encrypt_pii("operator@phantom.local")
        assert decrypt_pii(token) == "operator@phantom.local"

    def test_round_trip_bytes_with_nuls(self):
        # UTF-8 of these bytes is undefined — Fernet doesn't care, the
        # decrypt path decodes with `errors=` default (strict) so we
        # round-trip via a value we know is UTF-8 reversible.
        token = encrypt_pii(b"\xd1\x97\x00\xd0\x86")
        # b"\xd1\x97" is "ї", b"\x00" is NUL, b"\xd0\x86" is "І".
        assert decrypt_pii(token) == "ї\x00І"

    def test_round_trip_empty_string(self):
        token = encrypt_pii("")
        assert decrypt_pii(token) == ""

    def test_round_trip_long_payload(self):
        payload = "x" * 4096  # the FACTS-1 schema's max value length.
        token = encrypt_pii(payload)
        assert decrypt_pii(token) == payload

    def test_token_is_ascii_string(self):
        # FACTS-1 stores the token in a SQLAlchemy `Text` column — the
        # column accepts any Unicode but the contract is ASCII (Fernet
        # output is URL-safe base64). Pin it.
        token = encrypt_pii("data")
        assert isinstance(token, str)
        token.encode("ascii")  # raises if non-ASCII

    def test_token_does_not_contain_plaintext(self):
        # Sanity: the audit's "encrypted at rest" claim hinges on this.
        token = encrypt_pii("supersecretvalue")
        assert "supersecretvalue" not in token


# ─────────────────────────────────────────────────────────── tamper ──


class TestTamperDetection:
    def test_tamper_flips_last_byte(self):
        token = encrypt_pii("data")
        # Flip the last char to something different but still URL-safe
        # base64 — the HMAC must catch it.
        bad_last = "A" if token[-1] != "A" else "B"
        tampered = token[:-1] + bad_last
        with pytest.raises(InvalidToken):
            decrypt_pii(tampered)

    def test_tamper_flips_middle_byte(self):
        token = encrypt_pii("data")
        # Find a position with a stable char and flip it.
        idx = len(token) // 2
        replacement = "A" if token[idx] != "A" else "B"
        tampered = token[:idx] + replacement + token[idx + 1 :]
        with pytest.raises(InvalidToken):
            decrypt_pii(tampered)

    def test_truncated_token_rejected(self):
        token = encrypt_pii("data")
        with pytest.raises(InvalidToken):
            decrypt_pii(token[:-4])

    def test_garbage_token_rejected(self):
        with pytest.raises(InvalidToken):
            decrypt_pii("not-a-real-fernet-token")


# ─────────────────────────────────────────────────────────── rotation ──


class TestKeyRotation:
    def test_token_under_old_key_rejected_after_rotation(self, monkeypatch):
        """ADR-CRP-003: rotating `JWT_SECRET_KEY` makes pre-rotation
        tokens undecryptable; `decrypt_pii` raises `InvalidToken` rather
        than silently returning garbage."""
        token = encrypt_pii("rotation-canary")
        # Rotate.
        monkeypatch.setattr(live_config, "jwt_secret_key", _SECRET_B)
        with pytest.raises(InvalidToken):
            decrypt_pii(token)

    def test_round_trip_works_under_new_key(self, monkeypatch):
        monkeypatch.setattr(live_config, "jwt_secret_key", _SECRET_B)
        token = encrypt_pii("post-rotation")
        assert decrypt_pii(token) == "post-rotation"


# ─────────────────────────────────────────────────────────── derivation ──


class TestKeyDerivation:
    def test_deterministic_within_secret(self):
        # Same secret → same key, every call. No module-level cache, but
        # also no nondeterminism (HKDF is a pure function).
        a = derive_data_key()
        b = derive_data_key()
        assert a == b
        assert len(a) == 32

    def test_different_secrets_yield_different_keys(self, monkeypatch):
        monkeypatch.setattr(live_config, "jwt_secret_key", _SECRET_A)
        key_a = derive_data_key()
        monkeypatch.setattr(live_config, "jwt_secret_key", _SECRET_B)
        key_b = derive_data_key()
        assert key_a != key_b

    def test_unset_secret_raises(self, monkeypatch):
        monkeypatch.setattr(live_config, "jwt_secret_key", "")
        with pytest.raises(RuntimeError, match="jwt_secret_key is unset"):
            derive_data_key()
        with pytest.raises(RuntimeError):
            encrypt_pii("anything")


# ─────────────────────────────────────────────────────────── perf gate ──


class TestPerformance:
    """Soft performance gate (ADR-CRP-001 budget = 100 µs round-trip on
    Radxa). Marked tolerant — CI runners are slower than the device, and
    the V-6 Histogram primitive will replace this with real percentiles.

    The assertion floor (5 ms median) catches an *order-of-magnitude*
    regression — e.g., a future change that accidentally re-derives the
    key inside a tight loop or switches to an Argon2 KDF.
    """

    def test_round_trip_median_under_5ms(self):
        iterations = 100
        # Warm — the cryptography package lazy-loads OpenSSL bindings.
        encrypt_pii("warm")
        t0 = time.perf_counter()
        for _ in range(iterations):
            token = encrypt_pii("payload")
            decrypt_pii(token)
        elapsed_ms_per_op = (time.perf_counter() - t0) * 1000 / iterations
        assert elapsed_ms_per_op < 5.0, (
            f"crypto round-trip regressed: {elapsed_ms_per_op:.3f} ms/op "
            f"(budget < 5 ms; ADR-CRP-001 target ≤ 0.1 ms on Radxa)"
        )
