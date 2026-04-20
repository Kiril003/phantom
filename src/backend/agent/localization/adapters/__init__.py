"""Phase 9.4b — external service adapters (ipapi, Nominatim, Overpass)."""
from __future__ import annotations

from .rate_limiter import DailyRateLimiter, PerSecondRateLimiter
from .ipapi import IpApiLocator, get_default_ipapi, set_default_ipapi
from .nominatim import (
    GeocodeResult,
    NominatimGeocoder,
    ReverseGeocodeResult,
    get_default_nominatim,
    set_default_nominatim,
)

__all__ = [
    "DailyRateLimiter",
    "PerSecondRateLimiter",
    "IpApiLocator",
    "get_default_ipapi",
    "set_default_ipapi",
    "NominatimGeocoder",
    "GeocodeResult",
    "ReverseGeocodeResult",
    "get_default_nominatim",
    "set_default_nominatim",
]
