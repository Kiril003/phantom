"""Block B-3 regression tests — audit 2026-04-28 observability quick wins.

Covers:
  F-38: config.apply_overrides logs WARNING on rejection / unknown key
        instead of silently dropping the value.
  F-66: chat _serialize_message logs WARNING on corrupt metadata_json /
        attachments_json instead of producing an empty bubble silently.
  F-34: ai/provider.py _classify_provider_exception narrows its swallow
        to ImportError (regression-shape test only).
"""

from __future__ import annotations

import logging
from types import SimpleNamespace

import pytest


# ── F-38 — apply_overrides logging ────────────────────────────────────────────

class TestF38ApplyOverridesLogged:
    def test_unknown_key_logs_warning(self, caplog):
        from config import config
        with caplog.at_level(logging.WARNING, logger="config"):
            config.apply_overrides({"some_key_that_does_not_exist": 42})
        assert any(
            "unknown key" in rec.getMessage().lower()
            for rec in caplog.records
        ), "F-38 regression: unknown key did not emit a WARNING"

    def test_validation_failure_logs_warning(self, caplog):
        from config import config
        # voice_stt_mode is a Literal — assigning a junk value triggers
        # Pydantic validation.
        with caplog.at_level(logging.WARNING, logger="config"):
            config.apply_overrides({"voice_stt_mode": "completely_invalid_mode"})
        assert any(
            "rejected" in rec.getMessage().lower()
            and "voice_stt_mode" in rec.getMessage()
            for rec in caplog.records
        ), "F-38 regression: bad value did not emit a WARNING"

    def test_apply_overrides_does_not_raise_on_bad_value(self):
        # The function still handles bad input gracefully — it just makes
        # the failure observable now.
        from config import config
        before = config.voice_stt_mode
        config.apply_overrides({"voice_stt_mode": "junk"})
        after = config.voice_stt_mode
        assert before == after, "Bad value somehow leaked through"


# ── F-66 — chat metadata JSON parse logging ───────────────────────────────────

class TestF66ChatJsonParseLogged:
    def _fake_msg(self, *, metadata="{}", attachments="[]"):
        # Stand-in for ChatMessage ORM row — only the attrs _serialize_message
        # touches.
        from datetime import datetime, timezone
        return SimpleNamespace(
            id="msg-test",
            session_id="sess-test",
            user_id="u-test",
            role="assistant",
            content="hi",
            response_form="text",
            metadata_json=metadata,
            attachments_json=attachments,
            created_at=datetime.now(tz=timezone.utc),
        )

    def test_clean_message_no_warning(self, caplog):
        from api.routes_chat import _serialize_message
        with caplog.at_level(logging.WARNING, logger="api.routes_chat"):
            out = _serialize_message(self._fake_msg())
        assert out["metadata"] == {}
        assert out["attachments"] == []
        assert all("corrupt" not in r.getMessage() for r in caplog.records)

    def test_corrupt_metadata_logs_warning(self, caplog):
        from api.routes_chat import _serialize_message
        with caplog.at_level(logging.WARNING, logger="api.routes_chat"):
            out = _serialize_message(self._fake_msg(metadata="not_valid_json}{"))
        assert out["metadata"] == {}, "corrupt metadata should fall back to {}"
        assert any(
            "metadata_json corrupt" in r.getMessage()
            for r in caplog.records
        ), "F-66 regression: corrupt metadata did not log"

    def test_corrupt_attachments_logs_warning(self, caplog):
        from api.routes_chat import _serialize_message
        with caplog.at_level(logging.WARNING, logger="api.routes_chat"):
            out = _serialize_message(self._fake_msg(attachments="<<broken>>"))
        assert out["attachments"] == []
        assert any(
            "attachments_json corrupt" in r.getMessage()
            for r in caplog.records
        ), "F-66 regression: corrupt attachments did not log"


# ── F-34 — provider classifier narrow except ──────────────────────────────────

class TestF34ProviderClassifyShape:
    def test_classifier_still_returns_tuple_for_known_provider(self):
        from ai.provider import _classify_provider_exception
        from ai.tool_use import ToolErrorKind

        result = _classify_provider_exception("gemini", RuntimeError("boom"))
        assert isinstance(result, tuple) and len(result) == 3
        kind, retriable, retry_after = result
        assert isinstance(kind, ToolErrorKind)
        assert isinstance(retriable, bool)

    def test_classifier_unknown_provider_falls_through(self):
        from ai.provider import _classify_provider_exception
        from ai.tool_use import ToolErrorKind

        kind, retriable, _ = _classify_provider_exception("unknown_xyz", RuntimeError())
        assert kind == ToolErrorKind.NETWORK
        assert retriable is True
