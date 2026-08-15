"""Phase 19-9 — POST /api/v1/pair/refresh device JWT sliding refresh.

Per docs/MOBILE_COMPANION.md §9 "Token rotation: device JWT TTL 30
days, refresh — лише з валідним device-key signature; sliding window".

Without a refresh path, every paired phone has to re-scan a fresh QR
every 30 days even when it's still in active use — defeats the
"physical-presence required ONLY at first pairing" property described
in the design's TOFU section.

Phase 19-9 ships:
  • `decode_expired_device_token` — like `verify_device_token` but
    bypasses the per-token `exp` check while still enforcing
    signature, audience, role, and the ABSOLUTE_LIFETIME_DAYS cap
    anchored on `orig_iat`. Intentionally not a FastAPI dependency
    so it can never be used as auth on its own.
  • `POST /api/v1/pair/refresh` — phone posts old (possibly expired)
    JWT + a freshly-generated nonce + an Ed25519 signature over
    `device_id:nonce`. Server verifies the sig against the device
    pubkey pinned at /pair/claim time, rejects revoked / unknown /
    owner-mismatched rows, mints a new JWT preserving `orig_iat`,
    bumps `last_seen_at`.
  • Bearer auth deliberately NOT required — the old JWT may be
    expired, and the Ed25519 sig is the actual proof of identity
    (key lives in biometric-gated Android Keystore, only accessible
    to the legit phone).

These tests exercise:
  • Successful refresh — fresh token returned, orig_iat preserved,
    last_seen_at bumps.
  • Refresh works even when old JWT is past `exp` (sliding-window
    end-to-end).
  • Bad Ed25519 signature → 401/bad_signature.
  • Revoked device → 401/device_revoked.
  • Owner mismatch → 401/device_owner_mismatch.
  • Forged JWT (wrong audience) → 401/old_token_rejected.
  • Tampered nonce (sig was computed over a different nonce) →
    401/bad_signature (replay-resistance proxy).
"""
from __future__ import annotations

import base64
import os
from datetime import datetime, timedelta, timezone
from typing import AsyncIterator

import pytest
import pytest_asyncio
from cryptography.hazmat.primitives.asymmetric import ed25519

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase19-9")


def _gen_keypair() -> tuple[ed25519.Ed25519PrivateKey, str]:
    priv = ed25519.Ed25519PrivateKey.generate()
    pub_bytes = priv.public_key().public_bytes_raw()
    return priv, base64.b64encode(pub_bytes).decode("ascii")


def _sign(priv: ed25519.Ed25519PrivateKey, message: bytes) -> str:
    return base64.b64encode(priv.sign(message)).decode("ascii")


@pytest_asyncio.fixture
async def paired_with_keys(auth_root_user) -> AsyncIterator[dict]:
    """Insert a PairedDevice using a real Ed25519 pubkey we control,
    mint a device JWT for it, yield everything the test needs."""
    from db.database import AsyncSessionLocal
    from db.models import PairedDevice
    from security.device_token import create_device_token

    priv, pub_b64 = _gen_keypair()

    async with AsyncSessionLocal() as s:
        row = PairedDevice(
            user_id=auth_root_user.id,
            device_name="Pixel Refresh",
            device_model="google/pixel9",
            platform="android",
            device_pub_ed25519=pub_b64,
            capabilities_json='["sensors"]',
        )
        s.add(row)
        await s.commit()
        await s.refresh(row)
        device_id = row.id
        original_last_seen = row.last_seen_at

    jwt_token, exp_iso = create_device_token(
        device_id=device_id, user_id=auth_root_user.id
    )
    yield {
        "priv": priv,
        "pub_b64": pub_b64,
        "device_id": device_id,
        "user_id": auth_root_user.id,
        "jwt": jwt_token,
        "exp_iso": exp_iso,
        "original_last_seen": original_last_seen,
    }


def _refresh_body(*, device_id: str, priv: ed25519.Ed25519PrivateKey,
                  nonce_b64: str, jwt: str) -> dict:
    challenge = f"{device_id}:{nonce_b64}".encode("utf-8")
    return {
        "old_token": jwt,
        "nonce_b64": nonce_b64,
        "signature_b64": _sign(priv, challenge),
    }


def test_refresh_succeeds_with_valid_signature(paired_with_keys, unauth_client):
    body = _refresh_body(
        device_id=paired_with_keys["device_id"],
        priv=paired_with_keys["priv"],
        nonce_b64="aaaaaaaaaaaaaaaaaaaaaa==",
        jwt=paired_with_keys["jwt"],
    )
    resp = unauth_client.post("/api/v1/pair/refresh", json=body)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["device_jwt"] != paired_with_keys["jwt"]  # fresh token
    assert "expires_at" in data


def test_refresh_preserves_orig_iat(paired_with_keys, unauth_client):
    """orig_iat carries the absolute-lifetime anchor — refresh MUST
    keep it stable, otherwise the chain extends forever and the
    30-day "force re-pair" guarantee dies."""
    from security.device_token import verify_device_token

    old_payload = verify_device_token(paired_with_keys["jwt"])

    body = _refresh_body(
        device_id=paired_with_keys["device_id"],
        priv=paired_with_keys["priv"],
        nonce_b64="bbbbbbbbbbbbbbbbbbbbbb==",
        jwt=paired_with_keys["jwt"],
    )
    resp = unauth_client.post("/api/v1/pair/refresh", json=body)
    assert resp.status_code == 200

    new_payload = verify_device_token(resp.json()["device_jwt"])
    assert new_payload.orig_iat == old_payload.orig_iat
    assert new_payload.iat >= old_payload.iat
    # "Fresh 30d window" expressed without depending on sub-second timing:
    # `exp` is derived as `iat + window`, and both claims have 1-second
    # resolution, so a refresh completing inside the same second as the
    # original issuance produces an identical `exp`. `exp > exp` therefore
    # failed purely on speed. What actually matters is that the window is
    # re-based on the new issuance and never moves backwards.
    assert new_payload.exp >= old_payload.exp
    assert (new_payload.exp - new_payload.iat) == (old_payload.exp - old_payload.iat), (
        "refresh must re-base the same 30-day window, not extend or shrink it"
    )


@pytest.mark.asyncio
async def test_refresh_bumps_last_seen_at(paired_with_keys, unauth_client):
    from db.database import AsyncSessionLocal
    from db.models import PairedDevice

    body = _refresh_body(
        device_id=paired_with_keys["device_id"],
        priv=paired_with_keys["priv"],
        nonce_b64="cccccccccccccccccccccc==",
        jwt=paired_with_keys["jwt"],
    )
    resp = unauth_client.post("/api/v1/pair/refresh", json=body)
    assert resp.status_code == 200

    async with AsyncSessionLocal() as s:
        row = await s.get(PairedDevice, paired_with_keys["device_id"])
        assert row is not None
        assert row.last_seen_at >= paired_with_keys["original_last_seen"]


def test_refresh_with_expired_old_jwt_still_works(paired_with_keys, unauth_client):
    """Sliding-window proof: old JWT is past `exp`, refresh MUST
    still succeed because Ed25519 sig is the real authority."""
    from security.device_token import create_device_token

    # Mint a token that's already expired (negative ttl_days), but
    # still inside ABSOLUTE_LIFETIME_DAYS via orig_iat.
    expired_jwt, _ = create_device_token(
        device_id=paired_with_keys["device_id"],
        user_id=paired_with_keys["user_id"],
        ttl_days=-1,
        orig_iat=int(datetime.now(tz=timezone.utc).timestamp()),
    )

    body = _refresh_body(
        device_id=paired_with_keys["device_id"],
        priv=paired_with_keys["priv"],
        nonce_b64="dddddddddddddddddddddd==",
        jwt=expired_jwt,
    )
    resp = unauth_client.post("/api/v1/pair/refresh", json=body)
    assert resp.status_code == 200, resp.text


def test_refresh_with_bad_signature_returns_401(paired_with_keys, unauth_client):
    """Wrong key signing the challenge → 401, no new token issued."""
    rogue_priv, _ = _gen_keypair()

    challenge = f"{paired_with_keys['device_id']}:zzzzzzzzzzzzzzzzz==".encode("utf-8")
    body = {
        "old_token": paired_with_keys["jwt"],
        "nonce_b64": "zzzzzzzzzzzzzzzzz==",
        "signature_b64": _sign(rogue_priv, challenge),
    }
    resp = unauth_client.post("/api/v1/pair/refresh", json=body)
    assert resp.status_code == 401
    assert resp.json()["detail"]["code"] == "bad_signature"


def test_refresh_with_tampered_nonce_returns_401(paired_with_keys, unauth_client):
    """Sig was computed over nonce A, body advertises nonce B — must
    fail signature verification (basic replay protection)."""
    challenge_a = f"{paired_with_keys['device_id']}:nonceA==".encode("utf-8")
    body = {
        "old_token": paired_with_keys["jwt"],
        "nonce_b64": "nonceBBBBBBBBBBBB==",  # different from what was signed
        "signature_b64": _sign(paired_with_keys["priv"], challenge_a),
    }
    resp = unauth_client.post("/api/v1/pair/refresh", json=body)
    assert resp.status_code == 401
    assert resp.json()["detail"]["code"] == "bad_signature"


@pytest.mark.asyncio
async def test_refresh_with_revoked_device_returns_401(
    paired_with_keys, unauth_client
):
    from db.database import AsyncSessionLocal
    from db.models import PairedDevice

    async with AsyncSessionLocal() as s:
        row = await s.get(PairedDevice, paired_with_keys["device_id"])
        assert row is not None
        row.revoked_at = datetime.now(tz=timezone.utc)
        row.revoked_reason = "test"
        await s.commit()

    body = _refresh_body(
        device_id=paired_with_keys["device_id"],
        priv=paired_with_keys["priv"],
        nonce_b64="eeeeeeeeeeeeeeeeeeeeee==",
        jwt=paired_with_keys["jwt"],
    )
    resp = unauth_client.post("/api/v1/pair/refresh", json=body)
    assert resp.status_code == 401
    assert resp.json()["detail"]["code"] == "device_revoked"


def test_refresh_with_user_jwt_audience_returns_401(
    paired_with_keys, unauth_client, auth_root_token
):
    """A user JWT (aud=phantom-app) MUST NOT be accepted by refresh —
    audience guard in decode_expired_device_token catches it."""
    body = _refresh_body(
        device_id=paired_with_keys["device_id"],
        priv=paired_with_keys["priv"],
        nonce_b64="ffffffffffffffffffffff==",
        jwt=auth_root_token,
    )
    resp = unauth_client.post("/api/v1/pair/refresh", json=body)
    assert resp.status_code == 401
    assert resp.json()["detail"]["code"] == "old_token_rejected"
