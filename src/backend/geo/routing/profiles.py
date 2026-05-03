"""Travel-mode profiles + per-adapter name mapping (Phase 24-C).

The agent talks in PHANTOM-canonical terms (``car``, ``foot``,
``foot_stealth``); each routing backend uses its own dialect. Keep
the translation in one place so the facade stays readable.
"""
from __future__ import annotations

from enum import Enum


class RoutingProfile(str, Enum):
    CAR = "car"
    FOOT = "foot"
    BIKE = "bike"
    MTB = "mtb"
    FOOT_STEALTH = "foot_stealth"
    DRONE_LOITER = "drone_loiter"


# ── BRouter (offline, local Docker) ────────────────────────────────────────


_BROUTER_PROFILE = {
    RoutingProfile.CAR: "car-fast",
    RoutingProfile.FOOT: "hiking-mountain",
    RoutingProfile.BIKE: "trekking",
    RoutingProfile.MTB: "fastbike",
    RoutingProfile.FOOT_STEALTH: "hiking-mountain",
    RoutingProfile.DRONE_LOITER: "shortest",
}


# ── OpenRouteService ───────────────────────────────────────────────────────


_ORS_PROFILE = {
    RoutingProfile.CAR: "driving-car",
    RoutingProfile.FOOT: "foot-walking",
    RoutingProfile.BIKE: "cycling-regular",
    RoutingProfile.MTB: "cycling-mountain",
    RoutingProfile.FOOT_STEALTH: "foot-hiking",
    RoutingProfile.DRONE_LOITER: "driving-car",  # ORS has no drone — closest analogue
}


# ── OSRM (public demo or self-host) ────────────────────────────────────────


_OSRM_PROFILE = {
    RoutingProfile.CAR: "driving",
    RoutingProfile.FOOT: "foot",
    RoutingProfile.BIKE: "bike",
    RoutingProfile.MTB: "bike",
    RoutingProfile.FOOT_STEALTH: "foot",
    RoutingProfile.DRONE_LOITER: "driving",
}


def to_brouter(profile: RoutingProfile) -> str:
    return _BROUTER_PROFILE[profile]


def to_ors(profile: RoutingProfile) -> str:
    return _ORS_PROFILE[profile]


def to_osrm(profile: RoutingProfile) -> str:
    return _OSRM_PROFILE[profile]
