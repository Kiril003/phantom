"""
Scene-data Pydantic v2 models — the BE source of truth for the
`ChatScene.data` payload contract shared with the FE.

Mirrors the TypeScript shapes in
``src/shared/types/chat.ts`` lines 140-444 (the `ChatToolScene` union).
Adding a new scene here requires:

  1. extend the matching TS union in ``src/shared/types/chat.ts``;
  2. add a new ``*SceneData`` model below;
  3. add the ``"kind": ToolSceneEnvelope`` arm in ``ChatToolScene`` here;
  4. update ``CONTRACTS_R1.md`` § Shared schemas.

Owner: BE-TOOLS (this file) + FE-SCENES (TS twin).
"""
from __future__ import annotations

from typing import Annotated, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, NonNegativeInt


# ── Shared model config ──────────────────────────────────────────────────────


class _SceneBase(BaseModel):
    """All scene payloads forbid extra fields so a typo on BE doesn't
    silently land on the FE as `undefined`. The renderer expects an
    exact shape; new fields require coordinated TS + Pydantic edits."""

    model_config = ConfigDict(extra="forbid", frozen=False)


# ── Timer ────────────────────────────────────────────────────────────────────

TimerStatus = Literal["active", "paused", "done", "cancelled"]


class TimerSceneData(_SceneBase):
    timer_id: str
    label: str
    duration_sec: NonNegativeInt
    remaining_sec: NonNegativeInt
    started_at_ms: int
    ends_at_ms: int
    preset: Optional[str] = None
    status: TimerStatus
    ai_note: Optional[str] = None


# ── Alarm ────────────────────────────────────────────────────────────────────

Weekday = Literal["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]


class AlarmSceneData(_SceneBase):
    alarm_id: str
    fire_at_ms: int
    weekday: Weekday
    display_time: str
    display_date: str
    display_weekday_short: str
    sound: str
    sound_waveform: Optional[list[Annotated[float, Field(ge=0.0, le=1.0)]]] = None
    repeat_daily: bool
    fires_in_ms: int
    ai_note: Optional[str] = None


# ── Calendar ─────────────────────────────────────────────────────────────────

CalendarEventCategory = Literal["work", "personal", "amber", "coral"]
DayIndex = Literal[0, 1, 2, 3, 4, 5, 6]


class CalendarSceneEvent(_SceneBase):
    event_id: str
    day_index: DayIndex
    y_pct: Annotated[float, Field(ge=0.0, le=100.0)]
    h_pct: Annotated[float, Field(ge=0.0, le=100.0)]
    category: CalendarEventCategory
    label: str
    starts_at_ms: int
    ends_at_ms: int


class CalendarSceneData(_SceneBase):
    week_start_iso: str
    today_iso: str
    weekday_labels: tuple[str, str, str, str, str, str, str]
    date_labels: tuple[str, str, str, str, str, str, str]
    events: list[CalendarSceneEvent]
    total_count: NonNegativeInt
    ai_suggestion: Optional[str] = None


# ── Files ────────────────────────────────────────────────────────────────────

FilesIconKey = Literal[
    "image", "movie", "audiotrack", "description",
    "folder", "code", "archive", "unknown",
]
FilesTone = Literal["amber", "neutral", "coral", "green"]


class FilesMatch(_SceneBase):
    match_id: str
    name: str
    icon: FilesIconKey
    tone: FilesTone
    size_display: str
    size_bytes: NonNegativeInt
    date_display: str
    mtime_ms: int
    highlight: bool = False
    abs_path: str


class FilesSceneData(_SceneBase):
    root_display: str
    total_matches: NonNegativeInt
    matches: list[FilesMatch]
    filter_placeholder: Optional[str] = None
    ai_note: Optional[str] = None


# ── Audit ────────────────────────────────────────────────────────────────────

AuditEventStatus = Literal["ok", "retry", "fail"]


class AuditSceneEvent(_SceneBase):
    event_id: str
    time_display: str
    ts_ms: int
    tool: str
    status: AuditEventStatus
    text: str
    duration_display: str
    duration_ms: NonNegativeInt


class AuditSceneCounts(_SceneBase):
    ok: NonNegativeInt
    retry: NonNegativeInt
    fail: NonNegativeInt


class AuditSceneData(_SceneBase):
    window_display: str
    total_actions: NonNegativeInt
    events: list[AuditSceneEvent]
    counts: AuditSceneCounts
    trace_id: str


# ── Wardriving ───────────────────────────────────────────────────────────────


class WardrivingHotspot(_SceneBase):
    label: str
    x_pct: Annotated[float, Field(ge=0.0, le=100.0)]
    y_pct: Annotated[float, Field(ge=0.0, le=100.0)]


class WardrivingTopAp(_SceneBase):
    bssid_prefix: str
    best_rssi: int
    count: NonNegativeInt


WardrivingSecurity = Literal["open", "wpa2", "wpa3"]


class WardrivingSceneData(_SceneBase):
    window_display: str
    area_display: str
    heatmap: list[list[Annotated[float, Field(ge=0.0, le=1.0)]]]
    hotspots: list[WardrivingHotspot]
    top_aps: list[WardrivingTopAp]
    security_counts: dict[WardrivingSecurity, NonNegativeInt]
    ai_note: Optional[str] = None


# ── Location ─────────────────────────────────────────────────────────────────

LocationStopKind = Literal["home", "work", "transit", "food", "other"]


class LocationStop(_SceneBase):
    stop_id: str
    x_pct: Annotated[float, Field(ge=0.0, le=100.0)]
    y_pct: Annotated[float, Field(ge=0.0, le=100.0)]
    time_display: str
    ts_ms: int
    label: str
    kind: LocationStopKind


class LocationSceneData(_SceneBase):
    window_display: str
    total_distance_display: str
    total_distance_m: Annotated[float, Field(ge=0.0)]
    stops: list[LocationStop]
    walking_display: str
    walking_seconds: NonNegativeInt
    unknowns: NonNegativeInt
    ai_note: Optional[str] = None


# ── Checkpoint ───────────────────────────────────────────────────────────────


class CheckpointInclusion(_SceneBase):
    name: str
    included: bool
    reason: Optional[str] = None


class CheckpointSceneData(_SceneBase):
    checkpoint_id: str
    created_at_iso: str
    size_mb: Annotated[float, Field(ge=0.0)]
    stack_summary: str
    inclusions: list[CheckpointInclusion]
    total_checkpoints: NonNegativeInt
    ripe_for_cleanup: NonNegativeInt
    ai_note: Optional[str] = None


# ── Tool-scene envelope discriminated union ──────────────────────────────────

ToolSceneKind = Literal[
    "timer", "alarm", "calendar", "files",
    "audit", "wardriving", "location", "checkpoint",
    "phantom_manifest",
]


# ── Phantom Familiar (R1-FAMILIAR-1) ────────────────────────────────────────


FamiliarPose = Literal[
    "idle", "floating", "pointing", "peeking",
    "sleeping", "waving", "vanishing",
]


class FamiliarTargetData(_SceneBase):
    """Anchor for a `pointing` summon. Either a CSS selector OR a
    viewport coordinate; both fields are optional and the FE applies a
    sensible fallback when neither is supplied."""
    selector: Optional[str] = None
    x: Optional[Annotated[float, Field(ge=0.0, le=4096.0)]] = None
    y: Optional[Annotated[float, Field(ge=0.0, le=4096.0)]] = None


class PhantomManifestSceneData(_SceneBase):
    """Body of a `phantom_manifest` chat scene — when the AI explicitly
    summons the Familiar inside a reply. The FE renderer (the chat
    `PhantomManifestScene` component) calls
    `familiarStore.manifest('ai-summon', …)` on mount, which bypasses
    the rarity gate so the creature is guaranteed to appear."""
    pose: FamiliarPose = "waving"
    message: Optional[Annotated[str, Field(max_length=240)]] = None
    duration_ms: Optional[Annotated[int, Field(ge=500, le=30_000)]] = None
    target: Optional[FamiliarTargetData] = None


class ChatToolScene(_SceneBase):
    """The discriminated envelope BE emits and FE renders. ``data`` is
    one of the typed *SceneData models; the FE-side `kind` switch picks
    the matching React component."""
    kind: ToolSceneKind
    data: (
        TimerSceneData | AlarmSceneData | CalendarSceneData | FilesSceneData
        | AuditSceneData | WardrivingSceneData | LocationSceneData
        | CheckpointSceneData | PhantomManifestSceneData
    )


# ── ToolResult — what tool_executor returns to the chat loop ────────────────


class ToolResult(_SceneBase):
    """Mirrors ``CONTRACTS_R1.md § Tool execution result``. ``scene`` is
    nullable for tools that ran successfully but have nothing to render
    inline (e.g. cancel tools that just emit a confirmation summary)."""
    tool: str
    ok: bool
    scene: Optional[ChatToolScene] = None
    summary: str
    audit_id: str
    error: Optional[str] = None


__all__ = [
    "TimerSceneData",
    "AlarmSceneData",
    "CalendarSceneData",
    "CalendarSceneEvent",
    "FilesSceneData",
    "FilesMatch",
    "AuditSceneData",
    "AuditSceneEvent",
    "AuditSceneCounts",
    "WardrivingSceneData",
    "WardrivingHotspot",
    "WardrivingTopAp",
    "LocationSceneData",
    "LocationStop",
    "CheckpointSceneData",
    "CheckpointInclusion",
    "PhantomManifestSceneData",
    "FamiliarTargetData",
    "FamiliarPose",
    "ChatToolScene",
    "ToolResult",
    "ToolSceneKind",
]
