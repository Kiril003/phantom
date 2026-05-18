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


# ── Day-N (2026-05-03) — test DB isolation ────────────────────────────────────
#
# `db.database` builds the async engine at *module import time* from
# `config.database_url`, which defaults to `sqlite+aiosqlite:///./phantom.db`
# — the live development DB. Every test that called `init_db()` and
# `_ensure_user(_make_user_row(...))` therefore left `phantom_test_*` /
# `phase17a_user_*` rows in the operator's actual database. Over weeks of
# pytest runs this leaked ~78 ghost users into the LoginScreen profile
# grid, which on the 1024×600 panel pushed the PIN pad off-screen and
# made it impossible to log in.
#
# Force `DATABASE_URL` to a per-pytest-process tmp file BEFORE any
# `db.database` import. `setdefault` so tests that need to point at a
# specific DB (e.g. migration smoke-tests) can still pin their own URL
# via `monkeypatch.setenv("DATABASE_URL", ...)` *before* importing.
import tempfile  # noqa: E402  (stdlib import after env setup is intentional)

_TEST_DB_FD, _TEST_DB_PATH = tempfile.mkstemp(
    prefix="phantom_pytest_", suffix=".db"
)
os.close(_TEST_DB_FD)
os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{_TEST_DB_PATH}")


# ── Day-2 L-3 (audit-2026-04-29 F-15) — login lockout test isolation ─────────
#
# `security.login_lockout` is a process-local in-memory module. Tests
# that hit `/api/v1/auth/login/pin` with bad credentials trip the
# lockout after `LOCKOUT_THRESHOLD` attempts and the next test inherits
# the locked state — manifesting as a 429 instead of the 401 the test
# expected. Reset the module's deques/until-map between tests.


@pytest.fixture(autouse=True)
def _reset_login_lockout_per_test():
    from security import login_lockout
    login_lockout.reset_for_tests()
    yield
    login_lockout.reset_for_tests()


# ── Seed-user idempotence for tests that depend on phantom/000000 ─────────────
#
# Several pre-existing test files (`test_phase08_face.py::auth_token`,
# `test_phase07_voice.py` voice route fixtures) call `/api/v1/auth/login/pin`
# with `phantom`/`000000` to obtain a token. That works only when the
# bootstrap row created by `ensure_default_user` is in the DB. Other
# tests in this session can have already populated the `users` table
# (the conftest `_ensure_user` helper creates per-role test rows), which
# makes `ensure_default_user`'s "no users exist" gate skip the seed.
#
# This session-scoped autouse fixture restores the invariant by creating
# the `phantom` row up-front when missing — idempotent, no-op when it
# already exists.


@pytest.fixture(scope="session", autouse=True)
def _ensure_seed_phantom_user():
    """Day-3 D3-A-12 (FLAKE-02): the previous implementation called
    `asyncio.run()` inside a `try/except RuntimeError: pass`. Under
    pytest-asyncio's session loop the run could raise and be silently
    swallowed → seed row missing → sporadic 401s in `test_phase07_voice`
    and `test_phase08_face`. The fix is to run the bootstrap in a
    dedicated worker thread that owns its own event loop, so the parent
    loop state never matters and exceptions surface."""
    import asyncio as _asyncio
    import threading as _threading
    import uuid as _uuid

    async def _run():
        from db.database import init_db, get_session
        from db.models import User
        from security.auth import hash_secret
        from sqlalchemy import select

        await init_db()
        async with get_session() as db:
            existing = (await db.execute(
                select(User).where(User.username == "phantom")
            )).scalar_one_or_none()
            if existing is not None:
                return
            db.add(User(
                id=str(_uuid.uuid4()),
                username="phantom",
                role="ROOT",
                pin_hash=hash_secret("000000"),
                rfid_uid_hash=None,
                avatar_url=None,
                preferences_json="{}",
            ))
            await db.commit()

    # Run in a dedicated thread so the seed-bootstrap never collides
    # with any in-flight pytest-asyncio session loop.
    err_box: list[BaseException] = []

    def _worker() -> None:
        try:
            _asyncio.run(_run())
        except BaseException as exc:  # noqa: BLE001
            err_box.append(exc)

    t = _threading.Thread(target=_worker, daemon=False, name="seed-worker")
    t.start()
    t.join(timeout=30)
    if err_box:
        raise RuntimeError(
            f"_ensure_seed_phantom_user failed: {err_box[0]!r}"
        ) from err_box[0]
    if t.is_alive():
        raise RuntimeError(
            "_ensure_seed_phantom_user timed out after 30 s"
        )
    yield


# Day-3 D3-A-11 (FLAKE-01): the system_metrics_sampler is a module-
# level singleton that lifespan starts during app boot. Tests that mount
# `TestClient(create_app())` therefore start ONE sampler per app — and
# the asyncio task is bound to whatever loop pytest-asyncio is running
# at the time. The next test creates a new event loop; the old sampler
# task is on the dead loop, raising
# `RuntimeError: Task attached to a different loop` on every read.
# Reset the sampler module state between tests so each test starts
# clean.


@pytest.fixture(autouse=True)
def _reset_system_metrics_sampler_per_test():
    import system_metrics_sampler as _sms
    yield
    # Best-effort tear-down — `_reset_for_tests` is idempotent and
    # resilient to "no sampler ever started".
    try:
        _sms._reset_for_tests()
    except Exception:
        pass


@pytest.fixture(autouse=True)
def _register_ai_hub_capabilities_per_test():
    """Ensure AIHub starts with default capabilities (Gemini, Ollama) for every
    test. Isolation is maintained by resetting the hub singleton before
    each run."""
    from ai.hub import ai_hub, register_default_capabilities
    ai_hub.reset_for_tests()
    register_default_capabilities(hub=ai_hub)
    yield
    ai_hub.reset_for_tests()


# ── Helpers ───────────────────────────────────────────────────────────────────


def _make_user_row(role: str) -> dict:
    return {
        "id": str(uuid.uuid4()),
        # 2026-05-03 — name pattern MUST NOT match the picker's
        # exclusion filter (`phantom_test_*` / `phase17a_user_*` /
        # `t_*`); use `pytest_<role>_<uuid>` so picker-shape tests
        # still see fixture rows.
        "username": f"pytest_{role.lower()}_{uuid.uuid4().hex[:8]}",
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
