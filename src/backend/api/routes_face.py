"""
Face API — Phase 08.

POST   /api/v1/face/enroll      Save averaged embedding for current user.
POST   /api/v1/face/recognize   Return best-matching user for a query vector.
DELETE /api/v1/face/embedding   Remove current user's enrolled template.
GET    /api/v1/face/status      Subsystem health (enabled, threshold, counts).

All mutating routes require auth; `/recognize` is deliberately auth-optional
so a logged-out screen can offer face-login as an alternative to RFID/PIN.

Privacy gates:
  * `config.face_tracking_enabled` — master switch (503 when off).
  * `config.face_tracking_privacy_mode == "off"` — equivalent to disabled.
  * `core.state_machine.current_state == "GHOST"` — force-close everything.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import config
from db.database import get_db
from db.models import User
from security.auth import get_current_user
from vision.face_engine import (
    delete_embedding,
    get_embedding,
    has_embedding,
    match_embedding,
    store_embedding,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/face", tags=["face"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class EnrollRequest(BaseModel):
    samples: list[list[float]] = Field(
        ..., min_length=1, max_length=32,
        description="5-10 averaged landmark vectors captured over 2-3s",
    )


class EnrollResponse(BaseModel):
    ok: bool
    user_id: str
    sample_count: int
    dim: int


class RecognizeRequest(BaseModel):
    embedding: list[float] = Field(..., min_length=1)


class RecognizeResponse(BaseModel):
    matched: bool
    user_id: str | None
    username: str | None
    role: str | None
    confidence: float
    threshold: float


class StatusResponse(BaseModel):
    enabled: bool
    auto_switch_profile: bool
    privacy_mode: str
    threshold: float
    unknown_lockout_s: int
    enrolled_users: int
    has_my_embedding: bool | None
    system_state: str
    oled_enabled: bool


# ── Gate helpers ──────────────────────────────────────────────────────────────

def _current_system_state() -> str:
    try:
        from core.context_engine import context_engine
        return context_engine.get_snapshot()["system"]["state"]
    except Exception:
        return "SHADOW"


def _check_enabled() -> None:
    """Raise 503 if the face subsystem is not serving.

    Three kill-switches collapse to one: config flag off, privacy "off",
    or system in GHOST state. The single raise keeps the control flow
    obvious at each route entry.
    """
    if not config.face_tracking_enabled:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Face tracking is disabled (face_tracking_enabled=False)",
        )
    if config.face_tracking_privacy_mode == "off":
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Face tracking privacy mode is 'off' — camera suppressed",
        )
    if _current_system_state() == "GHOST":
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GHOST state forces camera off",
        )


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.post("/enroll", response_model=EnrollResponse)
async def face_enroll(
    req: EnrollRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EnrollResponse:
    _check_enabled()
    try:
        stored = await store_embedding(db, user, req.samples)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    logger.info(
        "face: enrolled user=%s samples=%d dim=%d",
        user.username, len(req.samples), len(stored),
    )
    return EnrollResponse(
        ok=True,
        user_id=user.id,
        sample_count=len(req.samples),
        dim=len(stored),
    )


@router.post("/recognize", response_model=RecognizeResponse)
async def face_recognize(
    req: RecognizeRequest,
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RecognizeResponse:
    """Перемикання активного профілю — для того, хто ВЖЕ увійшов.

    Було «auth-optional: … as a login suggestion (logged-out)», і замка не
    стояло. Наслідок: будь-хто, хто дотягнувся до порту, надсилав вектор і
    діставав `username`, `user_id` і `role` — тобто перебирав, чиї обличчя
    цей вузол знає. У продукті, чия суть — не розголошувати, це розголошення
    того, хто тут живе.

    Токена ця відповідь ніколи не видавала: способом ВХОДУ розпізнавання не
    є, воно лише наповнює `faceStore`. А обіцяна «підказка на екрані входу»
    не була підключена взагалі — `App.tsx:162` віддає `LoginScreen` замість
    усього дерева, і `<Overlays/>` (єдиний споживач циклу розпізнавання)
    рендериться лише після автентифікації. Тобто замок тут не забирає нічого,
    що працювало; він забирає те, що працювало ЛИШЕ для чужого.
    """
    _check_enabled()
    threshold = float(config.face_recognition_threshold)
    match = await match_embedding(db, req.embedding, threshold)
    if match is None:
        return RecognizeResponse(
            matched=False,
            user_id=None,
            username=None,
            role=None,
            confidence=0.0,
            threshold=threshold,
        )
    matched_user, confidence = match
    return RecognizeResponse(
        matched=True,
        user_id=matched_user.id,
        username=matched_user.username,
        role=matched_user.role,
        confidence=confidence,
        threshold=threshold,
    )


@router.delete("/embedding")
async def face_delete(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    # NOTE: deletion does NOT require the subsystem to be enabled — operators
    # must always be able to purge their template even with face tracking off.
    removed = await delete_embedding(db, user)
    return {"ok": True, "removed": removed}


@router.get("/status", response_model=StatusResponse)
async def face_status(
    db: AsyncSession = Depends(get_db),
) -> StatusResponse:
    """Status is intentionally queryable even when disabled — the UI needs
    to know *why* it's disabled (privacy mode vs GHOST vs master off).
    `has_my_embedding` is always null here; the authenticated variant is
    served by GET /face/me."""
    result = await db.execute(select(User))
    users = result.scalars().all()
    enrolled = sum(1 for u in users if has_embedding(u))

    return StatusResponse(
        enabled=config.face_tracking_enabled,
        auto_switch_profile=config.face_tracking_auto_switch_profile,
        privacy_mode=config.face_tracking_privacy_mode,
        threshold=float(config.face_recognition_threshold),
        unknown_lockout_s=int(config.face_unknown_lockout_s),
        enrolled_users=enrolled,
        has_my_embedding=None,
        system_state=_current_system_state(),
        oled_enabled=config.oled_animation_enabled,
    )


@router.get("/me")
async def face_me(
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Whether the caller has a stored embedding. Separate from /status
    because status is anonymous-safe."""
    return {
        "user_id": user.id,
        "username": user.username,
        "has_embedding": has_embedding(user),
    }
