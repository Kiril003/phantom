"""
Tests for Will Engine — Values (Phase 28).
"""
import pytest
from unittest.mock import AsyncMock, patch
from agent.cognition.will.values import ValuesSystem, ValueVerdict

@pytest.mark.asyncio
async def test_values_initialization():
    vs = ValuesSystem()
    assert vs._cache == {}

@pytest.mark.asyncio
async def test_values_evaluate_aligned():
    vs = ValuesSystem()
    mock_data = {
        "aligned": True,
        "conflicts": [],
        "confidence": 0.95,
        "rationale": "Action is perfectly fine."
    }
    
    with patch("agent.cognition.will.values.llm_json", new_callable=AsyncMock) as mock_llm:
        mock_llm.return_value = mock_data
        
        verdict = await vs.evaluate("Clean up the workspace")
        assert verdict.aligned is True
        assert verdict.confidence == 0.95
        assert mock_llm.called

@pytest.mark.asyncio
async def test_values_evaluate_conflicted():
    vs = ValuesSystem()
    mock_data = {
        "aligned": False,
        "conflicts": ["Якість > швидкість"],
        "confidence": 0.8,
        "rationale": "This action bypasses critical tests."
    }
    
    with patch("agent.cognition.will.values.llm_json", new_callable=AsyncMock) as mock_llm:
        mock_llm.return_value = mock_data
        
        verdict = await vs.evaluate("Deploy to production without testing")
        assert verdict.aligned is False
        assert "Якість > швидкість" in verdict.conflicts

@pytest.mark.asyncio
async def test_values_cache():
    vs = ValuesSystem()
    vs._cache_ttl = 10.0
    mock_data = {"aligned": True, "conflicts": [], "confidence": 1.0, "rationale": "ok"}
    
    with patch("agent.cognition.will.values.llm_json", new_callable=AsyncMock) as mock_llm:
        mock_llm.return_value = mock_data
        
        # First call
        await vs.evaluate("Action X")
        # Second call should use cache
        await vs.evaluate("Action X")
        
        assert mock_llm.call_count == 1

@pytest.mark.asyncio
async def test_values_fallback_on_error():
    vs = ValuesSystem()
    with patch("agent.cognition.will.values.llm_json", side_effect=Exception("LLM down")):
        verdict = await vs.evaluate("Any action")
        # Should fallback to aligned=True to not block system
        assert verdict.aligned is True
        assert "Evaluation failed" in verdict.rationale


@pytest.mark.asyncio
async def test_values_loads_real_doctrine():
    """The doctrine file resolves module-relative, so the real values.md
    loads regardless of CWD — not the hardcoded fallback string."""
    import os
    vs = ValuesSystem()
    assert os.path.exists(vs.values_path), vs.values_path
    doctrine = vs._load_doctrine()
    assert "Україна понад усе" in doctrine
    assert "Прозорість" in doctrine
    # The generic fallback must NOT be what we loaded.
    assert "Ukraine First, Quality > Speed" not in doctrine
