"""
PHANTOM OS — User Behavioral Model.
Tracks trust, honest gap, response patterns, and vocabulary.
Stored as JSON in users.behavioral_model_json.
"""
from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass, field
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

logger = logging.getLogger(__name__)

# ── Default behavioral model ───────────────────────────────────────────────────

@dataclass
class BehavioralModel:
    response_preference: str = ""
    stress_patterns: str = ""
    vocabulary: list[str] = field(default_factory=list)
    decision_style: str = "analytical"
    trust_level: float = 0.5
    honest_gap: float = 0.0
    preferred_topics: list[str] = field(default_factory=list)
    avoid_topics: list[str] = field(default_factory=list)
    interaction_count: int = 0
    days_active: int = 0
    breathing_signature: list[float] | None = None
    language_stats: dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "BehavioralModel":
        known = {f for f in cls.__dataclass_fields__}
        filtered = {k: v for k, v in data.items() if k in known}
        return cls(**filtered)

    @classmethod
    def from_json(cls, json_str: str) -> "BehavioralModel":
        try:
            return cls.from_dict(json.loads(json_str) if json_str else {})
        except Exception:
            return cls()

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False)


# ── Interaction record ─────────────────────────────────────────────────────────

@dataclass
class Interaction:
    followed_advice: bool = False
    cancelled_or_ignored: bool = False
    said_will_do: bool = False
    actually_did: bool = False


# ── Trust update logic ─────────────────────────────────────────────────────────

def update_trust(model: BehavioralModel, interaction: Interaction) -> float:
    """
    Micro-update trust_level and honest_gap based on interaction signals.
    Returns new trust_level (0–1).
    """
    delta = 0.001  # базовий мікро-зріст за кожну взаємодію

    if interaction.followed_advice:
        delta += 0.005
    if interaction.cancelled_or_ignored:
        delta -= 0.003

    # Honest gap: drift між обіцянками та діями
    if interaction.said_will_do and not interaction.actually_did:
        model.honest_gap = min(1.0, model.honest_gap + 0.01)
    elif interaction.actually_did:
        model.honest_gap = max(0.0, model.honest_gap - 0.005)

    model.trust_level = max(0.0, min(1.0, model.trust_level + delta))
    model.interaction_count += 1
    return model.trust_level


# ── Vocabulary learning ────────────────────────────────────────────────────────

def update_vocabulary(model: BehavioralModel, user_text: str) -> None:
    """
    Extract and remember repeated personal vocabulary from user messages.
    Filters out common short words; keeps unusual phrases.
    """
    _SKIP = {
        "і", "та", "в", "на", "з", "по", "до", "для", "не", "як", "що",
        "це", "but", "and", "the", "a", "an", "is", "it", "in", "of", "to",
    }
    words = [w.strip(".,!?\"'()").lower() for w in user_text.split()]
    candidates = [w for w in words if len(w) > 4 and w not in _SKIP]
    for cand in candidates:
        if cand not in model.vocabulary:
            model.vocabulary.append(cand)
    # Keep at most 200 words
    model.vocabulary = model.vocabulary[-200:]


def update_language_stats(model: BehavioralModel, text: str) -> None:
    """
    Simple heuristic: count Cyrillic vs Latin characters to infer language usage.
    """
    cyrillic = sum(1 for c in text if "\u0400" <= c <= "\u04FF")
    latin = sum(1 for c in text if c.isalpha() and c.isascii())
    total = cyrillic + latin
    if total == 0:
        return
    uk_share = cyrillic / total
    en_share = latin / total

    prev_uk = model.language_stats.get("uk", 0.5)
    prev_en = model.language_stats.get("en", 0.5)
    # Exponential moving average (α = 0.1)
    model.language_stats["uk"] = round(prev_uk * 0.9 + uk_share * 0.1, 3)
    model.language_stats["en"] = round(prev_en * 0.9 + en_share * 0.1, 3)


# ── DB helpers ─────────────────────────────────────────────────────────────────

async def get_behavioral_model(db: AsyncSession, user_id: str) -> BehavioralModel:
    """Load BehavioralModel from DB for a given user."""
    from db.models import User

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        logger.warning("get_behavioral_model: user %s not found", user_id)
        return BehavioralModel()
    return BehavioralModel.from_json(user.behavioral_model_json)


async def save_behavioral_model(
    db: AsyncSession, user_id: str, model: BehavioralModel
) -> None:
    """Persist updated BehavioralModel back to DB."""
    from db.models import User

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        logger.warning("save_behavioral_model: user %s not found", user_id)
        return
    user.behavioral_model_json = model.to_json()  # type: ignore[assignment]
    await db.flush()
