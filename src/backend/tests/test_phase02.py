"""
Phase 02 — Authorization tests.
Covers: JWTManager, auth helpers, RBAC permissions, auth API routes.
Uses in-memory SQLite — no hardware or external services needed.
"""
from __future__ import annotations

import os
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from jose import jwt as jose_jwt
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# ── Patch JWT secret before any app import ──────────────────────────────────
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-phase02-tests")

# ─────────────────────────────────────────────────────────────────────────────
# JWT Manager Tests
# ─────────────────────────────────────────────────────────────────────────────

class TestJWTManager:
    def test_create_token_returns_string_and_iso_expiry(self):
        from security.jwt_manager import create_token
        token, expires_at = create_token("user-123", "alice", "ROOT")
        assert isinstance(token, str)
        assert len(token) > 20
        assert "T" in expires_at  # ISO 8601 format contains 'T'

    def test_verify_token_roundtrip(self):
        from security.jwt_manager import create_token, verify_token
        token, _ = create_token("user-abc", "bob", "OPERATOR")
        payload = verify_token(token)
        assert payload.user_id == "user-abc"
        assert payload.username == "bob"
        assert payload.role == "OPERATOR"
        assert payload.exp > 0
        assert payload.iat > 0

    def test_verify_token_invalid_signature_raises(self):
        from jose import JWTError
        from security.jwt_manager import verify_token
        with pytest.raises(JWTError):
            verify_token("completely.invalid.token")

    def test_verify_token_tampered_payload_raises(self):
        from jose import JWTError
        from security.jwt_manager import create_token, verify_token
        token, _ = create_token("user-x", "alice", "ROOT")
        # Tamper by replacing payload with a different base64 segment
        parts = token.split(".")
        import base64
        import json as _json
        bad_payload = base64.urlsafe_b64encode(
            _json.dumps({"sub": "hacker", "username": "evil", "role": "ROOT",
                         "iat": 0, "exp": 9999999999}).encode()
        ).rstrip(b"=").decode()
        tampered = f"{parts[0]}.{bad_payload}.{parts[2]}"
        with pytest.raises(JWTError):
            verify_token(tampered)

    def test_verify_expired_token_raises(self):
        from jose import ExpiredSignatureError, JWTError
        from security.jwt_manager import _secret, _ALGORITHM
        # Manually craft an expired token
        now_ts = int(datetime.now(tz=timezone.utc).timestamp())
        payload = {
            "sub": "u1", "username": "alice", "role": "GUEST",
            "iat": now_ts - 7200,
            "exp": now_ts - 3600,  # expired 1 hour ago
        }
        token = jose_jwt.encode(payload, _secret(), algorithm=_ALGORITHM)
        with pytest.raises(JWTError):
            from security.jwt_manager import verify_token
            verify_token(token)

    def test_refresh_token_valid_token(self):
        from security.jwt_manager import create_token, refresh_token, verify_token
        original, _ = create_token("u2", "charlie", "GUEST")
        new_token, new_exp = refresh_token(original)
        assert isinstance(new_token, str)
        payload = verify_token(new_token)
        assert payload.user_id == "u2"
        assert payload.username == "charlie"

    def test_refresh_token_recently_expired_succeeds(self):
        from security.jwt_manager import _secret, _ALGORITHM, refresh_token, verify_token
        now_ts = int(datetime.now(tz=timezone.utc).timestamp())
        # Day-3 D3-C-2 (audit-2026-04-30 NEW-SEC-03) — strict cap
        # requires orig_iat. Hand-rolled tokens that previously omitted
        # the field would now be refused even within grace; this test
        # uses the canonical shape (orig_iat == iat) as v0.18.1+
        # produces it.
        payload = {
            "sub": "u3", "username": "dana", "role": "OPERATOR",
            "iat": now_ts - 60,
            "exp": now_ts - 30,  # expired 30s ago — within 1h grace
            "orig_iat": now_ts - 60,
        }
        token = jose_jwt.encode(payload, _secret(), algorithm=_ALGORITHM)
        new_token, _ = refresh_token(token)
        p = verify_token(new_token)
        assert p.user_id == "u3"

    def test_refresh_token_too_old_raises(self):
        from jose import JWTError
        from security.jwt_manager import _secret, _ALGORITHM, refresh_token
        now_ts = int(datetime.now(tz=timezone.utc).timestamp())
        payload = {
            "sub": "u4", "username": "eve", "role": "GUEST",
            "iat": now_ts - 7200,
            "exp": now_ts - 4000,  # expired 4000s ago > 3600s grace
        }
        token = jose_jwt.encode(payload, _secret(), algorithm=_ALGORITHM)
        with pytest.raises(JWTError):
            refresh_token(token)


# ─────────────────────────────────────────────────────────────────────────────
# Auth Module Tests (bcrypt + DB lookups)
# ─────────────────────────────────────────────────────────────────────────────

async def _make_test_db():
    """
    Create a fresh file-based SQLite engine with all tables.
    Uses a temp file so multiple sessions can access the same DB.
    Reloads db.models when Base.metadata is empty (happens if test_phase00
    reloaded db.database with importlib.reload, replacing the Base class).
    Returns (engine, factory, tmp_path) — caller must delete tmp_path.
    """
    import importlib
    import db.database as _dbm
    import db.models as _dm

    # If Base metadata is empty (e.g. after reload in test_phase00), re-register models
    if not _dbm.Base.metadata.tables:
        importlib.reload(_dm)

    fd, tmp_file = tempfile.mkstemp(suffix=".db", prefix="phantom_test_")
    os.close(fd)  # close the fd; SQLAlchemy opens its own connection
    url = f"sqlite+aiosqlite:///{tmp_file}"
    engine = create_async_engine(url, echo=False, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.run_sync(_dbm.Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    return engine, factory, tmp_file


class TestAuthHelpers:
    def test_hash_and_verify_pin(self):
        from security.auth import hash_secret, verify_secret
        pin = "123456"
        hashed = hash_secret(pin)
        assert hashed != pin
        assert verify_secret(pin, hashed)
        assert not verify_secret("000000", hashed)

    def test_hash_rfid_uid(self):
        from security.auth import hash_secret, verify_secret
        uid = "AB:CD:EF:01"
        h = hash_secret(uid)
        assert verify_secret(uid, h)
        assert not verify_secret("FF:FF:FF:FF", h)


@pytest.mark.asyncio
class TestAuthDBFunctions:
    async def test_ensure_default_user_creates_phantom(self):
        from security.auth import ensure_default_user, verify_secret
        from db.models import User
        from sqlalchemy import select

        engine, factory, _tmp = await _make_test_db()
        async with factory() as session:
            await ensure_default_user(session)
            result = await session.execute(select(User).where(User.username == "phantom"))
            user = result.scalar_one_or_none()
            assert user is not None
            assert user.role == "ROOT"
            assert verify_secret("000000", user.pin_hash)
        await engine.dispose()
        Path(_tmp).unlink(missing_ok=True)

    async def test_ensure_default_user_idempotent(self):
        from security.auth import ensure_default_user
        from db.models import User
        from sqlalchemy import select

        engine, factory, _tmp = await _make_test_db()
        async with factory() as session:
            await ensure_default_user(session)
            await ensure_default_user(session)
            result = await session.execute(select(User))
            users = result.scalars().all()
            assert len(users) == 1
        await engine.dispose()
        Path(_tmp).unlink(missing_ok=True)

    async def test_authenticate_pin_success(self):
        from security.auth import authenticate_pin, ensure_default_user

        engine, factory, _tmp = await _make_test_db()
        async with factory() as session:
            await ensure_default_user(session)
            user = await authenticate_pin(session, "phantom", "000000")
            assert user is not None
            assert user.username == "phantom"
        await engine.dispose()
        Path(_tmp).unlink(missing_ok=True)

    async def test_authenticate_pin_wrong_pin(self):
        from security.auth import authenticate_pin, ensure_default_user

        engine, factory, _tmp = await _make_test_db()
        async with factory() as session:
            await ensure_default_user(session)
            user = await authenticate_pin(session, "phantom", "999999")
            assert user is None
        await engine.dispose()
        Path(_tmp).unlink(missing_ok=True)

    async def test_authenticate_pin_unknown_user(self):
        from security.auth import authenticate_pin, ensure_default_user

        engine, factory, _tmp = await _make_test_db()
        async with factory() as session:
            await ensure_default_user(session)
            user = await authenticate_pin(session, "nobody", "000000")
            assert user is None
        await engine.dispose()
        Path(_tmp).unlink(missing_ok=True)

    async def test_authenticate_rfid_success(self):
        from security.auth import authenticate_rfid, ensure_default_user, hash_secret
        from db.models import User
        from sqlalchemy import select

        engine, factory, _tmp = await _make_test_db()
        async with factory() as session:
            await ensure_default_user(session)
            result = await session.execute(select(User).where(User.username == "phantom"))
            phantom = result.scalar_one()
            phantom.rfid_uid_hash = hash_secret("AA:BB:CC:DD")  # type: ignore[assignment]
            await session.commit()

            found = await authenticate_rfid(session, "AA:BB:CC:DD")
            assert found is not None
            assert found.username == "phantom"
        await engine.dispose()
        Path(_tmp).unlink(missing_ok=True)

    async def test_authenticate_rfid_wrong_uid(self):
        from security.auth import authenticate_rfid, ensure_default_user

        engine, factory, _tmp = await _make_test_db()
        async with factory() as session:
            await ensure_default_user(session)
            found = await authenticate_rfid(session, "FF:FF:FF:FF")
            assert found is None
        await engine.dispose()
        Path(_tmp).unlink(missing_ok=True)


# ─────────────────────────────────────────────────────────────────────────────
# Permissions / RBAC Tests
# ─────────────────────────────────────────────────────────────────────────────

class TestPermissions:
    def _make_user(self, role: str) -> object:
        """Create a lightweight user-like object with just the fields RoleChecker needs."""
        from types import SimpleNamespace
        return SimpleNamespace(
            id=str(uuid.uuid4()),
            username=f"user_{role.lower()}",
            role=role,
            pin_hash=None,
            rfid_uid_hash=None,
            avatar_url=None,
        )

    @pytest.mark.asyncio
    async def test_root_checker_allows_root(self):
        from security.permissions import RoleChecker
        checker = RoleChecker("ROOT")
        root_user = self._make_user("ROOT")
        result = await checker.__call__(root_user)
        assert result.role == "ROOT"

    @pytest.mark.asyncio
    async def test_root_checker_denies_operator(self):
        from fastapi import HTTPException
        from security.permissions import RoleChecker
        checker = RoleChecker("ROOT")
        op_user = self._make_user("OPERATOR")
        with pytest.raises(HTTPException) as exc_info:
            await checker.__call__(op_user)
        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_operator_checker_allows_operator(self):
        from security.permissions import RoleChecker
        checker = RoleChecker("OPERATOR")
        op_user = self._make_user("OPERATOR")
        result = await checker.__call__(op_user)
        assert result.role == "OPERATOR"

    @pytest.mark.asyncio
    async def test_operator_checker_allows_root(self):
        from security.permissions import RoleChecker
        checker = RoleChecker("OPERATOR")
        root_user = self._make_user("ROOT")
        result = await checker.__call__(root_user)
        assert result.role == "ROOT"

    @pytest.mark.asyncio
    async def test_operator_checker_denies_guest(self):
        from fastapi import HTTPException
        from security.permissions import RoleChecker
        checker = RoleChecker("OPERATOR")
        guest_user = self._make_user("GUEST")
        with pytest.raises(HTTPException) as exc_info:
            await checker.__call__(guest_user)
        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_guest_checker_allows_all_roles(self):
        from security.permissions import RoleChecker
        checker = RoleChecker("GUEST")
        for role in ["GUEST", "OPERATOR", "ROOT"]:
            user = self._make_user(role)
            result = await checker.__call__(user)
            assert result.role == role


# ─────────────────────────────────────────────────────────────────────────────
# Auth Routes Integration Tests
# ─────────────────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def app_client() -> AsyncGenerator[AsyncClient, None]:
    """
    Spin up the FastAPI app with an in-memory DB for route integration tests.
    Patches db.database globals so lifespan + routes all share the test DB.
    """
    import db.database as _db_mod
    from security.auth import ensure_default_user
    from main import app
    from db.database import get_db

    test_engine, factory, tmp_file = await _make_test_db()

    # Patch module-level engine and session factory so lifespan uses test DB too
    original_engine = _db_mod.engine
    original_session_local = _db_mod.AsyncSessionLocal
    _db_mod.engine = test_engine
    _db_mod.AsyncSessionLocal = factory

    async def _override_get_db():
        async with factory() as session:
            yield session

    # Create default user in this test DB
    async with factory() as session:
        await ensure_default_user(session)

    app.dependency_overrides[get_db] = _override_get_db

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client

    app.dependency_overrides.clear()
    # Restore original engine/session factory
    _db_mod.engine = original_engine
    _db_mod.AsyncSessionLocal = original_session_local
    await test_engine.dispose()
    Path(tmp_file).unlink(missing_ok=True)


@pytest.mark.asyncio
class TestAuthRoutes:
    async def test_pin_login_success(self, app_client):
        resp = await app_client.post("/api/v1/auth/login/pin", json={
            "username": "phantom",
            "pin": "000000",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "token" in data
        assert "expires_at" in data
        assert data["user"]["username"] == "phantom"
        assert data["user"]["role"] == "ROOT"

    async def test_pin_login_wrong_pin(self, app_client):
        resp = await app_client.post("/api/v1/auth/login/pin", json={
            "username": "phantom",
            "pin": "999999",
        })
        assert resp.status_code == 401

    async def test_pin_login_unknown_user(self, app_client):
        resp = await app_client.post("/api/v1/auth/login/pin", json={
            "username": "ghost_user",
            "pin": "000000",
        })
        assert resp.status_code == 401

    async def test_rfid_login_success(self, app_client):
        # First, give phantom user an RFID via update endpoint
        # Need auth token first
        login = await app_client.post("/api/v1/auth/login/pin", json={
            "username": "phantom", "pin": "000000"
        })
        token = login.json()["token"]
        user_id = login.json()["user"]["id"]

        update = await app_client.put(
            f"/api/v1/users/{user_id}",
            json={"rfid_uid": "AA:BB:CC:11"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert update.status_code == 200

        resp = await app_client.post("/api/v1/auth/login/rfid", json={"uid": "AA:BB:CC:11"})
        assert resp.status_code == 200
        assert resp.json()["user"]["username"] == "phantom"

    async def test_rfid_login_unknown_uid(self, app_client):
        resp = await app_client.post("/api/v1/auth/login/rfid", json={"uid": "FF:FF:FF:FF"})
        assert resp.status_code == 401

    async def test_me_endpoint(self, app_client):
        login = await app_client.post("/api/v1/auth/login/pin", json={
            "username": "phantom", "pin": "000000"
        })
        token = login.json()["token"]
        me = await app_client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert me.status_code == 200
        assert me.json()["username"] == "phantom"

    async def test_me_no_token(self, app_client):
        resp = await app_client.get("/api/v1/auth/me")
        assert resp.status_code == 401

    async def test_refresh_endpoint(self, app_client):
        login = await app_client.post("/api/v1/auth/login/pin", json={
            "username": "phantom", "pin": "000000"
        })
        token = login.json()["token"]
        resp = await app_client.post(
            "/api/v1/auth/refresh",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "token" in data
        assert "expires_at" in data
        # Verify the new token is valid
        from security.jwt_manager import verify_token
        payload = verify_token(data["token"])
        assert payload.username == "phantom"

    async def test_logout(self, app_client):
        resp = await app_client.post("/api/v1/auth/logout")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    async def test_create_user_root_only(self, app_client):
        login = await app_client.post("/api/v1/auth/login/pin", json={
            "username": "phantom", "pin": "000000"
        })
        token = login.json()["token"]
        resp = await app_client.post(
            "/api/v1/users",
            json={"username": "newop", "role": "OPERATOR", "pin": "111111"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 201
        assert resp.json()["username"] == "newop"
        assert resp.json()["role"] == "OPERATOR"

    async def test_create_user_duplicate_returns_409(self, app_client):
        login = await app_client.post("/api/v1/auth/login/pin", json={
            "username": "phantom", "pin": "000000"
        })
        token = login.json()["token"]
        await app_client.post(
            "/api/v1/users",
            json={"username": "dupuser", "role": "GUEST", "pin": "123456"},
            headers={"Authorization": f"Bearer {token}"},
        )
        resp = await app_client.post(
            "/api/v1/users",
            json={"username": "dupuser", "role": "GUEST", "pin": "654321"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 409

    async def test_list_users_root_only(self, app_client):
        login = await app_client.post("/api/v1/auth/login/pin", json={
            "username": "phantom", "pin": "000000"
        })
        token = login.json()["token"]
        resp = await app_client.get(
            "/api/v1/users",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert "users" in resp.json()
        assert len(resp.json()["users"]) >= 1

    async def test_list_users_denied_for_operator(self, app_client):
        # Create an operator user and try to list users with it
        login_root = await app_client.post("/api/v1/auth/login/pin", json={
            "username": "phantom", "pin": "000000"
        })
        root_token = login_root.json()["token"]
        # Create an operator
        await app_client.post(
            "/api/v1/users",
            json={"username": "opuser", "role": "OPERATOR", "pin": "777777"},
            headers={"Authorization": f"Bearer {root_token}"},
        )
        login = await app_client.post("/api/v1/auth/login/pin", json={
            "username": "opuser", "pin": "777777"
        })
        token = login.json()["token"]
        resp = await app_client.get(
            "/api/v1/users",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 403

    async def test_delete_own_account_returns_400(self, app_client):
        login = await app_client.post("/api/v1/auth/login/pin", json={
            "username": "phantom", "pin": "000000"
        })
        token = login.json()["token"]
        user_id = login.json()["user"]["id"]
        resp = await app_client.delete(
            f"/api/v1/users/{user_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 400

    async def test_set_role_own_account_returns_400(self, app_client):
        login = await app_client.post("/api/v1/auth/login/pin", json={
            "username": "phantom", "pin": "000000"
        })
        token = login.json()["token"]
        user_id = login.json()["user"]["id"]
        resp = await app_client.put(
            f"/api/v1/users/{user_id}/role",
            json={"role": "GUEST"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 400

    async def test_auth_config_no_auth_required(self, app_client):
        resp = await app_client.get("/api/v1/auth/config")
        assert resp.status_code == 200
        data = resp.json()
        assert "max_pin_attempts" in data
        assert "lockout_duration_m" in data
        assert "session_timeout_m" in data
        assert data["max_pin_attempts"] > 0

    async def test_context_routes_require_auth(self, app_client):
        resp = await app_client.get("/api/v1/context/current")
        assert resp.status_code == 401

    async def test_context_routes_accessible_with_token(self, app_client):
        login = await app_client.post("/api/v1/auth/login/pin", json={
            "username": "phantom", "pin": "000000"
        })
        token = login.json()["token"]
        resp = await app_client.get(
            "/api/v1/context/current",
            headers={"Authorization": f"Bearer {token}"},
        )
        # 200 or 503 (if context engine not started) — just not 401
        assert resp.status_code != 401
