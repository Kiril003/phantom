"""
PHANTOM Familiar — backend route + WS broadcaster.

The Familiar is a frontend-first feature; this route exists so the AI
runtime (and operator-side automation, e.g. a Telegram nudge) can
explicitly summon the wisp via a server-side call.

Phase-5 R1-FAMILIAR-1.

Endpoint:
  POST /api/v1/familiar/manifest
    body: {
      pose: 'idle' | 'floating' | 'pointing' | 'peeking' | 'sleeping'
            | 'waving' | 'vanishing',
      message?: str,           # ≤ 240 chars
      duration_ms?: int        # 500..30_000
      target?: { selector?: str, x?: float, y?: float }
    }
    -> {ok: True, summoned_at_ms: int}

Side effect: ``hub.broadcast("familiar", "manifestation", payload)`` so
every connected WS client receives the summon. The frontend
``wsHandlers`` listener turns it into a ``familiarStore.manifest(
'ai-summon', …)`` call — the front-end rarity gate is bypassed for
``ai-summon`` so the creature is guaranteed to appear.

Auth: ROOT-only by default (the Familiar is a presence layer, not a
public API). Anonymous WS clients still receive the broadcast — they
just can't *trigger* it.
"""
from __future__ import annotations

import logging
import time
from typing import Annotated, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from db.models import User
from security.auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/familiar", tags=["familiar"])


# ── Schemas (mirror src/shared/types/familiar.ts) ───────────────────────────

FamiliarPose = Literal[
    "idle",
    "floating",
    "pointing",
    "peeking",
    "sleeping",
    "waving",
    "vanishing",
]


class FamiliarTarget(BaseModel):
    """Anchor for ``pointing`` poses. Either a CSS selector OR a
    viewport coordinate; both fields are optional but at least one
    SHOULD be supplied for the pose to render meaningfully."""

    model_config = ConfigDict(extra="forbid")

    selector: Optional[str] = Field(
        default=None,
        max_length=240,
        description="CSS selector resolved client-side via querySelector.",
    )
    x: Optional[float] = Field(default=None, ge=0.0, le=4096.0)
    y: Optional[float] = Field(default=None, ge=0.0, le=4096.0)


class FamiliarManifestRequest(BaseModel):
    """Body for ``POST /familiar/manifest``."""

    model_config = ConfigDict(extra="forbid")

    pose: FamiliarPose = "waving"
    message: Optional[Annotated[str, Field(max_length=240)]] = None
    duration_ms: Optional[Annotated[int, Field(ge=500, le=30_000)]] = None
    target: Optional[FamiliarTarget] = None


class FamiliarManifestResponse(BaseModel):
    ok: bool
    summoned_at_ms: int
    pose: FamiliarPose


# ── Route handler ───────────────────────────────────────────────────────────


@router.post("/manifest", response_model=FamiliarManifestResponse)
async def api_familiar_manifest(
    req: FamiliarManifestRequest,
    user: User = Depends(get_current_user),
) -> FamiliarManifestResponse:
    """Summon the Familiar on every connected WS client.

    The pose / message / duration / target are passed through verbatim;
    the frontend store applies the per-pose default duration when
    ``duration_ms`` is absent. ROOT-only — operators below ROOT see a
    403 (the Familiar is a presence layer, not a public toy).
    """
    # ROOT trust gate. The User model carries a ``trust`` enum via
    # ``security.permissions``; absent that field we fall back to the
    # ``role`` slug.
    role = getattr(user, "role", None) or getattr(user, "trust", None)
    if role and str(role).upper() not in {"ROOT", "OPERATOR"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Familiar manifest requires ROOT/OPERATOR.",
        )

    # Lazy-import the WS hub so test harnesses that import this module
    # without booting the FastAPI app don't pull the singleton.
    try:
        from api.websocket_hub import hub
    except Exception as exc:
        logger.error("Familiar route: WS hub import failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="WebSocket hub unavailable.",
        ) from exc

    payload: dict = {
        "pose": req.pose,
        "message": req.message,
        "duration_ms": req.duration_ms,
        "target": req.target.model_dump(exclude_none=True) if req.target else None,
        "summoned_by": getattr(user, "id", None),
    }

    summoned_at_ms = int(time.time() * 1000)
    try:
        await hub.broadcast("familiar", "manifestation", payload)
    except Exception as exc:
        logger.error("Familiar route: WS broadcast failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="WS broadcast failed.",
        ) from exc

    logger.info(
        "Familiar manifest: pose=%s by user=%s message=%r",
        req.pose, getattr(user, "id", None), req.message,
    )
    return FamiliarManifestResponse(
        ok=True, summoned_at_ms=summoned_at_ms, pose=req.pose,
    )


__all__ = [
    "router",
    "FamiliarManifestRequest",
    "FamiliarManifestResponse",
    "FamiliarTarget",
    "FamiliarPose",
]
