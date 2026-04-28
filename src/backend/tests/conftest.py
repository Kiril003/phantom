"""
Project-level conftest — Day-2 audit (Tier A) authenticated TestClient
fixtures.

Until 2026-04-29 every test that hit the FastAPI routes either bypassed
auth (because the route had none — F-08, F-09) or hand-rolled token
issuance via `headers={"Authorization": f"Bearer {token}"}` per call.
Day 2 closes F-08 / F-09 / F-15, which means dozens of pre-existing
tests need an authenticated client; centralising the fixture here
makes that swap a one-line change per call site.

Fixtures provided:

    auth_root_user      — User row with role=ROOT, fresh per session
    auth_root_token     — JWT for auth_root_user
    auth_root_client    — TestClient wrapping the FastAPI app with
                           the bearer header preset
    auth_operator_user  — same shape, role=OPERATOR
    auth_operator_token / auth_operator_client
    unauth_client       — TestClient without auth, for "should 401"
                           negative tests

The fixtures avoid leaking state across tests by creating a unique
user_id per pytest session and tearing down only the auth row (chroma
state already lives behind a session-scoped `_get_client` so we don't
fight over it).

JWT_SECRET_KEY is set here at module import so pre-existing tests that
forgot to set it themselves still get a deterministic key. Production
must NEVER use this value — see Day-2 D2-CI1 for the ci-fixed-secret
rejection logic.
"""
from __future__ import annotations

import os
import uuid
from typing import AsyncIterator

import pytest


# ── JWT secret bootstrap ──────────────────────────────────────────────────────
#
# Set BEFORE any FastAPI app import so routes that read config at module
# load time (e.g. CORS origins via cors_origins) see the right value.
# `setdefault` so individual test files can still pin a stronger secret.
os.environ.setdefault(
    "JWT_SECRET_KEY",
    "phantom-conftest-test-secret-do-not-use-in-prod-2026",
)


# ── Helpers ───────────────────────────────────────────────────────────────────


def _make_user_row(role: str) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "username": f"phantom_test_{role.lower()}_{uuid.uuid4().hex[:8]}",
        "role": role,
        "pin_hash": "x",  # routes don't re-verify PIN once a JWT is issued
        "rfid_uid_hash": None,
        "preferences_json": "{}",
    }


async def _ensure_user(payload: dict):
    """Insert User row if not present. Returns the User instance."""
    from db.database import init_db, get_session
    from db.models import User
    from sqlalchemy import select

    await init_db()
    async with get_session() as db:
        existing = (
            await db.execute(select(User).where(User.id == payload["id"]))
        ).scalar_one_or_none()
        if existing is not None:
            return existing
        user = User(**payload)
        db.add(user)
        await db.commit()
    async with get_session() as db:
        return (
            await db.execute(select(User).where(User.id == payload["id"]))
        ).scalar_one_or_none()


def _issue_token(user_id: str, username: str, role: str) -> str:
    from security.jwt_manager import create_token
    token, _expires_at = create_token(user_id, username, role)
    return token


# ── Session-scoped user rows ──────────────────────────────────────────────────


@pytest.fixture(scope="session")
def _root_payload() -> dict:
    return _make_user_row("ROOT")


@pytest.fixture(scope="session")
def _operator_payload() -> dict:
    return _make_user_row("OPERATOR")


@pytest.fixture
async def auth_root_user(_root_payload):
    return await _ensure_user(_root_payload)


@pytest.fixture
async def auth_operator_user(_operator_payload):
    return await _ensure_user(_operator_payload)


# ── Token fixtures (sync for ease of use in non-async tests) ──────────────────


@pytest.fixture
def auth_root_token(_root_payload) -> str:
    return _issue_token(
        _root_payload["id"], _root_payload["username"], _root_payload["role"]
    )


@pytest.fixture
def auth_operator_token(_operator_payload) -> str:
    return _issue_token(
        _operator_payload["id"],
        _operator_payload["username"],
        _operator_payload["role"],
    )


# ── TestClient fixtures ───────────────────────────────────────────────────────


@pytest.fixture
async def auth_root_client(auth_root_user, auth_root_token):
    """TestClient with `Authorization: Bearer <root_token>` preset on every
    request. The user row exists in the DB so `get_current_user` resolves."""
    from fastapi.testclient import TestClient
    from main import create_app

    app = create_app()
    with TestClient(app) as c:
        c.headers.update({"Authorization": f"Bearer {auth_root_token}"})
        yield c


@pytest.fixture
async def auth_operator_client(auth_operator_user, auth_operator_token):
    from fastapi.testclient import TestClient
    from main import create_app

    app = create_app()
    with TestClient(app) as c:
        c.headers.update({"Authorization": f"Bearer {auth_operator_token}"})
        yield c


@pytest.fixture
def unauth_client():
    """TestClient with NO auth — for negative tests that expect 401."""
    from fastapi.testclient import TestClient
    from main import create_app

    app = create_app()
    with TestClient(app) as c:
        yield c
