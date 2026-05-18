"""
Phase 9.3a Part 2 — expanded SelfModel surfaces.

Tests cover schema defaults, relationship tracking, FIFO concerns / successes,
heuristic concern extraction from Ukrainian user text, planner prompt
injection of the new fields.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from agent.schemas import EmotionVector, Relationship, SelfModel
from agent.cognition.self_model import (
    add_concern,
    decay_stale_concerns,
    get_or_create_relationship,
    maybe_add_concern_from_user_text,
    note_interaction,
    record_success,
    update_known_preference,
)


# ── schema defaults ──────────────────────────────────────────────────────────


def test_selfmodel_defaults_empty():
    sm = SelfModel()
    assert sm.relationships == {}
    assert sm.active_concerns == []
    assert sm.recent_successes == []


def test_relationship_defaults():
    r = Relationship(user_id="u1")
    assert r.user_id == "u1"
    assert r.trust_level == 0.5
    assert r.interaction_count == 0
    assert r.last_interaction_at is None
    assert r.known_preferences == []


# ── relationship tracking ────────────────────────────────────────────────────


def test_get_or_create_relationship_idempotent():
    sm = SelfModel()
    r1 = get_or_create_relationship(sm, "user-abc")
    r2 = get_or_create_relationship(sm, "user-abc")
    assert r1 is r2
    assert len(sm.relationships) == 1


def test_note_interaction_bumps_count_and_timestamp():
    sm = SelfModel()
    t0 = datetime.now(tz=timezone.utc)
    note_interaction(sm, "user-abc")
    note_interaction(sm, "user-abc")
    note_interaction(sm, "user-abc")
    r = sm.relationships["user-abc"]
    assert r.interaction_count == 3
    assert r.last_interaction_at is not None
    assert r.last_interaction_at >= t0


def test_update_known_preference_dedups_and_caps():
    sm = SelfModel()
    # Add 12 distinct prefs; cap is 10.
    for i in range(12):
        update_known_preference(sm, "u", f"pref-{i}")
    r = sm.relationships["u"]
    assert len(r.known_preferences) == 10
    # FIFO — newest survive, so "pref-0" and "pref-1" dropped.
    assert "pref-0" not in r.known_preferences
    assert "pref-11" in r.known_preferences

    # Dedup — adding an existing one is a no-op.
    before = list(r.known_preferences)
    update_known_preference(sm, "u", "pref-11")
    assert r.known_preferences == before


# ── FIFO concerns ────────────────────────────────────────────────────────────


def test_active_concerns_fifo_at_10():
    sm = SelfModel()
    for i in range(12):
        add_concern(sm, f"c-{i}")
    assert len(sm.active_concerns) == 10
    assert "c-0" not in sm.active_concerns
    assert "c-11" in sm.active_concerns


def test_active_concerns_dedup_refreshes():
    sm = SelfModel()
    add_concern(sm, "disk low")
    add_concern(sm, "cpu high")
    add_concern(sm, "disk low")  # refreshes — moves to end
    assert sm.active_concerns == ["cpu high", "disk low"]


def test_decay_stale_concerns_with_timestamps():
    sm = SelfModel()
    add_concern(sm, "old concern")
    add_concern(sm, "new concern")
    now = datetime.now(tz=timezone.utc)
    ts = {
        "old concern": now - timedelta(hours=25),
        "new concern": now - timedelta(hours=1),
    }
    dropped = decay_stale_concerns(sm, now=now, last_refresh=ts)
    assert dropped == 1
    assert sm.active_concerns == ["new concern"]


def test_decay_stale_concerns_noop_without_timestamps():
    """When last_refresh map is not provided, nothing decays (9.3b will wire
    real timestamps into the runtime)."""
    sm = SelfModel()
    add_concern(sm, "any")
    assert decay_stale_concerns(sm) == 0
    assert sm.active_concerns == ["any"]


# ── FIFO successes ───────────────────────────────────────────────────────────


def test_recent_successes_fifo_at_5():
    sm = SelfModel()
    for i in range(7):
        record_success(sm, f"task #{i} done")
    assert len(sm.recent_successes) == 5
    assert all(f"task #{i} done" not in sm.recent_successes for i in range(2))
    assert "task #6 done" in sm.recent_successes


def test_recent_successes_skip_empty():
    sm = SelfModel()
    record_success(sm, "")
    record_success(sm, "x")
    assert sm.recent_successes == ["x"]


# ── heuristic concern extraction ─────────────────────────────────────────────


def test_concern_from_ukrainian_text_down():
    sm = SelfModel()
    added = maybe_add_concern_from_user_text(sm, "мені сьогодні сумно і немає настрою")
    assert added == ["user mentioned feeling down"]
    assert "user mentioned feeling down" in sm.active_concerns


def test_concern_from_ukrainian_text_fatigue():
    sm = SelfModel()
    added = maybe_add_concern_from_user_text(sm, "я дуже втомився сьогодні")
    assert added == ["user mentioned fatigue"]


def test_concern_from_ukrainian_text_unwell():
    sm = SelfModel()
    added = maybe_add_concern_from_user_text(sm, "щось мені погано себе почуваю")
    assert added == ["user mentioned not feeling well"]


def test_concern_ignores_unrelated_text():
    sm = SelfModel()
    assert maybe_add_concern_from_user_text(sm, "прочитай /etc/hosts") == []
    assert sm.active_concerns == []


def test_concern_extraction_dedups_across_calls():
    sm = SelfModel()
    maybe_add_concern_from_user_text(sm, "я втомився")
    # Second call — already in concerns, should not be re-added (but it will
    # get refreshed via add_concern's dedup path).
    added = maybe_add_concern_from_user_text(sm, "я дуже втомлений")
    assert added == []
    # Concern is present exactly once.
    assert sm.active_concerns.count("user mentioned fatigue") == 1


# ── planner prompt includes expanded fields ──────────────────────────────────


def test_planner_prompt_includes_concerns_and_successes():
    """tactical._build_user_message serializes the full SelfModel — new
    fields land in the JSON blob the LLM sees."""
    import json
    from agent.cognition.planner.tactical import _build_user_message
    from agent.schemas import SelfModel, SubGoal

    sm = SelfModel(
        active_concerns=["disk at 86%", "user mentioned fatigue"],
        recent_successes=["fetched weather ok", "compiled report"],
    )
    sg = SubGoal(
        description="do something",
        rationale="because",
        expected_actions=2,
        acceptance_criteria="",
    )
    msg = _build_user_message(
        self_model=sm, sub_goal=sg, observations=[], actions_in_sub_goal=0,
    )
    # Round-trip the SELF: block — must still carry the expanded surfaces.
    assert "active_concerns" in msg
    assert "disk at 86%" in msg
    assert "recent_successes" in msg
    assert "compiled report" in msg
    # Sanity — still valid JSON embedded.
    self_line = msg.split("SELF:\n", 1)[1].split("\n", 1)[0]
    parsed = json.loads(self_line)
    assert "user mentioned fatigue" in parsed["active_concerns"]


def test_planner_prompt_includes_relationship_when_populated():
    import json
    from agent.cognition.planner.tactical import _build_user_message
    from agent.schemas import SelfModel, SubGoal

    sm = SelfModel()
    note_interaction(sm, "user-main")
    update_known_preference(sm, "user-main", "prefers terse answers")
    sg = SubGoal(description="x", rationale="y", expected_actions=1,
                 acceptance_criteria="")
    msg = _build_user_message(
        self_model=sm, sub_goal=sg, observations=[], actions_in_sub_goal=0,
    )
    self_line = msg.split("SELF:\n", 1)[1].split("\n", 1)[0]
    parsed = json.loads(self_line)
    assert "relationships" in parsed
    assert "user-main" in parsed["relationships"]
    assert "prefers terse answers" in parsed["relationships"]["user-main"]["known_preferences"]


# Sanity — EmotionVector still imported successfully (covers a stray
# regression in import order).
def test_emotion_vector_still_importable():
    sm = SelfModel()
    assert isinstance(sm.emotion, EmotionVector)
