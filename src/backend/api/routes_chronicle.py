"""Phase 36 — Relationship Chronicle endpoints.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, and_, delete, update
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import User, ChatMessage
from db.tom_models import Epoch, Belief, SemanticMemory, Episode
from security.auth import get_current_user
from security.device_auth import get_user_or_device_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chronicle", tags=["chronicle"])


class BeliefOut(BaseModel):
    id: int
    subject: str
    statement: str
    predicate_key: str
    value: Optional[str] = None
    belief_type: str
    confidence: float
    status: str
    superseded_by: Optional[int] = None
    created_at: float
    updated_at: float


class SemanticOut(BaseModel):
    id: int
    statement: str
    topic_key: Optional[str] = None
    importance: float
    created_at: float


class EpochTimelineItem(BaseModel):
    id: int
    name: str
    start_time: float
    end_time: float
    topic_summary: list[str]
    status: str
    created_at: float
    avg_valence: float
    avg_arousal: float
    beliefs: list[BeliefOut]
    semantics: list[SemanticOut]
    dream_art_svg: str


class RenameEpochRequest(BaseModel):
    name: str


def generate_epoch_art_svg(topics: list[str], num_beliefs: int, num_contradictions: int, superseded_count: int) -> str:
    """Generates a beautiful, deterministic SVG abstract digital art piece
    representing the night consolidation activities of the epoch.
    """
    has_code = any(t in ("code", "system", "logs", "api", "preference") for t in topics)
    
    if has_code:
        bg_start = "#0f172a"
        bg_end = "#1e1b4b"
        accent_color = "#38bdf8"
    else:
        bg_start = "#1c1917"
        bg_end = "#451a03"
        accent_color = "#fbbf24"

    svg_parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="100%" height="100%">',
        '<defs>',
        f'  <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">',
        f'    <stop offset="0%" stop-color="{bg_start}" />',
        f'    <stop offset="100%" stop-color="{bg_end}" />',
        f'  </linearGradient>',
        f'  <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="100%">',
        f'    <stop offset="0%" stop-color="{accent_color}" />',
        f'    <stop offset="100%" stop-color="#ec4899" />',
        f'  </linearGradient>',
        '</defs>',
        '<rect width="400" height="400" fill="url(#bgGrad)" rx="16"/>'
    ]

    # Draw superseded paths (fading lines)
    for i in range(max(1, superseded_count)):
        y_pos = 100 + i * 40
        svg_parts.append(
            f'<path d="M 50 {y_pos} Q 200 {y_pos + 40} 350 {y_pos}" '
            f'fill="none" stroke="{accent_color}" stroke-width="2" '
            f'stroke-dasharray="5,5" opacity="0.3" />'
        )

    # Draw contradictions (overlapping circles / knots)
    for i in range(num_contradictions):
        cx = 120 + i * 80
        cy = 200
        svg_parts.append(
            f'<circle cx="{cx}" cy="{cy}" r="30" fill="none" stroke="#ef4444" stroke-width="1.5" opacity="0.4" />'
            f'<circle cx="{cx + 20}" cy="{cy}" r="20" fill="none" stroke="#f97316" stroke-width="1.5" opacity="0.4" />'
        )

    # Draw nodes representing active beliefs
    for i in range(min(num_beliefs + 1, 8)):
        cx = 80 + (i * 50) % 260
        cy = 80 + (i * 40) % 260
        if i > 0:
            prev_cx = 80 + ((i - 1) * 50) % 260
            prev_cy = 80 + ((i - 1) * 40) % 260
            svg_parts.append(
                f'<line x1="{prev_cx}" y1="{prev_cy}" x2="{cx}" y2="{cy}" stroke="{accent_color}" stroke-width="1.5" opacity="0.4" />'
            )
        svg_parts.append(
            f'<circle cx="{cx}" cy="{cy}" r="7" fill="url(#accentGrad)" />'
            f'<circle cx="{cx}" cy="{cy}" r="12" fill="none" stroke="{accent_color}" stroke-width="1" opacity="0.5" />'
        )

    topics_str = ", ".join(topics[:3]) if topics else "general"
    svg_parts.append(
        f'<text x="20" y="375" fill="#94a3b8" font-family="sans-serif" font-size="10" opacity="0.8">'
        f'Topics: {topics_str} | Nodes: {num_beliefs}'
        f'</text>'
    )
    svg_parts.append('</svg>')
    return "\n".join(svg_parts)


@router.get("/timeline", response_model=List[EpochTimelineItem])
async def get_timeline(
    me: User = Depends(get_user_or_device_user),
    db: AsyncSession = Depends(get_db)
) -> List[EpochTimelineItem]:
    """Retrieve chronological epochs for the timeline view, populated with facts and metrics."""
    # 1. Fetch epochs
    stmt = select(Epoch).where(Epoch.status == "active").order_by(Epoch.start_time.desc())
    res = await db.execute(stmt)
    epochs = res.scalars().all()

    timeline_items = []
    for ep in epochs:
        # Fetch beliefs created or updated in this epoch
        belief_stmt = select(Belief).where(
            and_(
                Belief.created_at >= ep.start_time,
                Belief.created_at <= ep.end_time
            )
        )
        belief_res = await db.execute(belief_stmt)
        beliefs = belief_res.scalars().all()

        # Fetch semantics
        sem_stmt = select(SemanticMemory).where(
            and_(
                SemanticMemory.created_at >= ep.start_time,
                SemanticMemory.created_at <= ep.end_time
            )
        )
        sem_res = await db.execute(sem_stmt)
        semantics = sem_res.scalars().all()

        # Fetch episodes to compute average affect trend
        episode_stmt = select(Episode).where(
            and_(
                Episode.ts >= ep.start_time,
                Episode.ts <= ep.end_time
            )
        )
        episode_res = await db.execute(episode_stmt)
        episodes = episode_res.scalars().all()

        val_sum, aro_sum, count = 0.0, 0.0, 0
        for e in episodes:
            if e.prosody:
                try:
                    p = json.loads(e.prosody)
                    val_sum += p.get("valence", 0.5)
                    aro_sum += p.get("arousal", 0.5)
                    count += 1
                except Exception:
                    pass

        avg_val = val_sum / count if count > 0 else 0.5
        avg_aro = aro_sum / count if count > 0 else 0.5

        # Extract topics
        try:
            topics = json.loads(ep.topic_summary or "[]")
        except Exception:
            topics = []

        # Count statistics for SVG art
        num_beliefs = len(beliefs)
        superseded_count = sum(1 for b in beliefs if b.status == "superseded")
        num_contradictions = sum(1 for b in beliefs if b.status == "inactive")

        svg_art = generate_epoch_art_svg(topics, num_beliefs, num_contradictions, superseded_count)

        timeline_items.append(
            EpochTimelineItem(
                id=ep.id,
                name=ep.name,
                start_time=ep.start_time,
                end_time=ep.end_time,
                topic_summary=topics,
                status=ep.status,
                created_at=ep.created_at,
                avg_valence=avg_val,
                avg_arousal=avg_aro,
                beliefs=[
                    BeliefOut(
                        id=b.id,
                        subject=b.subject,
                        statement=b.statement,
                        predicate_key=b.predicate_key,
                        value=b.value,
                        belief_type=b.belief_type,
                        confidence=b.confidence,
                        status=b.status,
                        superseded_by=b.superseded_by,
                        created_at=b.created_at,
                        updated_at=b.updated_at
                    )
                    for b in beliefs
                ],
                semantics=[
                    SemanticOut(
                        id=s.id,
                        statement=s.statement,
                        topic_key=s.topic_key,
                        importance=s.importance,
                        created_at=s.created_at
                    )
                    for s in semantics
                ],
                dream_art_svg=svg_art
            )
        )

    return timeline_items


@router.put("/epoch/{epoch_id}")
async def rename_epoch(
    epoch_id: int,
    payload: RenameEpochRequest,
    me: User = Depends(get_user_or_device_user),
    db: AsyncSession = Depends(get_db)
) -> dict:
    """Rename an epoch (curation)."""
    stmt = select(Epoch).where(Epoch.id == epoch_id)
    res = await db.execute(stmt)
    epoch = res.scalar_one_or_none()
    if not epoch:
        raise HTTPException(status_code=404, detail="Epoch not found")
    epoch.name = payload.name
    await db.commit()
    return {"status": "success", "message": f"Epoch renamed to {payload.name}"}


@router.post("/epoch/{epoch_id}/hide")
async def hide_epoch(
    epoch_id: int,
    me: User = Depends(get_user_or_device_user),
    db: AsyncSession = Depends(get_db)
) -> dict:
    """Hide an epoch from the timeline (curation)."""
    stmt = select(Epoch).where(Epoch.id == epoch_id)
    res = await db.execute(stmt)
    epoch = res.scalar_one_or_none()
    if not epoch:
        raise HTTPException(status_code=404, detail="Epoch not found")
    epoch.status = "hidden"
    await db.commit()
    return {"status": "success", "message": "Epoch hidden successfully"}


@router.delete("/epoch/{epoch_id}", status_code=204, response_model=None)
async def delete_epoch(
    epoch_id: int,
    me: User = Depends(get_user_or_device_user),
    db: AsyncSession = Depends(get_db)
) -> None:
    """Hard delete an epoch and cascade-delete all episodes, beliefs, and semantics in that range across SQL, Chroma, and Vault."""
    stmt = select(Epoch).where(Epoch.id == epoch_id)
    res = await db.execute(stmt)
    epoch = res.scalar_one_or_none()
    if not epoch:
        raise HTTPException(status_code=404, detail="Epoch not found")

    from memory.forget_service import forget_epoch
    await forget_epoch(db, epoch_id, me.id)
