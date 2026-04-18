"""Self-model builder — minimal structured self-awareness for the planner."""
from __future__ import annotations

import logging
import os

from sqlalchemy import select

from config import config
from db.database import get_session
from db.models import AgentMemorySeed

from .actions.registry import ActionRegistry
from .schemas import RiskLevel, SelfModel

logger = logging.getLogger(__name__)


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


async def build_self_model(registry: ActionRegistry) -> SelfModel:
    raw_tolerance = max(1, min(7, int(config.agent_risk_tolerance)))
    # Snap to a known enum value (1/3/5/7) — pick the highest level not over the raw cap.
    rt_value = max((lvl for lvl in (RiskLevel.SAFE, RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.HIGH)
                    if int(lvl) <= raw_tolerance), default=RiskLevel.SAFE)

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
    )


def _firejail_present() -> bool:
    from .safety.sandbox import firejail_available
    return firejail_available()
