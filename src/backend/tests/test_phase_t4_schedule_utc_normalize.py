"""Day-4 Wave-1 — Block T-4: OneShotSchedule UTC normalisation +
croniter early-check at parse time (ADR-SO-002).

Closes audit U7-TIME-H2 ("naive datetimes leak into persisted standing
orders") + U7-TIME-M3 ("croniter missing surfaces only at first fire,
not at order creation").

Coverage:

* Naive `OneShotSchedule.at` is coerced to UTC at parse time and a
  WARNING log fires once. The persisted `model_dump_json()` carries
  an explicit UTC offset.
* tz-aware inputs (UTC and non-UTC) round-trip unchanged.
* `parse_schedule({"kind":"cron",...})` raises immediately when
  `_HAS_CRONITER` is False — the operator sees the misconfig at
  order-creation, not at first fire hours later.
* `parse_schedule({"kind":"cron",...})` accepts the spec when
  croniter IS installed (today's CI).
* `next_fire_time(OneShotSchedule, ...)` is defensive against a
  caller that bypassed parse_schedule with a naive `at` field —
  total over its declared input domain.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest


# ────────────────────────────────────────────────────────── UTC normalisation ──


class TestOneShotUtcNormalisation:
    def test_naive_at_is_coerced_to_utc_with_warning(self, caplog):
        from agent.operations.standing_orders.schedules import OneShotSchedule

        naive = datetime(2026, 5, 1, 12, 0, 0)  # no tzinfo
        with caplog.at_level(logging.WARNING):
            s = OneShotSchedule(at=naive)

        assert s.at.tzinfo is timezone.utc
        assert s.at == datetime(2026, 5, 1, 12, 0, 0, tzinfo=timezone.utc)
        # The WARN must have fired with a clear identifier so an operator
        # tailing logs can find the offending order.
        assert any(
            "naive datetime" in rec.message and "OneShotSchedule" in rec.message
            for rec in caplog.records
        )

    def test_utc_aware_at_round_trips_unchanged(self):
        from agent.operations.standing_orders.schedules import OneShotSchedule

        aware = datetime(2026, 5, 1, 12, 0, 0, tzinfo=timezone.utc)
        s = OneShotSchedule(at=aware)
        assert s.at == aware
        assert s.at.tzinfo is timezone.utc

    def test_non_utc_aware_at_preserved(self):
        from agent.operations.standing_orders.schedules import OneShotSchedule

        # +02:00 — Kyiv summer.
        offset = timezone(timedelta(hours=2))
        aware = datetime(2026, 5, 1, 14, 0, 0, tzinfo=offset)
        s = OneShotSchedule(at=aware)
        # Pydantic may normalise to UTC; either way the absolute instant
        # must match.
        assert s.at == aware
        assert s.at.tzinfo is not None

    def test_persisted_json_carries_explicit_offset(self):
        """Operators rely on `model_dump_json()` for the persisted
        column. After T-4 the JSON must NEVER contain a naive ISO
        string — the UTC offset suffix is the audit trail."""
        from agent.operations.standing_orders.schedules import OneShotSchedule

        s = OneShotSchedule(at=datetime(2026, 5, 1, 12, 0, 0))  # naive in
        payload = json.loads(s.model_dump_json())
        # ISO 8601: '...+00:00' or 'Z'. Either way, NOT naive.
        at_str = payload["at"]
        assert at_str.endswith("+00:00") or at_str.endswith("Z"), (
            f"T-4 regression: persisted OneShotSchedule.at lacks an "
            f"explicit UTC marker — got {at_str!r}"
        )


# ─────────────────────────────────────────── parse_schedule cron early check ──


class TestParseScheduleCronEarlyCheck:
    def test_cron_spec_rejected_when_croniter_missing(self):
        """Simulate the no-croniter env via patch."""
        import agent.operations.standing_orders.schedules as sched

        with patch.object(sched, "_HAS_CRONITER", False):
            with pytest.raises(ValueError) as exc:
                sched.parse_schedule({"kind": "cron", "minute": "*/15"})

        assert "croniter" in str(exc.value).lower()
        assert "parse time" in str(exc.value).lower()

    def test_cron_spec_accepted_when_croniter_present(self):
        """Today's CI has croniter installed (per requirements.txt). The
        positive case is the boundary we care about — a misconfigured
        env should fail loud, a healthy env should round-trip."""
        from agent.operations.standing_orders.schedules import (
            CronSchedule,
            _HAS_CRONITER,
            parse_schedule,
        )

        if not _HAS_CRONITER:
            pytest.skip("croniter not installed in this env")

        spec = parse_schedule({"kind": "cron", "minute": "*/15"})
        assert isinstance(spec, CronSchedule)
        assert spec.minute == "*/15"

    def test_interval_spec_unaffected_by_croniter_absence(self):
        """The early check fires only on the cron path — interval /
        conditional / one-shot specs MUST round-trip whether or not
        croniter is present."""
        import agent.operations.standing_orders.schedules as sched

        with patch.object(sched, "_HAS_CRONITER", False):
            interval = sched.parse_schedule({"kind": "interval", "every_s": 60})
            cond = sched.parse_schedule(
                {
                    "kind": "conditional",
                    "check_every_s": 60,
                    "condition": "cpu_percent > 50",
                }
            )
            one_shot = sched.parse_schedule(
                {
                    "kind": "one_shot_future",
                    "at": "2026-05-01T12:00:00+00:00",
                }
            )

        assert isinstance(interval, sched.IntervalSchedule)
        assert isinstance(cond, sched.ConditionalSchedule)
        assert isinstance(one_shot, sched.OneShotSchedule)


# ──────────────────────────────────────── next_fire_time defensive UTC guard ──


class TestNextFireTimeDefensive:
    def test_one_shot_with_naive_at_returns_utc_aware_fire_time(self):
        """A caller that bypassed parse_schedule (constructed
        OneShotSchedule directly with model_validate=False semantics, or
        via __init_subclass__-style trickery) MUST still get a
        tz-aware result back from next_fire_time. The function is
        total over its declared input domain — no naive datetimes leak
        downstream."""
        from agent.operations.standing_orders.schedules import (
            OneShotSchedule,
            next_fire_time,
        )

        # Use Pydantic's `model_construct` to skip the validator path.
        # This is exactly the bypass scenario T-4 defends against.
        s = OneShotSchedule.model_construct(
            kind="one_shot_future", at=datetime(2026, 5, 1, 12, 0, 0)
        )
        assert s.at.tzinfo is None  # confirm the bypass actually worked

        now = datetime(2026, 5, 1, 11, 0, 0, tzinfo=timezone.utc)
        result = next_fire_time(s, now, last_fired_at=None)

        assert result is not None
        assert result.tzinfo is timezone.utc, (
            "T-4 defensive guard failed: next_fire_time returned a naive "
            f"datetime ({result!r}) — runner downstream now compares "
            "naive vs tz-aware and crashes on TypeError."
        )

    def test_one_shot_after_fire_still_returns_none(self):
        """The naive-coercion guard MUST NOT change the post-fire
        contract: an OneShotSchedule that already fired returns None
        regardless of `at`'s tz state."""
        from agent.operations.standing_orders.schedules import (
            OneShotSchedule,
            next_fire_time,
        )

        s = OneShotSchedule(at=datetime(2026, 5, 1, 12, 0, 0, tzinfo=timezone.utc))
        last = datetime(2026, 5, 1, 12, 0, 0, tzinfo=timezone.utc)
        future_now = last + timedelta(hours=1)

        assert next_fire_time(s, future_now, last_fired_at=last) is None

    def test_cron_path_in_no_croniter_env_raises_runtime_error(self):
        """Defensive: if a CronSchedule arrives at next_fire_time without
        croniter (would-be impossible after parse_schedule's check, but
        possible via direct construction), raise a RuntimeError with a
        clear cross-reference to parse_schedule."""
        import agent.operations.standing_orders.schedules as sched

        s = sched.CronSchedule(minute="*/15")
        now = datetime(2026, 5, 1, 12, 0, 0, tzinfo=timezone.utc)

        with patch.object(sched, "_HAS_CRONITER", False), \
             patch.object(sched, "_croniter", None):
            with pytest.raises(RuntimeError) as exc:
                sched.next_fire_time(s, now, last_fired_at=None)

        assert "croniter" in str(exc.value).lower()
        assert "parse_schedule" in str(exc.value)


# ─────────────────────────────────────────── module-load contract ──


class TestModuleLevelContract:
    def test_has_croniter_flag_is_boolean(self):
        from agent.operations.standing_orders.schedules import _HAS_CRONITER

        assert isinstance(_HAS_CRONITER, bool)

    def test_module_exposes_optional_croniter_contract(self):
        """T-4 contract: schedules.py probes croniter at module load
        WITHOUT raising — the import is best-effort so envs that don't
        need cron don't pay an install cost. The module must expose the
        `_HAS_CRONITER` flag and `parse_schedule` regardless of whether
        croniter is present.

        We deliberately avoid `importlib.reload` here because reload
        rebinds module objects and breaks cached references downstream
        (e.g., the standing-orders runner's already-imported
        `next_fire_time` would dangle on the old module). The contract
        is testable by attribute inspection alone.
        """
        import agent.operations.standing_orders.schedules as sched

        assert hasattr(sched, "_HAS_CRONITER")
        assert hasattr(sched, "parse_schedule")
        assert hasattr(sched, "next_fire_time")
        assert callable(sched.parse_schedule)
        assert callable(sched.next_fire_time)
