"""Phase 19 Mobile Companion — pairing endpoints.

Implements the protocol from `docs/MOBILE_COMPANION.md` §4:

  POST /api/v1/pair/init             ROOT — start a pairing attempt, get QR.
  POST /api/v1/pair/claim            no auth — phone presents proof + pubkey.
  GET  /api/v1/pair/status?pair_id=  ROOT — poll claim state (long-poll
                                              friendly; WS `pair` channel
                                              also broadcasts on success).
  GET  /api/v1/pair/devices          ROOT — list paired devices for the
                                              authenticated user.
  DELETE /api/v1/pair/devices/{id}   ROOT — revoke a device.

`security.pair_crypto` carries the actual ECDH / HKDF / HMAC / Ed25519
math; this file is glue: HTTP shape, DB persistence, WS broadcast, audit.
ROOT is enforced via the existing `security.permissions.require_root`
dependency — physical presence at the desktop establishes ownership of
the resulting device row (per design §4 "TOFU through QR").
"""
from __future__ import annotations

import io
import json
import logging
import socket
from datetime import datetime, timezone
from typing import Optional

import segno
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.websocket_hub import hub
from config import config
from db.database import get_db
from db.models import PairedDevice, Profile, User
from security.device_token import (
    create_device_token,
    decode_expired_device_token,
)
from security.pair_crypto import (
    PAIR_TTL_SECONDS,
    PairingError,
    build_qr_payload,
    build_server_proof,
    derive_shared_key,
    session_store,
    verify_client_proof,
    verify_device_signature,
)
from security.permissions import require_root

logger = logging.getLogger(__name__)

router = APIRouter(tags=["pair"])


# ── Request / response shapes ────────────────────────────────────────────────


class PairInitResponse(BaseModel):
    pair_id: str
    expires_in_seconds: int = PAIR_TTL_SECONDS
    qr: dict
    # Phase 19 — desktop UI rendering. The QR JSON above is the raw payload
    # the phone receives; this is a server-rendered SVG of that same JSON
    # so the React panel can show <img src=qr_svg_data_url /> without
    # bundling a JS QR encoder. SVG is inlined as a `data:` URL.
    qr_svg_data_url: str


class PairClaimRequest(BaseModel):
    pair_id: str = Field(..., min_length=8, max_length=64)
    client_pub: str = Field(..., min_length=40, max_length=64)
    device_pub_ed25519: str = Field(..., min_length=40, max_length=64)
    nonce_echo: str = Field(..., min_length=20, max_length=64)
    client_proof: str = Field(..., min_length=40, max_length=64)
    device: dict = Field(default_factory=dict)
    # Phase 1-B (companion-v2) — phone may nominate which existing
    # Profile under the owning User this device should bind to. Omit
    # on first pair under a fresh user and the server lazy-creates
    # the user's Primary profile and attaches the device to it.
    profile_id: Optional[str] = Field(default=None, max_length=36)
    # Phase 1-B (companion-v2) — display name to seed the lazy Primary
    # profile when `profile_id` is omitted *and* the user has no
    # profiles yet. Ignored if a profile already exists. Trimmed and
    # length-capped to match Profile.display_name.
    profile_display_name: Optional[str] = Field(default=None, max_length=64)


class PairClaimResponse(BaseModel):
    device_jwt: str
    device_id: str
    expires_at: str
    server_proof: str
    user: dict
    # Phase 1-B (companion-v2) — the Profile this device is now bound to.
    # The phone caches this id locally so subsequent re-pairings under
    # the same operator persona can pass it back via PairClaimRequest.
    profile: dict


class PairStatusResponse(BaseModel):
    pair_id: str
    status: str
    device_id: Optional[str] = None


class PairRefreshRequest(BaseModel):
    """Phase 19-9 — phone-initiated device JWT refresh.

    The phone proves possession of its biometric-gated Android Keystore
    Ed25519 key by signing `device_id || ":" || nonce_b64`. The old
    JWT carries the orig_iat anchor that the server preserves into the
    new token. Even if the old JWT is past its `exp`, refresh succeeds
    as long as the orig_iat is within the absolute-lifetime cap.
    """

    old_token: str = Field(..., description="Most-recent device JWT (may be expired)")
    nonce_b64: str = Field(..., min_length=16, max_length=64)
    signature_b64: str = Field(..., min_length=40, max_length=128)


class PairRefreshResponse(BaseModel):
    device_jwt: str
    expires_at: str


class PairedDeviceRow(BaseModel):
    id: str
    device_name: str
    device_model: str
    platform: str
    platform_version: Optional[str]
    paired_at: str
    last_seen_at: str
    revoked_at: Optional[str]
    capabilities: list[str]


# ── Helpers ──────────────────────────────────────────────────────────────────


def _user_to_dict(u: User) -> dict:
    return {
        "id": u.id,
        "username": u.username,
        "role": u.role,
        "avatar_url": u.avatar_url,
    }


def _profile_to_dict(p: Profile) -> dict:
    return {
        "id": p.id,
        "user_id": p.user_id,
        "display_name": p.display_name,
        "role": p.role,
        "avatar_uri": p.avatar_uri,
        "is_primary": p.is_primary,
    }


async def _resolve_or_bootstrap_profile(
    db: AsyncSession,
    *,
    owner: User,
    requested_profile_id: Optional[str],
    primary_display_name: Optional[str],
) -> Profile:
    """Resolve the [Profile] this paired device should bind to.

    Three paths, in priority order:
      1. The phone supplied a ``profile_id`` — must exist, belong to the
         owning user, and not be archived. Anything else is a 400.
      2. The user already has a Primary profile — re-use it. This is
         the steady-state "second device joining the same persona" path.
      3. The user has no profile yet — lazy-create the Primary using
         ``primary_display_name`` (sanitised) or the user's username as
         fallback. New profiles inherit the user's role so a ROOT user's
         first profile can co-sign ROOT verbs without an extra step.
    """
    if requested_profile_id:
        profile = await db.get(Profile, requested_profile_id)
        if (
            profile is None
            or profile.user_id != owner.id
            or profile.archived_at is not None
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"code": "profile_invalid"},
            )
        return profile

    stmt = (
        select(Profile)
        .where(Profile.user_id == owner.id, Profile.is_primary == True)  # noqa: E712
        .order_by(Profile.created_at.asc())
        .limit(1)
    )
    primary = (await db.execute(stmt)).scalar_one_or_none()
    if primary is not None:
        return primary

    # First profile under this user — seed the Primary.
    requested_name = (primary_display_name or "").strip()
    seed_name = requested_name[:64] or (owner.username or "")[:64] or "Primary"
    primary = Profile(
        user_id=owner.id,
        display_name=seed_name,
        role=owner.role or "OPERATOR",
        is_primary=True,
    )
    db.add(primary)
    await db.flush()
    return primary


def _row_to_pydantic(row: PairedDevice) -> PairedDeviceRow:
    try:
        caps = json.loads(row.capabilities_json or "[]")
        if not isinstance(caps, list):
            caps = []
    except json.JSONDecodeError:
        caps = []
    return PairedDeviceRow(
        id=row.id,
        device_name=row.device_name,
        device_model=row.device_model,
        platform=row.platform,
        platform_version=row.platform_version,
        paired_at=row.paired_at.replace(tzinfo=timezone.utc).isoformat()
        if row.paired_at.tzinfo is None
        else row.paired_at.isoformat(),
        last_seen_at=row.last_seen_at.replace(tzinfo=timezone.utc).isoformat()
        if row.last_seen_at.tzinfo is None
        else row.last_seen_at.isoformat(),
        revoked_at=(
            row.revoked_at.replace(tzinfo=timezone.utc).isoformat()
            if row.revoked_at and row.revoked_at.tzinfo is None
            else (row.revoked_at.isoformat() if row.revoked_at else None)
        ),
        capabilities=caps,
    )


def _qr_to_svg_data_url(payload: dict) -> str:
    """Render the QR JSON payload to an inline-able SVG data URL.

    Compact JSON keeps the QR matrix small enough for a phone camera to
    decode in <2 s on a Pixel 6a even at 1024×1024 desktop scale. Error
    correction `M` (15%) is the sweet spot — `H` blows the matrix up
    past v15 and the dev box can't focus close enough to scan reliably.
    `scale=8` + `border=2` produces ~280 px on the desktop, which the
    UI further upscales via CSS. SVG (vs PNG) means zero base64 weight
    and crisp rendering at any zoom.
    """
    encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    qr = segno.make(encoded, error="m")
    buf = io.BytesIO()
    qr.save(buf, kind="svg", scale=8, border=2, dark="#1a1a1a", light="#ffffff")
    svg_bytes = buf.getvalue()
    # `segno` writes XML with a declaration; strip it for inline data: URL
    # cleanliness — the browser reads SVG fine without it.
    svg_text = svg_bytes.decode("utf-8")
    if svg_text.startswith("<?xml"):
        svg_text = svg_text.split("?>", 1)[1].lstrip()
    import urllib.parse

    return "data:image/svg+xml;utf8," + urllib.parse.quote(svg_text)


def _local_ip_guess() -> str:
    """Best-effort LAN IP for the QR payload. Phones scan from the LAN, so we
    want the address that resolves on the *user's* network — not 127.0.0.1.
    Falls back to 0.0.0.0 if nothing better is reachable; the desktop UI may
    let the operator override it manually before showing the QR.
    """
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # 8.8.8.8 chosen as a non-routable probe target — we don't actually
        # send anything, we just ask the kernel which interface it would use.
        s.connect(("8.8.8.8", 53))
        ip = s.getsockname()[0]
    except OSError:
        ip = "0.0.0.0"
    finally:
        s.close()
    return ip


def _plain_http_port() -> int:
    """Порт, на який телефону справді є куди прийти.

    Тут стояло `getattr(config, "pair_port", 8000)`, а поля `pair_port` в
    конфізі немає й ніколи не було: значення за замовчуванням у getattr
    перетворило зниклу назву на зашиту вісімку під виглядом налаштування.
    Оператор із `PORT=8080` діставав у QR 8000 і бачив «не вдалось
    підключитись» — помилку, яка ніколи не називає справжню причину.
    """
    return int(getattr(config, "port", 8000) or 8000)


# ── Routes ───────────────────────────────────────────────────────────────────


@router.post("/pair/init", response_model=PairInitResponse)
async def pair_init(
    current_user: User = Depends(require_root),
) -> PairInitResponse:
    """ROOT operator initiates a pairing attempt. Server allocates an
    ephemeral X25519 keypair (in-memory only, 60 s TTL) and returns the
    QR payload. The phone scans, runs ECDH, posts to /pair/claim.
    """
    session = session_store.create(created_by_user_id=current_user.id)
    qr = build_qr_payload(
        session,
        host=getattr(config, "pair_host", "phantom.local"),
        ip=_local_ip_guess(),
        port=_plain_http_port(),
        # Cert pin is filled in by Caddy/mkcert in deploy. For dev we use a
        # well-known sentinel ("dev-no-pin") so the phone can opt out of
        # cert pinning when the server runs cleartext on the LAN. Production
        # MUST set `PAIR_CERT_SHA256` in config so this turns into a real
        # SHA-256 fingerprint.
        cert_sha256_hex=getattr(config, "pair_cert_sha256", "") or "dev-no-pin",
    )
    logger.info(
        "pair/init: user=%s pair_id=%s ttl=%ds",
        current_user.id,
        session.pair_id,
        PAIR_TTL_SECONDS,
    )
    return PairInitResponse(
        pair_id=session.pair_id,
        qr=qr,
        qr_svg_data_url=_qr_to_svg_data_url(qr),
    )


@router.post("/pair/claim", response_model=PairClaimResponse)
async def pair_claim(
    body: PairClaimRequest,
    db: AsyncSession = Depends(get_db),
) -> PairClaimResponse:
    """Phone-side endpoint. NO auth — the QR carried the only secret needed
    to participate, and the HMAC proof gates write access. On success we
    persist a `PairedDevice`, mint a device JWT, broadcast `pair/claimed`.
    """
    session = session_store.consume(body.pair_id)
    if session is None:
        # Single-shot consume: either expired or already claimed. Either
        # way the client must restart from a fresh QR.
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail={"code": "session_expired"},
        )

    if body.nonce_echo != session.nonce_b64:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "bad_nonce"},
        )

    try:
        shared_key = derive_shared_key(
            session.server_priv,
            body.client_pub,
            session.nonce_bytes,
        )
        verify_client_proof(
            shared_key=shared_key,
            pair_id=session.pair_id,
            device_pub_ed25519_b64=body.device_pub_ed25519,
            proof_b64=body.client_proof,
        )
    except PairingError as exc:
        logger.warning(
            "pair/claim: protocol error pair_id=%s code=%s",
            session.pair_id,
            exc.code,
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": exc.code, "message": str(exc)},
        ) from exc

    # Owner is the ROOT operator who initiated /pair/init.
    owner = await db.get(User, session.created_by_user_id)
    if owner is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "owner_missing"},
        )

    # Phase 1-B (companion-v2) — pick or seed the Profile this device
    # binds to BEFORE inserting PairedDevice so the FK lands in one
    # transaction. `_resolve_or_bootstrap_profile` raises 400 on any
    # phone-supplied profile_id that doesn't belong to `owner`.
    profile = await _resolve_or_bootstrap_profile(
        db,
        owner=owner,
        requested_profile_id=body.profile_id,
        primary_display_name=body.profile_display_name,
    )

    device_meta = body.device or {}
    row = PairedDevice(
        user_id=owner.id,
        profile_id=profile.id,
        device_name=str(device_meta.get("name", ""))[:128],
        device_model=str(device_meta.get("model", ""))[:128],
        platform=str(device_meta.get("platform", "android"))[:16],
        platform_version=str(device_meta.get("os_version", "") or "")[:32] or None,
        device_pub_ed25519=body.device_pub_ed25519,
        # Default capabilities — MVP devices act as sensor + approval surface.
        # Comms / vault flags can be flipped on by a later PATCH endpoint.
        capabilities_json=json.dumps(["sensors", "approvals"]),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)

    device_jwt, expires_at_iso = create_device_token(
        device_id=row.id, user_id=owner.id
    )
    server_proof = build_server_proof(shared_key=shared_key, device_jwt=device_jwt)

    logger.info(
        "pair/claim: device_id=%s user_id=%s name=%s",
        row.id,
        owner.id,
        row.device_name or "<unnamed>",
    )

    # Notify desktop UI (and any other ROOT clients) — they may show a toast
    # "<phone> paired with <user>, revoke?". Filtered to the owning user's
    # client_count via user_id arg.
    await hub.broadcast(
        "pair",
        "claimed",
        {
            "device_id": row.id,
            "device_name": row.device_name,
            "device_model": row.device_model,
            "platform": row.platform,
            "user_id": owner.id,
            "profile_id": profile.id,
            "profile_display_name": profile.display_name,
            "paired_at": row.paired_at.isoformat(),
        },
        user_id=owner.id,
    )

    return PairClaimResponse(
        device_jwt=device_jwt,
        device_id=row.id,
        expires_at=expires_at_iso,
        server_proof=server_proof,
        user=_user_to_dict(owner),
        profile=_profile_to_dict(profile),
    )


@router.post("/pair/refresh", response_model=PairRefreshResponse)
async def pair_refresh(
    body: PairRefreshRequest,
    db: AsyncSession = Depends(get_db),
) -> PairRefreshResponse:
    """Phase 19-9 — sliding-window device-JWT refresh.

    NO Bearer auth: the old JWT may be expired, in which case the
    standard auth dependency would refuse. Instead, the phone proves
    identity through an Ed25519 signature over the (device_id, nonce)
    tuple — the corresponding pubkey lives on `PairedDevice` and was
    pinned at /pair/claim time.

    The new token preserves `orig_iat`, so the absolute-lifetime cap
    in `verify_device_token` (anchored to that field) eventually
    forces the phone to re-pair via QR — no infinite refresh chains.
    """
    # 1) Decode the old token w/o exp validation. Anything else
    #    structural (signature, audience, role, missing orig_iat,
    #    absolute-lifetime cap) DOES still raise — those represent
    #    forgery attempts and should fail the refresh.
    try:
        old_payload = decode_expired_device_token(body.old_token)
    except Exception as exc:
        logger.info("pair/refresh: old token rejected: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "old_token_rejected"},
        ) from exc

    # 2) Look up the paired-device row.
    row = await db.get(PairedDevice, old_payload.device_id)
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
    if row.user_id != old_payload.user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "device_owner_mismatch"},
        )

    # 3) Verify the Ed25519 signature over `device_id:nonce_b64`. The
    #    nonce is the per-refresh entropy that prevents replay; we
    #    don't store it server-side because the timestamp embedded in
    #    the new JWT (`iat`) plus the orig_iat ceiling collectively
    #    bound replay value to ≤ ABSOLUTE_LIFETIME_DAYS anyway.
    challenge = f"{old_payload.device_id}:{body.nonce_b64}".encode("utf-8")
    try:
        verify_device_signature(
            device_pub_ed25519_b64=row.device_pub_ed25519,
            message=challenge,
            signature_b64=body.signature_b64,
        )
    except PairingError as exc:
        logger.info(
            "pair/refresh: signature rejected device_id=%s code=%s",
            old_payload.device_id,
            exc.code,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": exc.code},
        ) from exc

    # 4) Mint a fresh token preserving orig_iat. last_seen_at bumps
    #    on every refresh, which keeps the dormancy clock honest.
    new_jwt, new_exp_iso = create_device_token(
        device_id=old_payload.device_id,
        user_id=old_payload.user_id,
        orig_iat=old_payload.orig_iat,
    )
    row.last_seen_at = datetime.now(tz=timezone.utc)
    await db.commit()

    logger.info(
        "pair/refresh: device_id=%s user_id=%s",
        old_payload.device_id,
        old_payload.user_id,
    )
    return PairRefreshResponse(device_jwt=new_jwt, expires_at=new_exp_iso)


@router.get("/pair/status", response_model=PairStatusResponse)
async def pair_status(
    pair_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_root),
) -> PairStatusResponse:
    """ROOT-only — long-poll friendly state lookup. WS `pair/claimed` is the
    push path; this exists for UI clients that prefer a REST poll loop or
    that lost their WS connection between init and claim.
    """
    session = session_store.get(pair_id)
    if session is None:
        # Either expired or already claimed. We can't tell which without
        # extra bookkeeping, so we treat both as "session no longer pending"
        # and let the WS broadcast (or absence of one) inform the UI.
        return PairStatusResponse(pair_id=pair_id, status="closed")
    return PairStatusResponse(pair_id=pair_id, status="pending")


@router.get("/pair/devices", response_model=list[PairedDeviceRow])
async def list_devices(
    include_revoked: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_root),
) -> list[PairedDeviceRow]:
    stmt = select(PairedDevice).where(PairedDevice.user_id == current_user.id)
    if not include_revoked:
        stmt = stmt.where(PairedDevice.revoked_at.is_(None))
    stmt = stmt.order_by(PairedDevice.paired_at.desc())
    result = await db.execute(stmt)
    return [_row_to_pydantic(row) for row in result.scalars().all()]


@router.delete("/pair/devices/{device_id}")
async def revoke_device(
    device_id: str,
    reason: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_root),
) -> dict:
    row = await db.get(PairedDevice, device_id)
    if row is None or row.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "device_not_found"},
        )
    if row.revoked_at is not None:
        return {"ok": True, "already_revoked": True}
    row.revoked_at = datetime.now(tz=timezone.utc)
    row.revoked_by = current_user.id
    row.revoked_reason = (reason or "")[:256] or None
    await db.commit()
    logger.info(
        "pair/revoke: device_id=%s user_id=%s reason=%s",
        device_id,
        current_user.id,
        reason or "<none>",
    )
    await hub.broadcast(
        "pair",
        "revoked",
        {"device_id": device_id, "reason": reason},
        user_id=current_user.id,
    )
    return {"ok": True}
