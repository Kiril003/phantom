"""Self-model builder — minimal structured self-awareness for the planner."""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from config import config
from db.database import get_session
from db.models import AgentMemorySeed

from ..actions.registry import ActionRegistry
from ..schemas import Relationship, RiskLevel, SelfModel

logger = logging.getLogger(__name__)


# Phase 9.3a — FIFO caps.
_MAX_ACTIVE_CONCERNS = 10
_MAX_RECENT_SUCCESSES = 5
_MAX_KNOWN_PREFERENCES = 10
_CONCERN_DECAY_HOURS = 24

# Heuristic concern-extraction patterns. Intentionally simple (regex, no
# LLM classification) so 9.3a doesn't add LLM calls to chat message
# handling. 9.3b may replace with an async classification task.
_CONCERN_PATTERNS: dict[str, str] = {
    r"сумно|грусн|пригніч": "user mentioned feeling down",
    r"втомив|виснажен|устал": "user mentioned fatigue",
    r"хвор|погано себе|нездужа": "user mentioned not feeling well",
}


def get_or_create_relationship(self_model: SelfModel, user_id: str) -> Relationship:
    """Return (and create if missing) the Relationship for `user_id`."""
    rel = self_model.relationships.get(user_id)
    if rel is None:
        rel = Relationship(user_id=user_id)
        self_model.relationships[user_id] = rel
    return rel


def note_interaction(self_model: SelfModel, user_id: str) -> None:
    """Bump interaction counter + timestamp for `user_id`. Hook this into the
    authenticated-call dependency so every agent-adjacent request increments.
    """
    rel = get_or_create_relationship(self_model, user_id)
    rel.interaction_count += 1
    rel.last_interaction_at = datetime.now(tz=timezone.utc)


def update_known_preference(self_model: SelfModel, user_id: str, preference: str) -> None:
    """Append a preference to the user's Relationship. Dedups + caps at 10."""
    rel = get_or_create_relationship(self_model, user_id)
    if preference in rel.known_preferences:
        return
    rel.known_preferences.append(preference)
    if len(rel.known_preferences) > _MAX_KNOWN_PREFERENCES:
        rel.known_preferences = rel.known_preferences[-_MAX_KNOWN_PREFERENCES:]


def add_concern(self_model: SelfModel, concern: str) -> None:
    """FIFO add with dedup + cap. Existing concerns are refreshed to the end
    so a re-raised worry doesn't get pushed out by rotation.

    Phase 9.3b — pushes a CONCERN_ADDED trigger into the proactive loop
    iff the concern is genuinely new (not just a refresh). Best-effort.
    """
    is_new = concern not in self_model.active_concerns
    if not is_new:
        # Refresh by moving to the end.
        self_model.active_concerns.remove(concern)
    self_model.active_concerns.append(concern)
    if len(self_model.active_concerns) > _MAX_ACTIVE_CONCERNS:
        self_model.active_concerns = self_model.active_concerns[-_MAX_ACTIVE_CONCERNS:]
    if is_new:
        try:
            from .proactive import get_loop
            from .proactive_triggers import ProactiveTrigger, ProactiveTriggerKind
            loop = get_loop()
            if loop is not None:
                loop.push_trigger(ProactiveTrigger(
                    kind=ProactiveTriggerKind.CONCERN_ADDED,
                    context={"concern": concern[:200]},
                    priority=6,
                ))
        except Exception as exc:
            logger.debug("proactive trigger push on add_concern failed: %s", exc)


def record_success(self_model: SelfModel, task_summary: str) -> None:
    """FIFO append to recent_successes, max 5 items."""
    if not task_summary:
        return
    self_model.recent_successes.append(task_summary[:200])
    if len(self_model.recent_successes) > _MAX_RECENT_SUCCESSES:
        self_model.recent_successes = self_model.recent_successes[-_MAX_RECENT_SUCCESSES:]


def maybe_add_concern_from_user_text(self_model: SelfModel, text: str) -> list[str]:
    """Scan Ukrainian user text for keyword hints; add each matched concern.
    Returns the list of concerns that were added this call (empty when none).
    """
    if not text:
        return []
    low = text.lower()
    added: list[str] = []
    for pattern, concern in _CONCERN_PATTERNS.items():
        if re.search(pattern, low) and concern not in self_model.active_concerns:
            add_concern(self_model, concern)
            added.append(concern)
    return added


def decay_stale_concerns(
    self_model: SelfModel,
    now: datetime | None = None,
    *,
    last_refresh: dict[str, datetime] | None = None,
) -> int:
    """Drop concerns whose last-refresh timestamp is older than 24h.

    `last_refresh` is an optional per-concern timestamp map; when omitted
    (current call-site), no concerns are dropped — this function exists for
    9.3b when the runtime will carry refresh timestamps alongside concerns.
    Returns the number of concerns removed.
    """
    if last_refresh is None:
        return 0
    now = now or datetime.now(tz=timezone.utc)
    cutoff = now - timedelta(hours=_CONCERN_DECAY_HOURS)
    stale = [c for c in self_model.active_concerns
             if (last_refresh.get(c) or now) < cutoff]
    if not stale:
        return 0
    self_model.active_concerns = [
        c for c in self_model.active_concerns if c not in stale
    ]
    return len(stale)


def _probe_camera() -> bool:
    return os.path.exists("/dev/video0")


def _probe_serial() -> bool:
    return os.path.exists(config.sensor_serial_port)


def _probe_microphone() -> bool:
    # PulseAudio / ALSA presence — best-effort guess.
    return os.path.exists("/dev/snd") or os.path.exists("/dev/audio")


async def _last_memory_seed_summary() -> str | None:
    try:
        async with get_session() as db:
            result = await db.execute(
                select(AgentMemorySeed).order_by(AgentMemorySeed.created_at.desc()).limit(1)
            )
            seed = result.scalar_one_or_none()
            return seed.summary if seed else None
    except Exception as exc:
        logger.debug("self_model: memory seed lookup failed: %s", exc)
        return None


def _list_active_ws_clients() -> list[str]:
    try:
        from api.websocket_hub import hub
        return [str(cid) for cid in list(hub._clients.keys())]
    except Exception:
        return []


async def build_self_model(
    registry: ActionRegistry,
    *,
    role_id: str | None = None,
) -> SelfModel:
    raw_tolerance = max(1, min(7, int(config.agent_risk_tolerance)))
    # Snap to a known enum value (1/3/5/7) — pick the highest level not over the raw cap.
    rt_value = max((lvl for lvl in (RiskLevel.SAFE, RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.HIGH)
                    if int(lvl) <= raw_tolerance), default=RiskLevel.SAFE)

    # Phase 30 — Org-Chart context resolution
    role_context = None
    if role_id:
        try:
            from .org_chart import get_org_chart
            chart = await get_org_chart()
            role = next((r for r in chart.roles if r.id == role_id), None)
            if role:
                role_context = {
                    "name": role.name,
                    "description": role.description,
                    "standing_orders": role.standing_orders,
                    "system_prompt_extension": role.system_prompt_extension,
                }
        except Exception as exc:
            logger.debug("self_model: org_chart lookup failed for role %s: %s", role_id, exc)

    return SelfModel(
        identity=(
            "Я PHANTOM — вбудована операційна система зі штучним інтелектом. "
            "Живу на пристрої користувача, маю доступ до сенсорів, мережі та екрану. "
            "Моя мета — бути корисним присутнім інтелектом, а не просто асистентом."
        ),
        hardware={
            "radxa_dragon_q6a": True,
            "esp32_serial_port": _probe_serial() and config.serial_enabled,
            "camera_available": _probe_camera() and config.face_tracking_enabled,
            "microphone_available": _probe_microphone(),
            "firejail_sandbox": _firejail_present(),
        },
        capabilities=[cls.name for cls in registry.all()],
        risk_tolerance=rt_value,
        current_track="foreground",
        active_connections=_list_active_ws_clients(),
        recent_task_summary=await _last_memory_seed_summary(),
        language_primary=str(config.agent_language_primary),
        language_fallback=str(config.agent_language_fallback),
        agent_role_id=role_id,
        agent_role_context=role_context,
    )


def _firejail_present() -> bool:
    from ..operations.safety.sandbox import firejail_available
    return firejail_available()
