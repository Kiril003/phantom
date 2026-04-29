"""Day-4 Wave-2 T-2 — action-kind discriminator (ADR-SOH-003).

Coverage:

1. ActionSpec union accepts each of the 4 kinds and rejects unknown.
2. parse_action(speak/notify/task/webhook) round-trips correctly.
3. parse_action({"goal": "..."}) is the legacy shorthand → TaskAction
   + emits DeprecationWarning ONCE per process.
4. parse_action({}) raises ValueError ("missing kind").
5. parse_action(non-dict) raises ValueError.
6. parse_action(invalid kind) raises ValueError.
7. action_kind_for_row(legacy goal) → "task".
8. action_kind_for_row({"kind": "speak"}) → "speak".
9. action_kind_for_row(corrupt JSON) → "task" (defensive).
10. StandingOrder.action_kind ORM column present + indexed.
"""
from __future__ import annotations

import json
import warnings

import pytest


# ────────────────────────────────────────────────────────── ActionSpec ──


class TestActionSpecModels:
    def test_speak_action_required_fields(self):
        from agent.standing_orders.actions import SpeakAction

        a = SpeakAction(text="hello world")
        assert a.kind == "speak"
        assert a.voice is None

    def test_notify_action_required_fields(self):
        from agent.standing_orders.actions import NotifyAction

        a = NotifyAction(title="Heads up", body="nothing burning")
        assert a.kind == "notify"
        assert a.target_user_id is None

    def test_task_action_required_fields(self):
        from agent.standing_orders.actions import TaskAction

        a = TaskAction(goal="run nightly summary")
        assert a.kind == "task"

    def test_webhook_action_defaults_to_post(self):
        from agent.standing_orders.actions import WebhookAction

        a = WebhookAction(url="https://api.example.com/hook")
        assert a.kind == "webhook"
        assert a.method == "POST"


# ────────────────────────────────────────────────────────── parse_action ──


class TestParseAction:
    def test_speak_round_trip(self):
        from agent.standing_orders.actions import SpeakAction, parse_action

        out = parse_action({"kind": "speak", "text": "hi"})
        assert isinstance(out, SpeakAction)
        assert out.text == "hi"

    def test_notify_round_trip(self):
        from agent.standing_orders.actions import NotifyAction, parse_action

        out = parse_action(
            {"kind": "notify", "title": "T", "body": "B"}
        )
        assert isinstance(out, NotifyAction)
        assert out.body == "B"

    def test_task_round_trip(self):
        from agent.standing_orders.actions import TaskAction, parse_action

        out = parse_action({"kind": "task", "goal": "do stuff"})
        assert isinstance(out, TaskAction)
        assert out.goal == "do stuff"

    def test_webhook_round_trip(self):
        from agent.standing_orders.actions import WebhookAction, parse_action

        out = parse_action(
            {
                "kind": "webhook",
                "url": "https://example.com/hook",
                "method": "GET",
            }
        )
        assert isinstance(out, WebhookAction)
        assert out.method == "GET"

    def test_legacy_goal_shorthand_promotes_to_task(self):
        """Day-3 rows: {"goal": "..."} sans `kind` → TaskAction +
        one DeprecationWarning per process."""
        from agent.standing_orders import actions as mod
        from agent.standing_orders.actions import TaskAction, parse_action

        # Reset the one-time warning sentinel so this test is
        # repeatable in any order.
        mod._LEGACY_WARNED = False

        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always", DeprecationWarning)
            out = parse_action({"goal": "legacy"})
        assert isinstance(out, TaskAction)
        assert out.goal == "legacy"
        assert any(
            issubclass(item.category, DeprecationWarning) for item in w
        )

        # Second call → still TaskAction but no second warning emitted.
        with warnings.catch_warnings(record=True) as w2:
            warnings.simplefilter("always", DeprecationWarning)
            parse_action({"goal": "legacy-2"})
        assert not any(
            issubclass(item.category, DeprecationWarning) for item in w2
        )

    def test_missing_kind_no_goal_raises(self):
        from agent.standing_orders.actions import parse_action

        with pytest.raises(ValueError):
            parse_action({})
        with pytest.raises(ValueError):
            parse_action({"text": "no kind"})

    def test_invalid_kind_raises(self):
        from agent.standing_orders.actions import parse_action

        with pytest.raises(ValueError):
            parse_action({"kind": "totally_made_up", "x": 1})

    def test_non_dict_raises(self):
        from agent.standing_orders.actions import parse_action

        with pytest.raises(ValueError):
            parse_action("oops")  # type: ignore[arg-type]


# ───────────────────────────────────────────────────── action_kind_for_row ──


class TestActionKindForRow:
    def test_typed_kind_returned(self):
        from agent.standing_orders.actions import action_kind_for_row

        assert (
            action_kind_for_row(json.dumps({"kind": "speak", "text": "x"}))
            == "speak"
        )

    def test_legacy_goal_returns_task(self):
        from agent.standing_orders.actions import action_kind_for_row

        assert action_kind_for_row(json.dumps({"goal": "x"})) == "task"

    def test_corrupt_json_returns_task(self):
        from agent.standing_orders.actions import action_kind_for_row

        assert action_kind_for_row("{not-json") == "task"

    def test_empty_string_returns_task(self):
        from agent.standing_orders.actions import action_kind_for_row

        assert action_kind_for_row("") == "task"

    def test_unknown_kind_returns_task(self):
        from agent.standing_orders.actions import action_kind_for_row

        assert action_kind_for_row(json.dumps({"kind": "alien"})) == "task"


# ──────────────────────────────────────────────────────────── ORM column ──


class TestActionKindColumn:
    def test_column_present_and_indexed(self):
        from db.models import StandingOrder

        cols = {c.name for c in StandingOrder.__table__.columns}
        assert "action_kind" in cols

        idx_cols: set[str] = set()
        for ix in StandingOrder.__table__.indexes:
            for col in ix.columns:
                idx_cols.add(col.name)
        assert "action_kind" in idx_cols
