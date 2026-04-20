"""
Phase 9.4b — localization primitives.

Base classes and a haversine helper that all sources/resolvers share.
"""
from __future__ import annotations

import math
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class LocalizationError(Exception):
    """Base class for localization failures."""


class LocalizationUnavailable(LocalizationError):
    """Raised when a source cannot produce a position right now (silent fallthrough)."""


class LocationEstimate(BaseModel):
    """A single localization reading with provenance and confidence metadata.

    ``source`` identifies which :class:`LocalizationSource` produced this
    estimate; ``trust_level`` is cached from the source so downstream code
    can sort results without holding a reference back to the source object.
    """
    model_config = ConfigDict(frozen=True)

    lat: float = Field(..., ge=-90.0, le=90.0)
    lon: float = Field(..., ge=-180.0, le=180.0)
    source: str = Field(..., min_length=1, max_length=64)
    confidence: float = Field(..., ge=0.0, le=1.0)
    accuracy_m: Optional[float] = Field(default=None, ge=0.0)
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(tz=timezone.utc)
    )
    trust_level: int = Field(..., ge=0, le=100)

    def with_updated_trust(self, trust_level: int) -> "LocationEstimate":
        return self.model_copy(update={"trust_level": trust_level})


class LocalizationSource(ABC):
    """Abstract source — subclass + register with the resolver.

    Attributes:
        name:        short snake_case identifier, matches ``LocationEstimate.source``
        trust_level: 0..100; resolver tries sources highest-first
    """
    name: str = "abstract"
    trust_level: int = 0

    @abstractmethod
    def is_available(self) -> bool:
        """Quick synchronous check — return False to skip this source
        without paying the cost of :meth:`get_position`.
        """

    @abstractmethod
    async def get_position(self) -> Optional[LocationEstimate]:
        """Produce the current position estimate, or None if unknown.

        Raise :class:`LocalizationError` for transient failures (network
        timeout, rate-limit, parse error); the resolver logs and continues
        to the next source. Return ``None`` when the source is simply idle
        (e.g. no GPS fix, cache empty) — no logging, no fuss.
        """


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two coords in kilometres."""
    r = 6371.0088
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = (math.sin(dphi / 2) ** 2
         + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return r * c


__all__ = [
    "LocalizationError",
    "LocalizationUnavailable",
    "LocationEstimate",
    "LocalizationSource",
    "haversine_km",
]
