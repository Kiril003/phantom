import base64
import json

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from licensing import verifier
from licensing.fingerprint import device_fingerprint


def _sign(cert: dict, private: Ed25519PrivateKey) -> dict:
    payload = json.dumps(cert, sort_keys=True, separators=(",", ":")).encode()
    return {**cert, "sig": base64.b64encode(private.sign(payload)).decode()}


@pytest.fixture()
def keypair(monkeypatch):
    private = Ed25519PrivateKey.generate()
    pub_hex = private.public_key().public_bytes_raw().hex()
    monkeypatch.setenv("PHANTOM_LICENSE_PUBKEY", pub_hex)
    return private


@pytest.fixture()
def license_file(tmp_path, monkeypatch):
    path = tmp_path / "license.json"
    monkeypatch.setenv("PHANTOM_LICENSE_FILE", str(path))
    return path


def _valid_cert(private: Ed25519PrivateKey) -> dict:
    return _sign(
        {
            "v": 1,
            "license_id": "lic-1",
            "serial": "ser-1",
            "tier": "image",
            "device_fingerprint": device_fingerprint(),
            "updates_until": "2027-07-05",
            "issued_at": "2026-07-05T00:00:00+00:00",
        },
        private,
    )


def test_fingerprint_is_stable_sha256():
    fp = device_fingerprint()
    assert fp == device_fingerprint()
    assert len(fp) == 64 and int(fp, 16) >= 0


def test_status_not_activated(keypair, license_file):
    status = verifier.license_status()
    assert not status.valid and status.reason == "not_activated"


def test_valid_certificate_roundtrip(keypair, license_file):
    verifier.store_certificate(_valid_cert(keypair))
    status = verifier.license_status()
    assert status.valid and status.reason == "ok"
    assert status.tier == "image" and status.updates_until == "2027-07-05"
    assert oct(license_file.stat().st_mode & 0o777) == "0o600"


def test_tampered_certificate_rejected(keypair, license_file):
    cert = _valid_cert(keypair)
    cert["tier"] = "atelier"  # bump tier after signing
    verifier.store_certificate(cert)
    assert verifier.license_status().reason == "bad_signature"


def test_wrong_device_rejected(keypair, license_file):
    cert = _sign(
        {"v": 1, "license_id": "lic-1", "serial": "s", "tier": "image",
         "device_fingerprint": "f" * 64, "updates_until": None,
         "issued_at": "2026-07-05T00:00:00+00:00"},
        keypair,
    )
    verifier.store_certificate(cert)
    assert verifier.license_status().reason == "device_mismatch"


def test_untrusted_signer_rejected(keypair, license_file, monkeypatch):
    intruder = Ed25519PrivateKey.generate()
    verifier.store_certificate(_valid_cert(intruder))
    assert verifier.license_status().reason == "bad_signature"


def test_corrupt_file_rejected(keypair, license_file):
    license_file.write_text("{not json")
    assert verifier.license_status().reason == "corrupt_license_file"


def test_remove_certificate(keypair, license_file):
    verifier.store_certificate(_valid_cert(keypair))
    verifier.remove_certificate()
    assert verifier.license_status().reason == "not_activated"
