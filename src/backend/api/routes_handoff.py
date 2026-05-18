"""Cross-device task handoff registry.

A handoff is a small declarative payload one device hands to another:
"continue on the phone what I started on the desktop", "open this
route on the device that's actually moving", "show this card on the
phone now that the operator's away from the desk". Each row carries:

  • origin_device_id  — who created the handoff (None for desktop).
  • target_device_id  — who should pick it up (None = "the next phone
                        that's online", which is the common case for
                        "send map route to whatever phone is mine").
  • kind              — closed enum that names the action surface
                        the receiver should render (see HandoffKind).
  • payload           — opaque dict the receiver knows how to parse.
  • status            — pending | accepted | rejected | expired.
  • expires_at        — TTL guard so a forgotten handoff stops
                        nagging after some time.

REST surface (api/v1/handoff/*):

  POST   /                     — create a handoff (desktop or phone).
  GET    /                     — list pending handoffs scoped to the
                                  caller's device + user.
  POST   /{handoff_id}/accept  — receiver acknowledges; status →
                                  accepted, broadcast to all subs so
                                  every other device clears its UI.
  POST   /{handoff_id}/reject  — receiver declines.
  POST   /{handoff_id}/cancel  — origin recalls before pickup.

WS channel `handoff`. Every state change emits one frame so all
subscribed devices update in real time.

Auth: dual-auth (`get_user_or_device_user`). For phones the calling
device id is recovered from the device JWT; for desktop the row is
attributed to the user only.
"""
from __future__ import annotations

import json
import logging
import secrets
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    select,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from api.websocket_hub import hub
from db.database import Base, get_db
from db.models import PairedDevice, User, _now, _uuid
from security.device_auth import get_user_or_device_user
from security.device_token import verify_device_token
from jose import JWTError

logger = logging.getLogger(__name__)

router = APIRouter(tags=["handoff"])
_bearer = HTTPBearer(auto_error=False)


# ── ORM ───────────────────────────────────────────────────────────────────────


class Handoff(Base):
    __tablename__ = "handoffs"
    __table_args__ = (
        Index("ix_handoffs_user_status", "user_id", "status"),
        Index("ix_handoffs_target", "target_device_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    origin_device_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    target_device_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    payload_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    resolved_by_device_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)


# ── Wire schemas ──────────────────────────────────────────────────────────────


class HandoffKind(str, Enum):
    map_route = "map_route"
    vault_card = "vault_card"
    chat_thread = "chat_thread"
    file_drop = "file_drop"
    voice_continuation = "voice_continuation"
    custom = "custom"


class HandoffCreate(BaseModel):
    model_config = ConfigDict(use_enum_values=True)

    kind: HandoffKind
    title: str = Field(default="", max_length=160)
    payload: dict[str, Any] = Field(default_factory=dict)
    target_device_id: Optional[str] = None
    ttl_seconds: int = Field(default=900, ge=15, le=86400)


class HandoffOut(BaseModel):
    id: str
    user_id: str
    origin_device_id: Optional[str]
    target_device_id: Optional[str]
    kind: str
    title: str
    payload: dict[str, Any]
    status: str
    created_at: datetime
    expires_at: datetime
    resolved_at: Optional[datetime] = None
    resolved_by_device_id: Optional[str] = None


class HandoffListOut(BaseModel):
    handoffs: list[HandoffOut]


# ── Helpers ───────────────────────────────────────────────────────────────────


async def _calling_device_id(
    creds: Optional[HTTPAuthorizationCredentials],
) -> Optional[str]:
    """Best-effort recovery of the calling device id from a device JWT.

    Desktop callers will not have a device-audience token, so we
    silently fall through to None. Failures here are non-fatal — the
    handoff just won't carry the origin_device_id, and the desktop
    UI handles that case as "from the desktop"."""
    if creds is None:
        return None
    try:
        payload = verify_device_token(creds.credentials)
    except (JWTError, Exception):
        return None
    return payload.device_id


def _to_out(row: Handoff) -> HandoffOut:
    try:
        payload = json.loads(row.payload_json or "{}")
    except json.JSONDecodeError:
        payload = {}
    return HandoffOut(
        id=row.id,
        user_id=row.user_id,
        origin_device_id=row.origin_device_id,
        target_device_id=row.target_device_id,
        kind=row.kind,
        title=row.title,
        payload=payload,
        status=row.status,
        created_at=row.created_at,
        expires_at=row.expires_at,
        resolved_at=row.resolved_at,
        resolved_by_device_id=row.resolved_by_device_id,
    )


async def _broadcast(user_id: str, type_: str, data: dict[str, Any]) -> None:
    try:
        await hub.broadcast("handoff", type_, data, user_id=user_id)
    except Exception as exc:  # pragma: no cover
        logger.warning("handoff broadcast failed: %s", exc)


# ── Routes ────────────────────────────────────────────────────────────────────


@router.post("/handoff", response_model=HandoffOut, status_code=status.HTTP_201_CREATED)
async def create_handoff(
    body: HandoffCreate,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    user: User = Depends(get_user_or_device_user),
    db: AsyncSession = Depends(get_db),
) -> HandoffOut:
    """Create a handoff. The receiver picks it up via WS or the
    /handoff GET poll. Creator's device id is auto-discovered from
    the device JWT when present."""
    origin = await _calling_device_id(creds)

    if body.target_device_id is not None:
        target_row = await db.get(PairedDevice, body.target_device_id)
        if target_row is None or target_row.user_id != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail={"code": "target_device_unknown"})
        if target_row.revoked_at is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": "target_device_revoked"})

    expires_at = datetime.now(timezone.utc) + timedelta(seconds=body.ttl_seconds)
    row = Handoff(
        id=_uuid(),
        user_id=user.id,
        origin_device_id=origin,
        target_device_id=body.target_device_id,
        kind=body.kind.value if isinstance(body.kind, HandoffKind) else body.kind,
        title=body.title or "",
        payload_json=json.dumps(body.payload),
        status="pending",
        expires_at=expires_at,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)

    out = _to_out(row)
    await _broadcast(user.id, "created", out.model_dump(mode="json"))
    return out


@router.get("/handoff", response_model=HandoffListOut)
async def list_handoffs(
    user: User = Depends(get_user_or_device_user),
    db: AsyncSession = Depends(get_db),
) -> HandoffListOut:
    """Return pending handoffs for the caller's user. Phones filter
    further client-side by `target_device_id` (None = "any phone")."""
    now = datetime.now(timezone.utc)
    rows = (
        await db.execute(
            select(Handoff)
            .where(Handoff.user_id == user.id, Handoff.status == "pending")
            .order_by(Handoff.created_at.desc())
        )
    ).scalars().all()

    # SQLite stores DateTime columns as naive (no tzinfo) by default,
    # so the bare comparison `r.expires_at <= now` raises
    # `TypeError: can't compare offset-naive and offset-aware datetimes`
    # on every poll. Normalise the row side to UTC-aware before
    # comparing — production Postgres returns aware values already, so
    # this stays a no-op there.
    fresh: list[Handoff] = []
    for r in rows:
        expires = r.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires <= now:
            r.status = "expired"
            r.resolved_at = now
        else:
            fresh.append(r)
    if any(r.status == "expired" for r in rows):
        await db.commit()

    return HandoffListOut(handoffs=[_to_out(r) for r in fresh])


@router.post("/handoff/{handoff_id}/accept", response_model=HandoffOut)
async def accept_handoff(
    handoff_id: str,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    user: User = Depends(get_user_or_device_user),
    db: AsyncSession = Depends(get_db),
) -> HandoffOut:
    row = await db.get(Handoff, handoff_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail={"code": "handoff_not_found"})
    if row.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": "handoff_not_pending"})
    row.status = "accepted"
    row.resolved_at = datetime.now(timezone.utc)
    row.resolved_by_device_id = await _calling_device_id(creds)
    await db.commit()
    await db.refresh(row)
    out = _to_out(row)
    await _broadcast(user.id, "accepted", out.model_dump(mode="json"))
    return out


@router.post("/handoff/{handoff_id}/reject", response_model=HandoffOut)
async def reject_handoff(
    handoff_id: str,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    user: User = Depends(get_user_or_device_user),
    db: AsyncSession = Depends(get_db),
) -> HandoffOut:
    row = await db.get(Handoff, handoff_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail={"code": "handoff_not_found"})
    if row.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": "handoff_not_pending"})
    row.status = "rejected"
    row.resolved_at = datetime.now(timezone.utc)
    row.resolved_by_device_id = await _calling_device_id(creds)
    await db.commit()
    await db.refresh(row)
    out = _to_out(row)
    await _broadcast(user.id, "rejected", out.model_dump(mode="json"))
    return out


@router.post("/handoff/{handoff_id}/cancel", response_model=HandoffOut)
async def cancel_handoff(
    handoff_id: str,
    user: User = Depends(get_user_or_device_user),
    db: AsyncSession = Depends(get_db),
) -> HandoffOut:
    row = await db.get(Handoff, handoff_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail={"code": "handoff_not_found"})
    if row.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": "handoff_not_pending"})
    row.status = "cancelled"
    row.resolved_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(row)
    out = _to_out(row)
    await _broadcast(user.id, "cancelled", out.model_dump(mode="json"))
    return out


# ── Helpers exposed to other route files ─────────────────────────────────────


async def emit_handoff_for_user(
    db: AsyncSession,
    user_id: str,
    kind: str,
    title: str,
    payload: dict[str, Any],
    target_device_id: Optional[str] = None,
    ttl_seconds: int = 900,
    origin_device_id: Optional[str] = None,
) -> Handoff:
    """Internal call site for routes that want to push a handoff
    without going through HTTP (e.g. the agent runtime saying "open
    this card on the phone"). Returns the created row."""
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)
    row = Handoff(
        id=_uuid(),
        user_id=user_id,
        origin_device_id=origin_device_id,
        target_device_id=target_device_id,
        kind=kind,
        title=title or "",
        payload_json=json.dumps(payload),
        status="pending",
        expires_at=expires_at,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    await _broadcast(user_id, "created", _to_out(row).model_dump(mode="json"))
    return row
