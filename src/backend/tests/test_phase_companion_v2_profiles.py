"""Phase 1-B (companion-v2) — backend coverage for the multi-Profile per
User addition.

Scope of this suite:
  • Profile model invariants (cascade-delete from User, unique
    ``(user_id, display_name)`` index, default role).
  • Migration ``011_user_profiles`` is idempotent — re-running on an
    already-migrated DB is a no-op, never re-adds the
    ``paired_devices.profile_id`` column, never creates duplicate
    Primary rows on backfill.
  • ``_resolve_or_bootstrap_profile`` routes every pair-flow path:
    explicit-id, reuse-existing-Primary, lazy-seed-Primary,
    reject-unknown, reject-other-user, reject-archived.
  • ``/api/v1/pair/claim`` end-to-end — phone fully reproduces the
    pair-crypto handshake and the response surface carries the new
    ``profile`` dict + the ``PairedDevice.profile_id`` is persisted.
  • ``WebSocketHub.broadcast`` filter precedence — profile_id narrows
    most-tightly, user_id is the legacy fan-out, both unset = global.

This is a Phase 1-B-only suite; on-device Compose tests for the same
schema live in ``companion-android/feature-onboarding`` (Phase 1-C).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import uuid
from typing import AsyncIterator

import pytest
import pytest_asyncio
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ed25519, x25519
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from fastapi import HTTPException

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-companion-v2")


# ── Helpers ──────────────────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def fresh_user() -> AsyncIterator:
    """Insert a brand-new ROOT-flavoured User with zero profiles attached.

    Tests that need to verify "lazy-seed Primary" can't reuse the
    session-scoped ``auth_root_user`` because some other test in the
    suite may already have created a Primary for them. A fresh row
    keeps the bootstrap path deterministic.
    """
    from db.database import AsyncSessionLocal
    from db.models import User

    async with AsyncSessionLocal() as s:
        u = User(
            username=f"profile-test-{uuid.uuid4().hex[:8]}",
            role="ROOT",
        )
        s.add(u)
        await s.commit()
        await s.refresh(u)
    yield u


def _build_pair_proofs(*, qr: dict, pair_id: str):
    """Mirror what the phone's pair-flow client does so we can drive
    ``/pair/claim`` end-to-end without touching real Android.

    Returns a dict shaped like a ``PairClaimRequest`` body.
    """
    server_pub_raw = base64.b64decode(qr["server_pub"])
    nonce_bytes = base64.b64decode(qr["nonce"])

    client_priv = x25519.X25519PrivateKey.generate()
    client_pub_raw = client_priv.public_key().public_bytes_raw()
    server_pub = x25519.X25519PublicKey.from_public_bytes(server_pub_raw)
    shared = client_priv.exchange(server_pub)
    shared_key = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=nonce_bytes,
        info=b"phantom-os/mobile-pair-v1",
    ).derive(shared)

    device_priv = ed25519.Ed25519PrivateKey.generate()
    device_pub_raw = device_priv.public_key().public_bytes_raw()
    proof = hmac.new(
        shared_key,
        pair_id.encode("utf-8") + device_pub_raw,
        hashlib.sha256,
    ).digest()

    return {
        "pair_id": pair_id,
        "client_pub": base64.b64encode(client_pub_raw).decode("ascii"),
        "device_pub_ed25519": base64.b64encode(device_pub_raw).decode("ascii"),
        "nonce_echo": qr["nonce"],
        "client_proof": base64.b64encode(proof).decode("ascii"),
    }


# ── Profile model invariants ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_profile_create_round_trip(fresh_user):
    """Insert a Profile, query it back, assert every field survives."""
    from db.database import AsyncSessionLocal
    from db.models import Profile

    pid = str(uuid.uuid4())
    async with AsyncSessionLocal() as s:
        s.add(
            Profile(
                id=pid,
                user_id=fresh_user.id,
                display_name="Кирило",
                role="ROOT",
                is_primary=True,
            )
        )
        await s.commit()

    async with AsyncSessionLocal() as s:
        p = await s.get(Profile, pid)
        assert p is not None
        assert p.display_name == "Кирило"
        assert p.role == "ROOT"
        assert p.is_primary is True
        assert p.archived_at is None
        assert p.behavioral_model_json == "{}"


@pytest.mark.asyncio
async def test_profile_unique_user_display_name(fresh_user):
    """Two profiles with the same (user_id, display_name) must collide."""
    from sqlalchemy.exc import IntegrityError

    from db.database import AsyncSessionLocal
    from db.models import Profile

    async with AsyncSessionLocal() as s:
        s.add(Profile(user_id=fresh_user.id, display_name="Kira"))
        await s.commit()

    with pytest.raises(IntegrityError):
        async with AsyncSessionLocal() as s:
            s.add(Profile(user_id=fresh_user.id, display_name="Kira"))
            await s.commit()


@pytest.mark.asyncio
async def test_profile_cascade_deletes_with_user():
    """Deleting a User must cascade through to its profiles — same
    posture every other per-user table holds.
    """
    from sqlalchemy import select

    from db.database import AsyncSessionLocal
    from db.models import Profile, User

    user_id = str(uuid.uuid4())
    profile_id = str(uuid.uuid4())
    async with AsyncSessionLocal() as s:
        u = User(id=user_id, username=f"cascade-{user_id[:6]}", role="OPERATOR")
        s.add(u)
        s.add(Profile(id=profile_id, user_id=user_id, display_name="P"))
        await s.commit()

    async with AsyncSessionLocal() as s:
        u = await s.get(User, user_id)
        await s.delete(u)
        await s.commit()

    async with AsyncSessionLocal() as s:
        rows = (
            await s.execute(select(Profile).where(Profile.user_id == user_id))
        ).scalars().all()
        assert rows == []


# ── Migration 011 idempotency ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_migration_011_is_idempotent():
    """Re-running ``apply_pending`` on an already-migrated DB must be a
    no-op: profile_id column appears exactly once, profiles table
    survives, indexes remain.
    """
    from sqlalchemy import text

    from db.database import engine
    from db.migrations import apply_pending

    # apply_pending already ran via init_db at conftest import — re-run
    # twice to confirm the PRAGMA + IF NOT EXISTS guards hold.
    await apply_pending(engine)
    await apply_pending(engine)

    async with engine.begin() as conn:
        result = await conn.execute(text("PRAGMA table_info(profiles)"))
        profile_cols = [row[1] for row in result.fetchall()]
        for required in (
            "id",
            "user_id",
            "display_name",
            "role",
            "avatar_uri",
            "created_at",
            "last_seen_at",
            "archived_at",
            "is_primary",
            "behavioral_model_json",
        ):
            assert required in profile_cols, f"profiles missing column {required}"

        result = await conn.execute(text("PRAGMA table_info(paired_devices)"))
        pd_cols = [row[1] for row in result.fetchall()]
        # Exactly one ``profile_id`` column — a duplicate ALTER would
        # have raised at this point on every modern SQLite.
        assert pd_cols.count("profile_id") == 1, pd_cols

        # Indexes
        result = await conn.execute(text("PRAGMA index_list(profiles)"))
        index_names = {row[1] for row in result.fetchall()}
        assert "ix_profiles_user" in index_names
        assert "uq_profiles_user_display_name" in index_names


# ── _resolve_or_bootstrap_profile ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_resolve_lazy_creates_primary(fresh_user):
    """User with zero profiles → helper seeds a Primary that inherits
    the user's role + the supplied display_name (sanitised).
    """
    from db.database import AsyncSessionLocal
    from api.routes_pair import _resolve_or_bootstrap_profile

    async with AsyncSessionLocal() as s:
        u = await s.get(type(fresh_user), fresh_user.id)
        profile = await _resolve_or_bootstrap_profile(
            s,
            owner=u,
            requested_profile_id=None,
            primary_display_name="  Кирило  ",  # trimmed
        )
        await s.commit()

    assert profile.user_id == fresh_user.id
    assert profile.display_name == "Кирило"
    assert profile.is_primary is True
    assert profile.role == "ROOT"  # inherited from fresh_user


@pytest.mark.asyncio
async def test_resolve_reuses_existing_primary(fresh_user):
    """Second call returns the same Primary row, no duplicate insert."""
    from db.database import AsyncSessionLocal
    from api.routes_pair import _resolve_or_bootstrap_profile

    async with AsyncSessionLocal() as s:
        u = await s.get(type(fresh_user), fresh_user.id)
        first = await _resolve_or_bootstrap_profile(
            s, owner=u, requested_profile_id=None, primary_display_name=None
        )
        await s.commit()
        first_id = first.id

    async with AsyncSessionLocal() as s:
        u = await s.get(type(fresh_user), fresh_user.id)
        again = await _resolve_or_bootstrap_profile(
            s, owner=u, requested_profile_id=None, primary_display_name="ignored"
        )
        await s.commit()

    assert again.id == first_id


@pytest.mark.asyncio
async def test_resolve_rejects_unknown_profile_id(fresh_user):
    from db.database import AsyncSessionLocal
    from api.routes_pair import _resolve_or_bootstrap_profile

    async with AsyncSessionLocal() as s:
        u = await s.get(type(fresh_user), fresh_user.id)
        with pytest.raises(HTTPException) as exc:
            await _resolve_or_bootstrap_profile(
                s,
                owner=u,
                requested_profile_id="not-a-real-id",
                primary_display_name=None,
            )
        assert exc.value.status_code == 400
        assert exc.value.detail.get("code") == "profile_invalid"


@pytest.mark.asyncio
async def test_resolve_rejects_other_users_profile(fresh_user):
    """A profile from User A must not be claimable by User B."""
    from db.database import AsyncSessionLocal
    from db.models import Profile, User
    from api.routes_pair import _resolve_or_bootstrap_profile

    other_id = str(uuid.uuid4())
    other_profile_id = str(uuid.uuid4())
    async with AsyncSessionLocal() as s:
        s.add(User(id=other_id, username=f"other-{other_id[:6]}"))
        s.add(
            Profile(
                id=other_profile_id,
                user_id=other_id,
                display_name="Other",
                is_primary=True,
            )
        )
        await s.commit()

    async with AsyncSessionLocal() as s:
        u = await s.get(type(fresh_user), fresh_user.id)
        with pytest.raises(HTTPException) as exc:
            await _resolve_or_bootstrap_profile(
                s,
                owner=u,
                requested_profile_id=other_profile_id,
                primary_display_name=None,
            )
        assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_resolve_rejects_archived_profile(fresh_user):
    """An archived profile is logically deleted and must be rejected."""
    from datetime import datetime, timezone

    from db.database import AsyncSessionLocal
    from db.models import Profile
    from api.routes_pair import _resolve_or_bootstrap_profile

    archived_id = str(uuid.uuid4())
    async with AsyncSessionLocal() as s:
        s.add(
            Profile(
                id=archived_id,
                user_id=fresh_user.id,
                display_name="Old",
                archived_at=datetime.now(tz=timezone.utc),
            )
        )
        await s.commit()

    async with AsyncSessionLocal() as s:
        u = await s.get(type(fresh_user), fresh_user.id)
        with pytest.raises(HTTPException) as exc:
            await _resolve_or_bootstrap_profile(
                s,
                owner=u,
                requested_profile_id=archived_id,
                primary_display_name=None,
            )
        assert exc.value.status_code == 400
        assert exc.value.detail.get("code") == "profile_invalid"


# ── End-to-end /pair/claim ───────────────────────────────────────────────────


def test_pair_claim_returns_profile_and_persists_profile_id(
    auth_root_user, auth_root_client, unauth_client
):
    """Full pair-flow round-trip: ROOT calls /pair/init, "phone"
    constructs the ECDH proof + Ed25519 device key, /pair/claim returns
    the new ``profile`` dict and the PairedDevice row carries
    ``profile_id`` matching it.
    """
    init_resp = auth_root_client.post("/api/v1/pair/init")
    assert init_resp.status_code == 200, init_resp.text
    init = init_resp.json()
    body = _build_pair_proofs(qr=init["qr"], pair_id=init["pair_id"])
    body["device"] = {"name": "Test Pixel", "model": "test/v1", "platform": "android"}
    body["profile_display_name"] = "Кирило-Test"

    claim_resp = unauth_client.post("/api/v1/pair/claim", json=body)
    assert claim_resp.status_code == 200, claim_resp.text
    data = claim_resp.json()

    assert "profile" in data
    profile = data["profile"]
    assert profile["user_id"] == auth_root_user.id
    assert profile["is_primary"] is True
    # Display name is either "Кирило-Test" (if no prior Primary existed)
    # or the existing Primary's name (re-use path). Both are correct;
    # what we strictly require is that *some* primary is returned.
    assert profile["id"]
    assert profile["display_name"]
    profile_id = profile["id"]

    # PairedDevice persisted with the same profile_id.
    import asyncio

    from db.database import AsyncSessionLocal
    from db.models import PairedDevice

    async def _check():
        async with AsyncSessionLocal() as s:
            row = await s.get(PairedDevice, data["device_id"])
            assert row is not None
            assert row.profile_id == profile_id

    asyncio.get_event_loop().run_until_complete(_check())


# ── WebSocketHub.broadcast filter ────────────────────────────────────────────


class _FakeWS:
    """Minimal WebSocket stand-in for hub tests. Only ``send_text`` and
    ``close`` are exercised; the hub's broadcast path goes through
    ``client.send`` which calls ``ws.send_text``.
    """

    def __init__(self) -> None:
        self.sent: list[str] = []
        self._open = True

    async def send_text(self, msg: str) -> None:
        if not self._open:
            return
        self.sent.append(msg)

    async def close(self) -> None:
        self._open = False


@pytest.mark.asyncio
async def test_broadcast_profile_id_narrows_most_tightly():
    from api.websocket_hub import WSClient, WebSocketHub

    h = WebSocketHub()
    ws_a, ws_b, ws_c = _FakeWS(), _FakeWS(), _FakeWS()
    a = WSClient(ws_a, "a", user_id="u1", profile_id="p-A")
    b = WSClient(ws_b, "b", user_id="u1", profile_id="p-B")
    c = WSClient(ws_c, "c", user_id="u1", profile_id=None)
    h._clients = {"a": a, "b": b, "c": c}

    await h.broadcast("test", "ping", {"x": 1}, profile_id="p-A")
    assert len(ws_a.sent) == 1
    assert ws_b.sent == []
    assert ws_c.sent == []  # NULL profile_id never matches a non-NULL filter


@pytest.mark.asyncio
async def test_broadcast_user_id_keeps_legacy_fan_out():
    from api.websocket_hub import WSClient, WebSocketHub

    h = WebSocketHub()
    ws_a, ws_b, ws_c = _FakeWS(), _FakeWS(), _FakeWS()
    a = WSClient(ws_a, "a", user_id="u1", profile_id="p-A")
    b = WSClient(ws_b, "b", user_id="u1", profile_id="p-B")
    c = WSClient(ws_c, "c", user_id="u1", profile_id=None)
    h._clients = {"a": a, "b": b, "c": c}

    await h.broadcast("test", "pong", {"y": 2}, user_id="u1")
    # All three are under u1 — every one of them gets the message,
    # exactly as it did before Phase 1-B.
    assert len(ws_a.sent) == 1
    assert len(ws_b.sent) == 1
    assert len(ws_c.sent) == 1


@pytest.mark.asyncio
async def test_broadcast_combined_filters_both_apply():
    from api.websocket_hub import WSClient, WebSocketHub

    h = WebSocketHub()
    ws_match = _FakeWS()
    ws_other_user = _FakeWS()
    ws_other_profile = _FakeWS()
    h._clients = {
        "match": WSClient(ws_match, "match", user_id="u1", profile_id="p-A"),
        "wrong-u": WSClient(ws_other_user, "wrong-u", user_id="u2", profile_id="p-A"),
        "wrong-p": WSClient(ws_other_profile, "wrong-p", user_id="u1", profile_id="p-B"),
    }

    await h.broadcast("test", "z", {}, user_id="u1", profile_id="p-A")
    assert len(ws_match.sent) == 1
    assert ws_other_user.sent == []
    assert ws_other_profile.sent == []


@pytest.mark.asyncio
async def test_broadcast_unfiltered_hits_everyone():
    from api.websocket_hub import WSClient, WebSocketHub

    h = WebSocketHub()
    sockets = [_FakeWS() for _ in range(4)]
    h._clients = {
        f"c{i}": WSClient(s, f"c{i}", user_id=f"u{i}", profile_id=None)
        for i, s in enumerate(sockets)
    }

    await h.broadcast("test", "tick", {})
    for s in sockets:
        assert len(s.sent) == 1
