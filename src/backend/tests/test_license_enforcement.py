import base64
import json

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI
from fastapi.testclient import TestClient

from licensing import enforcement, verifier
from licensing.fingerprint import device_fingerprint


def _sign(cert: dict, private: Ed25519PrivateKey) -> dict:
    payload = json.dumps(cert, sort_keys=True, separators=(",", ":")).encode()
    return {**cert, "sig": base64.b64encode(private.sign(payload)).decode()}


@pytest.fixture(autouse=True)
def _fresh_cache():
    enforcement.invalidate_cache()
    yield
    enforcement.invalidate_cache()


@pytest.fixture()
def keypair(monkeypatch):
    private = Ed25519PrivateKey.generate()
    monkeypatch.setenv(
        "PHANTOM_LICENSE_PUBKEY", private.public_key().public_bytes_raw().hex()
    )
    return private


@pytest.fixture()
def license_file(tmp_path, monkeypatch):
    path = tmp_path / "license.json"
    monkeypatch.setenv("PHANTOM_LICENSE_FILE", str(path))
    return path


@pytest.fixture()
def client():
    app = FastAPI()
    enforcement.install_enforcement(app)

    @app.get("/api/v1/chat/ping")
    async def chat():
        return {"ok": True}

    @app.get("/api/v1/license/status")
    async def lic():
        return {"ok": True}

    @app.get("/api/v1/auth/me")
    async def auth():
        return {"ok": True}

    @app.get("/healthz")
    async def health():
        return {"ok": True}

    return TestClient(app)


def _activate(private: Ed25519PrivateKey) -> None:
    verifier.store_certificate(
        _sign(
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
    )
    enforcement.invalidate_cache()


def test_disabled_passes_everything(client, keypair, license_file, monkeypatch):
    monkeypatch.delenv("PHANTOM_LICENSE_ENFORCE", raising=False)
    assert client.get("/api/v1/chat/ping").status_code == 200


def test_unlicensed_blocked(client, keypair, license_file, monkeypatch):
    monkeypatch.setenv("PHANTOM_LICENSE_ENFORCE", "1")
    resp = client.get("/api/v1/chat/ping")
    assert resp.status_code == 403
    assert resp.json() == {"detail": "license_required", "reason": "not_activated"}


def test_allowlist_open_when_unlicensed(client, keypair, license_file, monkeypatch):
    monkeypatch.setenv("PHANTOM_LICENSE_ENFORCE", "1")
    assert client.get("/api/v1/license/status").status_code == 200
    assert client.get("/api/v1/auth/me").status_code == 200
    assert client.get("/healthz").status_code == 200


def test_valid_license_passes(client, keypair, license_file, monkeypatch):
    monkeypatch.setenv("PHANTOM_LICENSE_ENFORCE", "1")
    _activate(keypair)
    assert client.get("/api/v1/chat/ping").status_code == 200


def test_activation_unblocks_via_cache_invalidation(
    client, keypair, license_file, monkeypatch
):
    monkeypatch.setenv("PHANTOM_LICENSE_ENFORCE", "1")
    assert client.get("/api/v1/chat/ping").status_code == 403
    _activate(keypair)
    assert client.get("/api/v1/chat/ping").status_code == 200


def test_options_preflight_passes(client, keypair, license_file, monkeypatch):
    monkeypatch.setenv("PHANTOM_LICENSE_ENFORCE", "1")
    assert client.options("/api/v1/chat/ping").status_code in (200, 405)
