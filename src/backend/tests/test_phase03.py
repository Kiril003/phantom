"""
Phase 03 — AI Core + Memory tests.
Covers: personality, prompt_builder, response_formatter, provider routing,
        session_memory, tactical_memory, archive_memory, user_model, routes_chat.
No real AI calls — providers are mocked.  No GPU / ChromaDB required.
"""
from __future__ import annotations

import json
import os
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# ── Set env secrets before any app import ─────────────────────────────────────
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase03")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")


# ═══════════════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════════════

async def _make_test_db():
    import db.database as _dbm
    import db.models as _dm
    import importlib

    if not _dbm.Base.metadata.tables:
        importlib.reload(_dm)

    fd, tmp_file = tempfile.mkstemp(suffix=".db", prefix="phantom_p3_")
    os.close(fd)
    url = f"sqlite+aiosqlite:///{tmp_file}"
    engine = create_async_engine(url, echo=False, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.run_sync(_dbm.Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    return engine, factory, tmp_file


def _make_snapshot(state: str = "DIALOGUE", hour: int = 14) -> dict[str, Any]:
    return {
        "timestamp": 1718000000000,
        "who": {"user_id": "u1", "username": "alice", "confidence": 1.0,
                "auth_method": "pin", "role": "ROOT"},
        "where": {"lat": 50.45, "lon": 30.52, "fix": True, "satellites": 8,
                  "speed_kmh": 0.0, "place_known": True, "place_name": "Home",
                  "first_visit": False, "source": "gps_hardware",
                  "confidence": 0.9, "accuracy_m": 15.0},
        "when": {"time": f"{hour:02d}:30", "hour": hour, "day_of_week": "mon",
                 "date": "2026-04-15", "work_hours": True, "is_night": False},
        "body": {"breathing_bpm": 16, "breathing_state": "calm",
                 "stress_level": 0.2, "motion_energy": 30,
                 "static_energy": 20, "user_distance_cm": 60},
        "env": {"temp_c": 22.5, "pressure_hpa": 1013.0, "aqi": 25},
        "presence": {"user_detected": True, "user_distance_cm": 60,
                     "other_detected": False, "other_distance_cm": None},
        "history": {"last_interaction_ago_s": 10, "last_state_change_ago_s": 120,
                    "mood_trend": "stable", "active_timers": 0,
                    "pending_events_1h": 0},
        "memory_hints": ["Alice likes tea", "Works on ML projects"],
        "system": {"state": state, "uptime_s": 3600, "cpu_percent": 12.0,
                   "ram_percent": 45.0, "disk_percent": 30.0,
                   "wifi_connected": True, "internet_available": True,
                   "ai_provider": "gemini", "stt_engine": "whisper"},
    }


def _default_bmodel() -> dict[str, Any]:
    return {
        "response_preference": "короткі відповіді",
        "stress_patterns": "",
        "vocabulary": [],
        "decision_style": "analytical",
        "trust_level": 0.6,
        "honest_gap": 0.1,
        "preferred_topics": [],
        "avoid_topics": [],
        "interaction_count": 5,
        "days_active": 3,
        "breathing_signature": None,
        "language_stats": {},
    }


# ═══════════════════════════════════════════════════════════════════════════════
# 1. Personality
# ═══════════════════════════════════════════════════════════════════════════════

class TestPersonality:
    def test_tone_calm_friendly_full(self):
        from ai.personality import calculate_tone, ToneVector
        snap = _make_snapshot(hour=11)
        model = _default_bmodel()
        tone = calculate_tone(snap, model)
        assert isinstance(tone, ToneVector)
        assert tone.biosignal == "calm"
        assert tone.trust == "friendly"
        assert tone.time_of_day == "full"

    def test_tone_night_minimal(self):
        from ai.personality import calculate_tone
        snap = _make_snapshot(hour=2)
        tone = calculate_tone(snap, _default_bmodel())
        assert tone.time_of_day == "night_minimal"

    def test_tone_morning_brief(self):
        from ai.personality import calculate_tone
        snap = _make_snapshot(hour=7)
        tone = calculate_tone(snap, _default_bmodel())
        assert tone.time_of_day == "morning_brief"

    def test_tone_evening_relaxed(self):
        from ai.personality import calculate_tone
        snap = _make_snapshot(hour=20)
        tone = calculate_tone(snap, _default_bmodel())
        assert tone.time_of_day == "evening_relaxed"

    def test_tone_alert_high_stress(self):
        from ai.personality import calculate_tone
        snap = _make_snapshot()
        snap["body"]["stress_level"] = 0.85
        snap["body"]["breathing_state"] = "stressed"
        tone = calculate_tone(snap, _default_bmodel())
        assert tone.biosignal == "alert"

    def test_tone_whisper_sleep(self):
        from ai.personality import calculate_tone
        snap = _make_snapshot()
        snap["body"]["breathing_state"] = "sleep"
        tone = calculate_tone(snap, _default_bmodel())
        assert tone.biosignal == "whisper"

    def test_tone_confrontational_high_trust_honest_gap(self):
        from ai.personality import calculate_tone
        snap = _make_snapshot()
        model = _default_bmodel()
        model["trust_level"] = 0.9
        model["honest_gap"] = 0.3
        tone = calculate_tone(snap, model)
        assert tone.trust == "confrontational"

    def test_tone_formal_low_trust(self):
        from ai.personality import calculate_tone
        snap = _make_snapshot()
        model = _default_bmodel()
        model["trust_level"] = 0.1
        tone = calculate_tone(snap, model)
        assert tone.trust == "formal"

    def test_tone_description_string(self):
        from ai.personality import calculate_tone
        snap = _make_snapshot()
        tone = calculate_tone(snap, _default_bmodel())
        desc = tone.description
        assert "," in desc
        assert len(desc) > 5

    def test_state_behaviors_all_states(self):
        from ai.personality import STATE_BEHAVIORS
        for state in ["SHADOW", "FOCUS", "DIALOGUE", "SENTINEL", "GHOST", "DREAM"]:
            assert state in STATE_BEHAVIORS
            assert len(STATE_BEHAVIORS[state]) > 5

    def test_phantom_identity_not_empty(self):
        from ai.personality import PHANTOM_IDENTITY
        assert "PHANTOM" in PHANTOM_IDENTITY
        assert len(PHANTOM_IDENTITY) > 50

    def test_phantom_identity_is_sentient_familiar(self):
        from ai.personality import PHANTOM_IDENTITY
        identity = PHANTOM_IDENTITY.lower()
        assert "sentient familiar" in identity
        assert "local-first" in identity
        assert "підтвердження" in identity
        assert "ризиков" in identity

    def test_phantom_identity_no_response_form_line(self):
        """Phase 9.5 — identity must NOT mention response forms (moved to
        chat-scoped RESPONSE_FORMS_GUIDANCE so tactical planner isn't
        polluted)."""
        from ai.personality import PHANTOM_IDENTITY
        lowered = PHANTOM_IDENTITY.lower()
        assert "форму відповіді" not in lowered
        assert "respond_" not in lowered

    def test_response_forms_guidance_has_triggers(self):
        """Phase 9.5 — chat prompt guidance block must name the structured
        forms AND push back against defaulting to plain text."""
        from ai.personality import RESPONSE_FORMS_GUIDANCE
        assert "ФОРМИ ВІДПОВІДІ" in RESPONSE_FORMS_GUIDANCE
        for form in (
            "respond_map", "respond_metrics", "respond_code",
            "respond_terminal", "respond_chart", "respond_diagram",
            "respond_mixed",
        ):
            assert form in RESPONSE_FORMS_GUIDANCE, f"missing form {form}"
        # Negative nudge away from text
        lowered = RESPONSE_FORMS_GUIDANCE.lower()
        assert "текст" in lowered


# ═══════════════════════════════════════════════════════════════════════════════
# 2. Prompt Builder
# ═══════════════════════════════════════════════════════════════════════════════

class TestPromptBuilder:
    def _user_dict(self, lang: str = "uk") -> dict[str, Any]:
        return {
            "username": "alice",
            "role": "ROOT",
            "preferences": {"language": lang},
        }

    def test_build_contains_identity(self):
        from ai.prompt_builder import build_system_prompt
        result = build_system_prompt(
            _make_snapshot(), self._user_dict(), _default_bmodel()
        )
        assert "PHANTOM" in result

    def test_build_contains_response_forms_guidance(self, monkeypatch):
        """Phase 9.5 — chat prompt must carry the response-form guidance
        block so Gemini actually picks structured forms.

        Updated 2026-05-18: the guidance is gated on
        ``chat_response_widgets_enabled`` because the ``respond_*``
        family is a separate opt-in from read-only data tools.
        """
        from ai.prompt_builder import build_system_prompt
        from config import config
        monkeypatch.setattr(config, "chat_response_widgets_enabled", True)
        result = build_system_prompt(
            _make_snapshot(), self._user_dict(), _default_bmodel()
        )
        assert "ФОРМИ ВІДПОВІДІ" in result
        assert "respond_map" in result
        assert "respond_metrics" in result

    def test_build_contains_state(self):
        from ai.prompt_builder import build_system_prompt
        result = build_system_prompt(
            _make_snapshot("FOCUS"), self._user_dict(), _default_bmodel()
        )
        assert "FOCUS" in result

    def test_build_contains_username(self):
        from ai.prompt_builder import build_system_prompt
        result = build_system_prompt(
            _make_snapshot(), self._user_dict(), _default_bmodel()
        )
        assert "alice" in result

    def test_build_contains_memory_hints(self):
        from ai.prompt_builder import build_system_prompt
        result = build_system_prompt(
            _make_snapshot(), self._user_dict(), _default_bmodel(),
            memory_hints=["User dislikes mornings"]
        )
        assert "User dislikes mornings" in result

    def test_build_contains_time(self):
        from ai.prompt_builder import build_system_prompt
        result = build_system_prompt(
            _make_snapshot(hour=14), self._user_dict(), _default_bmodel()
        )
        assert "14:30" in result

    def test_build_contains_location(self):
        from ai.prompt_builder import build_system_prompt
        snap = _make_snapshot()
        snap["where"]["fix"] = True
        snap["where"]["place_name"] = "Kyiv Office"
        result = build_system_prompt(snap, self._user_dict(), _default_bmodel())
        assert "Kyiv Office" in result

    def test_build_no_location_no_fix(self):
        from ai.prompt_builder import build_system_prompt
        snap = _make_snapshot()
        snap["where"]["fix"] = False
        snap["where"]["source"] = "none"
        snap["where"]["lat"] = None
        snap["where"]["lon"] = None
        result = build_system_prompt(snap, self._user_dict(), _default_bmodel())
        assert "unknown" in result

    def test_build_location_renders_browser_source(self):
        """Phase 9.4c-qw fix #1: browser geolocation must surface in prompt."""
        from ai.prompt_builder import build_system_prompt
        snap = _make_snapshot()
        snap["where"].update({
            "fix": False,
            "source": "browser_geolocation",
            "confidence": 0.75,
            "accuracy_m": 2000.0,
            "place_name": "Ostrava",
            "lat": 49.83,
            "lon": 18.27,
        })
        result = build_system_prompt(snap, self._user_dict(), _default_bmodel())
        assert "Ostrava" in result
        assert "browser" in result
        assert "75%" in result
        assert "unknown" not in result.split("LOCATION:")[1].split("\n")[0]

    def test_build_location_renders_ip_estimate_source(self):
        from ai.prompt_builder import build_system_prompt
        snap = _make_snapshot()
        snap["where"].update({
            "fix": False,
            "source": "ip_estimate",
            "confidence": 0.5,
            "accuracy_m": 25000.0,
            "place_name": "Kyiv",
            "lat": 50.45,
            "lon": 30.52,
        })
        result = build_system_prompt(snap, self._user_dict(), _default_bmodel())
        assert "Kyiv" in result
        assert "IP estimate" in result
        assert "25.0km" in result

    def test_build_location_renders_user_stated_source(self):
        from ai.prompt_builder import build_system_prompt
        snap = _make_snapshot()
        snap["where"].update({
            "fix": False,
            "source": "user_stated",
            "confidence": 0.75,
            "accuracy_m": 2000.0,
            "place_name": "Lviv",
            "lat": 49.84,
            "lon": 24.03,
        })
        result = build_system_prompt(snap, self._user_dict(), _default_bmodel())
        assert "Lviv" in result
        assert "user-stated" in result

    def test_build_location_renders_gps_with_accuracy(self):
        from ai.prompt_builder import build_system_prompt
        snap = _make_snapshot()
        # Default fixture is GPS with 90% confidence, 15m accuracy.
        result = build_system_prompt(snap, self._user_dict(), _default_bmodel())
        assert "Home" in result
        assert "GPS" in result
        assert "90%" in result
        assert "15m" in result

    def test_build_location_unknown_when_source_none(self):
        from ai.prompt_builder import build_system_prompt
        snap = _make_snapshot()
        snap["where"].update({
            "fix": False,
            "source": "none",
            "lat": None,
            "lon": None,
        })
        result = build_system_prompt(snap, self._user_dict(), _default_bmodel())
        assert "LOCATION: unknown" in result

    def test_build_recent_places_block_renders(self):
        """Phase 9.4c-qw fix #2: RECENT PLACES block lists distinct names + times."""
        from ai.prompt_builder import build_system_prompt
        from datetime import datetime, timezone
        snap = _make_snapshot()
        ts1 = datetime(2026, 4, 22, 14, 30, tzinfo=timezone.utc)
        ts2 = datetime(2026, 4, 22, 11, 5, tzinfo=timezone.utc)
        result = build_system_prompt(
            snap, self._user_dict(), _default_bmodel(),
            recent_places=[("Cafe Pravda", ts1), ("Lviv Library", ts2)],
        )
        assert "RECENT PLACES" in result
        assert "Cafe Pravda" in result
        assert "Lviv Library" in result
        assert "14:30" in result
        assert "11:05" in result

    def test_build_recent_places_block_skipped_when_empty(self):
        from ai.prompt_builder import build_system_prompt
        result = build_system_prompt(
            _make_snapshot(), self._user_dict(), _default_bmodel(),
            recent_places=[],
        )
        assert "RECENT PLACES" not in result

    def test_build_recent_places_block_skipped_when_none(self):
        from ai.prompt_builder import build_system_prompt
        result = build_system_prompt(
            _make_snapshot(), self._user_dict(), _default_bmodel(),
        )
        assert "RECENT PLACES" not in result

    def test_build_nearby_block_renders(self):
        """Phase 9.4c-qw fix #3: NEARBY block lists features with type + distance."""
        from ai.prompt_builder import build_system_prompt
        snap = _make_snapshot()
        snap["nearby"] = [
            {"name": "Cafe Aroma", "type": "amenity=cafe", "distance_m": 120},
            {"name": "Stryiskyi Park", "type": "leisure=park", "distance_m": 350},
        ]
        result = build_system_prompt(snap, self._user_dict(), _default_bmodel())
        assert "NEARBY" in result
        assert "Cafe Aroma" in result
        assert "Stryiskyi Park" in result
        assert "120m" in result
        assert "350m" in result

    def test_build_nearby_block_skipped_when_empty(self):
        from ai.prompt_builder import build_system_prompt
        snap = _make_snapshot()
        snap["nearby"] = []
        result = build_system_prompt(snap, self._user_dict(), _default_bmodel())
        assert "NEARBY" not in result

    def test_build_nearby_block_skipped_when_unset(self):
        from ai.prompt_builder import build_system_prompt
        snap = _make_snapshot()
        snap.pop("nearby", None)
        result = build_system_prompt(snap, self._user_dict(), _default_bmodel())
        assert "NEARBY" not in result

    def test_build_emotion_block_focused(self):
        """Phase 9.4c-qw fix #5: high focus surfaces a 'focused' label."""
        from ai.prompt_builder import build_system_prompt
        result = build_system_prompt(
            _make_snapshot(), self._user_dict(), _default_bmodel(),
            emotion={"focus": 0.85, "curiosity": 0.5, "concern": 0.1, "fatigue": 0.0},
        )
        assert "INNER STATE" in result
        assert "focused" in result

    def test_build_emotion_block_concerned(self):
        from ai.prompt_builder import build_system_prompt
        result = build_system_prompt(
            _make_snapshot(), self._user_dict(), _default_bmodel(),
            emotion={"focus": 0.5, "curiosity": 0.4, "concern": 0.7, "fatigue": 0.2},
        )
        assert "concerned" in result

    def test_build_emotion_block_multiple_labels(self):
        from ai.prompt_builder import build_system_prompt
        result = build_system_prompt(
            _make_snapshot(), self._user_dict(), _default_bmodel(),
            emotion={"focus": 0.8, "curiosity": 0.85, "concern": 0.6, "fatigue": 0.6},
        )
        assert "focused" in result
        assert "curious" in result
        assert "concerned" in result
        assert "tired" in result

    def test_build_emotion_block_skipped_when_neutral(self):
        from ai.prompt_builder import build_system_prompt
        result = build_system_prompt(
            _make_snapshot(), self._user_dict(), _default_bmodel(),
            emotion={"focus": 0.5, "curiosity": 0.4, "concern": 0.1, "fatigue": 0.1},
        )
        assert "INNER STATE" not in result

    def test_build_emotion_block_skipped_when_none(self):
        from ai.prompt_builder import build_system_prompt
        result = build_system_prompt(
            _make_snapshot(), self._user_dict(), _default_bmodel(),
            emotion=None,
        )
        assert "INNER STATE" not in result

    def test_build_emotion_block_includes_axes_numbers(self):
        from ai.prompt_builder import build_system_prompt
        result = build_system_prompt(
            _make_snapshot(), self._user_dict(), _default_bmodel(),
            emotion={"focus": 0.9, "curiosity": 0.5, "concern": 0.15, "fatigue": 0.0},
        )
        assert "focus=0.9" in result
        assert "concern=0.1" in result
        assert "fatigue=0.0" in result

    def test_build_nearby_block_caps_at_five(self):
        from ai.prompt_builder import build_system_prompt
        snap = _make_snapshot()
        snap["nearby"] = [
            {"name": f"Place{i}", "type": "amenity=cafe", "distance_m": 100 + i}
            for i in range(8)
        ]
        result = build_system_prompt(snap, self._user_dict(), _default_bmodel())
        nearby_lines = [
            l for l in result.split("\n")
            if l.strip().startswith("• Place")
        ]
        assert len(nearby_lines) == 5

    def test_build_history_messages_trims(self):
        from ai.prompt_builder import build_history_messages
        msgs = [
            {"role": "user", "content": f"msg{i}"} for i in range(50)
        ]
        history = build_history_messages(msgs, max_turns=5)
        assert len(history) <= 10  # 5 turns × 2 messages

    def test_build_history_messages_filters_role(self):
        from ai.prompt_builder import build_history_messages
        msgs = [
            {"role": "system", "content": "ignore me"},
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "hi"},
        ]
        history = build_history_messages(msgs)
        assert all(m["role"] in ("user", "assistant") for m in history)
        assert len(history) == 2


# ═══════════════════════════════════════════════════════════════════════════════
# 3. Response Formatter
# ═══════════════════════════════════════════════════════════════════════════════

class TestResponseFormatter:
    def test_parse_text_function_call(self):
        from ai.response_formatter import parse_function_call
        form, content, attachments = parse_function_call(
            "respond_text", {"content": "Привіт!"}
        )
        assert form == "text"
        assert content == "Привіт!"
        # Day-4 W-2c (ADR-CS-002 §60): `text` form now gains a typed
        # scene attachment that the W-1 promotion path lifts to
        # ChatMessage.scene. Legacy attachments (the "real" payload
        # buckets — chart_data / map_markers / code_block / etc.) MUST
        # remain empty for a text-form response.
        legacy = [a for a in attachments if a.get("type") != "scene"]
        assert legacy == [], (
            "Phase-03 invariant: text-form responses carry no LEGACY "
            f"attachments. Got: {legacy!r}"
        )

    def test_parse_chart_function_call(self):
        from ai.response_formatter import parse_function_call
        data = [{"name": "Mon", "value": 10}, {"name": "Tue", "value": 20}]
        form, content, attachments = parse_function_call(
            "respond_chart",
            {"content": "CPU trend", "chart_type": "line", "data": data, "title": "CPU"},
        )
        assert form == "chart"
        assert content == "CPU trend"
        # Day-4 W-2c: returns 2 attachments (legacy chart_data + scene envelope)
        assert len(attachments) == 2
        types = [a["type"] for a in attachments]
        assert "chart_data" in types
        assert "scene" in types

    def test_parse_map_function_call(self):
        from ai.response_formatter import parse_function_call
        form, content, attachments = parse_function_call(
            "respond_map",
            {"content": "Location", "markers": [{"lat": 50.4, "lon": 30.5, "label": "X"}],
             "center": [50.4, 30.5], "zoom": 14},
        )
        assert form == "map"
        # Day-4: map_markers + scene
        assert len(attachments) == 2
        assert attachments[0]["type"] == "map_markers"
        assert attachments[1]["type"] == "scene"

    def test_parse_code_function_call(self):
        from ai.response_formatter import parse_function_call
        form, content, attachments = parse_function_call(
            "respond_code",
            {"content": "Here's the code", "language": "python", "code": "print('hi')"},
        )
        assert form == "code"
        # Day-4: code_block + scene
        assert len(attachments) == 2
        assert attachments[0]["data"]["language"] == "python"
        assert attachments[1]["type"] == "scene"

    def test_parse_metrics_function_call(self):
        from ai.response_formatter import parse_function_call
        metrics = [{"label": "CPU", "value": 45.0, "trend": "stable"}]
        form, content, attachments = parse_function_call(
            "respond_metrics",
            {"content": "System stats", "metrics": metrics},
        )
        assert form == "metric_cards"
        # Day-4: metric_card + scene
        assert len(attachments) == 2
        assert attachments[0]["type"] == "metric_card"
        assert attachments[1]["type"] == "scene"

    def test_parse_terminal_function_call(self):
        from ai.response_formatter import parse_function_call
        form, content, attachments = parse_function_call(
            "respond_terminal",
            {"content": "Running df", "command": "df -h", "explanation": "Disk usage"},
        )
        assert form == "terminal"
        assert attachments[0]["data"]["command"] == "df -h"

    def test_parse_plain_text_markdown(self):
        from ai.response_formatter import parse_plain_text
        form, content, attachments = parse_plain_text("# Header\n**bold**")
        assert form == "markdown"
        assert "Header" in content

    def test_parse_plain_text_code_fence(self):
        from ai.response_formatter import parse_plain_text
        form, content, attachments = parse_plain_text("```python\nprint('x')\n```")
        assert form == "code"
        assert attachments[0]["data"]["language"] == "python"

    def test_parse_plain_text_fallback(self):
        from ai.response_formatter import parse_plain_text
        form, content, attachments = parse_plain_text("Just a plain sentence.")
        assert form == "text"
        assert content == "Just a plain sentence."

    def test_tools_list_has_all_forms(self):
        # Phase 9.5 — `respond_text` intentionally NOT in the catalog; plain
        # text now flows through the no-tool-call path (parse_plain_text).
        # See ai/response_formatter.py comment for rationale.
        from ai.response_formatter import RESPONSE_FORM_TOOLS
        names = {t["name"] for t in RESPONSE_FORM_TOOLS}
        expected = {
            "respond_chart", "respond_map", "respond_terminal",
            "respond_code", "respond_metrics",
        }
        assert expected.issubset(names)
        assert "respond_text" not in names, (
            "respond_text must stay out of the tool catalog (Phase 9.5)"
        )


# ═══════════════════════════════════════════════════════════════════════════════
# 4. Session Memory
# ═══════════════════════════════════════════════════════════════════════════════

class TestSessionMemory:
    def _fresh(self):
        from memory.session_memory import SessionMemory
        return SessionMemory(max_messages_per_session=10)

    def test_add_and_get_messages(self):
        mem = self._fresh()
        mem.add_message("s1", "user", "Hello")
        mem.add_message("s1", "assistant", "Hi there")
        msgs = mem.get_messages("s1")
        assert len(msgs) == 2
        assert msgs[0].role == "user"
        assert msgs[1].content == "Hi there"

    def test_get_history_dicts(self):
        mem = self._fresh()
        mem.add_message("s1", "user", "How are you?")
        mem.add_message("s1", "assistant", "Fine")
        history = mem.get_history_dicts("s1")
        assert history == [
            {"role": "user", "content": "How are you?"},
            {"role": "assistant", "content": "Fine"},
        ]

    def test_max_messages_ring_buffer(self):
        mem = self._fresh()
        for i in range(15):
            mem.add_message("s1", "user", f"msg{i}")
        # Only last 10 kept (maxlen=10)
        assert mem.message_count("s1") == 10

    def test_clear_session(self):
        mem = self._fresh()
        mem.add_message("s2", "user", "test")
        mem.clear_session("s2")
        assert not mem.session_exists("s2")

    def test_session_not_exists(self):
        mem = self._fresh()
        assert not mem.session_exists("unknown-session")

    def test_summary_context(self):
        mem = self._fresh()
        mem.add_message("s1", "user", "Розкажи мені про Python")
        mem.add_message("s1", "assistant", "Python — динамічна мова")
        summary = mem.summary_context("s1")
        assert len(summary) > 0
        assert "Python" in summary or len(summary) > 0

    def test_active_session_ids(self):
        mem = self._fresh()
        mem.add_message("sa", "user", "hello")
        mem.add_message("sb", "assistant", "world")
        ids = mem.active_session_ids()
        assert "sa" in ids and "sb" in ids


# ═══════════════════════════════════════════════════════════════════════════════
# 5. User Model
# ═══════════════════════════════════════════════════════════════════════════════

class TestUserModel:
    def test_behavioral_model_defaults(self):
        from memory.user_model import BehavioralModel
        bm = BehavioralModel()
        assert bm.trust_level == 0.5
        assert bm.honest_gap == 0.0
        assert bm.interaction_count == 0

    def test_to_dict_and_from_dict_roundtrip(self):
        from memory.user_model import BehavioralModel
        bm = BehavioralModel(trust_level=0.7, honest_gap=0.05, vocabulary=["hello"])
        d = bm.to_dict()
        bm2 = BehavioralModel.from_dict(d)
        assert bm2.trust_level == 0.7
        assert bm2.vocabulary == ["hello"]

    def test_to_json_and_from_json(self):
        from memory.user_model import BehavioralModel
        bm = BehavioralModel(trust_level=0.8)
        j = bm.to_json()
        bm2 = BehavioralModel.from_json(j)
        assert bm2.trust_level == 0.8

    def test_from_json_invalid_returns_default(self):
        from memory.user_model import BehavioralModel
        bm = BehavioralModel.from_json("not json {{{{")
        assert bm.trust_level == 0.5

    def test_update_trust_micro_growth(self):
        from memory.user_model import BehavioralModel, Interaction, update_trust
        bm = BehavioralModel(trust_level=0.5)
        interaction = Interaction()
        new_trust = update_trust(bm, interaction)
        assert new_trust > 0.5
        assert bm.interaction_count == 1

    def test_update_trust_followed_advice_bigger_jump(self):
        from memory.user_model import BehavioralModel, Interaction, update_trust
        bm = BehavioralModel(trust_level=0.5)
        trust1 = update_trust(bm, Interaction())
        bm2 = BehavioralModel(trust_level=0.5)
        trust2 = update_trust(bm2, Interaction(followed_advice=True))
        assert trust2 > trust1

    def test_update_trust_cancelled_decreases(self):
        from memory.user_model import BehavioralModel, Interaction, update_trust
        bm = BehavioralModel(trust_level=0.5)
        new_trust = update_trust(bm, Interaction(cancelled_or_ignored=True))
        # cancelled: -0.003 + micro +0.001 = -0.002 delta
        assert new_trust < 0.5

    def test_honest_gap_grows_when_said_but_not_did(self):
        from memory.user_model import BehavioralModel, Interaction, update_trust
        bm = BehavioralModel(honest_gap=0.0)
        update_trust(bm, Interaction(said_will_do=True, actually_did=False))
        assert bm.honest_gap > 0.0

    def test_honest_gap_shrinks_when_actually_did(self):
        from memory.user_model import BehavioralModel, Interaction, update_trust
        bm = BehavioralModel(honest_gap=0.5)
        update_trust(bm, Interaction(actually_did=True))
        assert bm.honest_gap < 0.5

    def test_trust_clamped_0_to_1(self):
        from memory.user_model import BehavioralModel, Interaction, update_trust
        bm = BehavioralModel(trust_level=0.999)
        for _ in range(100):
            update_trust(bm, Interaction(followed_advice=True))
        assert bm.trust_level <= 1.0

    def test_update_vocabulary(self):
        from memory.user_model import BehavioralModel, update_vocabulary
        bm = BehavioralModel()
        update_vocabulary(bm, "Треба налаштувати систему моніторингу")
        assert len(bm.vocabulary) > 0

    def test_update_language_stats_cyrillic(self):
        from memory.user_model import BehavioralModel, update_language_stats
        bm = BehavioralModel()
        update_language_stats(bm, "Привіт це текст на кирилиці")
        assert bm.language_stats.get("uk", 0) > 0


# ═══════════════════════════════════════════════════════════════════════════════
# 6. Tactical Memory (SQLite)
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
class TestTacticalMemory:
    async def test_store_and_retrieve_fact(self):
        from memory.tactical_memory import store_fact, get_recent_facts
        engine, factory, tmp = await _make_test_db()
        async with factory() as db:
            # Need a user first
            from db.models import User
            user_id = str(uuid.uuid4())
            session_id = str(uuid.uuid4())
            u = User(id=user_id, username="alice", role="ROOT")
            db.add(u)
            await db.flush()

            fid = await store_fact(db, user_id, session_id, "Важливий факт", importance=0.7)
            assert fid

            facts = await get_recent_facts(db, user_id)
            assert any(f["id"] == fid for f in facts)
            await db.commit()
        await engine.dispose()
        Path(tmp).unlink(missing_ok=True)

    async def test_get_recent_facts_filters_by_importance(self):
        from memory.tactical_memory import store_fact, get_recent_facts
        engine, factory, tmp = await _make_test_db()
        async with factory() as db:
            from db.models import User
            user_id = str(uuid.uuid4())
            u = User(id=user_id, username="bob", role="GUEST")
            db.add(u)
            await db.flush()

            await store_fact(db, user_id, "s1", "Low importance", importance=0.1)
            await store_fact(db, user_id, "s1", "High importance", importance=0.9)
            await db.flush()

            facts = await get_recent_facts(db, user_id, min_importance=0.5)
            assert len(facts) == 1
            assert facts[0]["content"] == "High importance"
            await db.commit()
        await engine.dispose()
        Path(tmp).unlink(missing_ok=True)

    async def test_prune_old_facts_deletes_below_threshold(self):
        from memory.tactical_memory import store_fact, prune_old_facts
        from db.models import MemoryFact
        from sqlalchemy import update as sa_update
        engine, factory, tmp = await _make_test_db()
        async with factory() as db:
            from db.models import User
            user_id = str(uuid.uuid4())
            u = User(id=user_id, username="prunetest", role="GUEST")
            db.add(u)
            await db.flush()

            fid = await store_fact(db, user_id, "s1", "Old low", importance=0.05)
            # Artificially age it
            old_ts = datetime.now(tz=timezone.utc) - timedelta(hours=48)
            await db.execute(
                sa_update(MemoryFact)
                .where(MemoryFact.id == fid)
                .values(created_at=old_ts)
            )
            await db.flush()

            deleted = await prune_old_facts(db, user_id)
            assert deleted >= 1
            await db.commit()
        await engine.dispose()
        Path(tmp).unlink(missing_ok=True)


# ═══════════════════════════════════════════════════════════════════════════════
# 7. Archive Memory
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
class TestArchiveMemory:
    async def test_store_and_retrieve_sealed_fact(self):
        from memory.archive_memory import store_archive_fact, get_sealed_facts
        engine, factory, tmp = await _make_test_db()
        async with factory() as db:
            from db.models import User
            user_id = str(uuid.uuid4())
            u = User(id=user_id, username="ghost_user", role="ROOT")
            db.add(u)
            await db.flush()

            fid = await store_archive_fact(db, user_id, "s1", "Secret observation")
            assert fid

            sealed = await get_sealed_facts(db, user_id)
            assert any(f["id"] == fid for f in sealed)
            # Content NOT exposed in get_sealed_facts
            for f in sealed:
                assert "content" not in f
            await db.commit()
        await engine.dispose()
        Path(tmp).unlink(missing_ok=True)

    async def test_unseal_fact(self):
        from memory.archive_memory import store_archive_fact, unseal_fact
        from memory.tactical_memory import get_recent_facts
        engine, factory, tmp = await _make_test_db()
        async with factory() as db:
            from db.models import User
            user_id = str(uuid.uuid4())
            u = User(id=user_id, username="unsealer", role="ROOT")
            db.add(u)
            await db.flush()

            fid = await store_archive_fact(db, user_id, "s1", "Unsealed content")
            result = await unseal_fact(db, fid, target_layer="tactical")
            assert result is True

            facts = await get_recent_facts(db, user_id)
            assert any(f["id"] == fid for f in facts)
            await db.commit()
        await engine.dispose()
        Path(tmp).unlink(missing_ok=True)

    async def test_seal_fact_in_db(self):
        from memory.archive_memory import seal_fact_in_db
        from memory.tactical_memory import store_fact, get_recent_facts
        engine, factory, tmp = await _make_test_db()
        async with factory() as db:
            from db.models import User
            user_id = str(uuid.uuid4())
            u = User(id=user_id, username="sealer", role="ROOT")
            db.add(u)
            await db.flush()

            fid = await store_fact(db, user_id, "s1", "To be sealed", importance=0.8)
            ok = await seal_fact_in_db(db, fid)
            assert ok is True

            # Should not appear in active tactical queries
            facts = await get_recent_facts(db, user_id)
            assert not any(f["id"] == fid for f in facts)
            await db.commit()
        await engine.dispose()
        Path(tmp).unlink(missing_ok=True)


# ═══════════════════════════════════════════════════════════════════════════════
# 8. AI Provider routing (mocked)
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
class TestAIRouter:
    async def test_router_uses_primary_on_success(self):
        from ai.provider import AIResponse, AIRouter

        mock_primary = AsyncMock()
        mock_primary.generate = AsyncMock(
            return_value=AIResponse(content="Primary response", provider="gemini")
        )
        mock_fallback = AsyncMock()
        mock_fallback.generate = AsyncMock(
            return_value=AIResponse(content="Fallback", provider="ollama")
        )

        router = AIRouter.__new__(AIRouter)
        router._providers = {"gemini": mock_primary, "ollama": mock_fallback}
        router._active = "gemini"

        with patch("ai.provider.config") as mock_cfg:
            mock_cfg.ai_primary_provider = "gemini"
            mock_cfg.ai_fallback_provider = "ollama"
            mock_cfg.ai_timeout_s = 5.0
            result = await router.generate("Hello", "system", [])

        assert result.content == "Primary response"
        assert result.provider == "gemini"

    async def test_router_falls_back_on_timeout(self):
        import asyncio
        from ai.provider import AIResponse, AIRouter

        async def _timeout(*args, **kwargs):
            raise asyncio.TimeoutError()

        mock_primary = AsyncMock()
        mock_primary.generate = AsyncMock(side_effect=asyncio.TimeoutError())
        mock_fallback = AsyncMock()
        mock_fallback.generate = AsyncMock(
            return_value=AIResponse(content="Fallback response", provider="ollama")
        )

        router = AIRouter.__new__(AIRouter)
        router._providers = {"gemini": mock_primary, "ollama": mock_fallback}
        router._active = "gemini"

        with patch("ai.provider.config") as mock_cfg:
            mock_cfg.ai_primary_provider = "gemini"
            mock_cfg.ai_fallback_provider = "ollama"
            mock_cfg.ai_timeout_s = 0.001  # force timeout
            result = await router.generate("Hello", "system", [])

        assert result.provider == "ollama"
        assert result.content == "Fallback response"

    async def test_router_raises_when_no_fallback(self):
        import asyncio
        from ai.provider import AIResponse, AIRouter

        mock_primary = AsyncMock()
        mock_primary.generate = AsyncMock(side_effect=RuntimeError("API down"))

        router = AIRouter.__new__(AIRouter)
        router._providers = {"gemini": mock_primary}
        router._active = "gemini"

        with patch("ai.provider.config") as mock_cfg:
            mock_cfg.ai_primary_provider = "gemini"
            mock_cfg.ai_fallback_provider = "none"
            mock_cfg.ai_timeout_s = 5.0
            with pytest.raises(RuntimeError):
                await router.generate("Hello", "system", [])

    async def test_router_stream_falls_back_to_non_stream(self):
        from ai.provider import AIResponse, AIRouter

        async def _fail_stream(*args, **kwargs):
            raise RuntimeError("stream error")
            yield  # make it an async generator

        mock_primary = MagicMock()
        mock_primary.generate_stream = _fail_stream

        mock_fallback = AsyncMock()
        mock_fallback.generate = AsyncMock(
            return_value=AIResponse(content="word1 word2 word3", provider="ollama")
        )

        router = AIRouter.__new__(AIRouter)
        router._providers = {"gemini": mock_primary, "ollama": mock_fallback}
        router._active = "gemini"

        chunks: list[str] = []
        with patch("ai.provider.config") as mock_cfg:
            mock_cfg.ai_primary_provider = "gemini"
            mock_cfg.ai_fallback_provider = "ollama"
            mock_cfg.ai_timeout_s = 5.0
            async for chunk in router.generate_stream("Hello", "system", []):
                chunks.append(chunk)

        full = "".join(chunks).strip()
        assert "word1" in full


# ═══════════════════════════════════════════════════════════════════════════════
# 9. Chat Routes (mocked AI)
# ═══════════════════════════════════════════════════════════════════════════════

@pytest_asyncio.fixture
async def chat_client() -> AsyncGenerator[AsyncClient, None]:
    """
    FastAPI test client with:
    - In-memory SQLite DB
    - Default ROOT user
    - AI provider mocked (no real API calls)
    """
    import db.database as _db_mod
    from main import app
    from db.database import get_db
    from security.auth import ensure_default_user
    from ai.provider import AIResponse
    from config import config

    test_engine, factory, tmp_file = await _make_test_db()
    original_engine = _db_mod.engine
    original_session = _db_mod.AsyncSessionLocal
    _db_mod.engine = test_engine
    _db_mod.AsyncSessionLocal = factory

    async def _override_get_db():
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    async with factory() as session:
        await ensure_default_user(session)
        await session.commit()

    # Boot parity: production runs the home_tenant lane right after
    # ensure_default_user (not skippable even under PHANTOM_SKIP_G2_WARMUP=1),
    # because get_current_tenant 403s every chat route for a tenantless user.
    # The lane swallows its own exceptions, so assert the binding happened.
    from lifespan_warmup import _lane_home_tenant
    await _lane_home_tenant()
    async with factory() as session:
        from sqlalchemy import select as _select
        from db.models import User
        root = (await session.execute(
            _select(User).where(User.username == "phantom")
        )).scalar_one()
        assert root.tenant_id, "home_tenant lane did not bind the ROOT user"

    app.dependency_overrides[get_db] = _override_get_db

    mock_response = AIResponse(
        content="Я PHANTOM, готовий допомогти.",
        response_form="text",
        attachments=[],
        provider="gemini",
        tokens_used=42,
        latency_ms=100,
    )
    prev_chat_tools_enabled = config.chat_tools_enabled
    config.chat_tools_enabled = False

    # Patch ChromaDB-dependent functions so tests run without chromadb installed
    try:
        with patch("ai.hub.ai_hub.dispatch", new=AsyncMock(return_value=mock_response)), \
             patch("ai.hub.ai_hub.route_state",
                   return_value=[{"task_class": "chat", "provider": "gemini"}]), \
             patch("memory.strategic_memory.retrieve_relevant",
                   new=AsyncMock(return_value=[])), \
             patch("memory.strategic_memory.extract_and_store_facts",
                   new=AsyncMock(return_value=[])):

            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                yield client
    finally:
        config.chat_tools_enabled = prev_chat_tools_enabled
        app.dependency_overrides.clear()
        _db_mod.engine = original_engine
        _db_mod.AsyncSessionLocal = original_session
        await test_engine.dispose()
        Path(tmp_file).unlink(missing_ok=True)


@pytest.mark.asyncio
class TestChatRoutes:
    async def _login(self, client: AsyncClient) -> str:
        resp = await client.post("/api/v1/auth/login/pin",
                                  json={"username": "phantom", "pin": "000000"})
        assert resp.status_code == 200
        return resp.json()["token"]

    async def test_send_message_requires_auth(self, chat_client):
        resp = await chat_client.post("/api/v1/chat/message",
                                       json={"content": "Hello"})
        assert resp.status_code == 401

    async def test_list_sessions_requires_auth(self, chat_client):
        resp = await chat_client.get("/api/v1/chat/sessions")
        assert resp.status_code == 401

    async def test_list_sessions_empty(self, chat_client):
        token = await self._login(chat_client)
        resp = await chat_client.get("/api/v1/chat/sessions",
                                      headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        assert resp.json()["sessions"] == []
        assert resp.json()["total"] == 0

    async def test_get_messages_session_not_found(self, chat_client):
        token = await self._login(chat_client)
        resp = await chat_client.get(
            "/api/v1/chat/sessions/nonexistent/messages",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 404

    async def test_delete_session_not_found(self, chat_client):
        token = await self._login(chat_client)
        resp = await chat_client.delete(
            "/api/v1/chat/sessions/nonexistent",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 404

    async def test_send_message_happy_path(self, chat_client):
        """Full pipeline: auth → send message → AI response → persisted in DB."""
        # ai_router.generate is already mocked in chat_client fixture
        token = await self._login(chat_client)
        resp = await chat_client.post(
            "/api/v1/chat/message",
            json={"content": "Привіт PHANTOM", "input_method": "text"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "message" in data
        assert "session_id" in data
        msg = data["message"]
        assert msg["role"] == "assistant"
        assert len(msg["content"]) > 0
        assert msg["response_form"] == "text"

    async def test_send_message_creates_session(self, chat_client):
        """First message creates a new session visible in /sessions."""
        token = await self._login(chat_client)
        await chat_client.post(
            "/api/v1/chat/message",
            json={"content": "Hello", "input_method": "text"},
            headers={"Authorization": f"Bearer {token}"},
        )
        sessions_resp = await chat_client.get(
            "/api/v1/chat/sessions",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert sessions_resp.status_code == 200
        assert sessions_resp.json()["total"] >= 1

    async def test_get_session_messages_returns_both_roles(self, chat_client):
        """After send, /messages returns user + assistant roles."""
        token = await self._login(chat_client)
        send_resp = await chat_client.post(
            "/api/v1/chat/message",
            json={"content": "Test msg", "input_method": "text"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert send_resp.status_code == 200
        session_id = send_resp.json()["session_id"]

        msgs_resp = await chat_client.get(
            f"/api/v1/chat/sessions/{session_id}/messages",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert msgs_resp.status_code == 200
        roles = {m["role"] for m in msgs_resp.json()["messages"]}
        assert "user" in roles
        assert "assistant" in roles

    async def test_delete_session_removes_it(self, chat_client):
        """Deleting a session removes it from /sessions list."""
        token = await self._login(chat_client)
        send_resp = await chat_client.post(
            "/api/v1/chat/message",
            json={"content": "hello", "input_method": "text"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert send_resp.status_code == 200
        session_id = send_resp.json()["session_id"]

        del_resp = await chat_client.delete(
            f"/api/v1/chat/sessions/{session_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert del_resp.status_code == 200
        assert del_resp.json()["ok"] is True

        sessions = await chat_client.get(
            "/api/v1/chat/sessions",
            headers={"Authorization": f"Bearer {token}"},
        )
        ids = [s["id"] for s in sessions.json()["sessions"]]
        assert session_id not in ids

    async def test_list_sessions_cleans_empty_sessions(self, chat_client):
        """Empty sessions (message_count == 0) are cleaned on list_sessions."""
        token = await self._login(chat_client)
        # Create an empty session directly in the DB
        import db.database as _db_mod
        from db.models import ChatSession
        async with _db_mod.AsyncSessionLocal() as session:
            from sqlalchemy import select
            from db.models import User
            res = await session.execute(select(User).where(User.username == "phantom"))
            user = res.scalar_one()
            empty_sess = ChatSession(id=str(uuid.uuid4()), user_id=user.id, message_count=0)
            session.add(empty_sess)
            await session.commit()
            empty_id = empty_sess.id

        # List sessions
        resp = await chat_client.get(
            "/api/v1/chat/sessions",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        # Check that the empty session is not in the list and has been deleted
        ids = [s["id"] for s in resp.json()["sessions"]]
        assert empty_id not in ids

        # Verify deletion from DB
        async with _db_mod.AsyncSessionLocal() as session:
            res = await session.execute(select(ChatSession).where(ChatSession.id == empty_id))
            assert res.scalar_one_or_none() is None

    async def test_list_sessions_cleans_failed_sessions(self, chat_client):
        """Sessions with message_count <= 2 and assistant message matching fallback error are cleaned."""
        token = await self._login(chat_client)
        import db.database as _db_mod
        from db.models import ChatSession, ChatMessage, User
        async with _db_mod.AsyncSessionLocal() as session:
            from sqlalchemy import select
            res = await session.execute(select(User).where(User.username == "phantom"))
            user = res.scalar_one()
            
            # Create a session with a user prompt and a failed/fallback reply
            failed_sess = ChatSession(id=str(uuid.uuid4()), user_id=user.id, message_count=2)
            session.add(failed_sess)
            await session.flush()
            
            msg1 = ChatMessage(
                id=str(uuid.uuid4()), session_id=failed_sess.id, user_id=user.id,
                role="user", content="Test prompt", response_form="text", attachments_json="[]"
            )
            msg2 = ChatMessage(
                id=str(uuid.uuid4()), session_id=failed_sess.id, user_id=user.id,
                role="assistant", content="Не встиг сформулювати — перепитай?", response_form="text", attachments_json="[]"
            )
            session.add(msg1)
            session.add(msg2)
            await session.commit()
            failed_id = failed_sess.id

        # List sessions
        resp = await chat_client.get(
            "/api/v1/chat/sessions",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        ids = [s["id"] for s in resp.json()["sessions"]]
        assert failed_id not in ids

        # Verify deletion of session and messages from DB
        async with _db_mod.AsyncSessionLocal() as session:
            res = await session.execute(select(ChatSession).where(ChatSession.id == failed_id))
            assert res.scalar_one_or_none() is None
            
            res_msg = await session.execute(select(ChatMessage).where(ChatMessage.session_id == failed_id))
            assert res_msg.scalars().all() == []

