"""Day-4 Wave-2 T-2 — `actions.py` (ADR-SOH-003 + ADR-SOH-004 type
contract).

Discriminated-union of the 4 standing-order action kinds. The runner's
existing `_fire_order` only knows `goal → start_task` (see
`runner.py:154`); T-2 ships the closed-vocabulary types so the
Day-5 dispatcher can match-table on `action.kind` without touching
the runner.

  speak    — text-to-speech via voice.tts_engine
  notify   — frontend toast via core.event_bus → WS fan-out
  task     — agent runtime.start_task (today's only path)
  webhook  — httpx POST/GET to a configured URL

`parse_action(raw)` mirrors `parse_schedule()` (`schedules.py:65-69`):
takes a dict, validates against the union, returns the typed model
or raises ValueError. Legacy rows whose `action_json` is
``{"goal": "..."}`` (pre-T-2) are accepted as a `TaskAction`
shorthand — emits a one-time DeprecationWarning at startup so
operators can migrate but the existing fleet stays warm.

Day-4 ships the TYPES + parser + the `agent_standing_orders_*_timeout_s`
config keys. The dispatcher (`dispatch_action`) lands in T-2's Day-5
follow-up.
"""
from __future__ import annotations

import logging
import warnings
from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, Field, HttpUrl, ValidationError

logger = logging.getLogger(__name__)

# Sentinel so the legacy-shorthand DeprecationWarning fires once per
# process, not per call.
_LEGACY_WARNED = False


# ─────────────────────────────────────────────────────── ActionSpec union ──


class SpeakAction(BaseModel):
    """ActionSpec for tts_engine. `voice` falls back to
    config.voice_tts_voice when omitted at dispatch time."""

    kind: Literal["speak"] = "speak"
    text: str = Field(..., min_length=1, max_length=2000)
    voice: Optional[str] = None


class NotifyAction(BaseModel):
    """Frontend toast / status-bar pop. The dispatcher emits via
    core.event_bus → /ws fan-out. `target_user_id` is optional —
    when set, the WS multiplexer narrows the broadcast to that user;
    otherwise everyone subscribed sees it."""

    kind: Literal["notify"] = "notify"
    title: str = Field(..., min_length=1, max_length=128)
    body: str = Field(..., min_length=1, max_length=2000)
    target_user_id: Optional[str] = None


class TaskAction(BaseModel):
    """The Day-3 path: lift the goal string into runtime.start_task
    with origin="standing_order"."""

    kind: Literal["task"] = "task"
    goal: str = Field(..., min_length=1, max_length=512)


class WebhookAction(BaseModel):
    """Outbound HTTP. Body is JSON (POST only); GET ignores body.
    4xx/5xx is `success=False` at dispatch time but does NOT raise —
    the order keeps re-firing on its schedule."""

    kind: Literal["webhook"] = "webhook"
    url: HttpUrl
    method: Literal["GET", "POST"] = "POST"
    body: Optional[dict] = None


ActionSpec = Annotated[
    Union[SpeakAction, NotifyAction, TaskAction, WebhookAction],
    Field(discriminator="kind"),
]


# Standalone Pydantic adapter so `parse_action` can validate against
# the union directly. Pydantic v2 idiom.
class _ActionEnvelope(BaseModel):
    """Internal: just for `model_validate({"kind": ..., ...})`."""

    inner: ActionSpec


# ──────────────────────────────────────────────────────────── parser ──


def parse_action(raw: dict) -> ActionSpec:
    """Validate ``raw`` against the closed ActionSpec union. Raises
    ValueError on schema mismatch. Accepts the legacy ``{"goal": ...}``
    shorthand by promoting it to a `TaskAction` (one-time
    DeprecationWarning the first time per process).

    Design choice: NOT raising on legacy shorthand keeps Day-3 deploys
    green; the migration (`009_standing_order_action_kind.py`) backfills
    the `action_kind` column to "task" so subsequent reads go through
    the typed path automatically.
    """
    if not isinstance(raw, dict):
        raise ValueError(
            f"parse_action requires a dict, got {type(raw).__name__}"
        )

    if "kind" not in raw:
        # Legacy shorthand: {"goal": "..."} → TaskAction.
        if "goal" in raw:
            global _LEGACY_WARNED
            if not _LEGACY_WARNED:
                warnings.warn(
                    "Standing-order action_json without 'kind' is the "
                    "Day-3 shorthand. Future migrations will require "
                    "explicit kind='task'. See ADR-SOH-003.",
                    DeprecationWarning,
                    stacklevel=2,
                )
                _LEGACY_WARNED = True
            try:
                return TaskAction(goal=str(raw["goal"]))
            except ValidationError as exc:
                raise ValueError(
                    f"parse_action: legacy shorthand goal invalid: {exc}"
                ) from exc
        raise ValueError(
            "parse_action: missing 'kind' field; use one of "
            "speak / notify / task / webhook"
        )

    # Typed path. Pydantic discriminator picks the right model.
    try:
        env = _ActionEnvelope.model_validate({"inner": raw})
    except ValidationError as exc:
        raise ValueError(f"parse_action: {exc}") from exc
    return env.inner


def action_kind_for_row(action_json: str) -> str:
    """Best-effort extractor used by the migration backfill + the new
    `action_kind` column write path. Reads `action_json`, returns the
    canonical kind ("speak"|"notify"|"task"|"webhook") or "task" for
    the legacy shorthand. Never raises — a corrupt JSON column gets
    "task" so the existing single-mode behaviour is preserved."""
    import json as _json

    try:
        raw = _json.loads(action_json or "{}")
    except Exception:  # noqa: BLE001
        return "task"
    if not isinstance(raw, dict):
        return "task"
    kind = raw.get("kind")
    if kind in ("speak", "notify", "task", "webhook"):
        return kind
    if "goal" in raw:
        return "task"
    return "task"


__all__ = [
    "ActionSpec",
    "NotifyAction",
    "SpeakAction",
    "TaskAction",
    "WebhookAction",
    "action_kind_for_row",
    "parse_action",
]
