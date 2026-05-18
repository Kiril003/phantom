import pytest
import time
from core.context_engine import ContextEngine

@pytest.mark.asyncio
async def test_hearing_buffer():
    engine = ContextEngine()
    engine.record_heard_speech("Hello")
    engine.record_heard_speech("World")
    
    recent = engine.get_recent_hearing(window_s=30)
    assert len(recent) == 2
    assert "Hello" in recent
    assert "World" in recent
