"""Phase 35/36 — DREAM Background Reflection Worker with Mutation Journaling.
Asynchronously processes episodic memory batches, synthesizes semantic memories, updates ToM beliefs, resolves conflicts, and sets conversational probes.
Separates thinking phase (PLAN) from atomic commit phase (APPLY) with preconditions.
"""
from __future__ import annotations
import os
import math
import json
import time
import logging
import uuid
from typing import Any, List, Dict, Tuple, Optional
from sqlalchemy import select, update, and_, or_, delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from db.tom_models import (
    Episode, SemanticMemory, SemanticSource, Belief, BeliefEvidence,
    Contradiction, Hypothesis, ReflectionQueue, Epoch, DreamJob, DreamMutation
)
from ai.hub import ai_hub
from memory import strategic_memory
from core.context_engine import context_engine
from core.state_machine import SystemState
from agent.operations.safety.thermal import cpu_temperature_c

logger = logging.getLogger(__name__)


def logit(p: float) -> float:
    p = max(0.001, min(0.999, p))
    return math.log(p / (1.0 - p))


def sigmoid(x: float) -> float:
    try:
        return 1.0 / (1.0 + math.exp(-x))
    except OverflowError:
        return 0.0 if x < 0 else 1.0


def check_power_status() -> Tuple[bool, float]:
    """Check AC power and battery level from sysfs.
    
    Returns:
        Tuple[bool, float]: (on_ac, battery_percent)
        Defaults to (True, 100.0) if sysfs is unavailable.
    """
    sysfs_path = "/sys/class/power_supply"
    on_ac = True
    battery_percent = 100.0
    
    if not os.path.exists(sysfs_path):
        return on_ac, battery_percent
        
    try:
        supplies = os.listdir(sysfs_path)
        ac_online = False
        has_ac = False
        has_bat = False
        
        for supply in supplies:
            path = os.path.join(sysfs_path, supply)
            type_path = os.path.join(path, "type")
            if os.path.exists(type_path):
                with open(type_path) as f:
                    s_type = f.read().strip().lower()
                if s_type == "mains" or "ac" in supply.lower():
                    has_ac = True
                    online_path = os.path.join(path, "online")
                    if os.path.exists(online_path):
                        with open(online_path) as f:
                            if f.read().strip() == "1":
                                ac_online = True
                elif s_type == "battery" or "bat" in supply.lower():
                    has_bat = True
                    cap_path = os.path.join(path, "capacity")
                    if os.path.exists(cap_path):
                        with open(cap_path) as f:
                            try:
                                battery_percent = float(f.read().strip())
                            except ValueError:
                                pass
        
        if has_ac:
            on_ac = ac_online
        elif not has_bat:
            on_ac = True
    except Exception as exc:
        logger.debug("Error checking power status: %s", exc)
        
    return on_ac, battery_percent


async def dream_admissible(db: AsyncSession) -> Tuple[bool, str]:
    """Eligibility gate - admission control for DREAM reflection cycle."""
    snap = context_engine.get_snapshot()
    state = snap.get("system", {}).get("state", "SHADOW")
    if state == "GHOST":
        return False, "privacy"
        
    idle_s = snap.get("history", {}).get("last_interaction_ago_s", 999)
    if idle_s < 300:  # 5 minutes idle limit
        return False, "presence"
        
    on_ac, battery_level = check_power_status()
    if not (on_ac or battery_level > 20.0):
        return False, "power"
        
    temp = await cpu_temperature_c()
    if temp is not None and temp > 85.0:
        return False, "thermal"
        
    # Count pending work
    pending_hints = (await db.execute(select(func.count(ReflectionQueue.id)).where(ReflectionQueue.consumed == 0))).scalar() or 0
    unprocessed = (await db.execute(select(func.count(Episode.id)).where(Episode.dream_processed == 0))).scalar() or 0
    pending = pending_hints + unprocessed
    
    oldest_ts = (await db.execute(select(Episode.ts).where(Episode.dream_processed == 0).order_by(Episode.ts.asc()).limit(1))).scalar_one_or_none()
    stale = False
    if oldest_ts:
        stale = (time.time() - oldest_ts) > 3600 * 4  # 4 hours
        
    if pending < 3 and not stale:  # MIN_BATCH = 3
        return False, "no_work"
        
    return True, "ok"


async def get_adaptive_batch_size() -> int:
    """Returns batch size based on hardware limits and power source."""
    on_ac, battery_level = check_power_status()
    temp = await cpu_temperature_c()
    
    if on_ac:
        if temp is not None and temp > 75.0:
            return 5
        return 15
    else:
        if temp is not None and temp > 75.0:
            return 3
        return 5


async def reclaim_abandoned_jobs(db: AsyncSession) -> None:
    """Finds jobs stuck in planning/applying with expired heartbeats and marks them aborted."""
    now = time.time()
    stmt = select(DreamJob).where(
        and_(
            DreamJob.phase.in_(["planning", "applying"]),
            DreamJob.heartbeat < now - 60.0
        )
    )
    res = await db.execute(stmt)
    stuck_jobs = res.scalars().all()
    for job in stuck_jobs:
        logger.warning("Reclaiming abandoned DreamJob ID %d (phase=%s, stage=%s)", job.id, job.phase, job.stage)
        job.phase = "aborted"
    if stuck_jobs:
        await db.commit()


async def check_precondition(db: AsyncSession, precond: dict) -> bool:
    """Verifies if the database state matches the preconditions of a mutation."""
    pred_key = precond.get("predicate_key")
    max_conf = precond.get("max_confidence")
    if not pred_key or max_conf is None:
        return True
        
    stmt = select(Belief.confidence).where(and_(Belief.predicate_key == pred_key, Belief.status == "active"))
    res = await db.execute(stmt)
    current_conf = res.scalar_one_or_none()
    if current_conf is not None:
        return current_conf <= max_conf
    return True


async def apply_job(db: AsyncSession, job_id: int, user_id: str) -> Dict[str, Any]:
    """Execute all mutations for a job in a single SQLite transaction and sync ChromaDB."""
    stmt = select(DreamJob).where(DreamJob.id == job_id)
    res = await db.execute(stmt)
    job = res.scalar_one_or_none()
    if not job or job.phase != "applying":
        return {"status": "error", "reason": f"Job {job_id} not ready to apply"}
        
    mut_stmt = select(DreamMutation).where(DreamMutation.job_id == job_id).order_by(DreamMutation.seq.asc())
    mut_res = await db.execute(mut_stmt)
    mutations = mut_res.scalars().all()
    
    predicate_to_belief_id = {}
    created_semantics_ids = []
    pending_chroma_ops: List[Dict[str, Any]] = []
    
    stats = {
        "episodes_processed": 0,
        "semantics_created": 0,
        "beliefs_extracted": 0,
        "contradictions_found": 0,
        "probes_generated": 0
    }
    
    now = time.time()
    
    for m in mutations:
        payload = json.loads(m.payload)
        precond = json.loads(m.precond) if m.precond else None
        
        if precond:
            if not await check_precondition(db, precond):
                logger.warning("DREAM APPLY: Precondition failed for mutation seq %d, skipping.", m.seq)
                continue
                
        if m.op == "semantic_upsert":
            sem = SemanticMemory(
                statement=payload["statement"],
                topic_key=payload.get("topic_key", "general"),
                importance=payload.get("importance", 0.5),
                decay_score=1.0,
                created_at=now,
                last_accessed=None
            )
            db.add(sem)
            await db.flush()
            sem.embedding_id = f"semantic_{sem.id}"
            created_semantics_ids.append(sem.id)
            
            if job.batch_lo <= job.batch_hi:
                ep_stmt = select(Episode).where(and_(Episode.id >= job.batch_lo, Episode.id <= job.batch_hi))
                ep_res = await db.execute(ep_stmt)
                episodes = ep_res.scalars().all()
                for ep in episodes:
                    src = SemanticSource(semantic_id=sem.id, episode_id=ep.id)
                    db.add(src)
                    
            pending_chroma_ops.append({
                "action": "store",
                "fact_id": sem.embedding_id,
                "content": sem.statement,
                "category": sem.topic_key or "general",
                "importance": sem.importance,
                "metadata_extra": {
                    "source": "dream_consolidation",
                    "created_at_ts": now
                }
            })
            stats["semantics_created"] += 1
            
        elif m.op == "belief_insert":
            b = Belief(
                subject="user",
                statement=payload["statement"],
                predicate_key=payload["predicate_key"],
                value=payload.get("value"),
                belief_type=payload["belief_type"],
                confidence=payload["confidence"],
                log_odds=logit(payload["confidence"]),
                status="active",
                created_at=now,
                updated_at=now,
                last_confirmed=now
            )
            db.add(b)
            await db.flush()
            b.embedding_id = f"belief_{b.id}"
            predicate_to_belief_id[b.predicate_key] = b.id
            
            pending_chroma_ops.append({
                "action": "store",
                "fact_id": b.embedding_id,
                "content": b.statement,
                "category": f"belief_{b.belief_type}",
                "importance": b.confidence,
                "metadata_extra": {
                    "source": "dream_belief_extraction",
                    "predicate_key": b.predicate_key,
                    "belief_subject": "user"
                }
            })
            stats["beliefs_extracted"] += 1
            
        elif m.op == "evidence_add":
            pred_key = payload["belief_predicate_key"]
            b_id = predicate_to_belief_id.get(pred_key)
            if not b_id:
                b_id_res = await db.execute(select(Belief.id).where(and_(Belief.predicate_key == pred_key, Belief.status == "active")))
                b_id = b_id_res.scalar_one_or_none()
                
            if b_id:
                source_type = payload["source_type"]
                source_id = payload.get("source_id")
                if source_type == "semantic" and "source_sim_index" in payload:
                    sim_idx = payload["source_sim_index"]
                    if 0 <= sim_idx < len(created_semantics_ids):
                        source_id = created_semantics_ids[sim_idx]
                        
                if source_id:
                    ev = BeliefEvidence(
                        belief_id=b_id,
                        source_type=source_type,
                        source_id=source_id,
                        polarity=payload["polarity"],
                        weight=payload.get("weight", 1.0),
                        added_at=now
                    )
                    db.add(ev)
                    
        elif m.op == "logodds_delta":
            pred_key = payload["predicate_key"]
            b_stmt = select(Belief).where(and_(Belief.predicate_key == pred_key, Belief.status == "active"))
            b_res = await db.execute(b_stmt)
            b = b_res.scalar_one_or_none()
            if b:
                b.log_odds += payload["delta_log_odds"]
                b.confidence = sigmoid(b.log_odds)
                b.updated_at = now
                
                if b.embedding_id:
                    pending_chroma_ops.append({
                        "action": "store",
                        "fact_id": b.embedding_id,
                        "content": b.statement,
                        "category": f"belief_{b.belief_type}",
                        "importance": b.confidence,
                        "metadata_extra": {
                            "predicate_key": b.predicate_key,
                            "updated_at_ts": now
                        }
                    })
                    
        elif m.op == "supersede":
            pred_key_old = payload["predicate_key_old"]
            pred_key_new = payload["predicate_key_new"]
            
            old_stmt = select(Belief).where(and_(Belief.predicate_key == pred_key_old, Belief.status == "active"))
            old_b = (await db.execute(old_stmt)).scalar_one_or_none()
            
            new_id = predicate_to_belief_id.get(pred_key_new)
            if not new_id:
                new_stmt = select(Belief.id).where(and_(Belief.predicate_key == pred_key_new, Belief.status == "active"))
                new_id = (await db.execute(new_stmt)).scalar_one_or_none()
                
            if old_b and new_id:
                old_b.status = "superseded"
                old_b.superseded_by = new_id
                old_b.updated_at = now
                if old_b.embedding_id:
                    pending_chroma_ops.append({
                        "action": "seal",
                        "fact_id": old_b.embedding_id
                    })
                    
        elif m.op == "contradiction_open":
            pred_key = payload["predicate_key"]
            old_stmt = select(Belief).where(and_(Belief.predicate_key == pred_key, Belief.status == "active"))
            old_b = (await db.execute(old_stmt)).scalar_one_or_none()
            
            if old_b:
                conflict_b = Belief(
                    subject="user",
                    statement=payload["statement_candidate"],
                    predicate_key=pred_key,
                    value=payload["value_candidate"],
                    belief_type=old_b.belief_type,
                    confidence=payload["confidence_candidate"],
                    log_odds=logit(payload["confidence_candidate"]),
                    status="inactive",
                    created_at=now,
                    updated_at=now
                )
                db.add(conflict_b)
                await db.flush()
                
                contradiction = Contradiction(
                    belief_a=old_b.id,
                    belief_b=conflict_b.id,
                    kind="conflict",
                    status="open",
                    resolution=payload["reasoning"],
                    detected_at=now
                )
                db.add(contradiction)
                stats["contradictions_found"] += 1
                
        elif m.op == "hypothesis_insert":
            pred_key = payload["predicate_key"]
            b_id = predicate_to_belief_id.get(pred_key)
            if not b_id:
                b_stmt = select(Belief.id).where(and_(Belief.predicate_key == pred_key, Belief.status == "active"))
                b_id = (await db.execute(b_stmt)).scalar_one_or_none()
                
            if b_id:
                hyp = Hypothesis(
                    belief_id=b_id,
                    text=payload["text"],
                    test_mode=payload["test_mode"],
                    probe_hint=payload.get("probe_hint"),
                    status="pending",
                    created_at=now
                )
                db.add(hyp)
                stats["probes_generated"] += 1
                
    if job.batch_lo <= job.batch_hi:
        await db.execute(
            update(Episode)
            .where(and_(Episode.id >= job.batch_lo, Episode.id <= job.batch_hi))
            .values(dream_processed=1)
        )
        stats["episodes_processed"] = job.batch_hi - job.batch_lo + 1
        
    await db.execute(
        update(ReflectionQueue)
        .where(and_(ReflectionQueue.consumed == 0, ReflectionQueue.created_at <= job.started_at))
        .values(consumed=1)
    )
    
    job.phase = "done"
    job.committed_at = now
    await db.commit()
    
    for op in pending_chroma_ops:
        try:
            if op["action"] == "store":
                await strategic_memory.store_fact(
                    user_id=user_id,
                    fact_id=op["fact_id"],
                    content=op["content"],
                    category=op["category"],
                    importance=op["importance"],
                    metadata_extra=op.get("metadata_extra")
                )
            elif op["action"] == "seal":
                await strategic_memory.seal_fact(user_id, op["fact_id"])
        except Exception as exc:
            logger.warning("Post-commit ChromaDB sync failed for op %s: %s", op, exc)
            
    return {"status": "success", "stats": stats}


async def dream_reflect(db: AsyncSession, user_id: str) -> Dict[str, Any]:
    """Runs the transactional 5-stage DREAM reflection cycle on SQLite + ChromaDB."""
    await reclaim_abandoned_jobs(db)
    
    is_ok, reason = await dream_admissible(db)
    if not is_ok:
        return {"status": "skipped", "reason": reason}
        
    resume_stmt = select(DreamJob).where(DreamJob.phase == "planning").order_by(DreamJob.started_at.desc()).limit(1)
    resume_res = await db.execute(resume_stmt)
    job = resume_res.scalar_one_or_none()
    
    now = time.time()
    batch_size = await get_adaptive_batch_size()
    
    if not job:
        last_cons_stmt = select(Episode.id).where(Episode.dream_processed == 1).order_by(Episode.id.desc()).limit(1)
        last_cons_res = await db.execute(last_cons_stmt)
        last_cons_id = last_cons_res.scalar_one_or_none() or 0
        batch_lo = last_cons_id + 1
        
        max_stmt = select(Episode.id).where(Episode.dream_processed == 0).order_by(Episode.id.asc()).limit(batch_size)
        max_res = await db.execute(max_stmt)
        ep_ids = max_res.scalars().all()
        
        if not ep_ids:
            pending_hints = (await db.execute(select(func.count(ReflectionQueue.id)).where(ReflectionQueue.consumed == 0))).scalar() or 0
            if pending_hints == 0:
                return {"status": "idle", "reason": "No unprocessed data"}
            batch_hi = batch_lo - 1
        else:
            batch_hi = ep_ids[-1]
            
        job = DreamJob(
            started_at=now,
            phase="planning",
            stage="start",
            batch_lo=batch_lo,
            batch_hi=batch_hi,
            heartbeat=now
        )
        db.add(job)
        await db.commit()
        await db.refresh(job)
        
    episodes = []
    if job.batch_lo <= job.batch_hi:
        ep_stmt = select(Episode).where(and_(Episode.id >= job.batch_lo, Episode.id <= job.batch_hi)).order_by(Episode.ts.asc())
        ep_res = await db.execute(ep_stmt)
        episodes = ep_res.scalars().all()
        
    hint_stmt = select(ReflectionQueue).where(
        and_(
            ReflectionQueue.consumed == 0,
            ReflectionQueue.created_at <= job.started_at
        )
    ).order_by(ReflectionQueue.priority.desc(), ReflectionQueue.created_at.asc()).limit(50)
    hint_res = await db.execute(hint_stmt)
    hints = hint_res.scalars().all()
    
    transcript_lines = []
    for ep in episodes:
        prosody_info = f" [prosody: {ep.prosody}]" if ep.prosody else ""
        transcript_lines.append(f"[{ep.role}]: {ep.content}{prosody_info}")
    transcript_text = "\n".join(transcript_lines)
    
    hints_summary = "\n".join([f"- Type: {h.kind}, Payload: {h.payload}" for h in hints])
    
    seq = 0
    ex_mut_stmt = select(DreamMutation).where(DreamMutation.job_id == job.id).order_by(DreamMutation.seq.asc())
    ex_mut_res = await db.execute(ex_mut_stmt)
    existing_mutations = ex_mut_res.scalars().all()
    if existing_mutations:
        seq = existing_mutations[-1].seq + 1
        
    def queue_mutation(op: str, payload: dict, precond: Optional[dict] = None):
        nonlocal seq
        mut = DreamMutation(
            job_id=job.id,
            seq=seq,
            op=op,
            precond=json.dumps(precond) if precond else None,
            payload=json.dumps(payload)
        )
        db.add(mut)
        seq += 1
        
    async def update_heartbeat_and_check_yield(current_stage: str) -> bool:
        job.stage = current_stage
        job.heartbeat = time.time()
        await db.commit()
        
        ok, _ = await dream_admissible(db)
        if not ok:
            job.phase = "aborted"
            await db.commit()
            logger.info("DREAM: User active or thermal pressure during stage %s. Aborting job %d.", current_stage, job.id)
            return True
        return False
        
    if job.stage in ("start",):
        summaries = []
        if episodes:
            prompt_1 = (
                "Ти — підсистема консолідації пам'яті автономної ОС. "
                "Нижче наведено батч діалогів користувача з асистентом, включаючи просодичні дані мовлення (valence, arousal, fatigue) та чергу рефлексії.\n\n"
                f"--- ТРАНСКРИПТ ДІАЛОГУ ---\n{transcript_text}\n\n"
                f"--- ЧЕРГА РЕФЛЕКСІЇ ---\n{hints_summary}\n\n"
                "Виведи 1-5 стійких довгострокових узагальнень про звички, уподобання або стан користувача, які мають цінність у майбутньому. Уникай ситуативних фактів. "
                "Кожному узагальненню присвой topic_key та оцінку важливості importance (0..1).\n\n"
                "Поверни результат ТІЛЬКИ у форматі JSON-масиву:\n"
                "[{\"statement\": \"...\", \"topic_key\": \"...\", \"importance\": 0.8}]\n"
                "Не додавай жодних інших пояснень, markdown-тегів чи вступного тексту."
            )
            try:
                resp_1 = await ai_hub.dispatch(
                    "chat_subtask",
                    {"user_message": prompt_1, "system_prompt": "You are a memory consolidation engine.", "history": [], "user_id": user_id},
                    provider_hint="gemini-flash"
                )
                raw_json = resp_1.content.strip().strip("`").strip("json").strip()
                summaries = json.loads(raw_json)
            except Exception as exc:
                logger.error("DREAM Phase 1 Consolidation failed: %s", exc)
                
            for item in summaries:
                statement = item.get("statement")
                topic_key = item.get("topic_key", "general")
                importance = float(item.get("importance", 0.5))
                if statement:
                    queue_mutation("semantic_upsert", {
                        "statement": statement,
                        "topic_key": topic_key,
                        "importance": importance
                    })
                    
        if await update_heartbeat_and_check_yield("summarize"):
            return {"status": "aborted", "reason": "yielded"}
            
    sem_mut_stmt = select(DreamMutation).where(and_(DreamMutation.job_id == job.id, DreamMutation.op == "semantic_upsert")).order_by(DreamMutation.seq.asc())
    sem_mut_res = await db.execute(sem_mut_stmt)
    sem_muts = sem_mut_res.scalars().all()
    
    created_semantics_data = []
    for idx, m in enumerate(sem_muts):
        payload = json.loads(m.payload)
        created_semantics_data.append({
            "sim_index": idx,
            "topic_key": payload.get("topic_key", "general"),
            "statement": payload["statement"]
        })
        
    if job.stage in ("summarize", "start"):
        candidates = []
        if created_semantics_data:
            semantics_text = "\n".join([f"- [Simulated Index {s['sim_index']}] Topic: {s['topic_key']}, Fact: {s['statement']}" for s in created_semantics_data])
            prompt_2 = (
                "Ти — підсистема оновлення моделі користувача (Theory of Mind).\n"
                f"На основі наступних нових консолідованих фактів:\n{semantics_text}\n\n"
                "Сформулюй 1-3 високорівневі ToM-переконання (beliefs) про користувача.\n"
                "Поверни результат ТІЛЬКИ у форматі JSON-масиву:\n"
                "[\n"
                "  {\n"
                "    \"statement\": \"опис переконання природною мовою\",\n"
                "    \"belief_type\": \"goal|preference|trait|open_loop|knowledge_gap|trigger\",\n"
                "    \"predicate_key\": \"унікальний_код_для_колізій (напр., preferred_sleep_time)\",\n"
                "    \"value\": \"нормалізоване значення (напр., night_owl)\",\n"
                "    \"confidence\": 0.8,\n"
                "    \"evidence_source_index\": Simulated_Index_факту_з_переліку\n"
                "  }\n"
                "]\n"
                "Не додавай жодних інших символів."
            )
            try:
                resp_2 = await ai_hub.dispatch(
                    "chat_subtask",
                    {"user_message": prompt_2, "system_prompt": "You are a Theory-of-Mind extractor.", "history": [], "user_id": user_id},
                    provider_hint="gemini-flash"
                )
                raw_json_2 = resp_2.content.strip().strip("`").strip("json").strip()
                candidates = json.loads(raw_json_2)
            except Exception as exc:
                logger.error("DREAM Phase 2 Belief Extraction failed: %s", exc)
                
            for c in candidates:
                pred_key = c.get("predicate_key")
                statement = c.get("statement")
                b_type = c.get("belief_type", "preference")
                val = c.get("value")
                confidence = float(c.get("confidence", 0.5))
                source_idx = c.get("evidence_source_index")
                
                if not pred_key or not statement:
                    continue
                    
                existing_stmt = select(Belief).where(and_(Belief.predicate_key == pred_key, Belief.status == "active"))
                existing = (await db.execute(existing_stmt)).scalar_one_or_none()
                
                if not existing:
                    queue_mutation("belief_insert", {
                        "statement": statement,
                        "predicate_key": pred_key,
                        "value": val,
                        "belief_type": b_type,
                        "confidence": confidence
                    })
                    if source_idx is not None:
                        queue_mutation("evidence_add", {
                            "belief_predicate_key": pred_key,
                            "source_type": "semantic",
                            "source_sim_index": int(source_idx),
                            "polarity": 1,
                            "weight": 1.0
                        })
                else:
                    prompt_3 = (
                        "Ти — підсистема вирішення суперечностей у Theory of Mind.\n"
                        "Наявне переконання про користувача:\n"
                        f"- Текст: \"{existing.statement}\" (впевненість={existing.confidence:.2f})\n\n"
                        "Новий кандидат на переконання:\n"
                        f"- Текст: \"{statement}\" (впевненість={confidence:.2f})\n\n"
                        f"Спільний ключ колізії predicate_key = \"{pred_key}\".\n"
                        "Класифікуй взаємодію між ними у форматі JSON:\n"
                        "{\n"
                        "  \"verdict\": \"UPDATE | REFINEMENT | CONFLICT\",\n"
                        "  \"delta_log_odds_existing\": float,\n"
                        "  \"delta_log_odds_candidate\": float,\n"
                        "  \"reasoning\": \"коротке пояснення рішення\"\n"
                        "}\n"
                        "Поверни результат ТІЛЬКИ як чистий JSON."
                    )
                    try:
                        resp_3 = await ai_hub.dispatch(
                            "chat_subtask",
                            {"user_message": prompt_3, "system_prompt": "You are a cognitive conflict resolver.", "history": [], "user_id": user_id},
                            provider_hint="gemini-flash"
                        )
                        raw_json_3 = resp_3.content.strip().strip("`").strip("json").strip()
                        resolution = json.loads(raw_json_3)
                        
                        verdict = resolution.get("verdict", "CONFLICT")
                        delta_existing = float(resolution.get("delta_log_odds_existing", 0.0))
                        delta_candidate = float(resolution.get("delta_log_odds_candidate", 0.0))
                        reasoning = resolution.get("reasoning", "Conflict resolution analysis")
                        
                        if verdict == "UPDATE":
                            precond = {"predicate_key": pred_key, "max_confidence": existing.confidence}
                            queue_mutation("belief_insert", {
                                "statement": statement,
                                "predicate_key": pred_key,
                                "value": val,
                                "belief_type": b_type,
                                "confidence": sigmoid(delta_candidate)
                            })
                            queue_mutation("supersede", {
                                "predicate_key_old": pred_key,
                                "predicate_key_new": pred_key
                            }, precond=precond)
                            
                        elif verdict == "REFINEMENT":
                            queue_mutation("logodds_delta", {
                                "predicate_key": pred_key,
                                "delta_log_odds": delta_existing
                            })
                            
                        elif verdict == "CONFLICT":
                            queue_mutation("logodds_delta", {
                                "predicate_key": pred_key,
                                "delta_log_odds": delta_existing
                            })
                            queue_mutation("contradiction_open", {
                                "predicate_key": pred_key,
                                "statement_candidate": statement,
                                "value_candidate": val,
                                "confidence_candidate": sigmoid(delta_candidate),
                                "reasoning": reasoning
                            })
                    except Exception as exc:
                        logger.error("DREAM Phase 3 Contradiction Resolution failed: %s", exc)
                        
        if await update_heartbeat_and_check_yield("beliefs"):
            return {"status": "aborted", "reason": "yielded"}
            
    if job.stage in ("beliefs", "summarize", "start"):
        weak_stmt = select(Belief).where(and_(Belief.status == "active", Belief.confidence < 0.60))
        weak_res = await db.execute(weak_stmt)
        weak_beliefs = weak_res.scalars().all()
        
        if weak_beliefs:
            weak_list_text = "\n".join([f"- [{b.predicate_key}] Text: {b.statement} (confidence: {b.confidence:.2f})" for b in weak_beliefs])
            prompt_4 = (
                "Ти — підсистема активного діалогового тестування (conversational probing) у ToM.\n"
                "Нижче наведено переконання з низькою впевненістю, які потребують з'ясування:\n"
                f"{weak_list_text}\n\n"
                "Згенеруй для кожного гіпотезу перевірки у форматі JSON:\n"
                "[\n"
                "  {\n"
                "    \"predicate_key\": \"ключ_переконання\",\n"
                "    \"text\": \"що саме потрібно з'ясувати для калібрування\",\n"
                "    \"test_mode\": \"active_probe\",\n"
                "    \"probe_hint\": \"інструкція для TURN-білдера: як природно запитати про це\"\n"
                "  }\n"
                "]\n"
                "Поверни результат ТІЛЬКИ як JSON."
            )
            try:
                resp_4 = await ai_hub.dispatch(
                    "chat_subtask",
                    {"user_message": prompt_4, "system_prompt": "You are a dialogue probe generator.", "history": [], "user_id": user_id},
                    provider_hint="gemini-flash"
                )
                raw_json_4 = resp_4.content.strip().strip("`").strip("json").strip()
                hyp_candidates = json.loads(raw_json_4)
                for h in hyp_candidates:
                    queue_mutation("hypothesis_insert", {
                        "predicate_key": h["predicate_key"],
                        "text": h["text"],
                        "test_mode": h.get("test_mode", "active_probe"),
                        "probe_hint": h.get("probe_hint")
                    })
            except Exception as exc:
                logger.error("DREAM Phase 4 Probing Hypothesis failed: %s", exc)
                
        job.phase = "applying"
        job.stage = "hypotheses"
        job.heartbeat = time.time()
        await db.commit()
        
    apply_result = await apply_job(db, job.id, user_id)
    
    try:
        await generate_epochs(db, user_id)
        await db.commit()
    except Exception as exc:
        logger.error("Epoch generation failed: %s", exc)
        
    return apply_result


async def reconcile_chroma_embeddings(db: AsyncSession, user_id: str) -> int:
    """Finds active SemanticMemory or Belief records that are not synced to ChromaDB, and syncs them."""
    count = 0
    now = time.time()
    try:
        sem_stmt = select(SemanticMemory).where(SemanticMemory.embedding_id.isnot(None))
        sem_res = await db.execute(sem_stmt)
        semantics = sem_res.scalars().all()
        for sem in semantics:
            try:
                if sem.decay_score > 0.1:
                    await strategic_memory.store_fact(
                        user_id=user_id,
                        fact_id=sem.embedding_id,
                        content=sem.statement,
                        category=sem.topic_key or "general",
                        importance=sem.importance,
                        metadata_extra={
                            "source": "chroma_reconciliation",
                            "reconciled_at": now
                        }
                    )
                    count += 1
            except Exception:
                pass

        belief_stmt = select(Belief).where(and_(Belief.status == "active", Belief.embedding_id.isnot(None)))
        belief_res = await db.execute(belief_stmt)
        beliefs = belief_res.scalars().all()
        for b in beliefs:
            try:
                await strategic_memory.store_fact(
                    user_id=user_id,
                    fact_id=b.embedding_id,
                    content=b.statement,
                    category=f"belief_{b.belief_type}",
                    importance=b.confidence,
                    metadata_extra={
                        "source": "chroma_reconciliation",
                        "predicate_key": b.predicate_key,
                        "reconciled_at": now
                    }
                )
                count += 1
            except Exception:
                pass
    except Exception as exc:
        logger.error("ChromaDB reconciliation cycle failed: %s", exc)

    return count


async def generate_epochs(db: AsyncSession, user_id: str) -> None:
    """Clusters processed episodes into chronological windows to form relationship epochs."""
    stmt = select(Episode).order_by(Episode.ts.asc()).limit(1)
    res = await db.execute(stmt)
    earliest_ep = res.scalar_one_or_none()
    if not earliest_ep:
        return

    WINDOW_SIZE = 3 * 24 * 3600
    start_time = earliest_ep.ts
    now = time.time()

    current_start = start_time
    while current_start < now:
        current_end = current_start + WINDOW_SIZE

        epoch_stmt = select(Epoch).where(
            and_(
                Epoch.start_time >= current_start - 1.0,
                Epoch.start_time <= current_start + 1.0
            )
        )
        epoch_res = await db.execute(epoch_stmt)
        existing = epoch_res.scalar_one_or_none()

        if not existing:
            ep_count_stmt = select(Episode).where(
                and_(
                    Episode.ts >= current_start,
                    Episode.ts <= current_end
                )
            )
            ep_res = await db.execute(ep_count_stmt)
            episodes = ep_res.scalars().all()
            if not episodes:
                current_start = current_end
                continue

            sem_stmt = select(SemanticMemory).where(
                and_(
                    SemanticMemory.created_at >= current_start,
                    SemanticMemory.created_at <= current_end
                )
            )
            sem_res = await db.execute(sem_stmt)
            semantics = sem_res.scalars().all()

            belief_stmt = select(Belief).where(
                and_(
                    Belief.created_at >= current_start,
                    Belief.created_at <= current_end
                )
            )
            belief_res = await db.execute(belief_stmt)
            beliefs = belief_res.scalars().all()

            statements = [sm.statement for sm in semantics] + [b.statement for b in beliefs]
            if not statements:
                statements = [ep.content for ep in episodes[:5]]

            if statements:
                prompt = (
                    "Аналізуй список спогадів та діалогів за епоху стосунків і дай їй коротку описову назву "
                    "(наприклад, 'Період стресу (жовтень)', 'Початок роботи', 'Зміна режиму сну').\n\n"
                    "Спогади/репліки:\n" + "\n".join([f"- {s}" for s in statements[:10]]) + "\n\n"
                    "Поверни ТІЛЬКИ назву (не більше 5 слів). Без лапок та пояснень."
                )
                try:
                    resp = await ai_hub.dispatch(
                        "chat_subtask",
                        {"user_message": prompt, "system_prompt": "You are an epoch chronicler.", "history": [], "user_id": user_id},
                        provider_hint="gemini-flash"
                    )
                    name = resp.content.strip().replace('"', '').strip()
                except Exception as exc:
                    logger.warning("Failed to generate epoch name via LLM: %s", exc)
                    name = f"Епоха ({time.strftime('%Y-%m-%d', time.localtime(current_start))})"

                topics = list(set([s.topic_key for s in semantics if s.topic_key] + [b.belief_type for b in beliefs]))
                if not topics:
                    topics = ["general"]

                epoch = Epoch(
                    name=name,
                    start_time=current_start,
                    end_time=current_end,
                    topic_summary=json.dumps(topics),
                    status="active",
                    created_at=time.time()
                )
                db.add(epoch)
                await db.flush()
                logger.info("Created Epoch: %s (%f - %f)", name, current_start, current_end)

        current_start = current_end
