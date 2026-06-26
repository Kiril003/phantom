import os

os.environ.setdefault("JWT_SECRET_KEY", "t")
os.environ.setdefault("AI_GEMINI_API_KEY", "k")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")

from agent.will.arbitration import intent_mutex


def test_proactive_helper_defers_when_will_holds():
    from agent.cognition.proactive.loop import _intent_available_for_proactive
    intent_mutex.release("will")  # ensure clean
    assert intent_mutex.try_acquire("will") is True
    assert _intent_available_for_proactive() is False
    intent_mutex.release("will")
    assert _intent_available_for_proactive() is True
