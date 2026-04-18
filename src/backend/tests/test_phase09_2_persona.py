"""
Phase 9.2 — Ukrainian persona: self-model identity, planner prompts, TTS voice.
"""
from __future__ import annotations

import json
import os

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase09-2-persona")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


# ═════════════════════════════════════════════════════════════════════════════
# 1. Self-model — UA identity + language fields
# ═════════════════════════════════════════════════════════════════════════════


class TestSelfModelUkrainian:
    @pytest.mark.asyncio
    async def test_build_self_model_uses_ukrainian_identity_and_language_fields(self):
        from agent.self_model import build_self_model
        from agent.actions.registry import registry

        sm = await build_self_model(registry)
        assert sm.language_primary == "uk"
        assert sm.language_fallback == "en"
        assert "PHANTOM" in sm.identity
        # Sanity: identity contains Cyrillic.
        assert any("\u0400" <= c <= "\u04FF" for c in sm.identity)


# ═════════════════════════════════════════════════════════════════════════════
# 2. Planner prompts contain UA + preserve technical EN terms
# ═════════════════════════════════════════════════════════════════════════════


class TestPlannerPromptsUkrainian:
    @pytest.mark.asyncio
    async def test_strategic_prompt_has_ua_and_en_technical_terms(self, monkeypatch):
        from agent.planner import strategic, _llm
        from agent.schemas import SelfModel

        captured: list[str] = []

        async def fake_call(prompt: str) -> str:
            captured.append(prompt)
            return json.dumps({
                "sub_goals": [{"description": "x", "rationale": "r",
                               "expected_actions": 1, "acceptance_criteria": "ok"}],
                "estimated_total_actions": 1, "risk_assessment": "low",
            })

        monkeypatch.setattr(_llm, "_call", fake_call)
        await strategic.plan(goal="read /etc/hostname", self_model=SelfModel())
        assert captured
        prompt = captured[0]
        # Must have UA section labels.
        assert "стратегічний планувальник" in prompt
        assert "ДОСТУПНІ КАТЕГОРІЇ ДІЙ" in prompt
        # English technical terms preserved naturally.
        assert "filesystem" in prompt
        assert "JSON" in prompt

    @pytest.mark.asyncio
    async def test_tactical_legacy_prompt_has_ua_and_en_technical_terms(self, monkeypatch):
        from agent.planner import tactical
        from agent.schemas import SelfModel, SubGoal
        from config import config

        # Force legacy path so we can capture the prompt body.
        monkeypatch.setattr(config, "agent_use_native_tool_calling", False)

        from agent.planner import _llm
        captured: list[str] = []

        async def fake_call(prompt: str) -> str:
            captured.append(prompt)
            return json.dumps({
                "action": "DONE_SUBGOAL",
                "args": {"summary": "ok"},
                "intent": "done",
                "monologue": {"what_i_see": "x", "what_i_plan": "y",
                              "why_this_works": "z", "what_could_fail": "f",
                              "objection": None, "confidence": 0.9},
            })

        monkeypatch.setattr(_llm, "_call", fake_call)
        await tactical.plan(
            step_idx=0,
            sub_goal=SubGoal(description="d", rationale="r",
                             expected_actions=1, acceptance_criteria=""),
            self_model=SelfModel(),
            observations=[], actions_in_sub_goal=0,
        )
        assert captured
        prompt = captured[0]
        assert "тактичний планувальник" in prompt
        assert "DONE_SUBGOAL" in prompt   # technical marker stays English


# ═════════════════════════════════════════════════════════════════════════════
# 3. TTS voice selection by Cyrillic ratio
# ═════════════════════════════════════════════════════════════════════════════


class TestTTSVoiceSelection:
    def test_cyrillic_ratio_basic(self):
        from voice.tts_engine import _cyrillic_ratio
        assert _cyrillic_ratio("Привіт") == 1.0
        assert _cyrillic_ratio("hello") == 0.0
        assert _cyrillic_ratio("hello Привіт") > 0.4
        assert _cyrillic_ratio("") == 0.0
        assert _cyrillic_ratio("12345") == 0.0

    def test_select_voice_picks_uk_for_cyrillic(self, monkeypatch):
        # Patch via voice.tts_engine's view of config — phase00 reload may
        # have swapped the singleton out from under top-level imports.
        from voice import tts_engine as _tts
        from voice.tts_engine import select_voice_for_text

        monkeypatch.setattr(_tts.config, "voice_tts_auto_language", True)
        monkeypatch.setattr(_tts.config, "voice_tts_voice_uk", "uk_UA-lada-x_low")
        monkeypatch.setattr(_tts.config, "voice_tts_voice_en", "en_US-amy-low")

        assert select_voice_for_text("Привіт, я готовий до роботи.") == "uk_UA-lada-x_low"
        assert select_voice_for_text("Hello, I am PHANTOM.") == "en_US-amy-low"

    def test_select_voice_respects_disabled_auto(self, monkeypatch):
        from voice import tts_engine as _tts
        from voice.tts_engine import select_voice_for_text

        monkeypatch.setattr(_tts.config, "voice_tts_auto_language", False)
        monkeypatch.setattr(_tts.config, "voice_tts_voice", "explicit-voice")
        assert select_voice_for_text("Привіт") == "explicit-voice"
