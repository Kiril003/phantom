"""agent.actions._synth — runtime-synthesized Action subclasses.

Files under this package are authored by the agent at runtime via
SynthesizeCapability and survive process restarts. The registry
auto-loads them at boot (see registry.py _load_synth_actions).
"""
