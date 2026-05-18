import asyncio
import logging
import time
from typing import List, Optional
from pydantic import BaseModel
from agent.cognition.monologue_emitter import emit_monologue, MonologueEvent

logger = logging.getLogger("phantom.monologue")

class ThoughtStep(BaseModel):
    thought: str
    emotion_context: Optional[str] = None
    timestamp: float

class InnerMonologue:
    """
    Manages the 'stream of consciousness' of the Central Phantom.
    Allows the AI to reason 'privately' before public output.
    """
    def __init__(self):
        self.history: List[ThoughtStep] = []
        self.active_monologue: Optional[str] = None

    async def reflect(self, context: str, endocrine_state: dict) -> str:
        """
        Generates an internal reflection based on current sensors and state.
        This is typically called in the background or right before a response.
        """
        # Logic to generate thought via a small model or system prompt injection
        # For now, we simulate the structure.
        thought = f"Reflecting on: {context[:50]}... | Endocrine State: {endocrine_state}"
        
        step = ThoughtStep(thought=thought, timestamp=time.time())
        self.history.append(step)
        
        # Broadcast to WebSocket for the UI (Sentient Inner Monologue)
        event = MonologueEvent(
            kind="reflection",
            source="sentient_engine",
            monologue={"note": thought, "endocrine": endocrine_state}
        )
        await emit_monologue(event)
        
        # Limit history
        if len(self.history) > 50:
            self.history.pop(0)
            
        self.active_monologue = thought
        return thought

    def get_current_thought(self) -> Optional[str]:
        return self.active_monologue

# Global instance
phantom_monologue = InnerMonologue()
