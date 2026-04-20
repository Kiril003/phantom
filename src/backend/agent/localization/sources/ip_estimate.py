"""
Phase 9.4b — IpEstimateSource.

Last-resort localization: asks ipapi.co where the current egress IP lives.
City-level accuracy (~50 km), free tier 1000 req/day, no key needed. We
cache aggressively (10 min) and back off when the daily budget is spent
— the whole point is to avoid pestering the service.
"""
from __future__ import annotations

import logging
from typing import Optional

from config import config

from ..adapters.ipapi import IpApiLocator, get_default_ipapi
from ..base import LocationEstimate, LocalizationSource

logger = logging.getLogger(__name__)


class IpEstimateSource(LocalizationSource):
    name = "ip_estimate"
    trust_level = 30

    def __init__(self, locator: Optional[IpApiLocator] = None) -> None:
        self._locator = locator if locator is not None else get_default_ipapi()

    def is_available(self) -> bool:
        if not getattr(config, "agent_ip_locator_enabled", True):
            return False
        return self._locator.can_request_or_has_cache()

    async def get_position(self) -> Optional[LocationEstimate]:
        if not getattr(config, "agent_ip_locator_enabled", True):
            return None
        est = await self._locator.locate_current_ip()
        if est is None:
            return None
        # Normalise the trust metadata the adapter returned — in case the
        # adapter was monkeypatched in tests with a different trust_level.
        if est.trust_level != self.trust_level or est.source != self.name:
            est = est.model_copy(update={"trust_level": self.trust_level, "source": self.name})
        return est


__all__ = ["IpEstimateSource"]
