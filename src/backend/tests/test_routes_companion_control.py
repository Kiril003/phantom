"""Track 4 — pytest coverage for the desktop→phone reverse driver.

Companion-control is ROOT-only (`require_root` dependency) so the
test surface is slim:

  • Each verb returns 200 + the right shape under ROOT auth.
  • OPERATOR (non-ROOT) is rejected with 403.
  • Unauthenticated callers are rejected with 401.
  • target_device_id pointing at an unknown device → 404.
  • target_device_id pointing at a revoked device → 409.
  • Body extras are rejected (extra='forbid').

The phone side (companionControl service + companionControlStore) is
covered by `phantom-companion/src/services/__tests__/companionControl.test.ts`.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import AsyncIterator

import pytest
import pytest_asyncio

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-companion-control")


VERBS = ["open_route", "open_card", "navigate", "focus_screen", "lock_vault", "ping"]


@pytest_asyncio.fixture
async def paired_device(auth_root_user) -> AsyncIterator[dict]:
    from db.database import AsyncSessionLocal
    from db.models import PairedDevice

    async with AsyncSessionLocal() as s:
        row = PairedDevice(
            user_id=auth_root_user.id,
            device_name="Pixel CC test",
            device_model="google/pixel9",
            platform="android",
            device_pub_ed25519="C" * 44,
            capabilities_json="[]",
        )
        s.add(row)
        await s.commit()
        await s.refresh(row)
        yield {"device_id": row.id}


@pytest_asyncio.fixture
async def revoked_device(auth_root_user) -> AsyncIterator[dict]:
    from db.database import AsyncSessionLocal
    from db.models import PairedDevice

    async with AsyncSessionLocal() as s:
        row = PairedDevice(
            user_id=auth_root_user.id,
            device_name="Revoked CC",
            device_model="bad/actor",
            platform="android",
            device_pub_ed25519="D" * 44,
            capabilities_json="[]",
            revoked_at=datetime.now(tz=timezone.utc),
            revoked_reason="lost",
        )
        s.add(row)
        await s.commit()
        await s.refresh(row)
        yield {"device_id": row.id}


# ── Happy path ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize("verb", VERBS)
def test_root_can_invoke_every_verb(auth_root_client, verb):
    r = auth_root_client.post(f"/api/v1/companion-control/{verb}", json={"payload": {"k": "v"}})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accepted"] is True
    assert body["verb"] == verb
    assert isinstance(body["delivered_to"], int)


def test_lock_vault_payload_can_be_empty(auth_root_client):
    r = auth_root_client.post("/api/v1/companion-control/lock_vault", json={})
    assert r.status_code == 200
    assert r.json()["verb"] == "lock_vault"


def test_navigate_passes_payload_through(auth_root_client):
    r = auth_root_client.post(
        "/api/v1/companion-control/navigate",
        json={"payload": {"path": "/now"}},
    )
    assert r.status_code == 200
    # Payload echo is on the WS frame, not the HTTP response — but
    # ensure the HTTP shape stays canonical.
    body = r.json()
    assert set(body.keys()) == {"accepted", "delivered_to", "verb"}


# ── Permission gates ─────────────────────────────────────────────────────────


@pytest.mark.parametrize("verb", VERBS)
def test_operator_role_is_rejected_with_403(auth_operator_client, verb):
    r = auth_operator_client.post(f"/api/v1/companion-control/{verb}", json={})
    assert r.status_code == 403, r.text


@pytest.mark.parametrize("verb", VERBS)
def test_unauthenticated_caller_is_rejected(unauth_client, verb):
    r = unauth_client.post(f"/api/v1/companion-control/{verb}", json={})
    assert r.status_code in (401, 403)


# ── Target device validation ─────────────────────────────────────────────────


def test_unknown_target_device_returns_404(auth_root_client):
    r = auth_root_client.post(
        "/api/v1/companion-control/open_route",
        json={"target_device_id": "00000000-not-a-device", "payload": {}},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_revoked_target_device_returns_409(auth_root_client, revoked_device):
    r = auth_root_client.post(
        "/api/v1/companion-control/lock_vault",
        json={"target_device_id": revoked_device["device_id"], "payload": {}},
    )
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_valid_target_device_is_accepted(auth_root_client, paired_device):
    r = auth_root_client.post(
        "/api/v1/companion-control/open_route",
        json={"target_device_id": paired_device["device_id"], "payload": {}},
    )
    assert r.status_code == 200


# ── Schema strictness ────────────────────────────────────────────────────────


def test_extra_fields_are_rejected(auth_root_client):
    r = auth_root_client.post(
        "/api/v1/companion-control/ping",
        json={"payload": {}, "wat": "no"},
    )
    # Pydantic v2 raises 422 when extra='forbid'.
    assert r.status_code == 422
