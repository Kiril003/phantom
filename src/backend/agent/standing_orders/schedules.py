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
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, Field, TypeAdapter


def _utcnow() -> datetime:
    return datetime.now(tz=timezone.utc)


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


ScheduleSpec = Annotated[
    Union[IntervalSchedule, CronSchedule, ConditionalSchedule, OneShotSchedule],
    Field(discriminator="kind"),
]


_schedule_adapter: TypeAdapter[ScheduleSpec] = TypeAdapter(ScheduleSpec)  # type: ignore[type-arg]


def parse_schedule(raw: str | dict[str, Any]) -> ScheduleSpec:
    """Parse JSON string or dict into the appropriate schedule model."""
    if isinstance(raw, str):
        raw = json.loads(raw)
    return _schedule_adapter.validate_python(raw)


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
        try:
            from croniter import croniter
        except ImportError:
            # croniter optional — without it, cron schedules never fire.
            # Explicit surface so tests / operators can see the cause.
            raise RuntimeError(
                "croniter not installed; cron schedules unsupported in this environment"
            )
        base = last_fired_at or (now - timedelta(seconds=1))
        itr = croniter(schedule.expression(), base)
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
        return schedule.at
    raise ValueError(f"unknown schedule kind: {type(schedule).__name__}")


__all__ = [
    "IntervalSchedule",
    "CronSchedule",
    "ConditionalSchedule",
    "OneShotSchedule",
    "ScheduleSpec",
    "parse_schedule",
    "next_fire_time",
]
