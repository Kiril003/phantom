"""
Phase 9.4b — pluggable localization sources.

Public surface:
  LocationEstimate      — coordinates + trust metadata
  LocalizationSource    — abstract source interface
  LocalizationResolver  — picks highest-trust available source, applies sanity checks
  get_resolver()        — module singleton access

Concrete sources + adapters live under `.sources` and `.adapters`.
"""
from __future__ import annotations

from .base import (
    LocationEstimate,
    LocalizationSource,
    LocalizationError,
    LocalizationUnavailable,
    haversine_km,
)
from .resolver import LocalizationResolver, get_resolver, set_resolver

__all__ = [
    "LocationEstimate",
    "LocalizationSource",
    "LocalizationError",
    "LocalizationUnavailable",
    "haversine_km",
    "LocalizationResolver",
    "get_resolver",
    "set_resolver",
]
