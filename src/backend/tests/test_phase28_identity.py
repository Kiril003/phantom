"""
Tests for Will Engine — Identity (Phase 28).
"""
import os
import pytest
from datetime import datetime, timezone
from agent.cognition.will.identity import IdentitySystem

@pytest.fixture
def tmp_narrative(tmp_path):
    path = tmp_path / "self_narrative.md"
    path.write_text("# PHANTOM — Identity")
    return str(path)

@pytest.mark.asyncio
async def test_identity_initialization(tmp_narrative):
    ids = IdentitySystem(narrative_path=tmp_narrative)
    assert "openness" in ids.personality_vector

@pytest.mark.asyncio
async def test_identity_summary(tmp_narrative):
    ids = IdentitySystem(narrative_path=tmp_narrative)
    summary = ids.summary()
    assert "# PHANTOM — Identity" in summary

@pytest.mark.asyncio
async def test_identity_append_moment(tmp_narrative):
    ids = IdentitySystem(narrative_path=tmp_narrative)
    ids.append_moment("I felt empowered today", importance=0.9)
    
    summary = ids.summary()
    assert "I felt empowered today" in summary
    assert "importance: 0.9" in summary

@pytest.mark.asyncio
async def test_identity_append_minor_moment_ignored(tmp_narrative):
    ids = IdentitySystem(narrative_path=tmp_narrative)
    ids.append_moment("I read a file", importance=0.1)
    
    summary = ids.summary()
    assert "I read a file" not in summary

@pytest.mark.asyncio
async def test_identity_summary_max_words(tmp_narrative):
    with open(tmp_narrative, "w") as f:
        f.write("one two three four five")
    
    ids = IdentitySystem(narrative_path=tmp_narrative)
    summary = ids.summary(max_words=3)
    assert summary == "one two three..."
