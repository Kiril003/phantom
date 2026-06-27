"""
Values doctrine system (Will Engine v1).
Evaluates action intent against defined core values.
"""
from __future__ import annotations

import hashlib
import logging
import os
import time
from typing import Optional

from pydantic import BaseModel, Field

from agent.cognition.planner._llm import llm_json

logger = logging.getLogger(__name__)

# The doctrine lives next to this module; resolve absolutely so loading is
# independent of the process CWD (uvicorn, pytest, and CLI all differ).
_DOCTRINE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "values.md")


class ValueVerdict(BaseModel):
    aligned: bool
    conflicts: list[str] = Field(default_factory=list)
    confidence: float = 1.0
    rationale: str = ""


class ValuesSystem:
    """Manages the values doctrine and evaluates alignment."""

    def __init__(self, values_path: str = _DOCTRINE_PATH) -> None:
        self.values_path = values_path
        self._cache: dict[str, tuple[float, ValueVerdict]] = {}
        self._cache_ttl = 60.0  # seconds

    def _load_doctrine(self) -> str:
        """Load values from values.md."""
        try:
            if os.path.exists(self.values_path):
                with open(self.values_path, "r", encoding="utf-8") as f:
                    return f.read()
        except Exception as exc:
            logger.warning("ValuesSystem: failed to load values.md: %s", exc)
        return "Core Values: Ukraine First, Quality > Speed, Transparency Always."

    async def evaluate(self, action_intent: str, *, task_id: str | None = None) -> ValueVerdict:
        """Evaluate if an action intent aligns with core values."""
        # Check cache
        key = hashlib.sha256(action_intent.encode("utf-8")).hexdigest()
        now = time.time()
        if key in self._cache:
            ts, verdict = self._cache[key]
            if now - ts < self._cache_ttl:
                return verdict

        doctrine = self._load_doctrine()
        prompt = f"""
Ти — охоронець цінностей PHANTOM. Твоє завдання — оцінити, чи відповідає намір дії
нашій Доктрині Цінностей.

ДОКТРИНА ЦІННОСТЕЙ:
{doctrine}

НАМІР ДІЇ:
"{action_intent}"

Оціни відповідність. Якщо дія прямо суперечить цінностям (наприклад, шкодить Україні,
приховує інформацію від оператора або є свідомо неякісною/небезпечною), встанови aligned=false.

Відповідай ТІЛЬКИ чистим JSON:
{{
  "aligned": true/false,
  "conflicts": ["назва цінності", ...],
  "confidence": 0.0..1.0,
  "rationale": "коротке пояснення"
}}
"""
        try:
            data = await llm_json(prompt, task_id=task_id)
            verdict = ValueVerdict(**data)
            self._cache[key] = (now, verdict)
            return verdict
        except Exception as exc:
            logger.warning("ValuesSystem.evaluate failed: %s", exc)
            # Default to aligned if LLM fails (to avoid blocking everything)
            return ValueVerdict(aligned=True, confidence=0.0, rationale=f"Evaluation failed: {exc}")


# Singleton
values_system = ValuesSystem()
