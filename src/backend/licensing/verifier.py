"""Offline license verification. The device trusts ONLY the embedded/env
public key — never a key delivered alongside the certificate."""
from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from licensing.fingerprint import device_fingerprint

# Dev/staging signing identity; production images override via PHANTOM_LICENSE_PUBKEY.
DEV_PUBLIC_KEY_HEX = "c55c57a15eb8647efdcf3ae6d3dde6b7c3ec713ed3b1af6492b6234e1b0b409f"


def trusted_public_key_hex() -> str:
    return os.environ.get("PHANTOM_LICENSE_PUBKEY", DEV_PUBLIC_KEY_HEX)


def license_file_path() -> Path:
    return Path(os.environ.get("PHANTOM_LICENSE_FILE", "~/.phantom/license.json")).expanduser()


@dataclass
class LicenseStatus:
    valid: bool
    reason: str
    tier: str | None = None
    license_id: str | None = None
    serial: str | None = None
    updates_until: str | None = None
    fingerprint: str | None = None

    def as_dict(self) -> dict:
        return {
            "valid": self.valid,
            "reason": self.reason,
            "tier": self.tier,
            "license_id": self.license_id,
            "serial": self.serial,
            "updates_until": self.updates_until,
            "fingerprint": self.fingerprint,
        }


def verify_certificate(cert: dict, public_key_hex: str | None = None) -> bool:
    key_hex = public_key_hex or trusted_public_key_hex()
    try:
        unsigned = {k: v for k, v in cert.items() if k != "sig"}
        payload = json.dumps(unsigned, sort_keys=True, separators=(",", ":")).encode()
        public = Ed25519PublicKey.from_public_bytes(bytes.fromhex(key_hex))
        public.verify(base64.b64decode(cert["sig"]), payload)
        return True
    except Exception:
        return False


def license_status() -> LicenseStatus:
    fp = device_fingerprint()
    path = license_file_path()
    if not path.exists():
        return LicenseStatus(valid=False, reason="not_activated", fingerprint=fp)
    try:
        cert = json.loads(path.read_text())["certificate"]
    except (OSError, KeyError, json.JSONDecodeError):
        return LicenseStatus(valid=False, reason="corrupt_license_file", fingerprint=fp)
    if not verify_certificate(cert):
        return LicenseStatus(valid=False, reason="bad_signature", fingerprint=fp)
    if cert.get("device_fingerprint") != fp:
        return LicenseStatus(valid=False, reason="device_mismatch", fingerprint=fp)
    return LicenseStatus(
        valid=True,
        reason="ok",
        tier=cert.get("tier"),
        license_id=cert.get("license_id"),
        serial=cert.get("serial"),
        updates_until=cert.get("updates_until"),
        fingerprint=fp,
    )


def store_certificate(cert: dict) -> None:
    path = license_file_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"certificate": cert}, indent=2))
    path.chmod(0o600)


def remove_certificate() -> None:
    path = license_file_path()
    if path.exists():
        path.unlink()
