"""Reverse driver — desktop tells phone what to do.

Companion-control is the inverse of `routes_drive.py`: instead of the
phone driving phantom-os, the desktop pushes a small set of
focus-the-attention verbs at one (or every) paired phone. The phone
listens on WS channel `companion_control` and routes each frame to
the matching local handler:

  open_route        — push a route into the map screen and surface
                      a "Open the route?" overlay.
  open_card         — push a vault card id; phone opens the Vault
                      card detail with focus on it.
  navigate          — generic in-app navigation: "go to /now" or
                      "/voice".
  focus_screen      — bring the phone screen ON if device permits;
                      otherwise just nudge a notification.
  lock_vault        — emergency clamp: phone re-locks any open vault
                      cards immediately.
  ping              — health probe + roundtrip latency timer.

Why a separate route file: keeps the wire format closed-enum and
auditable. Every emit lands on the `companion_control` WS channel
scoped to the calling user.
"""
from __future__ import annotations

import logging
from enum import Enum
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.websocket_hub import hub
from db.database import get_db
from db.models import PairedDevice, User
from security.permissions import require_root

logger = logging.getLogger(__name__)

router = APIRouter(tags=["companion-control"])


class ControlVerb(str, Enum):
    open_route = "open_route"
    open_card = "open_card"
    navigate = "navigate"
    focus_screen = "focus_screen"
    lock_vault = "lock_vault"
    ping = "ping"


class ControlIn(BaseModel):
    """Request body for `POST /companion-control/{verb}`. The verb
    itself comes from the URL; this carries only the per-verb payload
    plus an optional target device-id filter."""

    model_config = ConfigDict(extra="forbid")

    target_device_id: Optional[str] = Field(default=None)
    payload: dict[str, Any] = Field(default_factory=dict)


class ControlOut(BaseModel):
    accepted: bool
    delivered_to: int
    verb: str


async def _emit(
    user_id: str,
    verb: str,
    payload: dict[str, Any],
    target_device_id: Optional[str],
) -> int:
    """Broadcast on the companion_control channel. Returns the
    *attempted* fanout count — the WS hub doesn't currently surface
    per-recipient delivery confirmations, but counting connected
    clients of the same user gives a useful proxy."""
    body: dict[str, Any] = {"verb": verb, "payload": payload}
    if target_device_id is not None:
        body["target_device_id"] = target_device_id
    try:
        await hub.broadcast("companion_control", verb, body, user_id=user_id)
    except Exception as exc:  # pragma: no cover
        logger.warning("companion_control broadcast failed: %s", exc)
        return 0
    # Best-effort fanout count.
    delivered = sum(1 for c in hub._clients.values() if c.user_id == user_id)
    return delivered


def _verify_target(
    db: AsyncSession,
):  # pragma: no cover — tiny dependency wrapper
    return db


async def _check_target_device(
    db: AsyncSession, user_id: str, target_device_id: Optional[str]
) -> None:
    if target_device_id is None:
        return
    row = (
        await db.execute(
            select(PairedDevice).where(
                PairedDevice.id == target_device_id,
                PairedDevice.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail={"code": "target_device_unknown"})
    if row.revoked_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": "target_device_revoked"})


# ── Routes ────────────────────────────────────────────────────────────────────


@router.post("/companion-control/open_route", response_model=ControlOut)
async def control_open_route(
    body: ControlIn,
    user: User = Depends(require_root),
    db: AsyncSession = Depends(get_db),
) -> ControlOut:
    """Push a route to the phone's map. Payload typically:
    `{coords: [[lat,lon],...], summary: "до метро", profile: "drive"}`.
    The phone slides up an overlay; user confirms before MapScreen
    actually swaps to the new route."""
    await _check_target_device(db, user.id, body.target_device_id)
    n = await _emit(user.id, ControlVerb.open_route.value, body.payload, body.target_device_id)
    return ControlOut(accepted=True, delivered_to=n, verb=ControlVerb.open_route.value)


@router.post("/companion-control/open_card", response_model=ControlOut)
async def control_open_card(
    body: ControlIn,
    user: User = Depends(require_root),
    db: AsyncSession = Depends(get_db),
) -> ControlOut:
    await _check_target_device(db, user.id, body.target_device_id)
    n = await _emit(user.id, ControlVerb.open_card.value, body.payload, body.target_device_id)
    return ControlOut(accepted=True, delivered_to=n, verb=ControlVerb.open_card.value)


@router.post("/companion-control/navigate", response_model=ControlOut)
async def control_navigate(
    body: ControlIn,
    user: User = Depends(require_root),
    db: AsyncSession = Depends(get_db),
) -> ControlOut:
    await _check_target_device(db, user.id, body.target_device_id)
    n = await _emit(user.id, ControlVerb.navigate.value, body.payload, body.target_device_id)
    return ControlOut(accepted=True, delivered_to=n, verb=ControlVerb.navigate.value)


@router.post("/companion-control/focus_screen", response_model=ControlOut)
async def control_focus_screen(
    body: ControlIn,
    user: User = Depends(require_root),
    db: AsyncSession = Depends(get_db),
) -> ControlOut:
    await _check_target_device(db, user.id, body.target_device_id)
    n = await _emit(user.id, ControlVerb.focus_screen.value, body.payload, body.target_device_id)
    return ControlOut(accepted=True, delivered_to=n, verb=ControlVerb.focus_screen.value)


@router.post("/companion-control/lock_vault", response_model=ControlOut)
async def control_lock_vault(
    body: ControlIn,
    user: User = Depends(require_root),
    db: AsyncSession = Depends(get_db),
) -> ControlOut:
    """Emergency vault clamp. Bypasses target_device_id by default
    (lock everything everywhere) unless a specific device is named."""
    await _check_target_device(db, user.id, body.target_device_id)
    n = await _emit(user.id, ControlVerb.lock_vault.value, body.payload, body.target_device_id)
    return ControlOut(accepted=True, delivered_to=n, verb=ControlVerb.lock_vault.value)


@router.post("/companion-control/ping", response_model=ControlOut)
async def control_ping(
    body: ControlIn,
    user: User = Depends(require_root),
    db: AsyncSession = Depends(get_db),
) -> ControlOut:
    await _check_target_device(db, user.id, body.target_device_id)
    n = await _emit(user.id, ControlVerb.ping.value, body.payload, body.target_device_id)
    return ControlOut(accepted=True, delivered_to=n, verb=ControlVerb.ping.value)
