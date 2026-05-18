"""Action implementations for the agent loop. See registry.py for dispatch."""
# V4 — expose the _synth subpackage as an attribute so that
# `import agent.actions._synth.synthesizer` resolves correctly after the
# parent package is cached in sys.modules (Python __import__ uses getattr
# on the package to find dotted-name children).
from agent.actions import _synth  # noqa: F401
