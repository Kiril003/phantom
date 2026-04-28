"""Tier-E L-5 + L-6 — Day-2 audit ops hardening.

* **L-5 (D2-D-G2)** — `.dockerignore` excludes the dev `phantom.db`
  files from the build context so the image doesn't bake operator
  data (sealed memories, behavioural model, audit-log rows).
* **L-6 (structlog JSON renderer)** — `observability.JsonFormatter`
  emits structured JSON rows; `install_json_logging()` is the
  idempotent wire-up the lifespan hook reads off the `log_json_enabled`
  config flag. Operators on a journal/Loki/CloudWatch pipeline get
  parsable output without touching every `logger.info(...)` call site.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import pytest


# ── L-5 — .dockerignore exhaustive phantom.db exclusion ───────────────────────


class TestL5DockerIgnoreExcludesPhantomDb:
    def test_dockerignore_uses_glob_for_phantom_db(self):
        # The dev daemon writes phantom.db at whatever cwd init_db runs
        # from, so over the lifetime of the repo we accumulate copies
        # under src/backend/, src/frontend/, src/backend/db/. The
        # .dockerignore MUST use a recursive glob pattern (`**/phantom.db`)
        # rather than enumerate exact paths — exact paths drift.
        repo_root = Path(__file__).resolve().parents[3]
        dockerignore = repo_root / ".dockerignore"
        assert dockerignore.is_file()
        text = dockerignore.read_text()
        assert "**/phantom.db" in text, (
            "D2-D-G2 regression: .dockerignore no longer carries the "
            "recursive `**/phantom.db` glob — copies under "
            "src/backend/, src/frontend/, src/backend/db/ would bake "
            "into the image."
        )
        # SQLite write-ahead and journal files carry the same data risk.
        for sidecar in ("**/phantom.db-journal", "**/phantom.db-shm",
                         "**/phantom.db-wal"):
            assert sidecar in text, (
                f"D2-D-G2 regression: {sidecar!r} not covered by "
                f".dockerignore — checkpointed write-ahead state would "
                f"reach the image even when phantom.db itself is "
                f"excluded."
            )


# ── L-6 — structured JSON log formatter ───────────────────────────────────────


class TestL6JsonFormatter:
    def test_basic_row_carries_canonical_fields(self):
        from observability import JsonFormatter

        formatter = JsonFormatter()
        record = logging.LogRecord(
            name="phantom.test",
            level=logging.INFO,
            pathname=__file__,
            lineno=42,
            msg="hello %s",
            args=("world",),
            exc_info=None,
        )
        out = formatter.format(record)
        payload = json.loads(out)

        assert payload["level"] == "INFO"
        assert payload["logger"] == "phantom.test"
        assert payload["message"] == "hello world"
        assert "ts" in payload
        # ts is ISO-8601 UTC.
        assert payload["ts"].endswith("Z")

    def test_correlation_id_surfaces_when_filter_set_it(self):
        from observability import CorrelationFilter, JsonFormatter, _correlation_id

        formatter = JsonFormatter()
        record = logging.LogRecord(
            name="phantom.test",
            level=logging.INFO,
            pathname=__file__,
            lineno=1,
            msg="x",
            args=(),
            exc_info=None,
        )
        filt = CorrelationFilter()
        token = _correlation_id.set("req-abc-123")
        try:
            assert filt.filter(record) is True
            out = formatter.format(record)
        finally:
            _correlation_id.reset(token)
        payload = json.loads(out)
        assert payload["correlation_id"] == "req-abc-123"

    def test_correlation_id_omitted_outside_request(self):
        # Outside an HTTP request the filter writes "-". The JSON
        # formatter MUST drop the field rather than emit a misleading
        # placeholder — operators grepping `correlation_id` should
        # only match real requests.
        from observability import CorrelationFilter, JsonFormatter

        formatter = JsonFormatter()
        record = logging.LogRecord(
            name="phantom.test",
            level=logging.INFO,
            pathname=__file__,
            lineno=1,
            msg="bg",
            args=(),
            exc_info=None,
        )
        CorrelationFilter().filter(record)  # contextvar empty → "-"
        payload = json.loads(formatter.format(record))
        assert "correlation_id" not in payload

    def test_extra_fields_merge_into_payload(self):
        from observability import JsonFormatter

        formatter = JsonFormatter()
        record = logging.LogRecord(
            name="phantom.test",
            level=logging.WARNING,
            pathname=__file__,
            lineno=1,
            msg="rate limited",
            args=(),
            exc_info=None,
        )
        # Standard library: arbitrary attributes on the record are
        # merged into the JSON row. logger.warning(..., extra={...})
        # lands here.
        record.user_id = "phantom"
        record.retry_after_s = 30
        payload = json.loads(formatter.format(record))
        assert payload["user_id"] == "phantom"
        assert payload["retry_after_s"] == 30

    def test_non_serialisable_extra_is_str_coerced(self):
        from observability import JsonFormatter

        formatter = JsonFormatter()
        record = logging.LogRecord(
            name="phantom.test",
            level=logging.INFO,
            pathname=__file__,
            lineno=1,
            msg="custom",
            args=(),
            exc_info=None,
        )

        class _Custom:
            def __str__(self):
                return "<custom-obj>"

        record.payload = _Custom()
        payload = json.loads(formatter.format(record))
        assert payload["payload"] == "<custom-obj>"

    def test_exception_traceback_in_exc_field(self):
        from observability import JsonFormatter

        try:
            raise RuntimeError("synthetic boom")
        except RuntimeError:
            import sys as _sys
            exc_info = _sys.exc_info()

        formatter = JsonFormatter()
        record = logging.LogRecord(
            name="phantom.test",
            level=logging.ERROR,
            pathname=__file__,
            lineno=1,
            msg="caught it",
            args=(),
            exc_info=exc_info,
        )
        payload = json.loads(formatter.format(record))
        assert "exc" in payload
        assert "RuntimeError" in payload["exc"]
        assert "synthetic boom" in payload["exc"]


class TestL6InstallJsonLogging:
    def test_install_swaps_root_handlers_to_json(self, caplog):
        import io
        from observability import (
            JsonFormatter, install_json_logging, CorrelationFilter,
        )

        root = logging.getLogger()
        # Capture the prior handler set so we can restore.
        prior_formatters = [(h, h.formatter) for h in root.handlers]
        prior_filters = list(root.filters)
        try:
            install_json_logging(level="INFO")
            for handler in root.handlers:
                assert isinstance(handler.formatter, JsonFormatter)
            assert any(
                isinstance(f, CorrelationFilter) for f in root.filters
            ), (
                "L-6 regression: install_json_logging did not attach "
                "CorrelationFilter — JSON rows lose correlation_id."
            )
        finally:
            for handler, fmt in prior_formatters:
                handler.setFormatter(fmt)
            # Drop any filter we added that wasn't there before.
            for f in list(root.filters):
                if f not in prior_filters:
                    root.removeFilter(f)

    def test_install_is_idempotent_no_double_correlation_filter(self):
        from observability import CorrelationFilter, install_json_logging

        root = logging.getLogger()
        prior_filters = list(root.filters)
        try:
            install_json_logging(level="INFO")
            install_json_logging(level="INFO")
            install_json_logging(level="INFO")
            cf_count = sum(
                1 for f in root.filters if isinstance(f, CorrelationFilter)
            )
            assert cf_count <= 1, (
                "L-6 regression: install_json_logging is not idempotent "
                "and stacked CorrelationFilter instances on the root."
            )
        finally:
            for f in list(root.filters):
                if f not in prior_filters:
                    root.removeFilter(f)


class TestL6ConfigKnob:
    def test_log_json_enabled_default_off(self):
        from config import PhantomConfig
        v = PhantomConfig.model_fields["log_json_enabled"].default
        assert v is False, (
            "L-6 regression: log_json_enabled default flipped to True — "
            "local-dev would lose the human-readable line format."
        )
