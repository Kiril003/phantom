"""Phase 35 — ToM Hot Path (TURN) Service.
Handles fast-path probe classification, logging of dialogue episodes, and prompt-builder context generation.
"""
from __future__ import annotations
import math
import json
import time
import logging
from typing import Any, Optional, Dict, List
from sqlalchemy import select, update, and_
from sqlalchemy.ext.asyncio import AsyncSession

from db.tom_models import Episode, Belief, BeliefEvidence, Hypothesis, ReflectionQueue, SemanticMemory
from ai.hub import ai_hub
from memory import strategic_memory

logger = logging.getLogger(__name__)

# Prosody weights for AffectMatch
PROSODY_WEIGHTS = {
    "valence": 0.40,
    "arousal": 0.35,
    "fatigue": 0.15,
    "hesitation": 0.10
}


def sigmoid(x: float) -> float:
    try:
        return 1.0 / (1.0 + math.exp(-x))
    except OverflowError:
        return 0.0 if x < 0 else 1.0


async def log_episode(
    db: AsyncSession,
    session_id: str,
    role: str,
    content: str,
    prosody: Optional[Dict[str, float]] = None,
    context_snap: Optional[Dict[str, Any]] = None,
    importance: float = 0.5
) -> int:
    """Log dialogue turn into episodic memory. Returns Episode ID."""
    now = time.time()
    prosody_str = json.dumps(prosody) if prosody else None
    context_str = json.dumps(context_snap) if context_snap else None
    
    episode = Episode(
        session_id=session_id,
        ts=now,
        role=role,
        content=content,
        prosody=prosody_str,
        context_snap=context_str,
        importance=importance,
        access_count=0,
        last_accessed=None,
        dream_processed=0
    )
    db.add(episode)
    await db.flush()
    return episode.id


async def check_active_probes(
    db: AsyncSession,
    user_id: str,
    user_message: str
) -> None:
    """Fast-path Classifier: checks if user_message confirms/refutes any pending probes."""
    # Find pending active_probes
    stmt = select(Hypothesis).where(
        and_(
            Hypothesis.status == "pending",
            Hypothesis.test_mode == "active_probe"
        )
    )
    res = await db.execute(stmt)
    hypotheses = res.scalars().all()
    if not hypotheses:
        return

    for hyp in hypotheses:
        # Fetch the corresponding belief
        belief_res = await db.execute(select(Belief).where(Belief.id == hyp.belief_id))
        belief = belief_res.scalar_one_or_none()
        if not belief or belief.status != "active":
            continue

        # Run LLM subtask classifier
        prompt = (
            f"Аналізуй репліку користувача на предмет підтвердження чи спростування гіпотези.\n"
            f"Гіпотеза: {hyp.text}\n"
            f"Репліка користувача: \"{user_message}\"\n\n"
            f"Поверни ТІЛЬКИ одне з трьох слів:\n"
            f"CONFIRMED - якщо репліка підтверджує гіпотезу\n"
            f"REFUTED - якщо репліка спростовує гіпотезу\n"
            f"NONE - якщо репліка не стосується гіпотези або є нейтральною.\n"
            f"Не додавай жодних інших символів чи пояснень."
        )
        try:
            classification_resp = await ai_hub.dispatch(
                "chat_subtask",
                {
                    "user_message": prompt,
                    "system_prompt": "You are a fast semantic classifier for a Theory-of-Mind system.",
                    "history": [],
                    "user_id": user_id,
                }
            )
            verdict = classification_resp.content.strip().upper()
            if "CONFIRMED" in verdict:
                await _apply_probe_resolution(db, hyp, belief, polarity=1)
            elif "REFUTED" in verdict:
                await _apply_probe_resolution(db, hyp, belief, polarity=-1)
        except Exception as exc:
            logger.debug("Fast-path probe classification failed: %s", exc)


async def _apply_probe_resolution(
    db: AsyncSession,
    hypothesis: Hypothesis,
    belief: Belief,
    polarity: int
) -> None:
    now = time.time()
    # Update hypothesis status
    hypothesis.status = "confirmed" if polarity == 1 else "refuted"
    hypothesis.resolved_at = now

    # Adjust belief log_odds (Fast-path micro-delta)
    # delta = min(FASTPATH_K * strength, FASTPATH_CAP) -> let's use a standard shift of 0.8
    delta = 0.8 * polarity
    belief.log_odds += delta
    belief.confidence = sigmoid(belief.log_odds)
    belief.updated_at = now
    belief.last_confirmed = now

    # Add evidence log
    evidence = BeliefEvidence(
        belief_id=belief.id,
        source_type="hypothesis",
        source_id=hypothesis.id,
        polarity=polarity,
        weight=1.0,
        added_at=now
    )
    db.add(evidence)

    # Queue an event in reflection_queue
    queue_item = ReflectionQueue(
        kind="probe_outcome",
        payload=json.dumps({
            "hypothesis_id": hypothesis.id,
            "belief_id": belief.id,
            "verdict": hypothesis.status,
            "new_confidence": belief.confidence
        }),
        priority=1, # elevated priority
        created_at=now,
        consumed=0
    )
    db.add(queue_item)
    await db.flush()
    logger.info("Probe %d resolved: %s. Belief %d confidence updated to %.2f",
                hypothesis.id, hypothesis.status, belief.id, belief.confidence)


async def affect_match_retrieve(
    db: AsyncSession,
    user_id: str,
    query: str,
    query_prosody: Dict[str, float],
    k: int = 5
) -> List[str]:
    """Retrieve relevant memories with semantic similarity + prosody affect-match."""
    # 1. Fetch raw query with distances from ChromaDB
    chroma_hits = await strategic_memory.query_with_distances(user_id, query, k=k*3)
    if not chroma_hits:
        return []

    # Check stress condition: valence < 0.4 and arousal > 0.7
    q_val = query_prosody.get("valence", 0.5)
    q_aro = query_prosody.get("arousal", 0.5)
    is_stressed = q_val < 0.4 and q_aro > 0.7

    w_rel = 0.50
    w_imp = 0.20
    w_rec = 0.15
    w_aff = 0.15

    # If stressed, invert the affect weight to retrieve comforting/calming memories
    if is_stressed:
        w_aff = -0.15

    now = time.time()
    scored_hits = []

    # Map embedding IDs to retrieve SQLite rows
    embedding_ids = [hit["id"] for hit in chroma_hits]
    
    # Batch select episodes for these embedding_ids
    ep_stmt = select(Episode).where(Episode.embedding_id.in_(embedding_ids))
    ep_res = await db.execute(ep_stmt)
    episodes_map = {ep.embedding_id: ep for ep in ep_res.scalars().all()}

    # Batch select semantic_memory for these embedding_ids
    sem_stmt = select(SemanticMemory).where(SemanticMemory.embedding_id.in_(embedding_ids))
    sem_res = await db.execute(sem_stmt)
    semantics_map = {sm.embedding_id: sm for sm in sem_res.scalars().all()}

    for hit in chroma_hits:
        fid = hit["id"]
        content = hit["content"]
        cosine_dist = hit["distance"]
        cos_sim = max(0.0, min(1.0, 1.0 - cosine_dist))

        importance = 0.5
        last_accessed = now
        m_prosody = {"valence": 0.5, "arousal": 0.5, "fatigue": 0.0, "hesitation": 0.0}

        # Retrieve fields from SQLite representation if available
        if fid in episodes_map:
            ep = episodes_map[fid]
            importance = ep.importance
            last_accessed = ep.last_accessed if ep.last_accessed else ep.ts
            if ep.prosody:
                try:
                    m_prosody.update(json.loads(ep.prosody))
                except Exception:
                    pass
            # Update access details locally
            ep.access_count += 1
            ep.last_accessed = now
        elif fid in semantics_map:
            sm = semantics_map[fid]
            importance = sm.importance
            last_accessed = sm.last_accessed if sm.last_accessed else sm.created_at
            # Update access details
            sm.last_accessed = now

        # Recency decay: half-life of 1 hour (3600 seconds)
        age_hours = max(0.0, (now - last_accessed) / 3600.0)
        decay = math.pow(0.5, age_hours / 1.0) # 1 hour half-life

        # Compute AffectMatch
        diff_sq_sum = 0.0
        for key, weight in PROSODY_WEIGHTS.items():
            q_val = query_prosody.get(key, 0.5 if key in ("valence", "arousal") else 0.0)
            m_val = m_prosody.get(key, 0.5 if key in ("valence", "arousal") else 0.0)
            diff_sq_sum += weight * ((q_val - m_val) ** 2)
        
        affect_match = 1.0 - math.sqrt(diff_sq_sum)

        # Composite score
        score = (
            w_rel * cos_sim +
            w_imp * importance +
            w_rec * decay +
            w_aff * affect_match
        )
        scored_hits.append((score, content))

    # Sort descending
    scored_hits.sort(key=lambda x: -x[0])
    return [content for _, content in scored_hits[:k]]


async def get_tom_prompt_context(
    db: AsyncSession,
    user_id: str
) -> Dict[str, str]:
    """Generates user model system prompt components based on ToM database state."""
    # 1. Retrieve active beliefs
    belief_stmt = select(Belief).where(
        and_(
            Belief.subject == "user",
            Belief.status == "active"
        )
    )
    res = await db.execute(belief_stmt)
    beliefs = res.scalars().all()

    tom_lines = []
    open_loops = []
    for b in beliefs:
        # Confidence map to verbal hedge tags
        if b.confidence >= 0.85:
            tag = "[встановлено]"
        elif b.confidence >= 0.60:
            tag = "[ймовірно]"
        else:
            tag = "[припускаю]"
        
        line = f"  • {tag} {b.statement}"
        
        if b.belief_type == "open_loop":
            open_loops.append(line)
        else:
            tom_lines.append(line)

    # 2. Retrieve active probes / hypotheses
    probe_stmt = select(Hypothesis).where(Hypothesis.status == "pending")
    res = await db.execute(probe_stmt)
    hypotheses = res.scalars().all()

    active_probes = []
    for h in hypotheses:
        if h.test_mode == "active_probe":
            hint = f" ({h.probe_hint})" if h.probe_hint else ""
            active_probes.append(f"  • {h.text}{hint}")

    return {
        "tom_beliefs_with_band_tags": "\n".join(tom_lines) if tom_lines else "  • (немає відомостей)",
        "open_loops": "\n".join(open_loops) if open_loops else "  • (відсутні)",
        "active_probes": "\n".join(active_probes) if active_probes else "  • (немає активних гіпотез для перевірки)"
    }
