import time
import asyncio
from typing import Callable, List, Dict
from pydantic import BaseModel
from agent.cognition.monologue_emitter import emit_monologue, MonologueEvent

class ReflexAction(BaseModel):
    id: str
    trigger_condition: str
    action_type: str  # "haptic", "visual", "audio"
    payload: dict

class ReflexEngine:
    """
    The 'Spinal Cord' of Phantom OS.
    Handles high-priority sensor events with sub-millisecond reasoning logic
    before they reach the main LLM-based cognition layer.
    """
    def __init__(self):
        self.reflexes: Dict[str, ReflexAction] = {}
        self.last_reflex_ts: float = 0

    def register_reflex(self, reflex: ReflexAction):
        self.reflexes[reflex.id] = reflex

    async def trigger(self, trigger_id: str, intensity: float = 1.0):
        """
        Triggers a reflex action and notifies the endocrine system.
        """
        from ai.sentience.endocrine import endocrine_system
        
        # 1. Identify reflex
        # For now, we simulate a 'stress' reflex if intensity is high
        if intensity > 0.8:
            endocrine_system.stimulus(cortisol_delta=0.2 * intensity)
            
            # Broadcast reflex event
            event = MonologueEvent(
                kind="proactive",
                source="reflex_engine",
                monologue={
                    "note": f"REFLEX TRIGGERED: {trigger_id}",
                    "intensity": intensity,
                    "action": "Immediate Haptic Pulse + Visual Blink"
                }
            )
            await emit_monologue(event)
            self.last_reflex_ts = time.time()

# Global instance
reflex_engine = ReflexEngine()
