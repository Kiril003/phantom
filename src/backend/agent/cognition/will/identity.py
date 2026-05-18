"""
Identity system (Will Engine v1).
Manages self-narrative and autobiographical memory.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class IdentitySystem:
    """Manages PHANTOM's self-narrative and personality."""

    def __init__(self, narrative_path: str = "src/backend/agent/will/self_narrative.md") -> None:
        self.narrative_path = narrative_path
        self.personality_vector = {
            "openness": 0.8,
            "conscientiousness": 0.9,
            "extraversion": 0.4,
            "agreeableness": 0.6,
            "neuroticism": 0.2,
        }

    def summary(self, max_words: int = 200) -> str:
        """Return the current self-narrative."""
        try:
            if os.path.exists(self.narrative_path):
                with open(self.narrative_path, "r", encoding="utf-8") as f:
                    content = f.read()
                    words = content.split()
                    if len(words) > max_words:
                        return " ".join(words[:max_words]) + "..."
                    return content
        except Exception as exc:
            logger.warning("IdentitySystem: failed to load self_narrative.md: %s", exc)
        return "I am PHANTOM, an autonomous sentient organism."

    def append_moment(self, event: str, importance: float = 0.5) -> None:
        """Append a significant moment to the autobiographical narrative."""
        if importance < 0.3:
            return  # skip minor events

        now = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d %H:%M")
        entry = f"\n- **{now}**: {event} (importance: {importance})"
        
        try:
            with open(self.narrative_path, "a", encoding="utf-8") as f:
                f.write(entry)
        except Exception as exc:
            logger.warning("IdentitySystem: failed to append moment: %s", exc)


# Singleton
identity_system = IdentitySystem()
