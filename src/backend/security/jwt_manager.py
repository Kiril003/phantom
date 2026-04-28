"""
JWT Manager — create / verify / refresh tokens.
Uses python-jose with HS256. Secret from config.jwt_secret_key.

Day-2 F-14 (audit-2026-04-29 Tier E): the refresh chain used to walk
forward indefinitely — every refresh issued a new token with `exp =
now + session_timeout`, so a stolen valid token could be refreshed
forever. The audit asks for a 30-day absolute cap from the FIRST
issuance: a refresh chain dies after 30 days regardless of activity.

The cap is anchored on `orig_iat` (carried verbatim through every
refresh) so we don't have to track session lineage in the DB.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import ExpiredSignatureError, JWTError, jwt

from config import config

logger = logging.getLogger(__name__)

_ALGORITHM = "HS256"

# F-14 absolute lifetime cap. 30 days mirrors common SaaS "session
# anchored to login event" defaults (e.g. AWS IAM, GitHub web). A
# refresh chain that crosses this boundary is rejected even if every
# individual token along the way is structurally valid.
ABSOLUTE_LIFETIME_DAYS: int = 30


@dataclass
class TokenPayload:
    user_id: str
    username: str
    role: str
    exp: int   # unix timestamp
    iat: int   # unix timestamp
    # F-14 — first-issuance timestamp; preserved across the refresh
    # chain so the absolute-lifetime ceiling is enforceable. None on
    # legacy tokens issued before the cap shipped (see verify_token
    # for the back-fill behaviour).
    orig_iat: Optional[int] = None


def _secret() -> str:
    secret = config.jwt_secret_key
    if not secret:
        raise RuntimeError(
            "JWT_SECRET_KEY is not set. Set it via JWT_SECRET_KEY environment variable."
        )
    return secret


def create_token(
    user_id: str,
    username: str,
    role: str,
    expires_minutes: Optional[int] = None,
    *,
    orig_iat: Optional[int] = None,
) -> tuple[str, str]:
    """
    Create a signed JWT.
    Returns (token_string, expires_at_iso8601).

    F-14: when ``orig_iat`` is None this is a fresh login — `orig_iat`
    is anchored to the new `iat`. When passed (refresh path), the
    caller's original first-issuance timestamp is preserved so the
    30-day absolute cap stays anchored to the login event.
    """
    now = datetime.now(tz=timezone.utc)
    ttl = expires_minutes or config.security_session_timeout_m
    expire = now + timedelta(minutes=ttl)
    iat_ts = int(now.timestamp())

    payload = {
        "sub": user_id,
        "username": username,
        "role": role,
        "iat": iat_ts,
        "exp": int(expire.timestamp()),
        "orig_iat": int(orig_iat) if orig_iat is not None else iat_ts,
    }

    token = jwt.encode(payload, _secret(), algorithm=_ALGORITHM)
    expires_at = expire.isoformat()
    return token, expires_at


def verify_token(token: str) -> TokenPayload:
    """
    Verify and decode a JWT.
    Raises jose.JWTError on invalid token, ExpiredSignatureError on expiry.

    F-14: rejects tokens whose ``orig_iat`` is older than
    ``ABSOLUTE_LIFETIME_DAYS`` regardless of the per-token ``exp``.

    Day-3 D3-C-2 (audit-2026-04-30 NEW-SEC-03): the previous "fall back
    to iat when orig_iat absent" rule grandfathered legacy tokens
    forever — a token issued before v0.18.1 (when orig_iat shipped)
    would refresh past the 30-day cap because each refresh re-anchors
    iat. The cap is now strict: tokens MUST carry `orig_iat`. Legacy
    tokens are refused with a clear "re-auth required" error so the
    front-end can prompt the operator. The transition window is
    naturally bounded: operators running pre-v0.18.1 have already had
    days to re-issue, and the next request from a stale client just
    surfaces the expected 401.
    """
    payload = jwt.decode(token, _secret(), algorithms=[_ALGORITHM])
    iat_ts = int(payload["iat"])
    if "orig_iat" not in payload:
        raise JWTError(
            "Token is missing orig_iat (issued before v0.18.1's "
            "absolute-lifetime cap landed). Re-authenticate."
        )
    orig_iat_ts = int(payload["orig_iat"])
    now_ts = int(datetime.now(tz=timezone.utc).timestamp())
    if now_ts - orig_iat_ts > ABSOLUTE_LIFETIME_DAYS * 86400:
        raise JWTError(
            f"Refresh chain exceeded {ABSOLUTE_LIFETIME_DAYS}-day cap "
            f"from first issuance. Re-authenticate to start a new session."
        )
    return TokenPayload(
        user_id=payload["sub"],
        username=payload["username"],
        role=payload["role"],
        exp=payload["exp"],
        iat=iat_ts,
        orig_iat=orig_iat_ts,
    )


def refresh_token(token: str) -> tuple[str, str]:
    """
    Verify existing token and issue a new one with fresh TTL.
    Raises JWTError if token is invalid (but allows expired within 1h grace).

    F-14: the new token preserves the ORIGINAL `orig_iat`, NOT the
    refresh moment, so the absolute-lifetime cap can't be cleared by
    chaining refreshes.
    """
    try:
        # Try normal verify first — this also enforces the F-14 cap.
        payload_data = verify_token(token)
    except ExpiredSignatureError:
        # Allow refresh within 1h after expiry (grace period). We still
        # have to enforce the absolute cap here — the grace path skips
        # `verify_token` entirely.
        payload = jwt.decode(
            token,
            _secret(),
            algorithms=[_ALGORITHM],
            options={"verify_exp": False},
        )
        now_ts = int(datetime.now(tz=timezone.utc).timestamp())
        grace_s = 3600
        if now_ts - payload["exp"] > grace_s:
            raise
        iat_ts = int(payload["iat"])
        # Day-3 D3-C-2 strict cap — same logic as verify_token: refuse
        # legacy tokens that lack the orig_iat anchor rather than
        # re-anchoring on iat (which would silently extend the chain).
        if "orig_iat" not in payload:
            raise JWTError(
                "Token is missing orig_iat. Re-authenticate."
            )
        orig_iat_ts = int(payload["orig_iat"])
        if now_ts - orig_iat_ts > ABSOLUTE_LIFETIME_DAYS * 86400:
            raise JWTError(
                f"Refresh chain exceeded {ABSOLUTE_LIFETIME_DAYS}-day cap; "
                f"re-authenticate."
            )
        payload_data = TokenPayload(
            user_id=payload["sub"],
            username=payload["username"],
            role=payload["role"],
            exp=payload["exp"],
            iat=iat_ts,
            orig_iat=orig_iat_ts,
        )

    return create_token(
        payload_data.user_id,
        payload_data.username,
        payload_data.role,
        orig_iat=payload_data.orig_iat,
    )
