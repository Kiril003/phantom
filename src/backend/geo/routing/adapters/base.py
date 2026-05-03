"""Adapter ABC for routing backends."""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import ClassVar

from ..models import (
    IsochroneRequest,
    IsochroneResult,
    MatrixRequest,
    MatrixResult,
    RouteRequest,
    RouteResult,
    SnapMatchRequest,
    SnapMatchResult,
)


class RoutingError(RuntimeError):
    """Raised when a routing backend fails or times out.

    Always wrapped — the facade catches this and falls through to the
    next adapter rather than bubbling up. Callers see RoutingError only
    when *every* adapter has refused the request.
    """


class RouteAdapter(ABC):
    """Single backend (BRouter, ORS, OSRM, ...).

    Adapters MUST be cheap to construct (no I/O at __init__). The
    facade calls :meth:`available` before each operation so an offline
    machine doesn't hammer a downed cloud endpoint. Operations that
    aren't supported by the backend should raise :class:`RoutingError`
    with a descriptive message.
    """

    name: ClassVar[str] = "abstract"
    requires_internet: ClassVar[bool] = True

    @abstractmethod
    async def available(self) -> bool:
        """Return True if the adapter is configured + reachable."""

    @abstractmethod
    async def route(self, req: RouteRequest) -> RouteResult:
        ...

    async def isochrone(self, req: IsochroneRequest) -> IsochroneResult:
        raise RoutingError(f"{self.name} does not support isochrones")

    async def matrix(self, req: MatrixRequest) -> MatrixResult:
        raise RoutingError(f"{self.name} does not support matrix")

    async def snap_match(self, req: SnapMatchRequest) -> SnapMatchResult:
        raise RoutingError(f"{self.name} does not support map-matching")
