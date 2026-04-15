"""
JWT Manager — create / verify / refresh tokens.
Uses python-jose with HS256. Secret from config.jwt_secret_key.
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


@dataclass
class TokenPayload:
    user_id: str
    username: str
    role: str
    exp: int   # unix timestamp
    iat: int   # unix timestamp


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
) -> tuple[str, str]:
    """
    Create a signed JWT.
    Returns (token_string, expires_at_iso8601).
    """
    now = datetime.now(tz=timezone.utc)
    ttl = expires_minutes or config.security_session_timeout_m
    expire = now + timedelta(minutes=ttl)

    payload = {
        "sub": user_id,
        "username": username,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
    }

    token = jwt.encode(payload, _secret(), algorithm=_ALGORITHM)
    expires_at = expire.isoformat()
    return token, expires_at


def verify_token(token: str) -> TokenPayload:
    """
    Verify and decode a JWT.
    Raises jose.JWTError on invalid token, ExpiredSignatureError on expiry.
    """
    payload = jwt.decode(token, _secret(), algorithms=[_ALGORITHM])
    return TokenPayload(
        user_id=payload["sub"],
        username=payload["username"],
        role=payload["role"],
        exp=payload["exp"],
        iat=payload["iat"],
    )


def refresh_token(token: str) -> tuple[str, str]:
    """
    Verify existing token and issue a new one with fresh TTL.
    Raises JWTError if token is invalid (but allows expired within 1h grace).
    """
    try:
        # Try normal verify first
        payload_data = verify_token(token)
    except ExpiredSignatureError:
        # Allow refresh within 1h after expiry (grace period)
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
        payload_data = TokenPayload(
            user_id=payload["sub"],
            username=payload["username"],
            role=payload["role"],
            exp=payload["exp"],
            iat=payload["iat"],
        )

    return create_token(payload_data.user_id, payload_data.username, payload_data.role)
