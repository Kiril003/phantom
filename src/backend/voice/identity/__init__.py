"""Voice identity package — speaker recognition pipeline.

Day-4 ships the plumbing (frozen `resolve_speaker` signature). Day-5
drops in actual ML weights (ECAPA-TDNN / WeSpeaker / Resemblyzer) and a
real model body. The signature is frozen by ADR-ID-002 so the call
site in `voice.pipeline.transcribe_blob` never has to change.
"""
from voice.identity.resolver import resolve_speaker

__all__ = ["resolve_speaker"]
