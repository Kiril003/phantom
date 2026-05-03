"""RouterFacade — strategy + fallback chain across routing adapters.

Order of preference (configurable, defaults shown):

1. **BRouter** — local Docker, offline-friendly. First because the
   Radxa might not have internet at all.
2. **OpenRouteService** — online, API-key, rich features (matrix,
   isochrones).
3. **OSRM public** — last-resort online no-key fallback.

The facade dispatches to the first adapter whose ``available()``
returns True; on a :class:`RoutingError` it tries the next. When
*every* adapter refuses the request the facade re-raises the *last*
error so callers see a real reason rather than a generic timeout.

Caching is delegated to :class:`geo.MapCache` keyed by request hash;
TTL defaults are short (60 s for routes, 600 s for isochrones)
because traffic patterns shift on the minute scale.
"""
from __future__ import annotations

import hashlib
import json
import logging
import threading
from typing import Iterable, Optional

from ..map_cache import MapCache, get_map_cache
from .adapters import (
    BRouterAdapter,
    ORSAdapter,
    OSRMAdapter,
    RouteAdapter,
    RoutingError,
)
from .models import (
    IsochroneRequest,
    IsochroneResult,
    MatrixRequest,
    MatrixResult,
    RouteRequest,
    RouteResult,
    SnapMatchRequest,
    SnapMatchResult,
)

logger = logging.getLogger(__name__)


_ROUTE_TTL_S = 60.0
_ISOCHRONE_TTL_S = 600.0
_MATRIX_TTL_S = 300.0


class RouterFacade:
    """Try adapters in `chain` order; return the first success."""

    def __init__(self, chain: Iterable[RouteAdapter], cache: Optional[MapCache] = None) -> None:
        self._chain: list[RouteAdapter] = list(chain)
        self._cache = cache

    @property
    def chain(self) -> list[RouteAdapter]:
        return list(self._chain)

    @property
    def adapter_names(self) -> list[str]:
        return [a.name for a in self._chain]

    # ── Cache helpers ───────────────────────────────────────────────

    def _key(self, op: str, payload: dict) -> str:
        raw = json.dumps({"op": op, "p": payload}, sort_keys=True, default=str)
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]

    # ── Public API ──────────────────────────────────────────────────

    async def route(self, req: RouteRequest) -> RouteResult:
        return await self._dispatch(
            "route",
            req.model_dump(mode="json"),
            ttl_s=_ROUTE_TTL_S,
            method=lambda a: a.route(req),
            unwrap=RouteResult.model_validate,
        )

    async def isochrone(self, req: IsochroneRequest) -> IsochroneResult:
        return await self._dispatch(
            "isochrone",
            req.model_dump(mode="json"),
            ttl_s=_ISOCHRONE_TTL_S,
            method=lambda a: a.isochrone(req),
            unwrap=IsochroneResult.model_validate,
        )

    async def matrix(self, req: MatrixRequest) -> MatrixResult:
        return await self._dispatch(
            "matrix",
            req.model_dump(mode="json"),
            ttl_s=_MATRIX_TTL_S,
            method=lambda a: a.matrix(req),
            unwrap=MatrixResult.model_validate,
        )

    async def snap_match(self, req: SnapMatchRequest) -> SnapMatchResult:
        return await self._dispatch(
            "snap_match",
            req.model_dump(mode="json"),
            ttl_s=_ROUTE_TTL_S,
            method=lambda a: a.snap_match(req),
            unwrap=SnapMatchResult.model_validate,
        )

    # ── Core dispatch ───────────────────────────────────────────────

    async def _dispatch(self, op: str, payload: dict, *, ttl_s: float, method, unwrap):
        last_error: Optional[Exception] = None
        cache = self._cache
        cache_key = self._key(op, payload) if cache is not None else None

        if cache is not None and cache_key is not None:
            hit = cache.get("routing", f"{op}:{cache_key}")
            if hit is not None:
                # `value` is the dict form of the model
                return unwrap(hit.value)

        for adapter in self._chain:
            try:
                if not await adapter.available():
                    continue
            except Exception as exc:
                logger.debug("adapter %s availability probe raised: %s", adapter.name, exc)
                continue
            try:
                result = await method(adapter)
            except RoutingError as exc:
                last_error = exc
                logger.info("adapter %s failed %s: %s", adapter.name, op, exc)
                continue
            except Exception as exc:  # defensive — unwrap unexpected adapter exceptions
                last_error = RoutingError(f"{adapter.name}: {exc}")
                logger.warning("adapter %s raised unexpected %s: %s", adapter.name, op, exc)
                continue
            if cache is not None and cache_key is not None:
                cache.set("routing", f"{op}:{cache_key}", result.model_dump(mode="json"), ttl_s=ttl_s)
            return result

        if last_error is not None:
            raise last_error
        raise RoutingError(f"no routing adapter available for {op}")


# ── Factory + singleton ───────────────────────────────────────────────────


def _build_default_chain() -> list[RouteAdapter]:
    """Read config and assemble the adapter chain."""
    chain: list[RouteAdapter] = []
    try:
        from config import config
    except Exception:
        return chain
    if getattr(config, "routing_brouter_enabled", True):
        url = getattr(config, "routing_brouter_url", "http://localhost:17777")
        chain.append(BRouterAdapter(url))
    if getattr(config, "routing_ors_enabled", True):
        key = getattr(config, "routing_ors_api_key", "") or ""
        if key:
            chain.append(ORSAdapter(key))
    if getattr(config, "routing_osrm_enabled", True):
        url = getattr(config, "routing_osrm_url", "https://router.project-osrm.org")
        chain.append(OSRMAdapter(url))
    return chain


_lock = threading.Lock()
_router: Optional[RouterFacade] = None


def get_router() -> RouterFacade:
    global _router
    if _router is not None:
        return _router
    with _lock:
        if _router is None:
            _router = RouterFacade(_build_default_chain(), cache=get_map_cache())
    return _router


def reset_router_for_tests(chain: Optional[Iterable[RouteAdapter]] = None) -> RouterFacade:
    """Replace the singleton — pytest helper, never call from runtime."""
    global _router
    with _lock:
        _router = RouterFacade(chain or [], cache=None)
    return _router
