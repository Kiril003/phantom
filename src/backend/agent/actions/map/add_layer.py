"""map.add_layer — register an ephemeral, agent-authored layer.

Phase 28-B closes the OmniMap "the agent can only toggle pre-shipped
layers" gap. The pre-shipped registry stays read-only; this action
broadcasts an *ephemeral* layer spec on the ``"map"`` WebSocket
channel that the desktop renderer materialises into a live
MapLibre source + layer for the duration of the operator session.

The verb is the inverse of ``map.disable_layer`` (which already
turns OFF either a registry or an ephemeral layer the renderer
knows about). Registration intentionally bypasses the persistent
``LayerRegistry`` so an agent runaway can't pollute disk; the
operator clears ephemerals by reloading the OmniMap or calling
``map.disable_layer`` per id.

Source shapes the renderer accepts:

  * ``geojson_inline`` — payload includes a FeatureCollection that
    is added directly as a MapLibre GeoJSON source.
  * ``geojson_url``    — payload is a fetchable URL the renderer
    hands to MapLibre as a streaming source.
  * ``raster_tile_url`` — payload carries a tile template
    (``{z}/{x}/{y}``) the renderer wires into a raster source.

Style overrides (paint / layout) are forwarded verbatim — the
renderer falls back to safe defaults per source kind when omitted.
"""
from __future__ import annotations

import re
import time
from typing import Any, ClassVar, Literal

from pydantic import Field, field_validator

from ...schemas import ActionResult, RiskLevel
from ..base import Action, ActionContext
from ._common import AGENT_SESSION, MapMutation, broadcast_map_mutation, build_map_output


_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_\-]{1,62}[a-z0-9]$")


class MapAddLayer(Action):
    """Broadcast an ephemeral layer spec to the OmniMap renderer."""

    name: ClassVar[str] = "map.add_layer"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    requires_consent: ClassVar[bool] = False
    reversible: ClassVar[bool] = True

    layer_id: str = Field(
        ...,
        min_length=3,
        max_length=64,
        description="Stable id (lowercase ascii slug). Must not collide with the registry.",
    )
    name_ua: str = Field(..., min_length=1, max_length=120)
    category: str = Field(default="personal", max_length=24)
    attribution: str = Field(default="Agent-generated layer", max_length=240)

    # Source shape — discriminator + payload. Validated as a dict so
    # the action can stay forward-compatible with future source kinds
    # without re-shipping. Only the listed `kind` values are honoured
    # by the renderer today; unknown kinds are dropped client-side.
    source: dict[str, Any] = Field(
        ...,
        description="{kind: 'geojson_inline'|'geojson_url'|'raster_tile_url', ...payload}",
    )

    # Optional MapLibre style overrides (paint / layout / type / minzoom
    # …). Forwarded as-is. Limited to a sane top-level shape; deep
    # validation lives client-side.
    style: dict[str, Any] | None = None

    # Operator-facing one-line description (rendered in attribution
    # drawer so an ephemeral layer doesn't look anonymous).
    summary: str | None = Field(default=None, max_length=200)

    @field_validator("layer_id")
    @classmethod
    def _slug(cls, v: str) -> str:
        if not _SLUG_RE.match(v):
            raise ValueError(
                "layer_id must be a lowercase ascii slug (a-z0-9_-, 3..64 chars)"
            )
        return v

    @field_validator("source")
    @classmethod
    def _source_shape(cls, v: dict[str, Any]) -> dict[str, Any]:
        kind = v.get("kind")
        if kind not in ("geojson_inline", "geojson_url", "raster_tile_url"):
            raise ValueError(
                "source.kind must be one of geojson_inline | geojson_url | raster_tile_url"
            )
        if kind == "geojson_inline":
            data = v.get("data")
            if not isinstance(data, dict) or data.get("type") != "FeatureCollection":
                raise ValueError(
                    "geojson_inline.source.data must be a FeatureCollection dict"
                )
            features = data.get("features")
            if not isinstance(features, list):
                raise ValueError("geojson_inline.source.data.features must be a list")
            if len(features) > 5_000:
                raise ValueError("geojson_inline.source.data.features must have ≤5000 entries")
        elif kind == "geojson_url":
            url = v.get("url")
            if not isinstance(url, str) or not url.startswith(("http://", "https://")):
                raise ValueError("geojson_url.source.url must be an http(s) URL")
        elif kind == "raster_tile_url":
            tmpl = v.get("template")
            if not isinstance(tmpl, str) or "{z}" not in tmpl or "{x}" not in tmpl or "{y}" not in tmpl:
                raise ValueError(
                    "raster_tile_url.source.template must contain {z}/{x}/{y} placeholders"
                )
        return v

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        from geo import get_attribution_store, get_layer_registry

        registry = get_layer_registry()
        # Refuse to shadow a manifest-shipped layer — operator confusion
        # would be guaranteed and disable_layer would target the wrong one.
        try:
            registry.get(self.layer_id)
            return ActionResult(
                ok=False,
                output={
                    "narrative": f"Шар {self.layer_id!r} уже існує у реєстрі — обери інший id.",
                    "reason": "id_collides_with_registry",
                },
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )
        except Exception:
            # LayerNotFoundError is the desired path here.
            pass

        payload: dict[str, Any] = {
            "layer_id": self.layer_id,
            "name_ua": self.name_ua,
            "category": self.category,
            "attribution": self.attribution,
            "source": self.source,
            "ephemeral": True,
        }
        if self.style is not None:
            payload["style"] = self.style
        if self.summary is not None:
            payload["summary"] = self.summary

        mutation = MapMutation(
            op="add_layer",
            target=self.layer_id,
            payload=payload,
        )
        narrative = f"Додав шар «{self.name_ua}»."

        # Optional: track the ephemeral in the attribution store if it
        # exposes a hook for it. Older stores ignore unknown layer ids
        # cleanly, so we just attempt enable() with a best-effort flag.
        try:
            store = get_attribution_store()
            track = getattr(store, "track_ephemeral", None)
            if callable(track):
                track(
                    layer_id=self.layer_id,
                    name_ua=self.name_ua,
                    attribution=self.attribution,
                    session_id=AGENT_SESSION,
                )
        except Exception:  # pragma: no cover — defensive
            pass

        await broadcast_map_mutation(mutation, narrative=narrative)
        return ActionResult(
            ok=True,
            output=build_map_output(
                narrative=narrative,
                mutation=mutation,
                extras={
                    "layer_id": self.layer_id,
                    "ephemeral": True,
                    "source_kind": self.source.get("kind"),
                },
            ),
            side_effects=[f"layer_added:{self.layer_id}"],
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
