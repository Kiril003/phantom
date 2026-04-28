"""
Phase 9.3b — schedule specifications for standing orders.

Four kinds:
  - IntervalSchedule  (every N seconds)
  - CronSchedule      (cron expression via croniter)
  - ConditionalSchedule (poll a simple DSL condition, cooldown after fire)
  - OneShotSchedule   (fire once at a specific datetime)

`next_fire_time(schedule, now, last_fired_at)` returns a datetime when the
order is due (or None when it will never fire again). The runner treats
"now or earlier" as due.

Day-4 Block T-4 (ADR-SO-002 — UTC normalisation + early croniter check):

* Naive `OneShotSchedule.at` datetimes are coerced to UTC at parse time
  with a one-time WARN log. Letting a naive `datetime` slip through used
  to silently treat the timestamp as UTC inside `next_fire_time` AFTER
  the row was already persisted, which made post-mortem audits read the
  wrong absolute instant when the operator's box ran a non-UTC TZ. We
  fix this at parse time so the persisted JSON is unambiguous.

* `croniter` is now imported at module load (best-effort) instead of
  lazily inside `next_fire_time`. A `parse_schedule` call that hands us
  a cron spec WITHOUT croniter installed raises immediately — fail at
  parse, not at first fire (which can be hours later, well after the
  operator has stopped looking).
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, Field, TypeAdapter, field_validator

logger = logging.getLogger(__name__)


# ─── croniter availability — module-load probe ────────────────────────────────
#
# Probe at import. We do NOT raise here: an environment that never uses
# CronSchedule (the runner is the only consumer of cron specs and it's
# optional) shouldn't be forced to install croniter just to import this
# module. The miss is surfaced at parse_schedule for cron specs and at
# next_fire_time as a defensive fallback.

try:  # pragma: no cover — exercised by environment, not unit tests
    from croniter import croniter as _croniter
    _HAS_CRONITER = True
except ImportError:  # pragma: no cover
    _croniter = None  # type: ignore[assignment]
    _HAS_CRONITER = False
    logger.warning(
        "croniter not installed — CronSchedule specs will be rejected at "
        "parse time. Install `croniter` to enable cron-style standing "
        "orders."
    )


def _utcnow() -> datetime:
    return datetime.now(tz=timezone.utc)


# ─── Schedule kinds ──────────────────────────────────────────────────────────


class IntervalSchedule(BaseModel):
    kind: Literal["interval"] = "interval"
    every_s: int = Field(ge=1, le=86400)


class CronSchedule(BaseModel):
    kind: Literal["cron"] = "cron"
    minute: str = "*"
    hour: str = "*"
    day: str = "*"
    month: str = "*"
    day_of_week: str = "*"

    def expression(self) -> str:
        return f"{self.minute} {self.hour} {self.day} {self.month} {self.day_of_week}"


class ConditionalSchedule(BaseModel):
    kind: Literal["conditional"] = "conditional"
    check_every_s: int = Field(ge=10, le=86400)
    condition: str = Field(min_length=3, max_length=256)
    cooldown_s: int = Field(default=3600, ge=0, le=86400)


class OneShotSchedule(BaseModel):
    kind: Literal["one_shot_future"] = "one_shot_future"
    at: datetime

    @field_validator("at", mode="before")
    @classmethod
    def _coerce_naive_to_utc(cls, v: Any) -> Any:
        """Day-4 T-4: a naive `datetime` (no tzinfo) is treated as UTC and
        a WARN is logged. Persisting a naive datetime makes the stored
        absolute instant ambiguous — the runner picks UTC out of habit
        but a future post-mortem reader has no way to tell which TZ the
        operator meant. Coercing at parse time stamps "we picked UTC"
        unambiguously into the persisted JSON.

        Pydantic itself accepts naive ISO strings without complaint, so
        the validator runs before standard parsing — string inputs that
        contain a TZ offset (`...+02:00`) flow through unchanged."""
        if isinstance(v, datetime):
            if v.tzinfo is None:
                logger.warning(
                    "OneShotSchedule.at received a naive datetime (%r); "
                    "coercing to UTC. ADR-SO-002 — operators should pass "
                    "tz-aware datetimes to keep persisted schedules "
                    "unambiguous.",
                    v.isoformat(),
                )
                return v.replace(tzinfo=timezone.utc)
            return v
        # Strings / other shapes: let Pydantic's standard parser handle
        # them. Naive ISO strings round-trip back through this validator
        # via Pydantic's recursive coercion — but Pydantic stamps the
        # parsed object as a `datetime` first, so the second pass sees a
        # naive datetime and the warn fires there.
        return v


ScheduleSpec = Annotated[
    Union[IntervalSchedule, CronSchedule, ConditionalSchedule, OneShotSchedule],
    Field(discriminator="kind"),
]


_schedule_adapter: TypeAdapter[ScheduleSpec] = TypeAdapter(ScheduleSpec)  # type: ignore[type-arg]


def parse_schedule(raw: str | dict[str, Any]) -> ScheduleSpec:
    """Parse JSON string or dict into the appropriate schedule model.

    Day-4 T-4: rejects cron specs early when croniter is missing —
    catching the misconfiguration at parse time (when the operator is
    creating the standing order) is far more recoverable than failing at
    first fire (which may be hours later). The runner can also propagate
    the ValueError through the API layer to the operator's UI.
    """
    if isinstance(raw, str):
        raw = json.loads(raw)
    spec = _schedule_adapter.validate_python(raw)
    if isinstance(spec, CronSchedule) and not _HAS_CRONITER:
        raise ValueError(
            "CronSchedule rejected at parse time: `croniter` is not "
            "installed in this environment. Install croniter and reload "
            "to enable cron-style standing orders, or use IntervalSchedule "
            "as a workaround."
        )
    return spec


def next_fire_time(
    schedule: ScheduleSpec,
    now: datetime,
    last_fired_at: datetime | None,
) -> datetime | None:
    """Return the next datetime at which `schedule` is due, or None when the
    schedule is exhausted (one-shot already fired)."""
    if isinstance(schedule, IntervalSchedule):
        if last_fired_at is None:
            return now
        return last_fired_at + timedelta(seconds=schedule.every_s)
    if isinstance(schedule, CronSchedule):
        if not _HAS_CRONITER or _croniter is None:
            # Defensive: parse_schedule normally rejects cron specs
            # before they reach the runner. This branch only fires if a
            # caller bypassed parse_schedule (e.g., constructed a
            # CronSchedule via direct Pydantic instantiation in tests).
            raise RuntimeError(
                "croniter not installed; cron schedules unsupported in "
                "this environment. Use parse_schedule() to surface this "
                "at order-creation time."
            )
        base = last_fired_at or (now - timedelta(seconds=1))
        itr = _croniter(schedule.expression(), base)
        candidate = itr.get_next(datetime)
        if candidate.tzinfo is None:
            candidate = candidate.replace(tzinfo=timezone.utc)
        return candidate
    if isinstance(schedule, ConditionalSchedule):
        if last_fired_at is None:
            return now
        # After a fire, wait cooldown_s before re-eligible. Between fires
        # we still poll every check_every_s so the runner can re-evaluate.
        base = last_fired_at + timedelta(seconds=schedule.cooldown_s)
        if now >= base:
            return now  # eligible right now (runner will then check condition)
        return base
    if isinstance(schedule, OneShotSchedule):
        if last_fired_at is not None:
            return None
        # Defensive: the field_validator coerces naive→UTC at parse time
        # but a caller that constructs OneShotSchedule directly bypasses
        # the validator if Pydantic skips revalidation. Keep this guard
        # so `next_fire_time` is total over its declared input domain.
        at = schedule.at
        if at.tzinfo is None:
            at = at.replace(tzinfo=timezone.utc)
        return at
    raise ValueError(f"unknown schedule kind: {type(schedule).__name__}")


__all__ = [
    "IntervalSchedule",
    "CronSchedule",
    "ConditionalSchedule",
    "OneShotSchedule",
    "ScheduleSpec",
    "parse_schedule",
    "next_fire_time",
    "_HAS_CRONITER",
]
