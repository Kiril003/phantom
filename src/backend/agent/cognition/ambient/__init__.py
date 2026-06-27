"""Ambient awareness — PHANTOM watches the world around the user and speaks up.

The guardian turns the perceptual snapshot into proactive care: bad air, a
coming storm, a body too long still, a disk about to fill. Each concern is one
small `AmbientRule`; together they make the symbiote attentive in ways a human
cannot sustain. Adding a new "small thing" = adding one rule.
"""
from agent.cognition.ambient.guardian import (
    AmbientAlert,
    AmbientRule,
    AmbientGuardian,
    ambient_guardian,
)

__all__ = ["AmbientAlert", "AmbientRule", "AmbientGuardian", "ambient_guardian"]
