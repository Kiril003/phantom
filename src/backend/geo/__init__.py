"""PHANTOM geo domain — Phase 24-A.

Single source of truth for layers, tiles, attribution and map cache.

Public surface:
    - get_layer_registry(): the loaded LayerRegistry singleton
    - get_map_cache(): the shared MapCache singleton
    - get_attribution_store(): the shared AttributionStore singleton

Per ADR-OMNIMAP-001 (PHASE_24_OMNIMAP.md §1.4): "Layer registry is data,
not code." Every shippable layer is described by a YAML manifest in
`src/backend/geo/layer_registry/manifests/*.yaml` and validated against
`LayerManifest` (Pydantic v2). This package owns loading, caching and
attribution accumulation; rendering and routing live elsewhere.
"""
from __future__ import annotations

from .attribution import AttributionStore, get_attribution_store
from .layer_manifest import (
    LayerAuth,
    LayerCategory,
    LayerManifest,
    LayerSource,
    LayerSourceType,
    LayerStaleness,
    LayerStalenessAsymmetry,
    LayerStyle,
    LayerTier,
    StaleRender,
)
from .layer_registry import LayerRegistry, get_layer_registry, reload_layer_registry
from .map_cache import MapCache, get_map_cache

__all__ = [
    "AttributionStore",
    "LayerAuth",
    "LayerCategory",
    "LayerManifest",
    "LayerRegistry",
    "LayerSource",
    "LayerSourceType",
    "LayerStaleness",
    "LayerStalenessAsymmetry",
    "LayerStyle",
    "LayerTier",
    "MapCache",
    "StaleRender",
    "get_attribution_store",
    "get_layer_registry",
    "get_map_cache",
    "reload_layer_registry",
]
