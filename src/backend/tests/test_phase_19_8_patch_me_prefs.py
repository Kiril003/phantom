"""Phase 19-8 — `PATCH /api/v1/auth/me` preference sync.

Per docs/MOBILE_COMPANION.md §3 Tier 1 + §5, the phone and desktop
share a writeable whitelist of `User.preferences_json` fields. The
desktop already had a ROOT-only `PUT /users/{id}` that could write
preferences, but it (a) required ROOT trust the phone doesn't have
and (b) was admin-shaped, not self-service. The phone needs a
self-service endpoint that accepts EITHER a user JWT or a device JWT
and that broadcasts a `context/preferences_changed` event so the
other paired surfaces (other tab, paired phone, future watch) see
the change without polling.

Phase-19-8 ships:
  • PATCH /auth/me — accepts user OR device JWT, applies a
    whitelist-filtered patch (dotted-path or nested-dict shorthand),
    persists, broadcasts.
  • Whitelist enforcement: server-only fields (pin_hash, role,
    behavioral_model_json) are silently dropped, NOT 400'd, so a
    phone client doesn't have to know which keys are sensitive.
  • Hybrid `get_user_or_device_user` dependency in
    `security/device_auth.py` — single auth surface for the
    phone↔desktop shared endpoints.

These tests cover:
  • whitelist patch by user JWT
  • whitelist patch by device JWT
  • non-whitelisted keys silently dropped
  • dotted-path / nested-dict shorthand both work
  • revoked device JWT is rejected with `device_revoked`
  • broadcast on `context/preferences_changed` fires with the
    applied delta + full preferences snapshot
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import AsyncIterator
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase19-8")


@pytest_asyncio.fixture
async def device_jwt(auth_root_user) -> AsyncIterator[dict]:
    from db.database import AsyncSessionLocal
    from db.models import PairedDevice
    from security.device_token import create_device_token

    async with AsyncSessionLocal() as s:
        row = PairedDevice(
            user_id=auth_root_user.id,
            device_name="Pixel 9 Test",
            device_model="google/pixel9",
            platform="android",
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
async def revoked_device_jwt(auth_root_user) -> AsyncIterator[dict]:
    from db.database import AsyncSessionLocal
    from db.models import PairedDevice
    from security.device_token import create_device_token

    async with AsyncSessionLocal() as s:
        row = PairedDevice(
            user_id=auth_root_user.id,
            device_name="Stolen",
            device_model="bad/actor",
            platform="android",
            device_pub_ed25519="B" * 44,
            capabilities_json="[]",
            revoked_at=datetime.now(tz=timezone.utc),
            revoked_reason="lost",
        )
        s.add(row)
        await s.commit()
        await s.refresh(row)
        device_id = row.id

    jwt, _ = create_device_token(device_id=device_id, user_id=auth_root_user.id)
    yield {"jwt": jwt, "device_id": device_id}


def test_patch_me_user_jwt_writes_whitelisted_field(auth_root_client) -> None:
    resp = auth_root_client.patch(
        "/api/v1/auth/me",
        json={"preferences": {"theme": "amber-night", "language": "uk"}},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["preferences"]["theme"] == "amber-night"
    assert body["preferences"]["language"] == "uk"


def test_patch_me_drops_non_whitelisted_keys(auth_root_client) -> None:
    """Keys outside the whitelist (role, pin, secret_thing) must be
    silently dropped — NOT 400'd — so a phone client doesn't have to
    know which keys are sensitive."""
    before = auth_root_client.get("/api/v1/auth/me").json()
    resp = auth_root_client.patch(
        "/api/v1/auth/me",
        json={
            "preferences": {
                "theme": "sunrise-warm",
                "role": "ROOT",  # NEVER allowed
                "pin": "0000",  # NEVER allowed
                "behavioral_model": {"trust_score": 999},  # NEVER allowed
            }
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    # Role unchanged
    assert body["role"] == before["role"]
    # Theme applied
    assert body["preferences"]["theme"] == "sunrise-warm"
    # Sensitive fields not present in preferences
    assert "role" not in body["preferences"]
    assert "pin" not in body["preferences"]
    assert "behavioral_model" not in body["preferences"]


def test_patch_me_dotted_and_nested_shorthand_both_work(auth_root_client) -> None:
    # Dotted: voice.profile_id
    r1 = auth_root_client.patch(
        "/api/v1/auth/me",
        json={"preferences": {"voice.profile_id": "marie-v2"}},
    )
    assert r1.json()["preferences"]["voice"]["profile_id"] == "marie-v2"

    # Nested-dict shorthand: {"familiar": {"rarity": "epic"}} → applies
    # familiar.rarity (whitelisted) but not familiar.behavioral_model
    # (not whitelisted, even when nested).
    r2 = auth_root_client.patch(
        "/api/v1/auth/me",
        json={
            "preferences": {
                "familiar": {
                    "rarity": "epic",
                    "behavioral_model": "should-not-leak",
                }
            }
        },
    )
    body = r2.json()
    assert body["preferences"]["familiar"]["rarity"] == "epic"
    assert body["preferences"]["familiar"].get("behavioral_model") is None


def test_patch_me_with_device_jwt(device_jwt, unauth_client) -> None:
    resp = unauth_client.patch(
        "/api/v1/auth/me",
        json={"preferences": {"theme": "cyberdeck-cold"}},
        headers={"Authorization": f"Bearer {device_jwt['jwt']}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["preferences"]["theme"] == "cyberdeck-cold"
    # Device JWT resolves to the OWNING user, so the response is the
    # user object (with role/has_pin/etc) — same shape the desktop sees.
    assert body["id"] == device_jwt["user_id"]


def test_patch_me_with_revoked_device_jwt_returns_401(
    revoked_device_jwt, unauth_client
) -> None:
    resp = unauth_client.patch(
        "/api/v1/auth/me",
        json={"preferences": {"theme": "sunrise-warm"}},
        headers={"Authorization": f"Bearer {revoked_device_jwt['jwt']}"},
    )
    assert resp.status_code == 401
    assert resp.json()["detail"]["code"] == "device_revoked"


def test_patch_me_broadcasts_preferences_changed(
    auth_root_client, monkeypatch
) -> None:
    """Other paired surfaces (phone, other tab) need to see the change
    without polling. Broadcast must carry the applied delta AND the
    full preferences snapshot, scoped to user_id."""
    from api import websocket_hub

    captured: list[dict] = []

    async def _fake_broadcast(channel, type_, data, user_id=None):
        captured.append(
            {"channel": channel, "type": type_, "data": data, "user_id": user_id}
        )

    monkeypatch.setattr(websocket_hub.hub, "broadcast", _fake_broadcast)

    resp = auth_root_client.patch(
        "/api/v1/auth/me",
        json={"preferences": {"theme": "sunrise-warm", "co_pilot.auto_enable": True}},
    )
    assert resp.status_code == 200

    # Lifespan/state-broadcaster fires unrelated `oled`/`state` events
    # on the same hub — filter to the channel we care about.
    prefs_msgs = [
        m
        for m in captured
        if m["channel"] == "context" and m["type"] == "preferences_changed"
    ]
    assert len(prefs_msgs) == 1
    msg = prefs_msgs[0]
    assert msg["data"]["changes"] == {
        "theme": "sunrise-warm",
        "co_pilot.auto_enable": True,
    }
    assert msg["data"]["preferences"]["theme"] == "sunrise-warm"
    assert msg["data"]["preferences"]["co_pilot"]["auto_enable"] is True
    assert msg["user_id"] is not None  # scoped, not global


def test_patch_me_empty_patch_is_noop(auth_root_client) -> None:
    """Patching with an empty or all-unknown preference dict must not
    400 — clients across versions stay forward-compatible."""
    r1 = auth_root_client.patch("/api/v1/auth/me", json={"preferences": {}})
    assert r1.status_code == 200

    r2 = auth_root_client.patch(
        "/api/v1/auth/me",
        json={"preferences": {"unknown_key": "x", "another": 42}},
    )
    assert r2.status_code == 200
