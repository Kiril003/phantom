"""Shared types + helpers for the `map.*` action surface.

A :class:`MapMutation` describes a single delta the renderer should
apply: "fly to (lat, lon)", "enable the air-raid layer", "drop this
marker". An :class:`MapArtifact` is a serialised result the chat /
voice surfaces want to attach to the action's narrative — a
screenshot URL, a GeoJSON download, an isochrone polygon for the
side panel.

The actual ``ActionResult`` returned to the executor uses the
existing :class:`agent.schemas.ActionResult` so the registry stays a
single shape. The map-specific payload sits in
``ActionResult.output`` shaped by :func:`build_map_output`. Each
mutating action also emits the same payload over the ``"map"``
WebSocket channel via :func:`broadcast_map_mutation` so the desktop
HUD repaints without polling.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger(__name__)


# Default attribution session for actions issued by the agent loop.
# HTTP-side endpoints scope per JWT user (`user:<id>`); the agent
# itself runs in a single-operator context so a stable ``"agent"``
# session collapses concurrent agent verbs into one drawer.
AGENT_SESSION = "agent"


class MapMutation(BaseModel):
    """A single delta the renderer should apply to the OmniMap."""

    model_config = ConfigDict(extra="forbid")

    op: str = Field(
        ...,
        description=(
            "Mutation kind. Stable string keys consumed by the frontend "
            "renderer: open_map | set_view | fly_to | add_marker | "
            "enable_layer | disable_layer | snapshot | narrate."
        ),
    )
    target: Optional[str] = Field(
        default=None,
        description="Optional symbolic target (layer id, marker id, address).",
    )
    payload: dict[str, Any] = Field(
        default_factory=dict,
        description="op-specific data — e.g. {center, zoom, bearing, pitch}.",
    )

    def to_ws_payload(self, *, narrative: str = "") -> dict[str, Any]:
        return {
            "op": self.op,
            "target": self.target,
            "payload": self.payload,
            "narrative": narrative,
        }


class MapArtifact(BaseModel):
    """A side-channel artifact attached to an action's narrative."""

    model_config = ConfigDict(extra="forbid")

    kind: str = Field(
        ...,
        description="screenshot | geojson | gpx | route | layer_index | feature",
    )
    label: str = Field(default="")
    payload: dict[str, Any] = Field(default_factory=dict)


def build_map_output(
    *,
    narrative: str,
    mutation: MapMutation,
    artifacts: list[MapArtifact] | None = None,
    follow_ups: list[str] | None = None,
    extras: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Assemble the ``ActionResult.output`` shape that map verbs return.

    The narrative is human-facing (chat + TTS); the mutation drives the
    UI; artifacts open in side panels; follow_ups feed the planner's
    next-step hints. ``extras`` is a free-form bag for adapter-level
    debug data (cache hit?  source?  request ms).
    """
    return {
        "narrative": narrative,
        "map_mutation": mutation.model_dump(mode="json"),
        "artifacts": [a.model_dump(mode="json") for a in (artifacts or [])],
        "follow_ups": list(follow_ups or []),
        "extras": dict(extras or {}),
    }


async def broadcast_map_mutation(
    mutation: MapMutation,
    *,
    narrative: str = "",
    user_id: Optional[str] = None,
) -> None:
    """Push a mutation onto the `"map"` WS channel for the renderer.

    Best-effort — a missing/disconnected hub never raises. ``user_id``
    is optional; when set the broadcast is scoped to that user's
    WS clients (e.g. a mobile-only nudge).
    """
    try:
        from api.websocket_hub import hub  # late import — keeps package import-safe in tests
    except Exception as exc:  # pragma: no cover — websocket_hub is always present in prod
        logger.debug("map mutation broadcast skipped (no hub): %s", exc)
        return
    try:
        await hub.broadcast(
            "map",
            mutation.op,
            mutation.to_ws_payload(narrative=narrative),
            user_id=user_id,
        )
    except Exception as exc:
        logger.debug("map WS broadcast failed: %s", exc)
