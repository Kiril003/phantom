"""
Authentication logic — RFID, PIN, auto-login, FastAPI dependencies.
"""
from __future__ import annotations

import logging
from pathlib import Path
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


# Rebuild P0 (master-plan §2): the seed no longer ships a KNOWN default
# PIN. `ensure_default_user` now mints a random bootstrap PIN, persists
# it to a 0600 marker file in the data dir (and prints it to the boot
# log) so the console operator can perform first login. While the marker
# exists and still matches the user's hash, the PIN is treated as
# "bootstrap": auto-login refuses it and `/auth/login/pin` accepts it
# from loopback only. Rotating the PIN deletes the marker.
#
# `_LEGACY_DEFAULT_PIN` remains recognised so installs seeded before
# this change (rows holding bcrypt('000000')) keep BOTH protections —
# without it, upgrading would silently un-gate the old default.
_LEGACY_DEFAULT_PIN: str = "000000"

_BOOTSTRAP_PIN_LEN: int = 6  # matches the PinPad UI default maxLength


def bootstrap_pin_file() -> "Path":
    """Path of the bootstrap-PIN marker file (plaintext PIN, mode 0600).

    Lives under the identity data dir so packaged installs resolve via
    platformdirs and tests can redirect with PHANTOM_DATA_DIR.
    """
    from paths import resolve_data_dir
    return resolve_data_dir("identity") / "bootstrap_pin"


def read_bootstrap_pin() -> Optional[str]:
    """Return the persisted bootstrap PIN, or None when absent/unreadable."""
    try:
        pin = bootstrap_pin_file().read_text(encoding="utf-8").strip()
        return pin or None
    except OSError:
        return None


def discard_bootstrap_pin() -> None:
    """Remove the bootstrap-PIN marker (called after rotation)."""
    try:
        bootstrap_pin_file().unlink(missing_ok=True)
    except OSError as exc:
        logger.warning("Could not remove bootstrap PIN marker: %s", exc)


def _generate_bootstrap_pin() -> str:
    import secrets
    import string
    return "".join(secrets.choice(string.digits) for _ in range(_BOOTSTRAP_PIN_LEN))


def is_default_pin(pin_hash: Optional[str]) -> bool:
    """True iff the stored bcrypt hash is still a bootstrap credential:
    either the legacy seeded `'000000'` (pre-rebuild installs) or the
    randomly generated PIN recorded in the bootstrap marker file.
    Bcrypt is constant-time so this is safe to call per auto-login
    attempt."""
    if not pin_hash:
        return False
    if verify_secret(_LEGACY_DEFAULT_PIN, pin_hash):
        return True
    marker = read_bootstrap_pin()
    if marker is None:
        return False
    return verify_secret(marker, pin_hash)


# Day-3 D3-A-1 (audit-2026-04-30 Tier A): F-07's Day-2 closure only
# patched the auto-login path; the explicit `/auth/login/pin` route
# still accepts `phantom`/`000000` from anyone on the LAN. The fix is
# loopback-only bootstrap login: the operator sitting at the kiosk (or
# `docker compose exec`'d into the container) can rotate, but a remote
# attacker that hits `/login/pin` from a non-loopback origin gets 403.
# After rotation `is_default_pin` returns False → all hosts accepted.
_LOOPBACK_HOSTS: frozenset[str] = frozenset({
    "127.0.0.1",
    "::1",
    "localhost",
    # Starlette TestClient emits this in `request.client.host`; tests
    # MUST keep working without per-test loopback monkeypatching.
    "testclient",
})


def is_loopback_host(host: Optional[str]) -> bool:
    """True iff ``host`` is one of the loopback aliases (or the in-process
    Starlette TestClient sentinel). Used by `/auth/login/pin` to gate the
    bootstrap default-PIN login to console operators only.

    Single source of truth so D3-A-2 (XFF awareness in O-2) can extend
    it without touching the route.
    """
    if not host:
        return False
    return host in _LOOPBACK_HOSTS


# Day-5 phase-5-R3-BE-IDN-2 (C-4 audit + multi-modal fusion bridge):
# the auth route can now consult the fusion resolver in
# ``voice.identity_resolver`` for soft-confidence identification
# (voice + face + RFID + context). The PIN path stays the canonical
# hard-credential fallback — so when fusion comes back below
# ``PIN_FALLBACK_THRESHOLD`` AND the operator typed the bootstrap PIN
# at the kiosk, we let them through (and surface the rotation prompt
# the same way ``is_default_pin`` does today). The helper below is the
# tiny policy lookup the route uses; the actual fusion call lives in
# the route handler so this module stays free of voice/CV imports.


def fusion_unlocks_pin_fallback(
    *,
    fusion_confidence: Optional[float],
    pin_supplied: Optional[str],
) -> bool:
    """True iff the operator typed the bootstrap PIN AND the fusion
    resolver was either silent or under the fallback threshold.

    Inputs:
        ``fusion_confidence`` — the ``IdentityResolution.confidence`` from
            ``voice.identity_resolver.resolve``, or ``None`` when no
            modalities fired (fresh boot, no enrolment data, etc.).
        ``pin_supplied`` — the raw PIN string the kiosk operator typed,
            or ``None`` if no PIN field was on the form.

    Returns:
        ``True`` only when ``pin_supplied`` is the bootstrap PIN (legacy
        ``'000000'`` or the generated marker PIN) AND
        (``fusion_confidence is None`` OR
         ``fusion_confidence < PIN_FALLBACK_THRESHOLD``).

    Anywhere fusion is confidently identifying somebody (≥ 0.5), the
    PIN bypass is denied — that's the "no PIN reuse when the system
    knows you" guarantee. Anywhere fusion is silent, the PIN is the
    only way in and we honour it.
    """
    if pin_supplied is None:
        return False
    if pin_supplied != _LEGACY_DEFAULT_PIN and pin_supplied != read_bootstrap_pin():
        return False
    # PIN_FALLBACK_THRESHOLD lives in voice.identity_resolver; importing
    # locally keeps security/auth.py free of the voice module at import
    # time (and protects callers in tests that haven't installed CV
    # dependencies).
    from voice.identity_resolver import PIN_FALLBACK_THRESHOLD
    if fusion_confidence is None:
        return True
    return fusion_confidence < PIN_FALLBACK_THRESHOLD


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

    The bootstrap PIN is randomly generated (never a fixed default),
    written to the 0600 marker file returned by `bootstrap_pin_file()`
    and printed to the boot log. Until it is rotated, `/auth/login/pin`
    accepts it from loopback only and auto-login stays off.
    """
    result = await db.execute(select(User))
    if result.scalars().first() is not None:
        return  # already have users

    import uuid
    pin = _generate_bootstrap_pin()
    marker = bootstrap_pin_file()
    try:
        marker.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        marker.touch(mode=0o600, exist_ok=True)
        marker.write_text(pin, encoding="utf-8")
    except OSError as exc:
        # The log line below is then the operator's only copy of the PIN.
        logger.error("Could not persist bootstrap PIN marker %s: %s", marker, exc)

    default_user = User(
        id=str(uuid.uuid4()),
        username="phantom",
        role="ROOT",
        pin_hash=hash_secret(pin),
        rfid_uid_hash=None,
        avatar_url=None,
    )
    db.add(default_user)
    await db.commit()
    logger.warning(
        "Created ROOT user 'phantom' with one-time bootstrap PIN: %s "
        "(also saved to %s). Log in from the console and rotate it in "
        "Settings — remote login is refused until rotation.",
        pin, marker,
    )


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
    token_str: Optional[str] = Depends(_extract_token),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not token_str:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if token_str.startswith("pk_live_"):
        import hashlib
        from db.models import ApiKey
        key_hash = hashlib.sha256(token_str.encode()).hexdigest()
        result = await db.execute(select(ApiKey).where(ApiKey.key_hash == key_hash))
        api_key = result.scalar_one_or_none()
        if not api_key:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API Key")
        return User(
            id=f"api_{api_key.id}",
            username=f"api_client_{api_key.name}",
            role="API",
            tenant_id=api_key.tenant_id
        )

    try:
        token_data = verify_token(token_str)
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    result = await db.execute(select(User).where(User.id == token_data.user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    return user
