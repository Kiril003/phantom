"""F0.3 — signed node manifest is honest and tamper-evident."""
from __future__ import annotations

from node.manifest import build_manifest, verify_manifest

F0_CAPABILITIES = {"shell", "voice", "vision_screen", "always_on", "disk"}


def test_manifest_is_signed_and_verifies() -> None:
    m = build_manifest()
    assert m["name"] == "Кузня"
    assert m["role"] == "forge"
    assert m["alg"] == "ed25519"
    assert len(m["public_key"]) == 64  # 32-byte Ed25519 key, hex
    assert m["id"] == m["id"].lower() and len(m["id"]) == 16
    assert verify_manifest(m)


def test_capabilities_are_the_honest_f0_set() -> None:
    caps = set(build_manifest()["capabilities"])
    assert caps == F0_CAPABILITIES
    # nothing from later phases may be advertised before it is wired
    for unwired in ("blender", "browser", "mesh", "foundry", "gpu", "geo_compute"):
        assert unwired not in caps


def test_tamper_breaks_signature() -> None:
    m = build_manifest()
    m["capabilities"] = [*m["capabilities"], "blender"]
    assert not verify_manifest(m)


def test_endpoint_returns_signed_manifest() -> None:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from api.routes_node import router

    app = FastAPI()
    app.include_router(router)
    resp = TestClient(app).get("/node/manifest")
    assert resp.status_code == 200
    body = resp.json()
    assert verify_manifest(body)
    assert set(body["capabilities"]) == F0_CAPABILITIES
