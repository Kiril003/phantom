"""PHANTOM OS — Memory Consolidation Pipeline.

Implements the background "Sleep Cycle" Consolidation:
1. Promotes tactical memory to strategic memory.
2. Performs semantic clustering and LLM generalization.
3. Applies active decay to unused and low importance facts.
4. Rewrites the versioned Core Narrative.
5. Runs subconscious curiosity foraging to generate context questions.
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import and_, delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ai.provider import ai_router
from config import config
from db.models import CuriosityQuestion, MemoryFact
from memory import core_narrative, strategic_memory

logger = logging.getLogger(__name__)


def cosine_similarity(v1: list[float], v2: list[float]) -> float:
    """Compute cosine similarity between two vectors."""
    dot = sum(a * b for a, b in zip(v1, v2))
    mag1 = sum(a * a for a in v1) ** 0.5
    mag2 = sum(b * b for b in v2) ** 0.5
    if mag1 == 0 or mag2 == 0:
        return 0.0
    return dot / (mag1 * mag2)


async def run_consolidation_cycle(db: AsyncSession, user_id: str) -> dict[str, Any]:
    """Run the complete memory consolidation cycle for the user."""
    logger.info("Starting consolidation cycle for user %s", user_id)
    report = {
        "promoted": 0,
        "pruned_tactical": 0,
        "generalized_clusters": 0,
        "decayed": 0,
        "narrative_updated": False,
        "curiosity_questions": 0,
    }

    now = datetime.now(tz=timezone.utc)
    now_iso = now.isoformat()

    # 1) Promote Tactical Memory
    tactical_stmt = select(MemoryFact).where(
        and_(
            MemoryFact.user_id == user_id,
            MemoryFact.layer == "tactical",
        )
    )
    res = await db.execute(tactical_stmt)
    tactical_facts = res.scalars().all()

    cutoff_24h = now - timedelta(hours=getattr(config, "memory_tactical_window_h", 24))

    for fact in tactical_facts:
        should_promote = (
            fact.access_count > 0 
            or fact.category == "explicit"
            or fact.importance >= getattr(config, "cognitive_memory_min_importance", 0.3)
        )
        if should_promote:
            logger.info("Consolidation: Promoting tactical fact %s to strategic: %r", fact.id, fact.content)
            # Store in strategic ChromaDB
            await strategic_memory.store_fact(
                user_id=user_id,
                fact_id=fact.id,
                content=fact.content,
                category=fact.category,
                importance=fact.importance,
                metadata_extra={
                    "source": "consolidation",
                    "source_session_id": fact.source_session_id,
                    "entity_slot": fact.entity_slot or "none",
                    "sentiment_score": fact.sentiment_score or 0.0,
                }
            )
            # Update SQLite model
            fact.layer = "strategic"
            fact.embedding_id = fact.id
            report["promoted"] += 1
        elif fact.created_at < cutoff_24h:
            logger.info("Consolidation: Pruning expired tactical fact %s: %r", fact.id, fact.content)
            await db.delete(fact)
            report["pruned_tactical"] += 1

    await db.flush()

    # 2) Semantic Clustering & Generalization
    try:
        from memory.strategic_memory import _collection_name, _get_client
        client = _get_client()
        coll = client.get_collection(name=_collection_name(user_id))
        
        # Fetch active strategic facts with embeddings
        res_chroma = coll.get(
            where={"$and": [{"user_id": user_id}, {"is_sealed": False}, {"valid_until": "none"}]},
            include=["embeddings", "documents", "metadatas"]
        )
        
        ids = res_chroma.get("ids", [])
        embs = res_chroma.get("embeddings", [])
        docs = res_chroma.get("documents", [])
        metas = res_chroma.get("metadatas", [])
        
        if len(ids) >= 3 and embs:
            # Build similarity clusters
            used_ids = set()
            for i in range(len(ids)):
                if ids[i] in used_ids:
                    continue
                cluster = [(ids[i], docs[i], metas[i])]
                for j in range(i + 1, len(ids)):
                    if ids[j] in used_ids:
                        continue
                    sim = cosine_similarity(embs[i], embs[j])
                    if sim >= 0.82:
                        cluster.append((ids[j], docs[j], metas[j]))
                
                if len(cluster) >= 3:
                    # Found a cluster of 3+ highly similar facts. Generalize them!
                    cluster_contents = [item[1] for item in cluster]
                    logger.info("Consolidation: Found semantic cluster of %d facts: %r", len(cluster), cluster_contents)
                    
                    # Call LLM to summarize/generalize
                    prompt = (
                        f"Об'єднай наступні мікро-факти про користувача в один чіткий, узагальнений стратегічний факт від першої особи (Я...):\n"
                        + "\n".join(f"- {c}" for c in cluster_contents)
                        + "\n\nПоверни ТІЛЬКИ один результуючий узагальнений рядок факту, без прози та без markdown."
                    )
                    llm_res = await ai_router.generate(
                        user_message=prompt,
                        system_prompt="Ти стислий редактор когнітивної пам'яті.",
                        history=[]
                    )
                    generalized_content = (llm_res.content or "").strip()
                    if generalized_content:
                        new_fact_id = str(uuid.uuid4())
                        # Store generalized fact
                        await strategic_memory.store_fact(
                            user_id=user_id,
                            fact_id=new_fact_id,
                            content=generalized_content,
                            category="fact",
                            importance=0.6,
                            metadata_extra={
                                "source": "generalization",
                                "entity_slot": "none",
                            }
                        )
                        # Save generalized fact to SQLite
                        new_fact = MemoryFact(
                            id=new_fact_id,
                            user_id=user_id,
                            layer="strategic",
                            category="fact",
                            content=generalized_content,
                            importance=0.6,
                            embedding_id=new_fact_id,
                            source_session_id="consolidation",
                            created_at=now,
                        )
                        db.add(new_fact)
                        
                        # Mark old cluster facts as superseded
                        for old_id, _, _ in cluster:
                            used_ids.add(old_id)
                            # Update SQLite
                            stmt = select(MemoryFact).where(MemoryFact.id == old_id)
                            old_res = await db.execute(stmt)
                            old_fact = old_res.scalar_one_or_none()
                            if old_fact:
                                old_fact.valid_until = now
                                old_fact.superseded_by = new_fact_id
                            
                            # Update Chroma
                            await strategic_memory.supersede_fact(user_id, old_id, new_fact_id)
                            
                        report["generalized_clusters"] += 1
                        
            await db.flush()
    except Exception as exc:
        logger.debug("Consolidation: Semantic clustering failed (possibly empty db or missing packages): %s", exc)

    # 3) Active Semantic Decay
    decay_cutoff = now - timedelta(days=14)
    decay_stmt = select(MemoryFact).where(
        and_(
            MemoryFact.user_id == user_id,
            MemoryFact.layer == "strategic",
            MemoryFact.importance < getattr(config, "cognitive_memory_min_importance", 0.3),
            MemoryFact.access_count == 0,
            MemoryFact.created_at < decay_cutoff,
            MemoryFact.valid_until.is_(None),
        )
    )
    res_decay = await db.execute(decay_stmt)
    decayed_facts = res_decay.scalars().all()
    for fact in decayed_facts:
        logger.info("Consolidation: Active decay applied to fact %s: %r", fact.id, fact.content)
        fact.valid_until = now
        await strategic_memory.seal_fact(user_id, fact.id)  # Seal in Chroma
        report["decayed"] += 1

    await db.flush()

    # 4) Rewrite Core Narrative
    # Fetch all active strategic facts to inform the narrative
    active_stmt = select(MemoryFact).where(
        and_(
            MemoryFact.user_id == user_id,
            MemoryFact.layer == "strategic",
            MemoryFact.valid_until.is_(None),
        )
    ).limit(30)
    res_active = await db.execute(active_stmt)
    active_facts_str = [f.content for f in res_active.scalars().all()]
    
    narrative_text = await core_narrative.rewrite_core_narrative(db, user_id, active_facts_str)
    if narrative_text:
        report["narrative_updated"] = True

    # 5) Subconscious Foraging (Curiosity Loop)
    try:
        latest_narrative = await core_narrative.get_latest_core_narrative(db, user_id)
        narrative_val = latest_narrative.text if latest_narrative else ""
        
        prompt_curiosity = (
            f"Поточний core_narrative:\n{narrative_val}\n\n"
            f"Відомі факти про користувача:\n"
            + "\n".join(f"- {f}" for f in active_facts_str[:15])
            + "\n\nПроаналізуй ці дані. Знайди суперечності чи прогалини у знаннях. "
            f"Сформулюй 1-2 відкритих коротких запитання до користувача для уточнення вашої історії.\n"
            f"Поверни строго JSON-список рядків:\n"
            f"[\n  \"запитання...\"\n]\n"
            f"Без прози, без markdown."
        )
        
        res_curiosity = await ai_router.generate(
            user_message=prompt_curiosity,
            system_prompt="Ти когнітивний аналітик діалогової пам'яті. Відповідаєш чистим JSON.",
            history=[]
        )
        raw_curiosity = (res_curiosity.content or "").strip()
        if raw_curiosity.startswith("```"):
            raw_curiosity = raw_curiosity.strip("`").lstrip("json").strip()
            
        questions = json.loads(raw_curiosity)
        if isinstance(questions, list):
            for q in questions:
                if q:
                    new_q = CuriosityQuestion(
                        user_id=user_id,
                        question=str(q).strip(),
                        status="pending",
                        created_at=now,
                    )
                    db.add(new_q)
                    report["curiosity_questions"] += 1
            await db.flush()
    except Exception as exc:
        logger.debug("Consolidation: Curiosity generation failed: %s", exc)

    logger.info("Consolidation cycle completed for user %s: %r", user_id, report)
    return report
