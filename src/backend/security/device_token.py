"""Phase 19 Mobile Companion — device-scoped JWT helper.

`security.jwt_manager` issues *user* tokens (subject = user.id, role one of
ROOT/OPERATOR/GUEST). A paired phone needs a different audience: it
authenticates as a device that *belongs to* a user, not as the user itself.
Mixing the two would let a stolen device token impersonate the user on every
existing user-scoped endpoint, and would let a stolen user JWT claim device
capabilities it never had.

So we issue a parallel kind of token here:

    {
      "aud":       "device",
      "sub":       <device_id>,         # NOT a user_id
      "user_id":   <owner User.id>,     # convenience for backend lookups
      "device_id": <device_id>,         # explicit copy of sub for grep-ability
      "role":      "DEVICE",            # stable, never appears on user JWTs
      "iat":       <unix>,
      "exp":       <unix>,
      "orig_iat":  <unix>               # 30-day refresh chain anchor
    }

The signing secret is shared with `jwt_manager` (same `JWT_SECRET_KEY`) so
operators run one secret, but `aud` + `role` mean a device token cannot
satisfy `require_root` / `require_operator` / `get_current_user` — those
look up `User.role` from the DB, which never holds "DEVICE".

Default TTL: 30 days, anchored to `orig_iat` so the refresh chain dies after
30 days regardless of activity (mirrors `jwt_manager.ABSOLUTE_LIFETIME_DAYS`).
Revocation: `PairedDevice.revoked_at` is checked at the route layer on every
device-authenticated request — a revoked row makes the token effectively
dead before its `exp` arrives.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt

from config import config
from security.jwt_manager import ABSOLUTE_LIFETIME_DAYS

__all__ = [
    "DEVICE_TOKEN_DEFAULT_TTL_DAYS",
    "DeviceTokenPayload",
    "create_device_token",
    "verify_device_token",
    "decode_expired_device_token",
]

_ALGORITHM = "HS256"
_AUDIENCE = "device"
DEVICE_TOKEN_DEFAULT_TTL_DAYS: int = 30


@dataclass
class DeviceTokenPayload:
    device_id: str
    user_id: str
    iat: int
    exp: int
    orig_iat: int


def _secret() -> str:
    secret = config.jwt_secret_key
    if not secret:
        raise RuntimeError(
            "JWT_SECRET_KEY is not set — device tokens cannot be issued."
        )
    return secret


def create_device_token(
    *,
    device_id: str,
    user_id: str,
    ttl_days: int = DEVICE_TOKEN_DEFAULT_TTL_DAYS,
    orig_iat: Optional[int] = None,
) -> tuple[str, str]:
    """Issue a device-scoped JWT.

    Returns (token, expires_at_iso8601).
    """
    now = datetime.now(tz=timezone.utc)
    expire = now + timedelta(days=ttl_days)
    iat_ts = int(now.timestamp())
    payload = {
        "aud": _AUDIENCE,
        "sub": device_id,
        "device_id": device_id,
        "user_id": user_id,
        "role": "DEVICE",
        "iat": iat_ts,
        "exp": int(expire.timestamp()),
        "orig_iat": int(orig_iat) if orig_iat is not None else iat_ts,
    }
    token = jwt.encode(payload, _secret(), algorithm=_ALGORITHM)
    return token, expire.isoformat()


def verify_device_token(token: str) -> DeviceTokenPayload:
    """Decode + validate a device JWT.

    Raises `jose.JWTError` on:
      - bad signature / malformed token
      - wrong audience (someone presenting a user JWT)
      - role drift (anything other than DEVICE)
      - missing orig_iat (legacy / forged)
      - refresh chain exceeded ABSOLUTE_LIFETIME_DAYS
    """
    payload = jwt.decode(
        token,
        _secret(),
        algorithms=[_ALGORITHM],
        audience=_AUDIENCE,
    )
    if payload.get("role") != "DEVICE":
        raise JWTError("device token role drift")
    if "orig_iat" not in payload:
        raise JWTError("device token missing orig_iat")
    orig_iat_ts = int(payload["orig_iat"])
    now_ts = int(datetime.now(tz=timezone.utc).timestamp())
    if now_ts - orig_iat_ts > ABSOLUTE_LIFETIME_DAYS * 86400:
        raise JWTError(
            f"device refresh chain exceeded {ABSOLUTE_LIFETIME_DAYS}-day cap"
        )
    return DeviceTokenPayload(
        device_id=str(payload["sub"]),
        user_id=str(payload["user_id"]),
        iat=int(payload["iat"]),
        exp=int(payload["exp"]),
        orig_iat=orig_iat_ts,
    )


def decode_expired_device_token(token: str) -> DeviceTokenPayload:
    """Phase 19-9 refresh path — decode a device JWT WITHOUT validating
    `exp` so /pair/refresh can read `orig_iat` from a freshly-expired
    credential.

    This is only safe to call from a code path that ALREADY verified
    phone identity through some other proof (Ed25519 signature over a
    fresh nonce, `PairedDevice` row lookup, etc.). Using it as a
    standalone auth dependency would defeat token expiry entirely —
    so the helper is intentionally not exposed via FastAPI Depends().

    Signature, audience, role, and the absolute-lifetime cap are
    still enforced; only the per-token `exp` is allowed to be in the
    past. A token forged with a future orig_iat (e.g. an attacker
    trying to extend the chain) will still be caught by the
    `ABSOLUTE_LIFETIME_DAYS` ceiling.
    """
    payload = jwt.decode(
        token,
        _secret(),
        algorithms=[_ALGORITHM],
        audience=_AUDIENCE,
        options={"verify_exp": False},
    )
    if payload.get("role") != "DEVICE":
        raise JWTError("device token role drift")
    if "orig_iat" not in payload:
        raise JWTError("device token missing orig_iat")
    orig_iat_ts = int(payload["orig_iat"])
    now_ts = int(datetime.now(tz=timezone.utc).timestamp())
    if now_ts - orig_iat_ts > ABSOLUTE_LIFETIME_DAYS * 86400:
        raise JWTError(
            f"device refresh chain exceeded {ABSOLUTE_LIFETIME_DAYS}-day cap"
        )
    return DeviceTokenPayload(
        device_id=str(payload["sub"]),
        user_id=str(payload["user_id"]),
        iat=int(payload["iat"]),
        exp=int(payload["exp"]),
        orig_iat=orig_iat_ts,
    )
