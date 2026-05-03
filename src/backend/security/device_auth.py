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
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import PairedDevice
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
