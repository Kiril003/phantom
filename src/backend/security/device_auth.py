"""Phase 19 Mobile Companion — device-JWT FastAPI auth dependency.

Mirror of `security.auth.get_current_user` but for the device audience.
Returns a `(PairedDevice, DeviceTokenPayload)` tuple. A revoked or expired
device row makes the dependency raise 401 even when the JWT itself is
structurally valid — so revocation takes effect on the next request,
without depending on JWT TTL alone.

Mobile-only routes import `get_current_device` directly. ROOT desktop
routes keep using `security.auth.get_current_user` / `require_root` —
the audience guard in `verify_device_token` ensures a device JWT cannot
satisfy the user-side dependency, and vice versa, so there is no
cross-dependency confusion path.
"""
from __future__ import annotations

import logging
from typing import Optional, Tuple

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import PairedDevice, User
from security.device_token import DeviceTokenPayload, verify_device_token

logger = logging.getLogger(__name__)

_bearer = HTTPBearer(auto_error=False)


async def get_current_device(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> Tuple[PairedDevice, DeviceTokenPayload]:
    if creds is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "missing_token"},
        )
    try:
        payload = verify_device_token(creds.credentials)
    except JWTError as exc:
        logger.debug("device token verify failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "invalid_device_token"},
        ) from exc

    row = await db.get(PairedDevice, payload.device_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "device_unknown"},
        )
    if row.revoked_at is not None:
        # Don't 403 — that signals "you're authenticated but not allowed",
        # and the right semantics for a revoked pairing is "your credential
        # is dead, throw it away and re-pair". 401 with a stable code lets
        # the phone clear its EncryptedSharedPreferences and prompt a re-
        # pair flow instead of silently retrying.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "device_revoked"},
        )
    if row.user_id != payload.user_id:
        # Defence-in-depth: token's user_id claim must match the persisted
        # owner. A mismatch means the device row was reassigned (or the
        # token forged); either way refuse and force re-pair.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "device_owner_mismatch"},
        )
    return row, payload


async def get_user_or_device_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Phase 19-8 — accept either a user JWT or a device JWT and return
    the owning `User` row in both cases.

    Used by self-service endpoints (`PATCH /auth/me` for preference
    sync) where the operating principal is "the user", regardless of
    whether the request came from the desktop with a user JWT or from
    a paired phone with a device JWT scoped to that same user.

    Audience-confusion safety stays intact: the user-token path runs
    `verify_token` which rejects `aud=device`; the device-token path
    runs `verify_device_token` which rejects `aud≠device`. Neither
    branch can be fooled into accepting the wrong credential type.

    Raises 401 on missing / invalid / revoked credentials with stable
    error codes the client UI can map to "drop credential and re-auth".
    """
    if creds is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "missing_token"},
        )

    # Branch 1: try user JWT first (the desktop hot path).
    user_id: Optional[str] = None
    try:
        from security.jwt_manager import verify_token as _verify_user
        import hashlib
        if creds.credentials.startswith("pk_live_"):
            key_hash = hashlib.sha256(creds.credentials.encode()).hexdigest()
            from db.models import ApiKey
            result = await db.execute(select(ApiKey).where(ApiKey.key_hash == key_hash))
            api_key = result.scalar_one_or_none()
            if not api_key:
                raise HTTPException(status_code=401, detail={"code": "invalid_api_key"})
            return User(id=f"api_{api_key.id}", username=f"api_{api_key.name}", role="API", tenant_id=api_key.tenant_id)


        user_payload = _verify_user(creds.credentials)
        user_id = user_payload.user_id
    except Exception:
        # Branch 2: try device JWT.
        try:
            dev_payload = verify_device_token(creds.credentials)
        except JWTError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"code": "invalid_token"},
            ) from exc

        row = await db.get(PairedDevice, dev_payload.device_id)
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"code": "device_unknown"},
            )
        if row.revoked_at is not None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"code": "device_revoked"},
            )
        if row.user_id != dev_payload.user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"code": "device_owner_mismatch"},
            )
        user_id = dev_payload.user_id

    user = (
        await db.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "user_not_found"},
        )
    return user
