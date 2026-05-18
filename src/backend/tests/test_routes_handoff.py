"""Track 4 — pytest coverage for the cross-device handoff registry.

Closes the testing-debt that has been carried since the cross-device
shipped (`aa2083d`). Exercises:

  • Lifecycle — create / list / accept / reject / cancel.
  • Target-device validation (404 unknown, 409 revoked).
  • TTL expiry — list_handoffs auto-flips expired rows.
  • User scope — handoffs created by user A do not leak to user B.
  • Dual-auth — both user JWT and device JWT (`aud=device`) work.
  • State guards — accept/reject/cancel on a non-pending row → 409.

The companion side (`HandoffOverlay`, `handoffStore`) is covered by
`phantom-companion/src/state/__tests__/handoffStore.test.ts`.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import AsyncIterator, Iterator

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-handoff")


@pytest_asyncio.fixture
async def paired_device(auth_root_user) -> AsyncIterator[dict]:
    """Insert a PairedDevice owned by the conftest ROOT user + mint a
    device JWT. Used to test the dual-auth path and target-device
    validation."""
    from db.database import AsyncSessionLocal
    from db.models import PairedDevice
    from security.device_token import create_device_token

    async with AsyncSessionLocal() as s:
        row = PairedDevice(
            user_id=auth_root_user.id,
            device_name="Pixel 9 (handoff test)",
            device_model="google/pixel9",
            platform="android",
            platform_version="35",
            device_pub_ed25519="A" * 44,
            capabilities_json='["sensors"]',
        )
        s.add(row)
        await s.commit()
        await s.refresh(row)
        device_id = row.id

    jwt, _ = create_device_token(device_id=device_id, user_id=auth_root_user.id)
    yield {"jwt": jwt, "device_id": device_id, "user_id": auth_root_user.id}


@pytest_asyncio.fixture
async def revoked_device(auth_root_user) -> AsyncIterator[dict]:
    from db.database import AsyncSessionLocal
    from db.models import PairedDevice

    async with AsyncSessionLocal() as s:
        row = PairedDevice(
            user_id=auth_root_user.id,
            device_name="Old Phone",
            device_model="lost/phone",
            platform="android",
            device_pub_ed25519="B" * 44,
            capabilities_json="[]",
            revoked_at=datetime.now(tz=timezone.utc),
            revoked_reason="lost",
        )
        s.add(row)
        await s.commit()
        await s.refresh(row)
        yield {"device_id": row.id}


@pytest.fixture
def device_client(paired_device) -> Iterator[TestClient]:
    """TestClient authenticated as the paired phone (device JWT)."""
    from main import create_app

    app = create_app()
    with TestClient(app) as c:
        c.headers.update({"Authorization": f"Bearer {paired_device['jwt']}"})
        yield c


def _create_payload(**overrides):
    base = {
        "kind": "map_route",
        "title": "Маршрут до офісу",
        "payload": {"lat": 50.4501, "lon": 30.5234},
        "ttl_seconds": 600,
    }
    base.update(overrides)
    return base


# ── Lifecycle ────────────────────────────────────────────────────────────────


def test_create_handoff_returns_201_and_pending(auth_root_client):
    r = auth_root_client.post("/api/v1/handoff", json=_create_payload())
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "pending"
    assert body["kind"] == "map_route"
    assert body["title"] == "Маршрут до офісу"
    assert body["payload"] == {"lat": 50.4501, "lon": 30.5234}
    assert body["resolved_at"] is None


def test_list_handoffs_returns_only_pending(auth_root_client):
    r1 = auth_root_client.post("/api/v1/handoff", json=_create_payload(title="one"))
    r2 = auth_root_client.post("/api/v1/handoff", json=_create_payload(title="two"))
    assert r1.status_code == 201 and r2.status_code == 201
    h2_id = r2.json()["id"]

    # Resolve one — list should drop it.
    auth_root_client.post(f"/api/v1/handoff/{h2_id}/accept")

    listing = auth_root_client.get("/api/v1/handoff").json()
    titles = [h["title"] for h in listing["handoffs"]]
    assert "one" in titles
    assert "two" not in titles


def test_accept_flips_status_and_records_timestamp(auth_root_client):
    created = auth_root_client.post("/api/v1/handoff", json=_create_payload()).json()
    r = auth_root_client.post(f"/api/v1/handoff/{created['id']}/accept")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "accepted"
    assert body["resolved_at"] is not None


def test_reject_flips_status_to_rejected(auth_root_client):
    created = auth_root_client.post("/api/v1/handoff", json=_create_payload()).json()
    r = auth_root_client.post(f"/api/v1/handoff/{created['id']}/reject")
    assert r.status_code == 200
    assert r.json()["status"] == "rejected"


def test_cancel_flips_status_to_cancelled(auth_root_client):
    created = auth_root_client.post("/api/v1/handoff", json=_create_payload()).json()
    r = auth_root_client.post(f"/api/v1/handoff/{created['id']}/cancel")
    assert r.status_code == 200
    assert r.json()["status"] == "cancelled"


# ── State guards ─────────────────────────────────────────────────────────────


def test_accept_unknown_returns_404(auth_root_client):
    r = auth_root_client.post("/api/v1/handoff/00000000-no-such-row/accept")
    assert r.status_code == 404


def test_accept_already_resolved_returns_409(auth_root_client):
    created = auth_root_client.post("/api/v1/handoff", json=_create_payload()).json()
    auth_root_client.post(f"/api/v1/handoff/{created['id']}/accept")
    r = auth_root_client.post(f"/api/v1/handoff/{created['id']}/accept")
    assert r.status_code == 409


def test_cancel_already_resolved_returns_409(auth_root_client):
    created = auth_root_client.post("/api/v1/handoff", json=_create_payload()).json()
    auth_root_client.post(f"/api/v1/handoff/{created['id']}/cancel")
    r = auth_root_client.post(f"/api/v1/handoff/{created['id']}/reject")
    assert r.status_code == 409


# ── Target device validation ─────────────────────────────────────────────────


def test_create_with_unknown_target_device_returns_404(auth_root_client):
    body = _create_payload(target_device_id="00000000-not-a-device")
    r = auth_root_client.post("/api/v1/handoff", json=body)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_create_with_revoked_target_device_returns_409(
    auth_root_client, revoked_device
):
    body = _create_payload(target_device_id=revoked_device["device_id"])
    r = auth_root_client.post("/api/v1/handoff", json=body)
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_create_with_valid_target_device_succeeds(
    auth_root_client, paired_device
):
    body = _create_payload(target_device_id=paired_device["device_id"])
    r = auth_root_client.post("/api/v1/handoff", json=body)
    assert r.status_code == 201
    assert r.json()["target_device_id"] == paired_device["device_id"]


# ── TTL expiry ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_handoffs_marks_expired_rows(auth_root_client, auth_root_user):
    from api.routes_handoff import Handoff
    from db.database import AsyncSessionLocal

    created = auth_root_client.post("/api/v1/handoff", json=_create_payload()).json()
    handoff_id = created["id"]

    # Backdate expires_at so list_handoffs flips it to expired on the
    # next poll.
    async with AsyncSessionLocal() as s:
        row = await s.get(Handoff, handoff_id)
        assert row is not None
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=10)
        await s.commit()

    listing = auth_root_client.get("/api/v1/handoff").json()
    assert all(h["id"] != handoff_id for h in listing["handoffs"])

    async with AsyncSessionLocal() as s:
        row = await s.get(Handoff, handoff_id)
        assert row is not None and row.status == "expired"


# ── User scope ───────────────────────────────────────────────────────────────


def test_handoff_scoped_to_caller_user(auth_root_client, auth_operator_client):
    """A handoff created by ROOT must not appear in OPERATOR's listing."""
    created = auth_root_client.post("/api/v1/handoff", json=_create_payload()).json()
    listing = auth_operator_client.get("/api/v1/handoff").json()
    assert all(h["id"] != created["id"] for h in listing["handoffs"])


def test_accept_returns_404_for_other_users_handoff(
    auth_root_client, auth_operator_client
):
    created = auth_root_client.post("/api/v1/handoff", json=_create_payload()).json()
    r = auth_operator_client.post(f"/api/v1/handoff/{created['id']}/accept")
    assert r.status_code == 404


# ── Dual auth ────────────────────────────────────────────────────────────────


def test_device_jwt_can_create_handoff(device_client):
    r = device_client.post("/api/v1/handoff", json=_create_payload())
    assert r.status_code == 201, r.text
    # Origin device id auto-recovered from the device JWT.
    assert r.json()["origin_device_id"] is not None


def test_device_jwt_can_list_handoffs(device_client, auth_root_client):
    auth_root_client.post("/api/v1/handoff", json=_create_payload(title="from-root"))
    listing = device_client.get("/api/v1/handoff").json()
    titles = [h["title"] for h in listing["handoffs"]]
    assert "from-root" in titles


def test_device_jwt_accept_records_resolved_by_device_id(
    device_client, paired_device, auth_root_client
):
    created = auth_root_client.post("/api/v1/handoff", json=_create_payload()).json()
    r = device_client.post(f"/api/v1/handoff/{created['id']}/accept")
    assert r.status_code == 200, r.text
    assert r.json()["resolved_by_device_id"] == paired_device["device_id"]


# ── Auth gate ────────────────────────────────────────────────────────────────


def test_unauth_create_returns_401(unauth_client):
    r = unauth_client.post("/api/v1/handoff", json=_create_payload())
    assert r.status_code in (401, 403)
