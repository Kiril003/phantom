"""Ворота більше не заслінка, а фільтр по правах.

Раніше без ліцензії кожен /api/ повертав 403 — тобто продукт без ключа не
працював узагалі. Під чинною моделлю вільний рівень повноцінний, тож ворота
стоять лише на кількох платних гілках і повертають 402 з назвою права.
Головне, що тут перевіряється: розмова, мапа й решта безпечних гілок
відкриті НАВІТЬ коли ліцензії немає або вона поламана.
"""
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
def _fresh_cache(tmp_path, monkeypatch):
    # Проба дала б платний рівень і сховала б саме те, що ми перевіряємо.
    monkeypatch.setenv("PHANTOM_TRIAL_FILE", str(tmp_path / "trial.json"))
    monkeypatch.setenv("PHANTOM_LICENSE_SEEN_FILE", str(tmp_path / "seen.json"))
    from licensing import entitlements

    monkeypatch.setattr(entitlements, "TRIAL_FILE", tmp_path / "trial.json")
    monkeypatch.setattr(entitlements, "LAST_SEEN_FILE", tmp_path / "seen.json")
    monkeypatch.setattr(entitlements, "TRIAL_DAYS", 0)
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

    @app.get("/api/v1/map/offline/packs")
    async def packs():
        return {"ok": True}

    @app.get("/api/v1/pair/status")
    async def pair():
        return {"ok": True}

    @app.get("/api/v1/map/offline/terrain/kyiv")
    async def terrain():
        return {"ok": True}

    @app.get("/api/v1/license/status")
    async def lic():
        return {"ok": True}

    @app.get("/healthz")
    async def health():
        return {"ok": True}

    return TestClient(app)


def _activate(private: Ed25519PrivateKey, tier: str = "personal") -> None:
    verifier.store_certificate(
        _sign(
            {
                "v": 1,
                "license_id": "lic-1",
                "serial": "ser-1",
                "tier": tier,
                "device_fingerprint": device_fingerprint(),
                "updates_until": "2099-07-05",
                "issued_at": "2026-07-05T00:00:00+00:00",
            },
            private,
        )
    )
    enforcement.invalidate_cache()


def test_disabled_passes_everything(client, keypair, license_file, monkeypatch):
    monkeypatch.delenv("PHANTOM_LICENSE_ENFORCE", raising=False)
    assert client.get("/api/v1/pair/status").status_code == 200


class TestSafetyIsNeverBlocked:
    """Обіцянка продукту: без ключа він лишається повноцінним."""

    def test_chat_map_and_health_stay_open_without_a_licence(
        self, client, keypair, license_file, monkeypatch
    ):
        monkeypatch.setenv("PHANTOM_LICENSE_ENFORCE", "1")
        assert client.get("/api/v1/chat/ping").status_code == 200
        assert client.get("/api/v1/map/offline/packs").status_code == 200
        assert client.get("/api/v1/license/status").status_code == 200
        assert client.get("/healthz").status_code == 200

    def test_broken_certificate_does_not_close_the_free_tier(
        self, client, keypair, license_file, monkeypatch
    ):
        monkeypatch.setenv("PHANTOM_LICENSE_ENFORCE", "1")
        license_file.write_text('{"certificate": {"tier": "unit", "sig": "bm9wZQ=="}}')
        enforcement.invalidate_cache()
        assert client.get("/api/v1/chat/ping").status_code == 200
        assert client.get("/api/v1/map/offline/packs").status_code == 200


class TestPaidGates:
    def test_paid_branch_answers_402_with_the_name_of_the_right(
        self, client, keypair, license_file, monkeypatch
    ):
        monkeypatch.setenv("PHANTOM_LICENSE_ENFORCE", "1")
        resp = client.get("/api/v1/pair/status")
        assert resp.status_code == 402
        body = resp.json()
        assert body["detail"] == "upgrade_required"
        assert body["feature"] == "bridge.pair"
        assert body["needs_tier"] == "personal"
        assert body["tier"] == "free"

    def test_terrain_is_gated_but_the_rest_of_the_map_is_not(
        self, client, keypair, license_file, monkeypatch
    ):
        monkeypatch.setenv("PHANTOM_LICENSE_ENFORCE", "1")
        assert client.get("/api/v1/map/offline/terrain/kyiv").status_code == 402
        assert client.get("/api/v1/map/offline/packs").status_code == 200

    def test_valid_licence_opens_the_paid_branch(
        self, client, keypair, license_file, monkeypatch
    ):
        monkeypatch.setenv("PHANTOM_LICENSE_ENFORCE", "1")
        _activate(keypair)
        assert client.get("/api/v1/pair/status").status_code == 200

    def test_activation_takes_effect_without_a_restart(
        self, client, keypair, license_file, monkeypatch
    ):
        monkeypatch.setenv("PHANTOM_LICENSE_ENFORCE", "1")
        assert client.get("/api/v1/pair/status").status_code == 402
        _activate(keypair)
        assert client.get("/api/v1/pair/status").status_code == 200


def test_options_preflight_passes(client, keypair, license_file, monkeypatch):
    monkeypatch.setenv("PHANTOM_LICENSE_ENFORCE", "1")
    assert client.options("/api/v1/pair/status").status_code in (200, 405)
