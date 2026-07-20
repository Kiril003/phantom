"""Pydantic models for OmniMap layer manifests (Phase 24-A).

Each map layer in PHANTOM is described by a YAML file in
`geo/layer_registry/manifests/<id>.yaml`. The schema is intentionally
narrow: a layer is a *source of geometry* (where the data comes from),
*style* (how it paints), and *agent verbs* (what the chat agent can ask
of it). Anything else lives in the renderer.

The registry validates every manifest against `LayerManifest` at load
time. Manifest authors get fail-fast Pydantic errors with field paths
instead of silent runtime drift.
"""
from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


# ── Enums ──────────────────────────────────────────────────────────────────

class LayerCategory(str, Enum):
    """Top-level grouping shown in the LayerLibrary UI palette."""

    base = "base"
    terrain = "terrain"
    personal = "personal"
    reference = "reference"
    tourism = "tourism"
    ukraine = "ukraine"
    live = "live"
    environment = "environment"
    astronomy = "astronomy"
    infra = "infra"
    osint = "osint"
    hacker = "hacker"
    research = "research"
    marine = "marine"
    aviation = "aviation"
    health = "health"
    generic = "generic"
    fun = "fun"


class LayerSourceType(str, Enum):
    """How the renderer fetches geometry for the layer."""

    # Vector tiles served from a PMTiles archive (range-request capable).
    vector_pmtiles = "vector_pmtiles"
    # Raster tiles (XYZ scheme) — Carto, Stadia, EOX, OpenTopoMap, etc.
    raster_tiles = "raster_tiles"
    # REST endpoint polled at `poll_interval_s`, parsed into GeoJSON.
    rest_polling = "rest_polling"
    # WebSocket stream (AISStream, OpenSky firehose, …).
    ws_stream = "ws_stream"
    # Local SQLite/Chroma — wardriving, POIs, geo-tagged facts.
    local_db = "local_db"
    # Derived in-process from existing layers (heatmap, clustering).
    computed = "computed"
    # One-shot static GeoJSON file packaged with the build.
    geojson_static = "geojson_static"
    # Query-on-demand REST API with no manifest-declared fetch adapter
    # yet (e.g. Shodan lookups) — agent verbs call out directly rather
    # than the layer being polled on an interval.
    api = "api"


class LayerPriority(str, Enum):
    """Operator-visible importance hint for ordering & alerts."""

    background = "background"
    normal = "normal"
    elevated = "elevated"
    critical = "critical"


# ── Sub-models ─────────────────────────────────────────────────────────────


class LayerAuth(BaseModel):
    """Authentication descriptor for layers that need a key/header.

    The `env_key` field names an *environment variable* that holds the
    secret — actual values never live in manifests or code. The
    optional `header_name` overrides the default ``Authorization`` slot
    for sources that use ``X-API-Key`` etc.
    """

    model_config = ConfigDict(extra="forbid")

    kind: str = Field(
        ...,
        description="One of: api_key, bearer, basic, query_param, none.",
    )
    env_key: Optional[str] = Field(
        default=None,
        description="Env var that holds the secret (e.g. ALARMS_UA_KEY).",
    )
    header_name: Optional[str] = Field(
        default=None,
        description="Override default header (Authorization).",
    )
    query_param: Optional[str] = Field(
        default=None,
        description="When kind=query_param, name of the URL parameter.",
    )

    @field_validator("kind")
    @classmethod
    def _validate_kind(cls, v: str) -> str:
        allowed = {"api_key", "bearer", "basic", "query_param", "none"}
        if v not in allowed:
            raise ValueError(f"auth.kind must be one of {sorted(allowed)}")
        return v


class LayerSource(BaseModel):
    """Where the layer's data lives + how to fetch/cache it."""

    model_config = ConfigDict(extra="forbid")

    type: LayerSourceType
    url: Optional[str] = Field(
        default=None,
        description="Tile/REST URL (omitted for local_db/computed).",
    )
    auth: Optional[LayerAuth] = None
    poll_interval_s: Optional[int] = Field(
        default=None,
        ge=1,
        description="For rest_polling: how often to refresh.",
    )
    ttl_s: int = Field(
        default=300,
        ge=0,
        description="Cache TTL. 0 = no cache (live stream).",
    )
    bbox_required: bool = Field(
        default=False,
        description="Source needs a viewport bbox to query.",
    )
    rate_limit_per_minute: Optional[int] = Field(
        default=None,
        ge=1,
        description="Soft client-side rate limit hint.",
    )
    extras: dict[str, str | int | float | bool] = Field(
        default_factory=dict,
        description="Source-specific knobs (e.g. tile size, format).",
    )


class LayerStyle(BaseModel):
    """Default paint hints — the actual MapLibre style is compiled
    on the frontend, but these defaults travel with the manifest so the
    LayerLibrary preview and chat narrative ("paints red oblasts") agree
    with what the operator actually sees on the canvas."""

    model_config = ConfigDict(extra="forbid")

    fill: Optional[str] = Field(default=None, description="Token or hex.")
    fill_opacity: float = Field(default=0.6, ge=0.0, le=1.0)
    stroke: Optional[str] = None
    stroke_width: float = Field(default=1.0, ge=0.0, le=20.0)
    point_radius: float = Field(default=4.0, ge=0.0, le=64.0)
    pulse: bool = False
    icon: Optional[str] = Field(
        default=None,
        description="Lucide icon name or emoji shown in the LayerLibrary.",
    )
    legend: list[dict[str, str]] = Field(
        default_factory=list,
        description="Optional [{label, color}, ...] for the LegendPanel.",
    )


# ── Top-level manifest ─────────────────────────────────────────────────────


class LayerManifest(BaseModel):
    """The full description of a single OmniMap layer.

    Manifests live in YAML files under
    `src/backend/geo/layer_registry/manifests/`. The filename stem MUST
    match the `id` field — the registry rejects mismatches.
    """

    model_config = ConfigDict(extra="forbid")

    # ── Identity ─────────────────────────────────────────────────────
    id: str = Field(
        ...,
        pattern=r"^[a-z][a-z0-9_]{0,63}$",
        description="Stable layer ID (snake_case).",
    )
    name_ua: str = Field(..., min_length=1, max_length=120)
    name_en: str = Field(..., min_length=1, max_length=120)
    category: LayerCategory

    # ── Licensing / attribution ──────────────────────────────────────
    license: str = Field(
        ...,
        description="Short license tag (e.g. 'ODbL', 'MIT', 'CC-BY-4.0').",
    )
    attribution: str = Field(
        ...,
        min_length=1,
        max_length=512,
        description="Single-line credit string shown in AttributionDrawer.",
    )

    # ── Data plumbing ────────────────────────────────────────────────
    source: LayerSource
    geometry: str = Field(
        default="generic",
        description=(
            "Geometry hint: point | line | polygon | tile | "
            "oblast_polygons | mixed | generic."
        ),
    )
    style: LayerStyle = Field(default_factory=LayerStyle)

    # ── Agent / chat surface ─────────────────────────────────────────
    agent_verbs: list[str] = Field(
        default_factory=list,
        description="Chat actions this layer enables (map.air_raid_status …).",
    )

    # ── Operator policy ──────────────────────────────────────────────
    require_internet: bool = True
    require_setting: Optional[str] = Field(
        default=None,
        description="Settings key that must be truthy to enable (e.g. alerts.air_raid.enabled).",
    )
    require_root: bool = Field(
        default=False,
        description="True if only ROOT trust level may activate this layer.",
    )
    private: bool = Field(
        default=False,
        description="GHOST/sealed layer — never shown unless trust matches.",
    )
    priority: LayerPriority = LayerPriority.normal
    default_active: bool = Field(
        default=False,
        description="Active out-of-the-box (subject to require_setting).",
    )
    available_offline: bool = Field(
        default=False,
        description="Layer continues to work without internet.",
    )
    tags: list[str] = Field(default_factory=list, max_length=16)

    @field_validator("agent_verbs")
    @classmethod
    def _validate_verbs(cls, v: list[str]) -> list[str]:
        for verb in v:
            if not verb or " " in verb:
                raise ValueError(f"agent_verbs entry {verb!r} must be non-empty, no spaces")
        # de-dup while preserving order
        seen: set[str] = set()
        out: list[str] = []
        for verb in v:
            if verb in seen:
                continue
            seen.add(verb)
            out.append(verb)
        return out

    @field_validator("tags")
    @classmethod
    def _validate_tags(cls, v: list[str]) -> list[str]:
        return [t.strip().lower() for t in v if t and t.strip()]

    def public_dict(self) -> dict:
        """Frontend-safe projection — strips auth/extras secrets."""
        d = self.model_dump(mode="json")
        if d.get("source", {}).get("auth"):
            # Never leak env_key/header names to the browser.
            d["source"]["auth"] = {"kind": d["source"]["auth"]["kind"]}
        return d
