"""PHANTOM OS — Cognitive Memory Resolver.

Handles temporal fact resolution (conflict resolution) for incoming user facts
using slot-based matching (regex) and semantic fallback similarity thresholds.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import config
from db.models import MemoryFact
from memory import strategic_memory

logger = logging.getLogger(__name__)

# Heuristics for rule-based entity slot extraction
_SLOT_DETECTORS = [
    ("location", [
        r"\bживу\s+(?:в|у)\b", r"\bмешкаю\s+(?:в|у)\b", r"\bi\s+live\s+in\b", 
        r"\blives\s+in\b", r"\blocation\s+is\b", r"\bмій\s+дім\b", r"\bмоє\s+місто\b"
    ]),
    ("employer", [
        r"\bпрацюю\s+(?:в|у|на)\b", r"\bwork\s+(?:at|in|for)\b", r"\bemployer\s+is\b",
        r"\bмій\s+роботодавець\b", r"\bмоя\s+робота\b"
    ]),
    ("relationship", [
        r"\bзустрічаюся\s+з\b", r"\bдружина\b", r"\bчоловік\b", r"\bmy\s+wife\b", r"\bmy\s+husband\b",
        r"\brelationship\s+with\b", r"\bdating\b"
    ]),
    ("project", [
        r"\bрозробляю\b", r"\bпишу\s+проект\b", r"\bworking\s+on\b", r"\bdeveloping\b",
        r"\bмій\s+проект\b"
    ]),
]


def extract_entity_slot(content: str) -> str | None:
    """Detect entity slot based on regex patterns."""
    lower = content.lower()
    for slot, patterns in _SLOT_DETECTORS:
        for pat in patterns:
            if re.search(pat, lower):
                return slot
    return None


async def resolve_conflicts(
    db: AsyncSession,
    user_id: str,
    new_fact_content: str,
    new_fact_id: str,
) -> str | None:
    """Resolve conflicting memory facts.
    
    If the fact matches an entity slot, overwrites the active fact in that slot.
    Otherwise, falls back to semantic similarity overlap checks.
    
    Returns the detected/assigned entity_slot or None.
    """
    now = datetime.now(tz=timezone.utc)
    now_iso = now.isoformat()
    
    slot = extract_entity_slot(new_fact_content)
    
    if slot:
        logger.info("Resolver: Slot-based match detected for slot %r (fact: %r)", slot, new_fact_content)
        # Find active SQLite facts with the same slot
        stmt = select(MemoryFact).where(
            and_(
                MemoryFact.user_id == user_id,
                MemoryFact.entity_slot == slot,
                MemoryFact.valid_until.is_(None),
                MemoryFact.is_sealed.is_(False),
            )
        )
        res = await db.execute(stmt)
        active_facts = res.scalars().all()
        
        for fact in active_facts:
            if fact.id == new_fact_id:
                continue
            logger.info("Resolver: Superseding old slot fact %s (slot: %s)", fact.id, slot)
            fact.valid_until = now
            fact.superseded_by = new_fact_id
            
            # Sync to ChromaDB
            await strategic_memory.supersede_fact(user_id, fact.id, new_fact_id)
            
        return slot
        
    # Semantic Fallback (similarity threshold check)
    threshold = getattr(config, "cognitive_memory_semantic_similarity_threshold", 0.90)
    # Cosine distance = 1 - similarity. So threshold 0.90 similarity -> max distance 0.10
    max_distance = 1.0 - threshold
    
    logger.debug("Resolver: Running semantic overlap check with threshold %0.2f (max dist: %0.2f)", threshold, max_distance)
    candidates = await strategic_memory.query_with_distances(user_id, new_fact_content, k=3)
    
    for cand in candidates:
        cand_id = cand["id"]
        cand_dist = cand["distance"]
        if cand_id == new_fact_id:
            continue
            
        if cand_dist <= max_distance:
            logger.info("Resolver: Semantic conflict resolved. Superseding fact %s due to distance %0.3f <= %0.3f", cand_id, cand_dist, max_distance)
            # Find and update in SQLite
            stmt = select(MemoryFact).where(MemoryFact.id == cand_id)
            res = await db.execute(stmt)
            fact = res.scalar_one_or_none()
            if fact:
                fact.valid_until = now
                fact.superseded_by = new_fact_id
                
            # Sync to ChromaDB
            await strategic_memory.supersede_fact(user_id, cand_id, new_fact_id)
            
    return None
