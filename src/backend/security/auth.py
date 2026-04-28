"""
Authentication logic — RFID, PIN, auto-login, FastAPI dependencies.
"""
from __future__ import annotations

import logging
from typing import Optional

import bcrypt as _bcrypt_lib
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import config
from db.database import get_db
from db.models import User
from security.jwt_manager import TokenPayload, verify_token

logger = logging.getLogger(__name__)

_bearer = HTTPBearer(auto_error=False)


# ── Hashing helpers ────────────────────────────────────────────────────────────

def hash_secret(value: str) -> str:
    """Hash a PIN or RFID UID with bcrypt."""
    salt = _bcrypt_lib.gensalt()
    return _bcrypt_lib.hashpw(value.encode("utf-8"), salt).decode("utf-8")


def verify_secret(value: str, hashed: str) -> bool:
    """Verify a plain value against a bcrypt hash."""
    try:
        return _bcrypt_lib.checkpw(value.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


# ── DB lookups ─────────────────────────────────────────────────────────────────

async def authenticate_rfid(db: AsyncSession, uid_hash: str) -> Optional[User]:
    """
    Find a user whose rfid_uid_hash matches the given hash.
    uid_hash is already bcrypt-hashed by the client (or we verify raw against stored).
    The client sends the raw UID; we verify it against stored bcrypt hash.
    """
    result = await db.execute(
        select(User).where(User.rfid_uid_hash.is_not(None))
    )
    users = result.scalars().all()
    for user in users:
        if user.rfid_uid_hash and verify_secret(uid_hash, user.rfid_uid_hash):
            return user
    return None


async def authenticate_pin(
    db: AsyncSession, username: str, pin: str
) -> Optional[User]:
    """Find user by username and verify PIN."""
    result = await db.execute(
        select(User).where(User.username == username)
    )
    user = result.scalar_one_or_none()
    if user is None:
        return None
    if user.pin_hash is None:
        return None
    if not verify_secret(pin, user.pin_hash):
        return None
    return user


# Day-2 F-7 (audit-2026-04-29 Tier E): the seeded `ensure_default_user`
# row ships with PIN '000000' so the operator can log in once and rotate
# it. Auto-login MUST refuse that bootstrap PIN — otherwise a daemon left
# at the kiosk with auto-login on grants the next person to touch it ROOT
# without the rotation step ever happening. The user must explicitly log
# in (PIN/RFID), be told to rotate, and only then does auto-login take
# over for subsequent boots.
_DEFAULT_PIN: str = "000000"


def is_default_pin(pin_hash: Optional[str]) -> bool:
    """True iff the stored bcrypt hash matches the bootstrap PIN
    `'000000'`. Bcrypt is constant-time so this is safe to call per
    auto-login attempt."""
    if not pin_hash:
        return False
    return verify_secret(_DEFAULT_PIN, pin_hash)


async def get_auto_login_user(db: AsyncSession) -> Optional[User]:
    """
    Return the single ROOT user if only one user exists and auto-login is enabled.
    Used on system startup when no one has logged in yet.

    Day-2 F-7: refuses to surface a user whose PIN is still the default
    `'000000'` — forces the operator through the explicit login flow
    where the UI can prompt for rotation.
    """
    if not config.security_auto_login:
        return None
    result = await db.execute(select(User))
    users = result.scalars().all()
    if len(users) != 1 or users[0].role != "ROOT":
        return None
    user = users[0]
    if is_default_pin(user.pin_hash):
        logger.warning(
            "Auto-login refused for user %s (id=%s) — PIN is still the "
            "bootstrap default '000000'. Operator must rotate via "
            "Settings before auto-login resumes.",
            user.username, user.id,
        )
        return None
    return user


async def ensure_default_user(db: AsyncSession) -> None:
    """
    Create a default ROOT user on first launch if no users exist.
    Default PIN is '000000' — user should change it in settings.
    """
    result = await db.execute(select(User))
    if result.scalars().first() is not None:
        return  # already have users

    import uuid
    default_user = User(
        id=str(uuid.uuid4()),
        username="phantom",
        role="ROOT",
        pin_hash=hash_secret("000000"),
        rfid_uid_hash=None,
        avatar_url=None,
    )
    db.add(default_user)
    await db.commit()
    logger.info("Created default ROOT user 'phantom' — change PIN in settings")


# ── FastAPI dependencies ───────────────────────────────────────────────────────

async def _extract_token(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> Optional[str]:
    """Extract token from Bearer header or query param or cookie."""
    if creds:
        return creds.credentials
    # WS query param: /ws?token=...
    token = request.query_params.get("token")
    if token:
        return token
    # httponly cookie fallback
    return request.cookies.get("phantom_token")


async def require_auth(
    token_str: Optional[str] = Depends(_extract_token),
) -> TokenPayload:
    """
    FastAPI dependency — validates JWT and returns TokenPayload.
    Raises 401 if token is missing or invalid.
    """
    if not token_str:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        return verify_token(token_str)
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


async def get_current_user(
    token_data: TokenPayload = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Resolve TokenPayload → User ORM object. Raises 404 if user deleted."""
    result = await db.execute(select(User).where(User.id == token_data.user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    return user
