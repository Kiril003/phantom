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


async def get_auto_login_user(db: AsyncSession) -> Optional[User]:
    """
    Return the single ROOT user if only one user exists and auto-login is enabled.
    Used on system startup when no one has logged in yet.
    """
    if not config.security_auto_login:
        return None
    result = await db.execute(select(User))
    users = result.scalars().all()
    if len(users) == 1 and users[0].role == "ROOT":
        return users[0]
    return None


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
