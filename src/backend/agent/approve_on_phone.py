"""Phase 19 Mobile Companion — approve-on-phone gate.

The agent loop calls `request_phone_approval(...)` whenever it is about to
execute a risky action (`risk_level > config.agent_risk_tolerance`). If the
owning user has a paired, non-revoked device with the "approvals" capability,
we:

  1. Persist a `MobileApprovalRequest` row (status=pending, fresh nonce,
     expires_at = now + timeout_s).
  2. Hand a short-lived `asyncio.Event` waiter to a process-local registry
     keyed by request_id.
  3. Broadcast `pair/approval_requested` filtered to the owning user_id so
     the phone foreground service displays a push card.
  4. Await the event with a timeout.

The phone responds by signing `f"{request_id}|{verdict}|{nonce}"` with its
long-term Ed25519 device key and POSTing /api/v1/approve/respond. That route
verifies the signature against `PairedDevice.device_pub_ed25519`, mutates
the row, and fires the matching event.

This module returns one of four verdicts:

  'approved'   — phone tap. Loop SHOULD proceed straight to execution and
                 skip the existing desktop-intervene handshake.
  'denied'     — phone tap. Loop SHOULD reject the action.
  'timeout'    — phone never answered (or no app open). Loop SHOULD fall
                 through to the existing desktop-intervene path (operator
                 may still approve from the OperatorLayout).
  'no_device'  — user has no paired device, or none has the "approvals"
                 capability. Same fall-through behaviour as 'timeout'.

Design pillar §4 — never block the agent loop indefinitely on a remote
input device. The timeout is bounded by `config.agent_user_consent_timeout_s`
unless the caller passes `timeout_s` explicitly.

Design pillar §1 — the phone is *another path*, not the only path. If the
phone is offline or unreachable we fall back to the existing desktop flow
without surfacing an error to the user.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_session
from db.models import MobileApprovalRequest, PairedDevice

logger = logging.getLogger(__name__)


Verdict = Literal["approved", "denied", "timeout", "no_device"]


# ── Process-local waiter registry ────────────────────────────────────────────


@dataclass
class _PendingApproval:
    request_id: str
    nonce_b64: str
    device_pub_ed25519: str
    user_id: str
    event: asyncio.Event
    verdict: Optional[str] = None


_pending: dict[str, _PendingApproval] = {}
_pending_lock = asyncio.Lock()


async def _register_pending(p: _PendingApproval) -> None:
    async with _pending_lock:
        _pending[p.request_id] = p


async def _pop_pending(request_id: str) -> Optional[_PendingApproval]:
    async with _pending_lock:
        return _pending.pop(request_id, None)


async def get_pending(request_id: str) -> Optional[_PendingApproval]:
    """Used by the response route — fetch without removing so the same row
    can be polled by `pending` list endpoints."""
    async with _pending_lock:
        return _pending.get(request_id)


def signing_message(*, request_id: str, verdict: str, nonce_b64: str) -> bytes:
    """The exact byte string both sides sign over. Frozen format so a future
    schema change cannot retroactively reinterpret old signatures.
    """
    return f"{request_id}|{verdict}|{nonce_b64}".encode("utf-8")


# ── Request entry point (called from agent loop) ─────────────────────────────


async def request_phone_approval(
    *,
    user_id: Optional[str] = None,
    task_id: Optional[str],
    action_name: str,
    risk_level: int,
    summary: str,
    payload: Optional[dict[str, Any]] = None,
    timeout_s: float = 90.0,
    broadcast: Optional[Any] = None,
) -> Verdict:
    """Block until the phone replies, denied/approved or timeout.

    `user_id` may be None on single-operator PHANTOM installs — in that case
    we pick any paired device that carries the "approvals" capability and
    use ITS user_id as the implied owner. Multi-tenant callers should pass
    a concrete user_id so an action started by user A cannot be approved
    on user B's phone.

    `broadcast` — optional callable `async fn(channel, type_, data, *, user_id=)`.
    When None, falls back to `api.websocket_hub.hub.broadcast`. Injectable for
    tests + so the agent runtime can pass its own routed broadcast helper.
    """
    # Pick a paired device with `approvals` capability.
    device = await _pick_approval_device(user_id)
    if device is None:
        return "no_device"
    # When the caller didn't specify a user, the picked device's owner
    # becomes the implied user_id for DB persistence + WS broadcast routing.
    effective_user_id = user_id or device.user_id

    request_id = _new_request_id()
    nonce_b64 = base64.b64encode(os.urandom(16)).decode("ascii")
    now = datetime.now(tz=timezone.utc)
    expires_at = now + timedelta(seconds=max(5.0, float(timeout_s)))

    async with get_session() as db:
        row = MobileApprovalRequest(
            id=request_id,
            user_id=effective_user_id,
            device_id=device.id,
            task_id=task_id,
            action_name=action_name,
            risk_level=int(risk_level),
            payload_json=json.dumps(payload or {}, default=str)[:64_000],
            summary=(summary or "")[:512],
            nonce_b64=nonce_b64,
            status="pending",
            created_at=now,
            expires_at=expires_at,
        )
        db.add(row)
        await db.commit()

    pending = _PendingApproval(
        request_id=request_id,
        nonce_b64=nonce_b64,
        device_pub_ed25519=device.device_pub_ed25519,
        user_id=effective_user_id,
        event=asyncio.Event(),
    )
    await _register_pending(pending)

    if broadcast is None:
        try:
            from api.websocket_hub import hub as _hub

            broadcast = _hub.broadcast
        except Exception:
            broadcast = None  # WS hub unavailable; rely on REST poll fallback

    if broadcast is not None:
        try:
            await broadcast(
                "pair",
                "approval_requested",
                {
                    "request_id": request_id,
                    "task_id": task_id,
                    "action_name": action_name,
                    "risk_level": int(risk_level),
                    "summary": (summary or "")[:512],
                    "nonce": nonce_b64,
                    "expires_at": expires_at.isoformat(),
                },
                user_id=effective_user_id,
            )
        except Exception as exc:
            logger.debug("approve_on_phone broadcast failed: %s", exc)

    try:
        await asyncio.wait_for(pending.event.wait(), timeout=timeout_s)
    except asyncio.TimeoutError:
        await _mark_expired(request_id)
        await _pop_pending(request_id)
        return "timeout"

    await _pop_pending(request_id)
    if pending.verdict == "approve":
        return "approved"
    if pending.verdict == "deny":
        return "denied"
    # Defensive: if the response route fired the event without a verdict,
    # treat it as timeout so the agent loop falls back to desktop intervene
    # rather than wedging.
    return "timeout"


# ── Helpers ──────────────────────────────────────────────────────────────────


def _new_request_id() -> str:
    import uuid

    return str(uuid.uuid4())


async def _pick_approval_device(user_id: Optional[str]) -> Optional[PairedDevice]:
    """Pick the best device for an approval push.

    With `user_id` set we restrict to that user's devices; with None we pick
    any non-revoked device that carries the `approvals` capability — fits
    single-operator PHANTOM where the agent task has no explicit owner yet.
    Tie-break on most recently seen device so a phone in someone's pocket
    wins over a tablet that's been gathering dust on a shelf.
    """
    async with get_session() as db:
        stmt = (
            select(PairedDevice)
            .where(PairedDevice.revoked_at.is_(None))
            .order_by(PairedDevice.last_seen_at.desc())
        )
        if user_id is not None:
            stmt = stmt.where(PairedDevice.user_id == user_id)
        result = await db.execute(stmt)
        devices = result.scalars().all()
        for d in devices:
            try:
                caps = json.loads(d.capabilities_json or "[]")
            except json.JSONDecodeError:
                caps = []
            if "approvals" in caps:
                return d
        return None


async def _mark_expired(request_id: str) -> None:
    async with get_session() as db:
        row = await db.get(MobileApprovalRequest, request_id)
        if row is None or row.status != "pending":
            return
        row.status = "expired"
        row.resolved_at = datetime.now(tz=timezone.utc)
        await db.commit()


async def resolve_pending(
    *, request_id: str, verdict: str, signature_b64: str
) -> bool:
    """Called by the /approve/respond route after Ed25519 verification.

    Mutates the DB row + fires the in-memory event. Returns True if a
    waiter was found and notified, False if the request had already been
    resolved (replay protection — second call is a no-op).
    """
    pending = await get_pending(request_id)
    async with get_session() as db:
        row = await db.get(MobileApprovalRequest, request_id)
        if row is None:
            return False
        if row.status != "pending":
            return False
        row.status = "approved" if verdict == "approve" else "denied"
        row.verdict = verdict
        row.signature_b64 = signature_b64[:256]
        row.resolved_at = datetime.now(tz=timezone.utc)
        await db.commit()
    if pending is not None:
        pending.verdict = verdict
        pending.event.set()
    return True
