"""Phone-side notifications history.

Endpoints under `/api/v1/notifications/`:

  GET /notifications/recent?limit=&since_ms=&role=&kind=
        Returns the latest assistant + proactive lines so the
        Companion app can show a scrollable inbox even after the
        operator missed the system buzz.

The desktop already persists every chat exchange in
`chat_messages`. We project a slice of that table — assistant +
proactive messages, scoped to the current user, ordered newest-
first — into a thin shape the phone can render without joining
the full session graph.

Auth: `get_user_or_device_user` so paired phones reach this with
their device JWT.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import ChatMessage, User
from security.device_auth import get_user_or_device_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/notifications", tags=["notifications"])


class NotificationOut(BaseModel):
    id: str
    session_id: str
    role: str
    content: str
    response_form: str
    created_at: datetime
    meta: dict | None = None  # ChatMessage.metadata_json parsed
    is_proactive: bool = False
    horizon: str | None = None


class NotificationsResponse(BaseModel):
    items: list[NotificationOut]
    total: int


@router.get("/recent", response_model=NotificationsResponse)
async def list_recent(
    limit: int = Query(default=50, ge=1, le=200),
    since_ms: Optional[int] = Query(default=None, ge=0),
    role: Optional[str] = Query(
        default=None,
        description="Filter by chat role: user|assistant|system",
        max_length=16,
    ),
    proactive_only: bool = Query(
        default=False,
        description="Return only proactive monologue lines (input_method=proactive)",
    ),
    me: User = Depends(get_user_or_device_user),
    db: AsyncSession = Depends(get_db),
) -> NotificationsResponse:
    stmt = select(ChatMessage).where(ChatMessage.user_id == me.id)
    if role:
        stmt = stmt.where(ChatMessage.role == role)
    if since_ms is not None:
        cutoff = datetime.fromtimestamp(since_ms / 1000, tz=timezone.utc)
        stmt = stmt.where(ChatMessage.created_at >= cutoff)
    stmt = stmt.order_by(desc(ChatMessage.created_at)).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()

    items: list[NotificationOut] = []
    for r in rows:
        try:
            md = json.loads(r.metadata_json or "{}")
            md = md if isinstance(md, dict) else None
        except json.JSONDecodeError:
            md = None
        is_proactive = bool(md and md.get("input_method") == "proactive")
        if proactive_only and not is_proactive:
            continue
        horizon = (md or {}).get("horizon") if md else None
        items.append(
            NotificationOut(
                id=r.id,
                session_id=r.session_id,
                role=r.role,
                content=r.content,
                response_form=r.response_form,
                created_at=r.created_at,
                meta=md,
                is_proactive=is_proactive,
                horizon=horizon if isinstance(horizon, str) else None,
            )
        )
    return NotificationsResponse(items=items, total=len(items))
