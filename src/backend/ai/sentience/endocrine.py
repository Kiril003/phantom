import time
import math
import asyncio
from pydantic import BaseModel, Field
from agent.cognition.monologue_emitter import emit_monologue, MonologueEvent

class EndocrineState(BaseModel):
    cortisol: float = Field(0.2, ge=0.0, le=1.0, description="Stress/Alertness level. Higher means more defensive/brief.")
    dopamine: float = Field(0.5, ge=0.0, le=1.0, description="Reward/Engagement level. Higher means more creative/active.")
    oxytocin: float = Field(0.5, ge=0.0, le=1.0, description="Bonding/Trust level. Higher means more informal/friendly.")
    last_update: float = Field(default_factory=time.time)

class EndocrineSystem:
    """
    The Digital Endocrine System of Phantom OS.
    Manages internal 'hormonal' states that regulate AI behavior.
    """
    def __init__(self):
        self.state = EndocrineState()
        # Decay rates per hour
        self.decay_rates = {
            "cortisol": 0.1,  # Stress fades
            "dopamine": 0.2,  # Excitement fades faster
            "oxytocin": 0.05  # Bonding fades slowly
        }

    def update(self, delta_time_s: float):
        """Applies natural decay over time."""
        hours = delta_time_s / 3600.0
        
        self.state.cortisol = max(0.1, self.state.cortisol - (self.decay_rates["cortisol"] * hours))
        self.state.dopamine = max(0.2, self.state.dopamine - (self.decay_rates["dopamine"] * hours))
        self.state.oxytocin = max(0.3, self.state.oxytocin - (self.decay_rates["oxytocin"] * hours))
        self.state.last_update = time.time()

    def stimulus(self, cortisol_delta: float = 0.0, dopamine_delta: float = 0.0, oxytocin_delta: float = 0.0):
        """Injects hormonal stimuli based on events."""
        self.state.cortisol = max(0.0, min(1.0, self.state.cortisol + cortisol_delta))
        self.state.dopamine = max(0.0, min(1.0, self.state.dopamine + dopamine_delta))
        self.state.oxytocin = max(0.0, min(1.0, self.state.oxytocin + oxytocin_delta))
        self.state.last_update = time.time()
        
        # Trigger an emotion shift event
        asyncio.create_task(emit_monologue(MonologueEvent(
            kind="emotion_shift",
            source="endocrine_engine",
            monologue={
                "note": f"Hormonal spike: C={cortisol_delta:+.2f}, D={dopamine_delta:+.2f}, O={oxytocin_delta:+.2f}",
                "state": self.state.model_dump(mode="json")
            }
        )))

    def get_personality_bias(self) -> dict:
        """Translates chemical states into prompt biases."""
        # Derived values for personality engine
        return {
            "tone_warmth": self.state.oxytocin,
            "verbosity": 1.0 - (self.state.cortisol * 0.5), # High cortisol = brief
            "creativity": self.state.dopamine,
            "caution": self.state.cortisol
        }

# Global instance
endocrine_system = EndocrineSystem()
