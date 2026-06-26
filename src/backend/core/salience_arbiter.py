"""Phase 36 — Salience Arbiter.
Centralized notification arbiter evaluating proactive triggers (DREAM insights,
physiology, and critical system events) against state interruption budgets
and user trust credit.
"""
from __future__ import annotations
import json
import logging
import time
import uuid
from typing import Optional, Dict, Any
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import ChatMessage, Setting, ChatSession
from db.tom_models import ReflectionQueue
from core.state_machine import state_machine, SystemState
from core.context_engine import context_engine

logger = logging.getLogger(__name__)


def get_event_tier(kind: str) -> int:
    """Map trigger event kinds to Tiers.
    Tier 2: Urgent/physiological (can interrupt)
    Tier 1: Hints/nudges (silent, woven into chat)
    Tier 0: DREAM/ambient (early morning briefing)
    """
    tier_map = {
        "pulse_spike": 2,
        "security_alert": 2,
        "critical_battery": 2,
        "deadline_panic": 2,
        "task_nudge": 1,
        "active_probe": 1,
        "dream_insight": 0,
    }
    return tier_map.get(kind, 0)


async def get_trust_credit(db: AsyncSession) -> float:
    """Retrieve the accumulated user trust credit from Settings."""
    stmt = select(Setting).where(Setting.key == "salience_trust_credit")
    res = await db.execute(stmt)
    setting = res.scalar_one_or_none()
    if setting:
        try:
            return float(json.loads(setting.value_json))
        except Exception:
            pass
    return 5.0


async def set_trust_credit(db: AsyncSession, credit: float) -> None:
    """Save the updated trust credit to Settings."""
    credit = max(1.0, min(10.0, credit))
    stmt = select(Setting).where(Setting.key == "salience_trust_credit")
    res = await db.execute(stmt)
    setting = res.scalar_one_or_none()
    if setting:
        setting.value_json = json.dumps(credit)
    else:
        setting = Setting(
            key="salience_trust_credit",
            value_json=json.dumps(credit)
        )
        db.add(setting)
    await db.flush()


from datetime import datetime, timezone

async def get_active_session_id(db: AsyncSession, user_id: str) -> str:
    """Get the latest updated session ID or create a fallback one."""
    stmt = select(ChatSession).where(ChatSession.user_id == user_id).order_by(desc(ChatSession.started_at)).limit(1)
    res = await db.execute(stmt)
    sess = res.scalar_one_or_none()
    if sess:
        return sess.id
    # Create fallback session
    fallback_id = str(uuid.uuid4())
    new_sess = ChatSession(
        id=fallback_id,
        user_id=user_id,
        started_at=datetime.now(timezone.utc)
    )
    db.add(new_sess)
    await db.flush()
    return fallback_id


async def emit_candidate(
    db: AsyncSession,
    user_id: str,
    kind: str,
    content: str,
    salience_score: float,
    metadata: Optional[Dict[str, Any]] = None
) -> bool:
    """Emit a notification candidate into the queue and evaluate if it should interrupt.

    Returns:
        bool: True if interruption is allowed and triggered, False otherwise.
    """
    now = time.time()
    tier = get_event_tier(kind)

    # 1. Persist the candidate in reflection_queue for historical tracing
    queue_item = ReflectionQueue(
        kind="salience_candidate",
        payload=json.dumps({
            "user_id": user_id,
            "event_kind": kind,
            "content": content,
            "salience_score": salience_score,
            "tier": tier,
            "metadata": metadata or {}
        }),
        priority=0 if tier < 2 else 2,
        created_at=now,
        consumed=0
    )
    db.add(queue_item)
    await db.flush()

    # 2. Evaluate right to interrupt
    trust_credit = await get_trust_credit(db)
    snap = context_engine.get_snapshot()
    
    # Check if stress is exceptionally high (> 0.8) indicating panic
    stress = snap.get("body", {}).get("stress_level")
    is_crisis = stress is not None and stress > 0.8

    current_state = snap.get("system", {}).get("state", SystemState.SHADOW)

    # interruption budgets per state: higher means harder to interrupt
    state_budgets = {
        SystemState.FOCUS: 8.0,
        SystemState.SHADOW: 4.0,
        SystemState.DIALOGUE: 2.0,
        SystemState.SENTINEL: 99.0,  # Do not double interrupt
        SystemState.GHOST: 99.0,     # Suppressed
        SystemState.DREAM: 99.0,     # Suppressed
    }

    base_threshold = state_budgets.get(current_state, 5.0)
    if is_crisis:
        # In panic / crisis mode, drop threshold to minimum
        base_threshold = 1.0

    # Threshold shifts lower if trust credit is high, higher if trust is low
    threshold = max(1.0, base_threshold - (trust_credit - 5.0))

    allow_interruption = (tier == 2) and (salience_score >= threshold)

    session_id = await get_active_session_id(db, user_id)

    # 3. Handle delivery
    if allow_interruption:
        logger.info(
            "Salience Arbiter: Interruption ALLOWED. Event: %s, Score: %.1f, Threshold: %.1f, State: %s",
            kind, salience_score, threshold, current_state
        )
        
        # Trigger FSM transition to SENTINEL (which maps to visual indicators)
        if current_state != SystemState.SENTINEL:
            state_machine.force_transition(SystemState.SENTINEL, f"salience_{kind}")
            context_engine.set_state(SystemState.SENTINEL)

        # Store ChatMessage so UI and audio channels can render/synthesize it
        msg = ChatMessage(
            id=str(uuid.uuid4()),
            session_id=session_id,
            user_id=user_id,
            role="assistant",
            content=content,
            response_form="text",
            metadata_json=json.dumps({
                "input_method": "proactive",
                "event_kind": kind,
                "salience_score": salience_score,
                "tier": tier,
                "interrupted": True,
                "timestamp": now
            })
        )
        db.add(msg)
        await db.flush()
        
        # Mark queue item as consumed
        queue_item.consumed = 1
        return True

    else:
        logger.info(
            "Salience Arbiter: Interruption DEFERRED. Event: %s, Score: %.1f, Threshold: %.1f, State: %s",
            kind, salience_score, threshold, current_state
        )
        # Store as a silent proactive item in background (ambient/agenda)
        msg = ChatMessage(
            id=str(uuid.uuid4()),
            session_id=session_id,
            user_id=user_id,
            role="assistant",
            content=content,
            response_form="text",
            metadata_json=json.dumps({
                "input_method": "proactive",
                "event_kind": kind,
                "salience_score": salience_score,
                "tier": tier,
                "interrupted": False,
                "timestamp": now
            })
        )
        db.add(msg)
        await db.flush()
        return False


async def register_notification_feedback(
    db: AsyncSession,
    message_id: str,
    accepted: bool
) -> float:
    """Process feedback for a proactive notification to adjust the trust credit."""
    stmt = select(ChatMessage).where(ChatMessage.id == message_id)
    res = await db.execute(stmt)
    msg = res.scalar_one_or_none()
    if not msg:
        return 5.0

    try:
        meta = json.loads(msg.metadata_json or "{}")
    except Exception:
        meta = {}

    if meta.get("input_method") != "proactive":
        # Only adjust credit for proactive actions
        return await get_trust_credit(db)

    credit = await get_trust_credit(db)
    if accepted:
        # User accepted/engaged with trigger -> increase trust
        credit = min(10.0, credit + 0.5)
        logger.info("Salience Arbiter: Notification accepted. Trust credit increased to %.2f", credit)
    else:
        # User ignored or dismissed trigger -> decrease trust
        credit = max(1.0, credit - 1.0)
        logger.info("Salience Arbiter: Notification ignored/dismissed. Trust credit decreased to %.2f", credit)

    await set_trust_credit(db, credit)
    return credit
