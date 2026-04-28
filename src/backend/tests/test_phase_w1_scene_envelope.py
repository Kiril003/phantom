"""Day-4 Wave-1 — Block W-1: scene envelope wire format on `_serialize_message`.

Implements ADR-CS-002 (`docs/architecture/chat-liveness.md` §2). Closes
audit U1-UX-C2 schema gap that left ChatScene composer
(W-2 Wave-2) with no contract to consume.

Coverage:

* Absent scene → no `message.scene` key on the wire (back-compat
  invariant ADR-CS-002 §117 — pixel-snapshot baseline at `e12188f` MUST
  be unaffected).
* `attachments_json = [{"type":"scene","data":{...}}]` → promoted to
  `message.scene = {...}` AND stripped from the published `attachments`
  list (no double-render).
* Mixed attachments — the scene attachment is promoted while non-scene
  attachments stay in the list.
* Multiple scene attachments — only the first is surfaced (Day-4 closed
  contract: one scene per message; future multi-scene needs an ADR
  amendment).
* Corrupt `attachments_json` doesn't crash and logs WARNING (Day-2 F-66
  invariant preserved).
"""
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest


def _make_msg(*, attachments_json: str, metadata_json: str = "{}") -> SimpleNamespace:
    """Hand-rolled stand-in for `db.models.ChatMessage` — `_serialize_message`
    only touches a fixed set of attrs, so a SimpleNamespace is enough and
    keeps the test free of DB setup."""
    from datetime import datetime, timezone

    return SimpleNamespace(
        id="msg-w1-test",
        session_id="sess-1",
        user_id="user-1",
        role="assistant",
        content="hello",
        response_form="text",
        metadata_json=metadata_json,
        attachments_json=attachments_json,
        created_at=datetime(2026, 5, 1, 12, 0, 0, tzinfo=timezone.utc),
    )


# ──────────────────────────────────────────────── absent scene ──


class TestNoScene:
    def test_no_attachments_no_scene_key(self):
        from api.routes_chat import _serialize_message

        out = _serialize_message(_make_msg(attachments_json="[]"))

        assert "scene" not in out, (
            "W-1 regression: empty-attachments message carried a scene key. "
            "Back-compat invariant ADR-CS-002 §117 violated."
        )
        assert out["attachments"] == []

    def test_only_legacy_attachments_no_scene_key(self):
        from api.routes_chat import _serialize_message

        legacy = [
            {"type": "code_block", "data": {"language": "py", "code": "x=1"}},
            {"type": "metric_card", "data": {"metrics": []}},
        ]
        out = _serialize_message(
            _make_msg(attachments_json=json.dumps(legacy))
        )

        assert "scene" not in out
        assert out["attachments"] == legacy


# ──────────────────────────────────────────────── scene promotion ──


class TestScenePromotion:
    def test_scene_promoted_to_top_level(self):
        from api.routes_chat import _serialize_message

        scene_data = {
            "kind": "plan",
            "panels": [
                {
                    "id": "p0",
                    "kind": "plan-step",
                    "data": {"title": "step1", "state": "pending"},
                },
            ],
            "reveal": {"policy": "sequential", "staggerMs": 80},
        }
        atts = [{"type": "scene", "data": scene_data}]

        out = _serialize_message(
            _make_msg(attachments_json=json.dumps(atts))
        )

        assert out["scene"] == scene_data
        assert out["attachments"] == [], (
            "W-1 regression: scene attachment leaked into the published "
            "attachments list — would cause double-render."
        )

    def test_scene_alongside_legacy_attachment(self):
        from api.routes_chat import _serialize_message

        scene_data = {"kind": "text", "panels": []}
        legacy = {
            "type": "code_block",
            "data": {"language": "py", "code": "x"},
        }
        atts = [legacy, {"type": "scene", "data": scene_data}]

        out = _serialize_message(
            _make_msg(attachments_json=json.dumps(atts))
        )

        assert out["scene"] == scene_data
        assert out["attachments"] == [legacy], (
            "W-1 regression: scene split lost the legacy attachment"
        )

    def test_multiple_scenes_only_first_surfaced(self):
        """Day-4 contract: one scene per message. If two scene attachments
        somehow appear (legacy bug or test-corrupted state), the first
        wins; the second is silently dropped (not re-classified as a
        legacy attachment, which would crash the frontend type-check)."""
        from api.routes_chat import _serialize_message

        a = {"kind": "text", "panels": [{"id": "0", "kind": "text", "data": {"markdown": "a"}}]}
        b = {"kind": "list", "panels": []}
        atts = [
            {"type": "scene", "data": a},
            {"type": "scene", "data": b},
        ]

        out = _serialize_message(
            _make_msg(attachments_json=json.dumps(atts))
        )

        assert out["scene"] == a
        assert out["attachments"] == []  # both scenes consumed


# ──────────────────────────────────────────────── malformed shapes ──


class TestMalformedHandling:
    def test_scene_typed_attachment_with_bad_data_kept_as_attachment(self):
        """A `type: scene` attachment whose `data` isn't a dict is NOT
        a scene — the serializer leaves it in the attachments list so a
        downstream debugger can see the corrupt row instead of having
        the scene silently dropped."""
        from api.routes_chat import _serialize_message

        bad = {"type": "scene", "data": "not-a-dict"}
        out = _serialize_message(
            _make_msg(attachments_json=json.dumps([bad]))
        )

        assert "scene" not in out
        assert out["attachments"] == [bad]

    def test_corrupt_attachments_json_does_not_raise(self, caplog):
        """Day-2 F-66 invariant: a corrupt `attachments_json` logs a
        WARNING but the serializer keeps going (empty attachments,
        no scene). W-1 must preserve this."""
        import logging

        from api.routes_chat import _serialize_message

        with caplog.at_level(logging.WARNING):
            out = _serialize_message(_make_msg(attachments_json="not-json"))

        assert "scene" not in out
        assert out["attachments"] == []
        assert any(
            "attachments_json corrupt" in r.message for r in caplog.records
        )


# ──────────────────────────────────────────────── shared types pin ──


class TestSharedTypesContract:
    def test_scenekind_union_matches_adr_six_values(self):
        """The SceneKind union is a closed enum (ADR-CS-001 §39).
        Catches a future TypeScript-side change that adds a 7th kind
        without amending the ADR. Pin via grep — keeps the test free of
        a TS toolchain dep on the pytest CI."""
        from pathlib import Path

        # __file__ = .../phantom-os/src/backend/tests/test_*.py.
        # parents[0]=tests, [1]=backend, [2]=src → src/shared/types/chat.ts.
        chat_ts = (
            Path(__file__).resolve().parents[2]
            / "shared"
            / "types"
            / "chat.ts"
        )
        body = chat_ts.read_text(encoding="utf-8")

        for kind in (
            "'text'",
            "'list'",
            "'map-pin'",
            "'plan'",
            "'code-preview'",
            "'identity-card'",
        ):
            assert kind in body, (
                f"SceneKind missing literal {kind} in chat.ts — ADR-CS-001 §39 "
                "lists exactly six values; restore it or amend the ADR."
            )
