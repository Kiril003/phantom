"""Day-3 audit-2026-04-30 — Block O commit O-7.

Closes **D3-C-2 (NEW-SEC-03)**: Day-2's `verify_token` and
`refresh_token` fell back to `iat` when `orig_iat` was absent —
grandfathering legacy tokens (issued before v0.18.1) forever. Each
refresh re-anchors `iat`, so the F-14 30-day absolute cap was
silently bypassable for any token issued during the transition.

Day-3 makes the cap strict: tokens MUST carry `orig_iat` to verify
or refresh. Legacy tokens are refused with a clear "re-auth"
error. The front-end's existing 401 handler surfaces this as a
login prompt; no new UX surface needed.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from jose import JWTError, jwt


# ── D3-C-2 — verify_token strict cap ──────────────────────────────────────────


class TestD3C2VerifyTokenStrict:
    def test_legacy_token_without_orig_iat_refused(self):
        """A signed-but-missing-orig_iat token MUST be refused. The
        previous Day-2 fallback (`payload.get("orig_iat", iat_ts)`)
        let it through and re-anchored every refresh."""
        from security.jwt_manager import verify_token, _ALGORITHM, _secret

        now = datetime.now(tz=timezone.utc)
        payload = {
            "sub": "user-x",
            "username": "ghost",
            "role": "GUEST",
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(minutes=10)).timestamp()),
            # NB: orig_iat deliberately absent — this is the legacy shape
        }
        token = jwt.encode(payload, _secret(), algorithm=_ALGORITHM)
        with pytest.raises(JWTError, match="orig_iat"):
            verify_token(token)

    def test_modern_token_with_orig_iat_accepted(self):
        """The strict cap MUST NOT regress current-shape tokens."""
        from security.jwt_manager import (
            create_token, verify_token, ABSOLUTE_LIFETIME_DAYS,
        )
        token, _ = create_token("user-y", "phantom", "ROOT")
        payload = verify_token(token)
        assert payload.user_id == "user-y"
        assert payload.orig_iat is not None
        # And the cap math still applies — we just don't grandfather.
        _ = ABSOLUTE_LIFETIME_DAYS

    def test_orig_iat_too_old_still_refused(self):
        """The 30-day cap fires regardless of whether the token came
        from the legacy or current code path. Construct a token whose
        orig_iat is 31 days old; expect refusal."""
        from security.jwt_manager import (
            verify_token, _ALGORITHM, _secret, ABSOLUTE_LIFETIME_DAYS,
        )

        now = datetime.now(tz=timezone.utc)
        far_back = now - timedelta(days=ABSOLUTE_LIFETIME_DAYS + 1)
        payload = {
            "sub": "user-z",
            "username": "ancient",
            "role": "GUEST",
            "iat": int(far_back.timestamp()),
            "exp": int((now + timedelta(minutes=10)).timestamp()),
            "orig_iat": int(far_back.timestamp()),
        }
        token = jwt.encode(payload, _secret(), algorithm=_ALGORITHM)
        with pytest.raises(JWTError, match="exceeded"):
            verify_token(token)


# ── D3-C-2 — refresh_token grace path ────────────────────────────────────────


class TestD3C2RefreshTokenGrace:
    def test_grace_path_legacy_token_refused(self):
        """The 1 h grace window in `refresh_token` re-decodes with
        `verify_exp=False` — that path used the same fallback. Now
        legacy tokens are refused even within grace."""
        from security.jwt_manager import refresh_token, _ALGORITHM, _secret

        # Build an expired-but-within-grace token without orig_iat.
        long_dead = datetime.now(tz=timezone.utc) - timedelta(minutes=10)
        payload = {
            "sub": "user-x",
            "username": "ghost",
            "role": "GUEST",
            "iat": int(long_dead.timestamp()),
            "exp": int(long_dead.timestamp()),  # already expired
        }
        token = jwt.encode(payload, _secret(), algorithm=_ALGORITHM)
        with pytest.raises(JWTError, match="orig_iat"):
            refresh_token(token)

    def test_grace_path_modern_token_still_refreshes(self):
        """A current-shape token within grace must still refresh —
        the strict cap only refuses missing-orig_iat, not all tokens.
        """
        from security.jwt_manager import refresh_token, create_token, verify_token

        token, _ = create_token("user-y", "phantom", "ROOT")
        new_token, _ = refresh_token(token)
        assert verify_token(new_token).user_id == "user-y"
