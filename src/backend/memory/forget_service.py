"""Phase 36 — Right-to-Forget Cascade Service.
Deletes episodes, beliefs, and semantics from SQLite, ChromaDB, and Vault.
"""
from __future__ import annotations
import re
import json
import logging
from typing import List
from sqlalchemy import select, delete, and_, update
from sqlalchemy.ext.asyncio import AsyncSession

from db.tom_models import Episode, Belief, SemanticMemory, SemanticSource, BeliefEvidence, Contradiction, Hypothesis, Epoch
from db.models import VaultCard
from memory import strategic_memory

logger = logging.getLogger(__name__)

_VAULT_TOKEN_RE = re.compile(r"⟦vault:([a-f0-9-]{36}):[a-zA-Z0-9_-]+⟧", re.IGNORECASE)


async def extract_and_delete_vault_tokens(db: AsyncSession, texts: List[str], user_id: str) -> None:
    """Finds vault tokens in texts and deletes corresponding VaultCard records."""
    card_ids = set()
    for text in texts:
        if not text:
            continue
        for match in _VAULT_TOKEN_RE.finditer(text):
            card_ids.add(match.group(1))
            
    if card_ids:
        logger.info("Right-to-Forget: deleting %d VaultCards for user %s", len(card_ids), user_id)
        stmt = delete(VaultCard).where(
            and_(
                VaultCard.id.in_(list(card_ids)),
                VaultCard.owner_user_id == user_id
            )
        )
        await db.execute(stmt)


async def forget_belief(db: AsyncSession, belief_id: int, user_id: str) -> None:
    """Cascade delete a specific belief from SQLite and ChromaDB."""
    stmt = select(Belief).where(and_(Belief.id == belief_id, Belief.subject == "user"))
    res = await db.execute(stmt)
    belief = res.scalar_one_or_none()
    if not belief:
        return
        
    logger.info("Right-to-Forget: deleting Belief ID %d", belief_id)
    
    # 1. Delete ChromaDB vector
    if belief.embedding_id:
        try:
            await strategic_memory.delete_fact(user_id, belief.embedding_id)
        except Exception as exc:
            logger.warning("Right-to-Forget: failed to delete ChromaDB fact %s: %s", belief.embedding_id, exc)
            
    # 2. Check for PII vault tokens in statement
    await extract_and_delete_vault_tokens(db, [belief.statement], user_id)
    
    # 3. Clean self-referential links on other beliefs
    await db.execute(
        update(Belief)
        .where(Belief.superseded_by == belief_id)
        .values(superseded_by=None)
    )
    
    # 4. Cascade delete related ToM rows
    await db.execute(delete(BeliefEvidence).where(BeliefEvidence.belief_id == belief_id))
    await db.execute(delete(Contradiction).where((Contradiction.belief_a == belief_id) | (Contradiction.belief_b == belief_id)))
    await db.execute(delete(Hypothesis).where(Hypothesis.belief_id == belief_id))
    
    # 5. Delete belief itself
    await db.execute(delete(Belief).where(Belief.id == belief_id))
    await db.commit()


async def forget_epoch(db: AsyncSession, epoch_id: int, user_id: str) -> None:
    """Cascade delete an epoch and all episodes, beliefs, and semantics in that range."""
    stmt = select(Epoch).where(Epoch.id == epoch_id)
    res = await db.execute(stmt)
    epoch = res.scalar_one_or_none()
    if not epoch:
        return
        
    start = epoch.start_time
    end = epoch.end_time
    logger.info("Right-to-Forget: deleting Epoch ID %d (range %f to %f)", epoch_id, start, end)
    
    # Fetch beliefs in range
    beliefs_res = await db.execute(
        select(Belief).where(and_(Belief.created_at >= start, Belief.created_at <= end))
    )
    beliefs = beliefs_res.scalars().all()
    belief_ids = [b.id for b in beliefs]
    
    # Fetch semantics in range
    semantics_res = await db.execute(
        select(SemanticMemory).where(and_(SemanticMemory.created_at >= start, SemanticMemory.created_at <= end))
    )
    semantics = semantics_res.scalars().all()
    sem_ids = [s.id for s in semantics]
    
    # Fetch episodes in range
    episodes_res = await db.execute(
        select(Episode).where(and_(Episode.ts >= start, Episode.ts <= end))
    )
    episodes = episodes_res.scalars().all()
    ep_ids = [ep.id for ep in episodes]
    
    # 1. Clean ChromaDB embeddings for beliefs and semantics
    for b in beliefs:
        if b.embedding_id:
            try:
                await strategic_memory.delete_fact(user_id, b.embedding_id)
            except Exception as exc:
                logger.warning("Right-to-Forget: Chroma delete failed for belief %s: %s", b.embedding_id, exc)
                
    for s in semantics:
        if s.embedding_id:
            try:
                await strategic_memory.delete_fact(user_id, s.embedding_id)
            except Exception as exc:
                logger.warning("Right-to-Forget: Chroma delete failed for semantic fact %s: %s", s.embedding_id, exc)
                
    # 2. Extract and delete PII Vault tokens from all deleted records
    all_texts = [b.statement for b in beliefs] + [s.statement for s in semantics] + [ep.content for ep in episodes]
    await extract_and_delete_vault_tokens(db, all_texts, user_id)
    
    # 3. SQLite cleanups
    if belief_ids:
        # Nullify self-referential links
        await db.execute(
            update(Belief)
            .where(Belief.superseded_by.in_(belief_ids))
            .values(superseded_by=None)
        )
        await db.execute(delete(BeliefEvidence).where(BeliefEvidence.belief_id.in_(belief_ids)))
        await db.execute(delete(Contradiction).where((Contradiction.belief_a.in_(belief_ids)) | (Contradiction.belief_b.in_(belief_ids))))
        await db.execute(delete(Hypothesis).where(Hypothesis.belief_id.in_(belief_ids)))
        
    if sem_ids:
        await db.execute(delete(SemanticSource).where(SemanticSource.semantic_id.in_(sem_ids)))
        
    if ep_ids:
        await db.execute(delete(SemanticSource).where(SemanticSource.episode_id.in_(ep_ids)))
        
    # Delete primary tables
    await db.execute(delete(Episode).where(and_(Episode.ts >= start, Episode.ts <= end)))
    await db.execute(delete(Belief).where(and_(Belief.created_at >= start, Belief.created_at <= end)))
    await db.execute(delete(SemanticMemory).where(and_(SemanticMemory.created_at >= start, SemanticMemory.created_at <= end)))
    await db.execute(delete(Epoch).where(Epoch.id == epoch_id))
    
    await db.commit()
