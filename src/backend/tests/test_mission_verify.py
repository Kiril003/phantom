import pytest
from unittest.mock import AsyncMock, patch
from agent.missions.verify import verify_phase, VerifyResult
from agent.schemas import MissionBrief, PhaseSpec

@pytest.mark.asyncio
async def test_verify_phase_passed():
    brief = MissionBrief(brief="Test Mission")
    phase = PhaseSpec(description="Test Phase", success_criteria="Do X")
    ledger = "Phase 1 - Started\n- Decided: Doing X\n- Lessons: X is done"
    
    mock_data = {
        "passed": True,
        "critique": "Everything is great",
        "suggestions": ""
    }
    
    with patch("agent.missions.verify.llm_json", new_callable=AsyncMock) as mock_llm:
        mock_llm.return_value = mock_data
        
        result = await verify_phase(
            mission_brief=brief,
            phase=phase,
            ledger_section=ledger,
            task_id="T1"
        )
        
        assert result.passed is True
        assert result.critique == "Everything is great"
        mock_llm.assert_called_once()

@pytest.mark.asyncio
async def test_verify_phase_failed():
    brief = MissionBrief(brief="Test Mission")
    phase = PhaseSpec(description="Test Phase", success_criteria="Do X")
    ledger = "Phase 1 - Started\n- Decided: Doing Y\n- Lessons: Y is done, forgot X"
    
    mock_data = {
        "passed": False,
        "critique": "You forgot X",
        "suggestions": "Do X next time"
    }
    
    with patch("agent.missions.verify.llm_json", new_callable=AsyncMock) as mock_llm:
        mock_llm.return_value = mock_data
        
        result = await verify_phase(
            mission_brief=brief,
            phase=phase,
            ledger_section=ledger,
            task_id="T1"
        )
        
        assert result.passed is False
        assert "forgot X" in result.critique
        assert "Do X" in result.suggestions
