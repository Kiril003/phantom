"""
Phase 9.4b — wire the default source set into the resolver.

Called from FastAPI lifespan at startup. Tests build their own resolver
with monkey-patched sources and never call this.
"""
from __future__ import annotations

import logging

from .resolver import get_resolver
from .sources import (
    BrowserGeolocationSource,
    GpsHardwareSource,
    IpEstimateSource,
    UserStatedSource,
)

logger = logging.getLogger(__name__)


def wire_default_sources() -> None:
    """Idempotent — registering a source twice replaces the prior instance."""
    resolver = get_resolver()
    try:
        resolver.add_source(GpsHardwareSource())
    except Exception as exc:  # noqa: BLE001
        logger.warning("GpsHardwareSource wire failed: %s", exc)
    resolver.add_source(UserStatedSource())
    resolver.add_source(BrowserGeolocationSource())
    resolver.add_source(IpEstimateSource())
    logger.info(
        "Localization resolver wired with %d sources: %s",
        len(resolver.sources),
        [s.name for s in resolver.sources],
    )


__all__ = ["wire_default_sources"]
