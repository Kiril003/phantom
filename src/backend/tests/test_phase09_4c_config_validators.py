"""
Phase 9.4c audit §7 — cross-field Pydantic validators.

Conflicting setting combinations used to persist silently because Pydantic
only validated per-field. Three cross-field validators now reject:

  1. ai_primary_provider == ai_fallback_provider (unless fallback='none')
  2. agent_proactive_enabled=True with agent_proactive_interval_min_s<=0
  3. voice_tts_enabled=True with an empty voice_tts_voice
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from config import PhantomConfig


def test_provider_distinction_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AI_PROVIDER", "gemini")
    monkeypatch.setenv("AI_FALLBACK_PROVIDER", "gemini")
    with pytest.raises(ValidationError) as excinfo:
        PhantomConfig(_env_file=None)
    assert "ai_primary_provider" in str(excinfo.value)


def test_provider_distinction_none_fallback_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    """'none' is a valid fallback value — no distinctness needed."""
    monkeypatch.setenv("AI_PROVIDER", "gemini")
    monkeypatch.setenv("AI_FALLBACK_PROVIDER", "none")
    cfg = PhantomConfig(_env_file=None)
    assert cfg.ai_primary_provider == "gemini"
    assert cfg.ai_fallback_provider == "none"


def test_provider_distinction_ok_when_distinct(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AI_PROVIDER", "gemini")
    monkeypatch.setenv("AI_FALLBACK_PROVIDER", "ollama")
    cfg = PhantomConfig(_env_file=None)
    assert cfg.ai_primary_provider != cfg.ai_fallback_provider


def test_proactive_interval_zero_rejected_when_enabled() -> None:
    with pytest.raises(ValidationError) as excinfo:
        PhantomConfig(
            agent_proactive_enabled=True,
            agent_proactive_interval_min_s=0,
        )
    assert "agent_proactive_interval_min_s" in str(excinfo.value)


def test_proactive_interval_zero_ok_when_disabled() -> None:
    """If proactive is off, the interval value is moot and shouldn't block."""
    cfg = PhantomConfig(
        agent_proactive_enabled=False,
        agent_proactive_interval_min_s=0,
    )
    assert cfg.agent_proactive_interval_min_s == 0


def test_proactive_max_below_min_rejected() -> None:
    with pytest.raises(ValidationError) as excinfo:
        PhantomConfig(
            agent_proactive_enabled=True,
            agent_proactive_interval_min_s=100,
            agent_proactive_interval_max_s=50,
        )
    assert "max_s" in str(excinfo.value)


def test_tts_voice_empty_rejected_when_enabled() -> None:
    with pytest.raises(ValidationError) as excinfo:
        PhantomConfig(voice_tts_enabled=True, voice_tts_voice="")
    assert "voice_tts_voice" in str(excinfo.value)


def test_tts_voice_whitespace_rejected_when_enabled() -> None:
    with pytest.raises(ValidationError) as excinfo:
        PhantomConfig(voice_tts_enabled=True, voice_tts_voice="   ")
    assert "voice_tts_voice" in str(excinfo.value)


def test_tts_voice_empty_ok_when_disabled() -> None:
    cfg = PhantomConfig(voice_tts_enabled=False, voice_tts_voice="")
    assert cfg.voice_tts_voice == ""
