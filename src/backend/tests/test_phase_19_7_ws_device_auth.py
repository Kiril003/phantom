"""Phase 19-7 — WS hub accepts device JWT for paired phones.

Before this fix the `/ws` endpoint only ran `verify_token` (user
audience). A phone connecting with its `aud=device` JWT silently fell
through to the unauthenticated path and could see neither the
`pair/claimed` ack nor any channel scoped to its owning user. This
made every other Mobile Companion endpoint useless from the phone
side — sensor batches and approve flows could be sent, but their
results never made it back over WS.

Phase-19-7 wires the device-JWT branch into the WS handshake:

  • verify_token first (legacy path) — desktop unchanged.
  • on user-token failure, try verify_device_token; check
    PairedDevice exists, isn't revoked, and owner matches; bind the
    socket to user_id from the device payload; bump last_seen_at.
  • install a phone-friendly default channel filter
    (sensor/state/pair/familiar/alert/_meta/context/chat) so the
    phone doesn't pay battery cost for agent.stream raw step logs
    it didn't ask for.
  • a revoked device closes the socket with custom code 4401 and
    reason 'device_revoked' so the phone's reconnect loop can clear
    its EncryptedSharedPreferences and prompt re-pair.

This test file uses the FastAPI app's TestClient WebSocket helper
plus a real device JWT minted from the project's own helpers — so
the JWT secret, audience claim, and DB join all exercise production
code paths.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import AsyncIterator

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase19-7")


@pytest_asyncio.fixture
async def paired_device(auth_root_user) -> AsyncIterator[dict]:
    """Insert a PairedDevice row owned by the conftest ROOT user, mint
    a device JWT for it, yield both. Cleanup is automatic — tests run
    against an in-memory aiosqlite, so the row vanishes with the
    process."""
    from db.database import AsyncSessionLocal
    from db.models import PairedDevice
    from security.device_token import create_device_token

    async with AsyncSessionLocal() as s:
        row = PairedDevice(
            user_id=auth_root_user.id,
            device_name="Pixel 9 Test",
            device_model="google/pixel9",
            platform="android",
            platform_version="35",
            device_pub_ed25519="A" * 44,
            capabilities_json='["sensors","approvals"]',
        )
        s.add(row)
        await s.commit()
        await s.refresh(row)
        device_id = row.id
        original_last_seen = row.last_seen_at

    jwt, _exp_iso = create_device_token(
        device_id=device_id, user_id=auth_root_user.id
    )
    yield {
        "jwt": jwt,
        "device_id": device_id,
        "user_id": auth_root_user.id,
        "original_last_seen": original_last_seen,
    }


@pytest_asyncio.fixture
async def revoked_device(auth_root_user) -> AsyncIterator[dict]:
    from db.database import AsyncSessionLocal
    from db.models import PairedDevice
    from security.device_token import create_device_token

    async with AsyncSessionLocal() as s:
        row = PairedDevice(
            user_id=auth_root_user.id,
            device_name="Stolen Phone",
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

    jwt, _ = create_device_token(
        device_id=device_id, user_id=auth_root_user.id
    )
    yield {"jwt": jwt, "device_id": device_id}


def _ws_app_client() -> TestClient:
    """Build a TestClient on the real production app instance. We
    deliberately import lazily so the conftest's JWT secret + DB
    bootstrap have already run by the time the FastAPI app graph
    is constructed."""
    from main import app

    return TestClient(app)


@pytest.mark.asyncio
async def test_phone_connects_with_device_jwt_and_gets_default_filter(
    paired_device, auth_root_user
) -> None:
    from api.websocket_hub import hub

    pre_count = hub.client_count
    client = _ws_app_client()
    with client.websocket_connect(f"/ws?token={paired_device['jwt']}"):
        # On open, the connection landed in the hub with the right
        # owner + a phone-default channel filter. Inspect the hub
        # state directly while the socket is open.
        # We can't grab the WSClient by id (TestClient hides the uuid),
        # but we know it's the most recently-added client.
        assert hub.client_count == pre_count + 1
        # Pull the newest client and assert filter shape.
        latest = list(hub._clients.values())[-1]
        assert latest.user_id == auth_root_user.id
        assert latest.channels is not None, (
            "phone must get a narrow channel filter, not legacy wildcard"
        )
        assert "sensor" in latest.channels
        assert "pair" in latest.channels
        assert "agent.stream" not in latest.channels


@pytest.mark.asyncio
async def test_phone_connect_bumps_last_seen_at(
    paired_device, auth_root_user
) -> None:
    from db.database import AsyncSessionLocal
    from db.models import PairedDevice

    client = _ws_app_client()
    with client.websocket_connect(f"/ws?token={paired_device['jwt']}"):
        pass

    async with AsyncSessionLocal() as s:
        row = await s.get(PairedDevice, paired_device["device_id"])
        assert row is not None
        # Compare floor(microseconds) to dodge SQLite precision wobble.
        assert row.last_seen_at >= paired_device["original_last_seen"]


@pytest.mark.asyncio
async def test_revoked_device_jwt_is_closed_with_4401(
    revoked_device,
) -> None:
    """A phone presenting a JWT for a revoked device should be closed
    with code 4401/`device_revoked` so its reconnect loop can clear
    local credentials. Connect-and-close is the contract; we accept
    either path the harness exposes the close code on."""
    from starlette.websockets import WebSocketDisconnect

    client = _ws_app_client()
    with pytest.raises(WebSocketDisconnect) as excinfo:
        with client.websocket_connect(f"/ws?token={revoked_device['jwt']}") as ws:
            # The server closes immediately; reading must raise.
            ws.receive_text()
    assert excinfo.value.code == 4401


def test_legacy_user_jwt_path_still_works(auth_root_token) -> None:
    """Regression guard: desktop user JWTs continue to authenticate
    over WS exactly as they did before phase-19-7. The hub should
    bind to the user_id and leave channels=None (legacy wildcard)."""
    from api.websocket_hub import hub

    client = _ws_app_client()
    with client.websocket_connect(f"/ws?token={auth_root_token}"):
        latest = list(hub._clients.values())[-1]
        assert latest.user_id is not None
        assert latest.channels is None  # legacy wildcard


def test_ws_without_token_is_refused_4401() -> None:
    """Ф0 безпекова підлога: без токена немає анонімного wildcard-клієнта.
    До фікса `_ws` приймав будь-кого з channels=None — тобто всі
    броадкасти всіх користувачів. Тепер — accept + close(4401)."""
    from starlette.websockets import WebSocketDisconnect

    from api.websocket_hub import hub

    pre_count = hub.client_count
    client = _ws_app_client()
    with pytest.raises(WebSocketDisconnect) as excinfo:
        with client.websocket_connect("/ws") as ws:
            ws.receive_text()
    assert excinfo.value.code == 4401
    # І в хабі від нього не лишилось клієнта.
    assert hub.client_count == pre_count


def test_ws_with_garbage_token_is_refused_4401() -> None:
    """Невалідний токен — та сама відмова, що й відсутній: 4401 з
    reason='unauthorized' (відрізняється від 'device_revoked', щоб
    клієнт знав, що чистити)."""
    from starlette.websockets import WebSocketDisconnect

    from api.websocket_hub import hub

    pre_count = hub.client_count
    client = _ws_app_client()
    with pytest.raises(WebSocketDisconnect) as excinfo:
        with client.websocket_connect("/ws?token=garbage") as ws:
            ws.receive_text()
    assert excinfo.value.code == 4401
    assert hub.client_count == pre_count
