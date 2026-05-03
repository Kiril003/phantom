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
from .list_layers import MapListLayers
from .open_map import MapOpenMap
from .query_nearby import MapQueryNearby
from .reverse_geocode import MapReverseGeocode
from .set_view import MapSetView
from .snapshot import MapSnapshot

# Importable as a tuple so registry.py can splat it into _REGISTERED.
MAP_ACTIONS = (
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
    "MapListLayers",
    "MapMutation",
    "MapOpenMap",
    "MapQueryNearby",
    "MapReverseGeocode",
    "MapSetView",
    "MapSnapshot",
    "broadcast_map_mutation",
    "build_map_output",
]
