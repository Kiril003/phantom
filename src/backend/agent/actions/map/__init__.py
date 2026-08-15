"""PHANTOM agent — `map.*` action surface (Phase 24-B).

Twelve typed verbs the planner can issue against the OmniMap. Each
returns the standard ``ActionResult`` whose ``output`` carries a
:class:`MapMutation` describing what changed in the map state plus a
short narrative for chat / TTS. Mutations are mirrored to the
``"map"`` WebSocket channel so the renderer reacts in lock-step.
"""
from __future__ import annotations

from ._common import (
    AGENT_SESSION,
    MapArtifact,
    MapMutation,
    broadcast_map_mutation,
    build_map_output,
)
from .add_marker import MapAddMarker
from .disable_layer import MapDisableLayer
from .enable_layer import MapEnableLayer
from .explain_view import MapExplainView
from .flyto import MapFlyTo
from .geocode import MapGeocode
from .isochrone import MapIsochrone
from .list_layers import MapListLayers
from .open_map import MapOpenMap
from .optimize_visit import MapOptimizeVisit
from .plan_route import MapPlanRoute
from .query_nearby import MapQueryNearby
from .reverse_geocode import MapReverseGeocode
from .set_view import MapSetView
from .snap_track import MapSnapTrack
from .snapshot import MapSnapshot
from .time_travel import MapTimeTravel

# Importable as a tuple so registry.py can splat it into _REGISTERED.
MAP_ACTIONS = (
    # 24-B base surface
    MapOpenMap,
    MapSetView,
    MapFlyTo,
    MapAddMarker,
    MapQueryNearby,
    MapGeocode,
    MapReverseGeocode,
    MapListLayers,
    MapEnableLayer,
    MapDisableLayer,
    MapSnapshot,
    MapExplainView,
    # 24-C routing surface
    MapPlanRoute,
    MapOptimizeVisit,
    MapIsochrone,
    MapSnapTrack,
    # 24-H — written, then never imported here, so the agent could never
    # time-travel a layer despite `useMapAgentBridge.ts` already having a
    # working `op: "time_travel"` case since Phase 24-D. Unfinished
    # wiring, not an abandoned idea: closing the gap is exactly importing
    # it, nothing about the action itself needed to change.
    MapTimeTravel,
)

__all__ = [
    "AGENT_SESSION",
    "MAP_ACTIONS",
    "MapAddMarker",
    "MapArtifact",
    "MapDisableLayer",
    "MapEnableLayer",
    "MapExplainView",
    "MapFlyTo",
    "MapGeocode",
    "MapIsochrone",
    "MapListLayers",
    "MapMutation",
    "MapOpenMap",
    "MapOptimizeVisit",
    "MapPlanRoute",
    "MapQueryNearby",
    "MapReverseGeocode",
    "MapSetView",
    "MapSnapTrack",
    "MapSnapshot",
    "MapTimeTravel",
    "broadcast_map_mutation",
    "build_map_output",
]
