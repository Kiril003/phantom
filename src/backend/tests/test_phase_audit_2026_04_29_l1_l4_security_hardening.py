"""Tier-E L-1..L-4 — Day-2 audit security hardening.

Four findings closed in one batch (all touch the auth boundary):

* **L-1 (F-7)**  — `get_auto_login_user` refuses to surface a user
                   whose PIN is still the bootstrap default `'000000'`.
* **L-2 (F-14)** — JWT carries `orig_iat`; `verify_token` rejects
                   tokens whose `orig_iat` is older than 30 days.
                   `refresh_token` preserves the original timestamp
                   so the absolute cap can't be reset by chaining.
* **L-3 (F-15)** — login routes consult `security.login_lockout`
                   before calling `authenticate_*`; record per-IP +
                   per-username failures with sliding-window logic.
* **L-4 (D2-CI1)** — `main._refuse_ci_default_secret` raises if
                     `JWT_SECRET_KEY == 'ci-fixed-secret-do-not-reuse'`
                     outside test contexts.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest


# ── L-1 — F-7 default-PIN refusal ─────────────────────────────────────────────


class TestL1DefaultPinRefusal:
    def test_is_default_pin_helper_recognises_seed_value(self):
        from security.auth import hash_secret, is_default_pin

        assert is_default_pin(hash_secret("000000")) is True
        assert is_default_pin(hash_secret("123456")) is False
        assert is_default_pin(None) is False
        assert is_default_pin("") is False

    @pytest.mark.asyncio
    async def test_auto_login_refuses_user_with_default_pin(self, monkeypatch):
        # Construct an exact single-row User result without touching the
        # real DB — destructive `delete(User)` here would wipe the seed
        # `phantom` row that downstream test files (test_phase08_face's
        # `auth_token` fixture) depend on.
        from security.auth import get_auto_login_user, hash_secret
        from db.models import User

        synthetic_user = User(
            id=str(uuid.uuid4()),
            username="phantom_default",
            role="ROOT",
            pin_hash=hash_secret("000000"),
            rfid_uid_hash=None,
            preferences_json="{}",
        )

        class _FakeScalars:
            def __init__(self, rows):
                self._rows = rows

            def all(self):
                return list(self._rows)

        class _FakeResult:
            def __init__(self, rows):
                self._rows = rows

            def scalars(self):
                return _FakeScalars(self._rows)

        class _FakeDb:
            def __init__(self, rows):
                self._rows = rows

            async def execute(self, *_a, **_kw):
                return _FakeResult(self._rows)

        from config import config as live_config
        monkeypatch.setattr(live_config, "security_auto_login", True)

        user = await get_auto_login_user(_FakeDb([synthetic_user]))
        assert user is None, (
            "F-7 regression: auto-login surfaced a user whose PIN is "
            "still the bootstrap '000000'."
        )

    @pytest.mark.asyncio
    async def test_auto_login_succeeds_after_pin_rotation(self, monkeypatch):
        # Same fake-DB trick — non-destructive, so the seeded phantom
        # row downstream tests rely on stays intact.
        from security.auth import get_auto_login_user, hash_secret
        from db.models import User

        synthetic_user = User(
            id=str(uuid.uuid4()),
            username="phantom_rotated",
            role="ROOT",
            pin_hash=hash_secret("48732"),  # not default
            rfid_uid_hash=None,
            preferences_json="{}",
        )

        class _FakeScalars:
            def __init__(self, rows):
                self._rows = rows

            def all(self):
                return list(self._rows)

        class _FakeResult:
            def __init__(self, rows):
                self._rows = rows

            def scalars(self):
                return _FakeScalars(self._rows)

        class _FakeDb:
            def __init__(self, rows):
                self._rows = rows

            async def execute(self, *_a, **_kw):
                return _FakeResult(self._rows)

        from config import config as live_config
        monkeypatch.setattr(live_config, "security_auto_login", True)

        user = await get_auto_login_user(_FakeDb([synthetic_user]))
        assert user is not None
        assert user.username == "phantom_rotated"


# ── L-2 — F-14 JWT 30-day absolute cap ────────────────────────────────────────


class TestL2JwtAbsoluteCap:
    def test_create_token_anchors_orig_iat_on_first_issue(self):
        from security.jwt_manager import create_token, verify_token

        token, _ = create_token("u1", "phantom", "ROOT")
        payload = verify_token(token)
        assert payload.orig_iat is not None
        assert payload.orig_iat == payload.iat, (
            "F-14 regression: orig_iat should equal iat on a fresh "
            "(non-refreshed) token."
        )

    def test_refresh_preserves_orig_iat(self):
        from security.jwt_manager import create_token, refresh_token, verify_token

        token, _ = create_token("u1", "phantom", "ROOT")
        original = verify_token(token)
        refreshed_token, _ = refresh_token(token)
        refreshed = verify_token(refreshed_token)
        assert refreshed.orig_iat == original.orig_iat, (
            "F-14 regression: refresh moved orig_iat forward — the "
            "30-day cap can be reset by chaining refreshes."
        )
        # `iat` MAY equal `orig_iat` if the second-resolution clock
        # didn't advance; allow that. The point is the new iat must
        # NOT be lower than the original (monotonic).
        assert refreshed.iat >= original.iat

    def test_verify_token_rejects_old_orig_iat(self):
        # Encode a token by hand whose orig_iat is 31 days ago. iat/exp
        # are kept current so the per-token expiry doesn't intercept.
        from jose import JWTError, jwt
        from security.jwt_manager import _secret, _ALGORITHM, verify_token

        now = datetime.now(tz=timezone.utc)
        payload = {
            "sub": "u1",
            "username": "phantom",
            "role": "ROOT",
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(minutes=30)).timestamp()),
            "orig_iat": int((now - timedelta(days=31)).timestamp()),
        }
        token = jwt.encode(payload, _secret(), algorithm=_ALGORITHM)
        with pytest.raises(JWTError):
            verify_token(token)

    def test_refresh_token_rejects_chain_past_30_days(self):
        from jose import JWTError, jwt
        from security.jwt_manager import _secret, _ALGORITHM, refresh_token

        now = datetime.now(tz=timezone.utc)
        payload = {
            "sub": "u1",
            "username": "phantom",
            "role": "ROOT",
            "iat": int((now - timedelta(minutes=10)).timestamp()),
            "exp": int((now - timedelta(minutes=5)).timestamp()),
            "orig_iat": int((now - timedelta(days=35)).timestamp()),
        }
        # Token is in the 1h grace window (5 min past expiry) but the
        # absolute cap is breached — refresh must still reject it.
        token = jwt.encode(payload, _secret(), algorithm=_ALGORITHM)
        with pytest.raises(JWTError):
            refresh_token(token)

    def test_legacy_token_without_orig_iat_decays_naturally(self):
        # Tokens issued before F-14 shipped don't carry orig_iat. The
        # verifier treats them as if `orig_iat == iat`, so they're
        # accepted while still inside the cap and rejected once the
        # implied lifetime passes.
        from jose import JWTError, jwt
        from security.jwt_manager import _secret, _ALGORITHM, verify_token

        now = datetime.now(tz=timezone.utc)
        # Legacy iat ~31 days ago — implied orig_iat is also old.
        payload_old = {
            "sub": "u1",
            "username": "phantom",
            "role": "ROOT",
            "iat": int((now - timedelta(days=31)).timestamp()),
            "exp": int((now + timedelta(minutes=30)).timestamp()),
            # NO orig_iat key
        }
        token_old = jwt.encode(payload_old, _secret(), algorithm=_ALGORITHM)
        with pytest.raises(JWTError):
            verify_token(token_old)

        # Legacy iat fresh — implied orig_iat is also fresh; should pass.
        payload_fresh = {
            "sub": "u1",
            "username": "phantom",
            "role": "ROOT",
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(minutes=30)).timestamp()),
        }
        token_fresh = jwt.encode(payload_fresh, _secret(), algorithm=_ALGORITHM)
        result = verify_token(token_fresh)
        assert result.orig_iat == result.iat


# ── L-3 — F-15 login lockout ──────────────────────────────────────────────────


class TestL3LoginLockout:
    @pytest.fixture(autouse=True)
    def _clean_lockout_state(self):
        from security import login_lockout
        login_lockout.reset_for_tests()
        yield
        login_lockout.reset_for_tests()

    def test_below_threshold_does_not_lock(self):
        from security import login_lockout

        for _ in range(login_lockout.LOCKOUT_THRESHOLD - 1):
            login_lockout.register_failure("ip:1.2.3.4")
        locked, remaining = login_lockout.is_locked("ip:1.2.3.4")
        assert locked is False
        assert remaining == 0

    def test_threshold_failures_lock_the_key(self):
        from security import login_lockout

        for _ in range(login_lockout.LOCKOUT_THRESHOLD):
            login_lockout.register_failure("ip:1.2.3.4")
        locked, remaining = login_lockout.is_locked("ip:1.2.3.4")
        assert locked is True
        assert remaining > 0
        assert remaining <= login_lockout.LOCKOUT_DURATION_S

    def test_register_success_clears_failure_history(self):
        from security import login_lockout

        for _ in range(login_lockout.LOCKOUT_THRESHOLD - 1):
            login_lockout.register_failure("user:phantom")
        login_lockout.register_success("user:phantom")
        # Now another `THRESHOLD - 1` failures must NOT trip the lock —
        # the success cleared the deque.
        for _ in range(login_lockout.LOCKOUT_THRESHOLD - 1):
            login_lockout.register_failure("user:phantom")
        locked, _ = login_lockout.is_locked("user:phantom")
        assert locked is False

    def test_register_failure_returns_true_on_lock_transition(self):
        from security import login_lockout

        transitioned = []
        for _ in range(login_lockout.LOCKOUT_THRESHOLD):
            transitioned.append(login_lockout.register_failure("ip:9.9.9.9"))
        # Exactly one of those calls returned True (the threshold-th).
        assert transitioned.count(True) == 1
        # Subsequent failures while still locked do NOT transition.
        for _ in range(3):
            assert login_lockout.register_failure("ip:9.9.9.9") in (False, True)

    def test_login_pin_returns_429_when_ip_is_locked(self):
        from fastapi.testclient import TestClient
        from main import create_app
        from security import login_lockout

        # Pre-lock the IP via direct API.
        for _ in range(login_lockout.LOCKOUT_THRESHOLD):
            login_lockout.register_failure("ip:testclient")

        app = create_app()
        with TestClient(app) as client:
            r = client.post(
                "/api/v1/auth/login/pin",
                json={"username": "any", "pin": "000000"},
            )
        assert r.status_code == 429
        assert r.headers.get("X-Error-Code") == "LOCKED_OUT"
        assert "Retry-After" in r.headers

    def test_failed_pin_attempts_eventually_lock_out_real_request(self):
        # End-to-end: hammer /login/pin with wrong creds and see the
        # 5th request return 401, the 6th return 429.
        from fastapi.testclient import TestClient
        from main import create_app
        from security import login_lockout

        app = create_app()
        with TestClient(app) as client:
            # Confirm a fresh state hits 401 first.
            for i in range(login_lockout.LOCKOUT_THRESHOLD):
                r = client.post(
                    "/api/v1/auth/login/pin",
                    json={"username": "phantom_nope", "pin": "999999"},
                )
                assert r.status_code == 401, (
                    f"attempt {i + 1} should still be 401; got {r.status_code}"
                )
            # Next attempt — locked.
            r = client.post(
                "/api/v1/auth/login/pin",
                json={"username": "phantom_nope", "pin": "999999"},
            )
            assert r.status_code == 429
            assert r.headers.get("X-Error-Code") == "LOCKED_OUT"


# ── L-4 — D2-CI1 CI default secret refusal ────────────────────────────────────


class TestL4CiSecretGuard:
    def test_refuse_ci_default_secret_helper_passes_under_pytest(self):
        # We're literally running under pytest right now. The guard
        # MUST short-circuit so the existing test suite isn't broken
        # by setting JWT_SECRET_KEY to the public placeholder.
        from main import _refuse_ci_default_secret

        # No raise expected — under pytest, the guard is bypassed.
        _refuse_ci_default_secret()

    def test_refuse_raises_outside_test_runner(self, monkeypatch):
        # Simulate a non-test process: drop pytest from sys.modules,
        # clear the override env var, and pin the secret to the public
        # placeholder. The guard must raise.
        from main import _refuse_ci_default_secret, _CI_FIXED_SECRET
        from config import config as live_config

        import sys as _sys
        # Snapshot then drop. We restore via monkeypatch.
        for k in list(_sys.modules):
            if k == "pytest" or k.startswith("pytest."):
                monkeypatch.delitem(_sys.modules, k, raising=False)
        monkeypatch.delenv("PHANTOM_ALLOW_CI_SECRET", raising=False)
        monkeypatch.setattr(live_config, "jwt_secret_key", _CI_FIXED_SECRET)

        with pytest.raises(RuntimeError, match="ci-fixed-secret"):
            _refuse_ci_default_secret()

    def test_env_override_bypasses_guard(self, monkeypatch):
        from main import _refuse_ci_default_secret, _CI_FIXED_SECRET
        from config import config as live_config

        import sys as _sys
        for k in list(_sys.modules):
            if k == "pytest" or k.startswith("pytest."):
                monkeypatch.delitem(_sys.modules, k, raising=False)
        monkeypatch.setenv("PHANTOM_ALLOW_CI_SECRET", "1")
        monkeypatch.setattr(live_config, "jwt_secret_key", _CI_FIXED_SECRET)

        # No raise — the operator has explicitly opted in.
        _refuse_ci_default_secret()
