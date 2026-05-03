"""Pydantic models for PHANTOM routing requests/responses (Phase 24-C)."""
from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .profiles import RoutingProfile


class LatLon(BaseModel):
    """One lat/lon point."""

    model_config = ConfigDict(extra="forbid")

    lat: float = Field(..., ge=-90.0, le=90.0)
    lon: float = Field(..., ge=-180.0, le=180.0)

    def as_pair(self) -> tuple[float, float]:
        return (self.lat, self.lon)


# ── Route -----------------------------------------------------------------


class RouteRequest(BaseModel):
    """Request to plan a route between two or more waypoints."""

    model_config = ConfigDict(extra="forbid")

    waypoints: list[LatLon] = Field(..., min_length=2, max_length=64)
    profile: RoutingProfile = RoutingProfile.CAR
    alternatives: int = Field(default=0, ge=0, le=3)
    avoid: list[str] = Field(default_factory=list)
    prefer: list[str] = Field(default_factory=list)
    language: str = Field(default="uk", max_length=5)


class RouteAlternative(BaseModel):
    """One route option (primary + N alternatives)."""

    model_config = ConfigDict(extra="forbid")

    distance_m: float
    duration_s: float
    geometry: dict[str, Any] = Field(
        ...,
        description="GeoJSON LineString with the polyline (lon,lat pairs).",
    )
    summary: str = ""
    extras: dict[str, Any] = Field(default_factory=dict)


class RouteResult(BaseModel):
    """Successful route response."""

    model_config = ConfigDict(extra="forbid")

    primary: RouteAlternative
    alternatives: list[RouteAlternative] = Field(default_factory=list)
    profile: RoutingProfile
    engine: str
    cached: bool = False
    extras: dict[str, Any] = Field(default_factory=dict)


# ── Isochrone -------------------------------------------------------------


class IsochroneRequest(BaseModel):
    """Compute the area reachable within `time_minutes` from `center`."""

    model_config = ConfigDict(extra="forbid")

    center: LatLon
    time_minutes: int = Field(..., ge=1, le=120)
    profile: RoutingProfile = RoutingProfile.FOOT


class IsochroneResult(BaseModel):
    """GeoJSON polygon enclosing the isochrone."""

    model_config = ConfigDict(extra="forbid")

    geometry: dict[str, Any]
    profile: RoutingProfile
    time_minutes: int
    engine: str
    extras: dict[str, Any] = Field(default_factory=dict)


# ── Matrix ----------------------------------------------------------------


class MatrixRequest(BaseModel):
    """N×M duration/distance matrix used by `optimize_visit`."""

    model_config = ConfigDict(extra="forbid")

    points: list[LatLon] = Field(..., min_length=2, max_length=24)
    profile: RoutingProfile = RoutingProfile.CAR

    @field_validator("points")
    @classmethod
    def _no_dupes(cls, v: list[LatLon]) -> list[LatLon]:
        # Allow duplicates — matrix is well-defined; explicit guard kept
        # so future tightening is local.
        return v


class MatrixResult(BaseModel):
    """N×M matrices keyed by row index."""

    model_config = ConfigDict(extra="forbid")

    durations_s: list[list[float]]
    distances_m: list[list[float]]
    profile: RoutingProfile
    engine: str


# ── Snap / map-match ------------------------------------------------------


class SnapMatchRequest(BaseModel):
    """Snap a noisy GPS trace to roads."""

    model_config = ConfigDict(extra="forbid")

    points: list[LatLon] = Field(..., min_length=2, max_length=500)
    profile: RoutingProfile = RoutingProfile.CAR
    timestamps_ms: Optional[list[int]] = None


class SnapMatchResult(BaseModel):
    """Result of map-matching."""

    model_config = ConfigDict(extra="forbid")

    geometry: dict[str, Any]
    confidence: float = Field(ge=0.0, le=1.0)
    engine: str
    extras: dict[str, Any] = Field(default_factory=dict)
