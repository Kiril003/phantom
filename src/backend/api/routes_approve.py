"""Phase 19 Mobile Companion — approve-on-phone endpoints.

GET  /api/v1/approve/pending    device-JWT — list pending approval requests
                                              for the device's owning user.
POST /api/v1/approve/respond    device-JWT — phone signs `{request_id}|
                                              {verdict}|{nonce}` with its
                                              long-term Ed25519 device key.
                                              Server verifies, mutates the
                                              row, fires the in-memory
                                              waiter so the agent loop
                                              unblocks.

Design pillar §4 — every ROOT-tier action gets a verifiable signed verdict
attached to its audit row (`MobileApprovalRequest.signature_b64`). The
phone's biometric prompt gates the Keystore signing operation, so the
signature is *evidence* that someone with the phone + the right finger
approved this exact action.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agent.operations.approve_on_phone import resolve_pending, signing_message
from db.database import get_db
from db.models import MobileApprovalRequest, PairedDevice
from security.device_auth import get_current_device
from security.device_token import DeviceTokenPayload
from security.pair_crypto import PairingError, verify_device_signature

logger = logging.getLogger(__name__)

router = APIRouter(tags=["approve_on_phone"])


# ── Schemas ──────────────────────────────────────────────────────────────────


class PendingRequestRow(BaseModel):
    request_id: str
    task_id: Optional[str]
    action_name: str
    risk_level: int
    summary: str
    nonce: str
    expires_at: str
    payload: dict


class RespondBody(BaseModel):
    request_id: str = Field(..., min_length=8, max_length=64)
    verdict: str = Field(..., pattern=r"^(approve|deny)$")
    signature_b64: str = Field(..., min_length=40, max_length=256)


class RespondResponse(BaseModel):
    ok: bool = True
    waiter_notified: bool


# ── Routes ───────────────────────────────────────────────────────────────────


@router.get("/approve/pending", response_model=list[PendingRequestRow])
async def list_pending(
    db: AsyncSession = Depends(get_db),
    auth: tuple[PairedDevice, DeviceTokenPayload] = Depends(get_current_device),
) -> list[PendingRequestRow]:
    """Phone-side fallback when the WS push was missed (foreground service
    restart, doze, etc). Returns every pending request for this device's
    owning user that has not yet expired.
    """
    device, _ = auth
    now = datetime.now(tz=timezone.utc)
    stmt = (
        select(MobileApprovalRequest)
        .where(MobileApprovalRequest.user_id == device.user_id)
        .where(MobileApprovalRequest.status == "pending")
        .where(MobileApprovalRequest.expires_at > now.replace(tzinfo=None))
        .order_by(MobileApprovalRequest.created_at.desc())
    )
    rows = (await db.execute(stmt)).scalars().all()
    out: list[PendingRequestRow] = []
    for r in rows:
        try:
            payload = json.loads(r.payload_json or "{}")
            if not isinstance(payload, dict):
                payload = {}
        except json.JSONDecodeError:
            payload = {}
        out.append(
            PendingRequestRow(
                request_id=r.id,
                task_id=r.task_id,
                action_name=r.action_name,
                risk_level=r.risk_level,
                summary=r.summary,
                nonce=r.nonce_b64,
                expires_at=(
                    r.expires_at.replace(tzinfo=timezone.utc).isoformat()
                    if r.expires_at.tzinfo is None
                    else r.expires_at.isoformat()
                ),
                payload=payload,
            )
        )
    return out


@router.post("/approve/respond", response_model=RespondResponse)
async def respond(
    body: RespondBody,
    db: AsyncSession = Depends(get_db),
    auth: tuple[PairedDevice, DeviceTokenPayload] = Depends(get_current_device),
) -> RespondResponse:
    device, _ = auth

    row = await db.get(MobileApprovalRequest, body.request_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "request_not_found"},
        )
    # Defence-in-depth — only the device that owns this request's user can
    # respond. A revoked or different device on the same network presenting
    # a stale token is already blocked at `get_current_device`, but tying
    # the request to the user_id catches a multi-device household where
    # two phones for different users share a hub.
    if row.user_id != device.user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "request_owner_mismatch"},
        )
    if row.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "already_resolved", "status": row.status},
        )
    if row.expires_at.replace(tzinfo=timezone.utc) <= datetime.now(tz=timezone.utc):
        # Mark expired so the next /pending call doesn't return it.
        row.status = "expired"
        row.resolved_at = datetime.now(tz=timezone.utc)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail={"code": "request_expired"},
        )

    # Verify Ed25519 signature against the device's long-term pubkey.
    msg = signing_message(
        request_id=row.id, verdict=body.verdict, nonce_b64=row.nonce_b64
    )
    try:
        verify_device_signature(
            device_pub_ed25519_b64=device.device_pub_ed25519,
            message=msg,
            signature_b64=body.signature_b64,
        )
    except PairingError as exc:
        logger.warning(
            "approve/respond: signature failed device=%s req=%s code=%s",
            device.id,
            row.id,
            exc.code,
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": exc.code},
        ) from exc

    notified = await resolve_pending(
        request_id=row.id, verdict=body.verdict, signature_b64=body.signature_b64
    )
    return RespondResponse(ok=True, waiter_notified=notified)
