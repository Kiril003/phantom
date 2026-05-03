"""PHANTOM geo routing facade — Phase 24-C.

Strategy: try BRouter (offline, local Docker on Radxa) first, then
OpenRouteService (online, API key), then OSRM public (online, no
key) as last-resort fallback. Every adapter implements the same
:class:`RouteAdapter` ABC so the facade only knows how to "ask" — it
doesn't care which backend answers.

Public surface:
    - get_router(): the loaded `RouterFacade` singleton
    - RoutingProfile: enum of supported travel modes
    - RouteRequest / RouteResult / IsochroneRequest / ...

Per ADR-OMNIMAP-002 the routing layer is "offline-first": when the
operator is in air-plane mode (or the Radxa cannot reach the public
internet) BRouter answers locally and the experience never breaks.
Cloud backends are *upgrades*, not requirements.
"""
from __future__ import annotations

from .models import (
    IsochroneRequest,
    IsochroneResult,
    MatrixRequest,
    MatrixResult,
    RouteAlternative,
    RouteRequest,
    RouteResult,
    SnapMatchRequest,
    SnapMatchResult,
)
from .profiles import RoutingProfile
from .router_facade import RouterFacade, get_router, reset_router_for_tests

__all__ = [
    "IsochroneRequest",
    "IsochroneResult",
    "MatrixRequest",
    "MatrixResult",
    "RouteAlternative",
    "RouteRequest",
    "RouteResult",
    "RouterFacade",
    "RoutingProfile",
    "SnapMatchRequest",
    "SnapMatchResult",
    "get_router",
    "reset_router_for_tests",
]
