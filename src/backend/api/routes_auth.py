"""
Authentication routes — RFID login, PIN login, JWT refresh, user management.
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import User
from security.auth import (
    authenticate_pin,
    authenticate_rfid,
    get_current_user,
    hash_secret,
    is_default_pin,
    is_loopback_host,
    require_auth,
)
from security.jwt_manager import TokenPayload, create_token, refresh_token as jwt_refresh
from security.permissions import require_operator, require_root

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


# ── Pydantic schemas ───────────────────────────────────────────────────────────

def _user_to_dict(user: User) -> dict[str, Any]:
    prefs: dict = {}
    try:
        prefs = json.loads(user.preferences_json)
    except Exception:
        pass
    bm: dict = {}
    try:
        bm = json.loads(user.behavioral_model_json)
    except Exception:
        pass
    return {
        "id": user.id,
        "username": user.username,
        "role": user.role,
        "avatar_url": user.avatar_url,
        "has_rfid": user.rfid_uid_hash is not None,
        "has_pin": user.pin_hash is not None,
        "created_at": user.created_at.isoformat(),
        "last_seen_at": user.last_seen_at.isoformat(),
        "preferences": prefs,
        "behavioral_model": bm,
    }


class RFIDLoginRequest(BaseModel):
    uid: str = Field(..., description="Raw RFID UID string (e.g. 'AB:CD:EF:01')")


class PINLoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    pin: str = Field(..., min_length=1, max_length=32)


class AuthResponse(BaseModel):
    user: dict
    token: str
    expires_at: str


class RefreshResponse(BaseModel):
    token: str
    expires_at: str


class CreateUserRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    role: str = Field("GUEST", pattern="^(ROOT|OPERATOR|GUEST)$")
    pin: Optional[str] = Field(None, min_length=1, max_length=32)
    rfid_uid: Optional[str] = None


class UpdateUserRequest(BaseModel):
    avatar_url: Optional[str] = None
    pin: Optional[str] = None
    rfid_uid: Optional[str] = None
    preferences: Optional[dict] = None


class SetRoleRequest(BaseModel):
    role: str = Field(..., pattern="^(ROOT|OPERATOR|GUEST)$")


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _touch_last_seen(db: AsyncSession, user: User) -> None:
    user.last_seen_at = datetime.now(tz=timezone.utc)  # type: ignore[assignment]
    try:
        await db.commit()
    except Exception:
        logger.warning("Failed to update last_seen_at for user %s", user.id)
        await db.rollback()


# ── Auth routes ────────────────────────────────────────────────────────────────

# ── Day-2 F-15 — login lockout enforcement ────────────────────────────────────
#
# Two keys are tracked independently so neither IP-rotation NOR username-
# spray bypass the gate. The IP key uses the X-Forwarded-For-aware
# `request.client.host` fallback chain; behind a trusted reverse proxy
# the operator sets ``security_trust_xff`` (existing config knob) so
# the right value lands here.


def _resolve_client_ip(request: Request) -> str:
    """Day-3 D3-A-2: XFF-aware client-IP resolution.

    When ``security_trust_xff`` is False (default), the immediate TCP
    peer is the only thing we trust — same behaviour as the F-15 Day-2
    landing. When enabled AND the immediate peer is in
    ``security_trusted_proxies``, we walk ``X-Forwarded-For`` from
    right-to-left and return the first IP that is NOT itself a trusted
    proxy. That's the standard reverse-proxy resolution: a chain
    ``client, edge_proxy, internal_proxy`` lands as ``client`` once
    every hop on the right is trusted.

    The function returns ``"unknown"`` only when there's no usable peer
    info at all — testing seam, never reached in production.
    """
    client = request.client
    direct = client.host if (client and client.host) else None
    if not direct:
        return "unknown"

    from config import config
    if not config.security_trust_xff:
        return direct
    trusted = set(config.security_trusted_proxies or [])
    if direct not in trusted:
        # Immediate peer isn't a configured proxy — XFF is therefore
        # unreliable (could be spoofed by the peer). Fall through to
        # the direct peer; lockout still keys on what we observed.
        return direct
    xff = request.headers.get("x-forwarded-for")
    if not xff:
        return direct
    # XFF: "client, proxy1, proxy2"  (left = original, right = closest)
    candidates = [c.strip() for c in xff.split(",") if c.strip()]
    for ip in reversed(candidates):
        if ip not in trusted:
            return ip
    # All hops are trusted — degenerate chain; treat as direct.
    return direct


def _ip_key(request: Request) -> str:
    return f"ip:{_resolve_client_ip(request)}"


def _user_key(username: str) -> str:
    return f"user:{(username or '').strip().lower()}"


def _lockout_response(remaining_s: int) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=(
            f"Too many failed login attempts. Try again in "
            f"{max(1, remaining_s)} s."
        ),
        headers={
            "Retry-After": str(max(1, remaining_s)),
            "X-Error-Code": "LOCKED_OUT",
        },
    )


@router.post("/login/rfid", response_model=AuthResponse)
async def login_rfid(
    req: RFIDLoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> AuthResponse:
    """Authenticate using raw RFID UID. Verifies against stored bcrypt hash."""
    from security import login_lockout

    ip_key = _ip_key(request)
    locked, remaining = login_lockout.is_locked(ip_key)
    if locked:
        raise _lockout_response(remaining)

    user = await authenticate_rfid(db, req.uid)
    if user is None:
        login_lockout.register_failure(ip_key)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unknown RFID",
            headers={"X-Error-Code": "RFID_UNKNOWN"},
        )
    login_lockout.register_success(ip_key)
    token, expires_at = create_token(user.id, user.username, user.role)
    await _touch_last_seen(db, user)
    response.set_cookie(
        "phantom_token", token,
        httponly=True, samesite="lax",
        max_age=config_session_timeout_s(),
    )
    return AuthResponse(user=_user_to_dict(user), token=token, expires_at=expires_at)


@router.post("/login/pin", response_model=AuthResponse)
async def login_pin(
    req: PINLoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> AuthResponse:
    """Authenticate using username + PIN."""
    from security import login_lockout

    ip_key = _ip_key(request)
    user_key = _user_key(req.username)
    for key in (ip_key, user_key):
        locked, remaining = login_lockout.is_locked(key)
        if locked:
            raise _lockout_response(remaining)

    user = await authenticate_pin(db, req.username, req.pin)
    if user is None:
        # Record on BOTH keys so an attacker can't dodge by switching
        # IPs (username gate fires) or by spraying usernames (IP gate
        # fires).
        login_lockout.register_failure(ip_key)
        login_lockout.register_failure(user_key)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or PIN",
            headers={"X-Error-Code": "PIN_INVALID"},
        )
    # Day-3 D3-A-1: bootstrap default-PIN login is loopback-only.
    # `phantom`/`000000` MUST NOT be reachable from a remote host even
    # though the underlying password hash matches — operator rotates
    # via the console, then remote login resumes. D3-A-2 makes this
    # reverse-proxy-aware: resolved IP (post-XFF) is what we judge.
    client_host = _resolve_client_ip(request)
    if is_default_pin(user.pin_hash) and not is_loopback_host(client_host):
        login_lockout.register_failure(ip_key)
        login_lockout.register_failure(user_key)
        logger.warning(
            "Default-PIN login refused from %r (user=%s) — rotate via "
            "console before allowing remote login.",
            client_host, user.username,
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Bootstrap default PIN cannot be used from a remote "
                "host. Rotate via console first."
            ),
            headers={"X-Error-Code": "PIN_DEFAULT_REMOTE_FORBIDDEN"},
        )
    login_lockout.register_success(ip_key)
    login_lockout.register_success(user_key)
    token, expires_at = create_token(user.id, user.username, user.role)
    await _touch_last_seen(db, user)
    response.set_cookie(
        "phantom_token", token,
        httponly=True, samesite="lax",
        max_age=config_session_timeout_s(),
    )
    return AuthResponse(user=_user_to_dict(user), token=token, expires_at=expires_at)


@router.post("/refresh", response_model=RefreshResponse)
async def refresh(
    request: Request,
    response: Response,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(HTTPBearer(auto_error=False)),
) -> RefreshResponse:
    """
    Issue a new JWT with fresh TTL.
    Accepts tokens expired within the 1-hour grace period (uses jwt_refresh).
    Does NOT require a valid (non-expired) token — this is intentional so
    the client can silently refresh shortly after expiry.

    Day-3 D3-A-3: lockout enforced here too. F-15's Day-2 closure missed
    this third unauthenticated auth route, so an attacker who'd burned
    through the `/login/pin` lockout could pivot to spraying tokens
    against `/refresh` (signature-only failures cost the same as PIN
    failures from the attacker's perspective). We register failures on
    BOTH the IP key and the token's `sub` claim when extractable.
    """
    from jose import JWTError, jwt
    from security import login_lockout
    from security.jwt_manager import _ALGORITHM, _secret

    ip_key = _ip_key(request)
    locked, remaining = login_lockout.is_locked(ip_key)
    if locked:
        raise _lockout_response(remaining)

    # Extract raw token the same way require_auth does
    raw: Optional[str] = None
    if creds:
        raw = creds.credentials
    if not raw:
        raw = request.query_params.get("token")
    if not raw:
        raw = request.cookies.get("phantom_token")
    if not raw:
        # No token at all → IP-only attempt (no user to attribute).
        login_lockout.register_failure(ip_key)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No token provided",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Best-effort user-key extraction — verify signature + algorithm,
    # skip exp so we can attribute failures even when the token is just
    # expired. A signature-invalid token still attributes to ip_key
    # only (we cannot trust the embedded `sub`).
    user_key: Optional[str] = None
    try:
        sig_ok = jwt.decode(
            raw, _secret(),
            algorithms=[_ALGORITHM],
            options={"verify_exp": False},
        )
        sub = sig_ok.get("sub")
        if sub:
            user_key = f"user_id:{sub}"
            locked, remaining = login_lockout.is_locked(user_key)
            if locked:
                raise _lockout_response(remaining)
    except JWTError:
        user_key = None  # signature invalid → cannot trust `sub`

    try:
        new_token, expires_at = jwt_refresh(raw)
    except JWTError as exc:
        login_lockout.register_failure(ip_key)
        if user_key:
            login_lockout.register_failure(user_key)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Cannot refresh token: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    login_lockout.register_success(ip_key)
    if user_key:
        login_lockout.register_success(user_key)
    response.set_cookie(
        "phantom_token", new_token,
        httponly=True, samesite="lax",
        max_age=config_session_timeout_s(),
    )
    return RefreshResponse(token=new_token, expires_at=expires_at)


@router.get("/config")
async def get_auth_config() -> dict:
    """Return public auth config (limits) needed by the login screen before auth."""
    from config import config
    return {
        "max_pin_attempts": config.security_max_pin_attempts,
        "lockout_duration_m": config.security_lockout_duration_m,
        "session_timeout_m": config.security_session_timeout_m,
    }


@router.get("/me")
async def get_me(current_user: User = Depends(get_current_user)) -> dict:
    """Return full current user object."""
    return _user_to_dict(current_user)


@router.post("/logout")
async def logout(response: Response) -> dict:
    """Clear auth cookie."""
    response.delete_cookie("phantom_token")
    return {"ok": True}


# ── User management (ROOT only) ────────────────────────────────────────────────

users_router = APIRouter(prefix="/users", tags=["users"])


@users_router.get("")
async def list_users(
    _: User = Depends(require_root),
    db: AsyncSession = Depends(get_db),
) -> dict:
    result = await db.execute(select(User))
    users = result.scalars().all()
    return {"users": [_user_to_dict(u) for u in users]}


@users_router.post("", status_code=status.HTTP_201_CREATED)
async def create_user(
    req: CreateUserRequest,
    _: User = Depends(require_root),
    db: AsyncSession = Depends(get_db),
) -> dict:
    # Check username uniqueness
    existing = await db.execute(select(User).where(User.username == req.username))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Username '{req.username}' already exists",
        )
    user = User(
        id=str(uuid.uuid4()),
        username=req.username,
        role=req.role,
        pin_hash=hash_secret(req.pin) if req.pin else None,
        rfid_uid_hash=hash_secret(req.rfid_uid) if req.rfid_uid else None,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return _user_to_dict(user)


@users_router.put("/{user_id}")
async def update_user(
    user_id: str,
    req: UpdateUserRequest,
    current_user: User = Depends(require_root),
    db: AsyncSession = Depends(get_db),
) -> dict:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if req.avatar_url is not None:
        user.avatar_url = req.avatar_url  # type: ignore[assignment]
    if req.pin is not None:
        user.pin_hash = hash_secret(req.pin)  # type: ignore[assignment]
    if req.rfid_uid is not None:
        user.rfid_uid_hash = hash_secret(req.rfid_uid)  # type: ignore[assignment]
    if req.preferences is not None:
        user.preferences_json = json.dumps(req.preferences)  # type: ignore[assignment]

    await db.commit()
    await db.refresh(user)
    return _user_to_dict(user)


@users_router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_user(
    user_id: str,
    current_user: User = Depends(require_root),
    db: AsyncSession = Depends(get_db),
) -> Response:
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete your own account",
        )
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    await db.delete(user)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@users_router.put("/{user_id}/role")
async def set_user_role(
    user_id: str,
    req: SetRoleRequest,
    current_user: User = Depends(require_root),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot change your own role",
        )
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    user.role = req.role  # type: ignore[assignment]
    await db.commit()
    await db.refresh(user)
    return _user_to_dict(user)


# ── Utility ────────────────────────────────────────────────────────────────────

def config_session_timeout_s() -> int:
    from config import config
    return config.security_session_timeout_m * 60
