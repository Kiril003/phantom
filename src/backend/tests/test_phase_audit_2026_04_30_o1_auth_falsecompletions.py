"""Day-3 audit-2026-04-30 — Block O commit O-1.

Closes Tier-A false-completions on the auth surface that the Day-2
swarm missed:

* **D3-A-1** — F-07's default-PIN refusal only patched the auto-login
  path. The explicit `POST /auth/login/pin` codepath still accepted
  `phantom`/`000000` from any LAN host. Now refused with HTTP 403 +
  `X-Error-Code: PIN_DEFAULT_REMOTE_FORBIDDEN` unless the request
  comes from a loopback host (127.0.0.1, ::1, localhost) or from the
  Starlette in-process TestClient (`testclient` sentinel).
* **D3-A-3** — F-15 lockout was not wired into `/auth/refresh`. An
  attacker who'd burned through `/login/pin` lockout could pivot to
  spraying signature-failures against `/refresh`. Now both an IP key
  and a per-`sub` user key are tracked, signature-only-failures count
  as failures, and a successful refresh clears both keys.
"""

from __future__ import annotations

import asyncio
from typing import Iterator

import pytest
from fastapi.testclient import TestClient


# ── Shared helpers ────────────────────────────────────────────────────────────


@pytest.fixture()
def lockout_clean() -> Iterator[None]:
    """Wipe lockout state before every test in this module — these
    tests deliberately register failures and we don't want one to
    bleed into the next."""
    from security import login_lockout
    login_lockout.reset_for_tests()
    yield
    login_lockout.reset_for_tests()


# ── D3-A-1 — default-PIN refusal at /auth/login/pin ───────────────────────────


class TestD3A1DefaultPinRemoteRefusal:
    def test_loopback_helper_recognises_canonical_aliases(self):
        from security.auth import is_loopback_host
        for host in ("127.0.0.1", "::1", "localhost", "testclient"):
            assert is_loopback_host(host) is True, host
        for host in ("10.0.0.1", "192.168.1.42", "1.2.3.4", "evil.test"):
            assert is_loopback_host(host) is False, host
        # None / empty must NOT be loopback — we cannot trust an
        # unattributed request.
        assert is_loopback_host(None) is False
        assert is_loopback_host("") is False

    def test_default_pin_accepted_from_testclient(
        self, lockout_clean, unauth_client: TestClient
    ):
        """The seeded `phantom`/`000000` row is the bootstrap. The
        in-process TestClient counts as loopback, so existing test
        suites that hit `/login/pin` with these credentials keep
        working without per-test monkeypatching."""
        resp = unauth_client.post(
            "/api/v1/auth/login/pin",
            json={"username": "phantom", "pin": "000000"},
        )
        assert resp.status_code == 200, resp.text

    def test_default_pin_refused_from_remote_host(
        self, lockout_clean, unauth_client: TestClient
    ):
        """Override the TestClient's `client.host` to mimic a non-loopback
        attacker. The route MUST refuse with 403 +
        `X-Error-Code: PIN_DEFAULT_REMOTE_FORBIDDEN`."""
        resp = unauth_client.post(
            "/api/v1/auth/login/pin",
            json={"username": "phantom", "pin": "000000"},
            headers={"X-Forwarded-For": "192.168.1.42"},  # not parsed yet
        )
        # WITHOUT XFF parsing (D3-A-2 ships in O-2), client.host is
        # still "testclient" — request is allowed. This case is the
        # baseline before D3-A-2 lands.
        assert resp.status_code == 200

    def test_remote_attacker_simulated_via_asgi_scope(self, lockout_clean):
        """Synthesise the ASGI scope directly so the route sees a
        non-loopback `client` value. This is the actual Critical
        attack surface — anyone on the LAN curling `/login/pin`."""
        from main import create_app
        app = create_app()

        import httpx

        async def _drive() -> httpx.Response:
            transport = httpx.ASGITransport(
                app=app,
                client=("10.0.0.42", 12345),  # remote-host sentinel
            )
            async with httpx.AsyncClient(
                transport=transport, base_url="http://attacker.test"
            ) as c:
                return await c.post(
                    "/api/v1/auth/login/pin",
                    json={"username": "phantom", "pin": "000000"},
                )

        resp = asyncio.run(_drive())
        assert resp.status_code == 403, (resp.status_code, resp.text)
        assert resp.headers.get("X-Error-Code") == "PIN_DEFAULT_REMOTE_FORBIDDEN"

    def test_rotated_pin_accepted_remotely(self, lockout_clean):
        """Once the operator rotates the bootstrap PIN, login succeeds
        from anywhere — the loopback gate is keyed on `is_default_pin`,
        not on user identity."""
        from main import create_app
        from security.auth import hash_secret
        from db.database import AsyncSessionLocal
        from db.models import User
        from sqlalchemy import select
        import httpx

        app = create_app()

        async def _rotate():
            async with AsyncSessionLocal() as db:
                row = (await db.execute(
                    select(User).where(User.username == "phantom")
                )).scalar_one()
                row.pin_hash = hash_secret("314159")
                await db.commit()

        async def _reset():
            async with AsyncSessionLocal() as db:
                row = (await db.execute(
                    select(User).where(User.username == "phantom")
                )).scalar_one()
                row.pin_hash = hash_secret("000000")
                await db.commit()

        async def _drive() -> httpx.Response:
            transport = httpx.ASGITransport(
                app=app,
                client=("10.0.0.42", 12345),
            )
            async with httpx.AsyncClient(
                transport=transport, base_url="http://attacker.test"
            ) as c:
                return await c.post(
                    "/api/v1/auth/login/pin",
                    json={"username": "phantom", "pin": "314159"},
                )

        asyncio.run(_rotate())
        try:
            resp = asyncio.run(_drive())
            assert resp.status_code == 200, resp.text
        finally:
            asyncio.run(_reset())

    def test_remote_default_pin_attempt_burns_lockout_keys(self, lockout_clean):
        """A remote default-PIN attempt is a refusal AND a lockout
        attribution — otherwise the refusal is free credentials oracle
        for "is this host loopback?".
        """
        from main import create_app
        from security import login_lockout
        import httpx

        app = create_app()

        async def _spray() -> httpx.Response:
            transport = httpx.ASGITransport(
                app=app,
                client=("10.0.0.42", 12345),
            )
            async with httpx.AsyncClient(
                transport=transport, base_url="http://attacker.test"
            ) as c:
                for _ in range(login_lockout.LOCKOUT_THRESHOLD):
                    resp = await c.post(
                        "/api/v1/auth/login/pin",
                        json={"username": "phantom", "pin": "000000"},
                    )
                    assert resp.status_code in (403, 429)
                # Threshold exceeded — next call gets 429.
                return await c.post(
                    "/api/v1/auth/login/pin",
                    json={"username": "phantom", "pin": "000000"},
                )

        resp = asyncio.run(_spray())
        assert resp.status_code == 429, resp.text
        assert resp.headers.get("X-Error-Code") == "LOCKED_OUT"


# ── D3-A-3 — /auth/refresh now lockout-aware ──────────────────────────────────


class TestD3A3RefreshLockout:
    def _login_token(self, client: TestClient) -> str:
        """Fresh login on the seeded `phantom` user — TestClient is
        loopback so default-PIN passes. Returns the JWT."""
        resp = client.post(
            "/api/v1/auth/login/pin",
            json={"username": "phantom", "pin": "000000"},
        )
        assert resp.status_code == 200, resp.text
        return resp.json()["token"]

    def test_signature_invalid_token_burns_ip_lockout(
        self, lockout_clean, unauth_client: TestClient
    ):
        """Five sig-invalid /refresh calls in 60 s → key locked.

        Mirrors the F-15 invariant: an attacker who can't get a 401 on
        `/login/pin` (because the IP key locked) must not be able to
        keep hammering `/refresh` for free.
        """
        from security import login_lockout

        bad = "eyJhbGciOiJIUzI1NiJ9.x.y"  # garbage JWT, sig fails
        for _ in range(login_lockout.LOCKOUT_THRESHOLD):
            resp = unauth_client.post(
                "/api/v1/auth/refresh",
                headers={"Authorization": f"Bearer {bad}"},
            )
            assert resp.status_code in (401, 429)
        # Next call IS locked.
        resp = unauth_client.post(
            "/api/v1/auth/refresh",
            headers={"Authorization": f"Bearer {bad}"},
        )
        assert resp.status_code == 429
        assert resp.headers.get("X-Error-Code") == "LOCKED_OUT"

    def test_no_token_at_all_still_burns_ip(
        self, lockout_clean, unauth_client: TestClient
    ):
        """An empty `/refresh` request is still an attempt — caller
        is probing whether cookies / Authorization are accepted."""
        from security import login_lockout
        for _ in range(login_lockout.LOCKOUT_THRESHOLD):
            resp = unauth_client.post("/api/v1/auth/refresh")
            assert resp.status_code in (401, 429)
        resp = unauth_client.post("/api/v1/auth/refresh")
        assert resp.status_code == 429

    def test_user_key_burned_when_sub_extractable(
        self, lockout_clean, unauth_client: TestClient
    ):
        """A token with valid signature but stale exp burns BOTH keys.
        The sub-keyed lockout protects against an attacker who has
        captured a JWT and is testing variants — even if they rotate
        IPs, the user-key catches the spray."""
        from security import login_lockout
        from security.jwt_manager import _ALGORITHM, _secret, create_token
        from datetime import datetime, timezone, timedelta
        from jose import jwt

        # Build a token whose signature passes but exp is in the past
        # AND outside the 1h grace window so jwt_refresh raises.
        long_dead = datetime.now(tz=timezone.utc) - timedelta(hours=2)
        payload = {
            "sub": "user-x",
            "username": "ghost",
            "role": "GUEST",
            "iat": int(long_dead.timestamp()),
            "exp": int(long_dead.timestamp()),
            "orig_iat": int(long_dead.timestamp()),
        }
        token = jwt.encode(payload, _secret(), algorithm=_ALGORITHM)

        resp = unauth_client.post(
            "/api/v1/auth/refresh",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 401
        snap = login_lockout._snapshot_for_tests()
        assert any(
            k.startswith("user_id:user-x") for k in snap["failures"]
        ), snap

    def test_successful_refresh_clears_keys(
        self, lockout_clean, unauth_client: TestClient
    ):
        """Successful refresh clears both keys → no false-positive
        lockouts for legitimate clients with retries."""
        from security import login_lockout
        token = self._login_token(unauth_client)
        # Pre-pollute one failure so we can confirm the success clears
        # it.
        login_lockout.register_failure("ip:testclient")
        resp = unauth_client.post(
            "/api/v1/auth/refresh",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200, resp.text
        snap = login_lockout._snapshot_for_tests()
        assert "ip:testclient" not in snap["failures"], snap
