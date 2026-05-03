"""LayerRegistry — load, validate and serve OmniMap layer manifests.

Phase 24-A. The registry is the *single source of truth* for which
layers exist, what they cost, who is allowed to enable them, and what
attribution they bring. The renderer never invents a layer; the agent
never asks for one that's missing — both consult this registry.

Loading is filesystem-driven: every `*.yaml` under
`MANIFEST_DIR` (default
`src/backend/geo/layer_registry/manifests/`) is parsed and validated
against :class:`~geo.layer_manifest.LayerManifest`. Bad files raise
:class:`LayerManifestError` so a typo in a manifest never silently
disables the layer at runtime.

Per-session enable/disable state is *not* persisted here — it lives in
the AttributionStore (see `attribution.py`) so the registry stays a
pure read-model. Settings-driven defaults (e.g. `default_active`) and
operator overrides via `POST /map/layers/<id>/enable` /
`DELETE /map/layers/<id>` are layered on top by `routes_map.py`.
"""
from __future__ import annotations

import logging
import threading
from collections.abc import Iterable
from pathlib import Path
from typing import Optional

import yaml
from pydantic import ValidationError

from .layer_manifest import LayerCategory, LayerManifest

logger = logging.getLogger(__name__)


# ── Errors ─────────────────────────────────────────────────────────────────


class LayerManifestError(ValueError):
    """Raised when a manifest YAML cannot be parsed or validated."""


class LayerNotFoundError(KeyError):
    """Raised when a layer id is not present in the registry."""


# ── Registry ───────────────────────────────────────────────────────────────


_DEFAULT_MANIFEST_DIR = Path(__file__).parent / "layer_registry" / "manifests"


class LayerRegistry:
    """In-memory directory of validated :class:`LayerManifest` records."""

    def __init__(self, manifest_dir: Path | None = None) -> None:
        self._manifest_dir: Path = (manifest_dir or _DEFAULT_MANIFEST_DIR).resolve()
        self._layers: dict[str, LayerManifest] = {}
        self._load_errors: list[tuple[str, str]] = []
        self._lock = threading.RLock()

    # ── Loading ─────────────────────────────────────────────────────

    def load(self) -> "LayerRegistry":
        """Read and validate every YAML manifest under `manifest_dir`."""
        with self._lock:
            self._layers.clear()
            self._load_errors.clear()
            if not self._manifest_dir.exists():
                logger.warning("manifest dir missing: %s", self._manifest_dir)
                return self
            yaml_files = sorted(self._manifest_dir.glob("*.yaml"))
            for path in yaml_files:
                try:
                    manifest = self._load_one(path)
                except LayerManifestError as exc:
                    logger.error("layer manifest %s rejected: %s", path.name, exc)
                    self._load_errors.append((path.name, str(exc)))
                    continue
                self._layers[manifest.id] = manifest
            logger.info(
                "layer registry loaded: %d valid, %d rejected from %s",
                len(self._layers),
                len(self._load_errors),
                self._manifest_dir,
            )
        return self

    def _load_one(self, path: Path) -> LayerManifest:
        try:
            raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        except yaml.YAMLError as exc:
            raise LayerManifestError(f"YAML parse failure: {exc}") from exc
        if not isinstance(raw, dict):
            raise LayerManifestError(
                f"manifest must be a mapping at the top level, got {type(raw).__name__}"
            )
        try:
            manifest = LayerManifest.model_validate(raw)
        except ValidationError as exc:
            raise LayerManifestError(f"schema validation failed: {exc}") from exc
        expected_id = path.stem
        if manifest.id != expected_id:
            raise LayerManifestError(
                f"id field {manifest.id!r} does not match filename stem {expected_id!r}"
            )
        return manifest

    # ── Read API ────────────────────────────────────────────────────

    def get(self, layer_id: str) -> LayerManifest:
        """Return a manifest by id or raise :class:`LayerNotFoundError`."""
        with self._lock:
            try:
                return self._layers[layer_id]
            except KeyError as exc:
                raise LayerNotFoundError(layer_id) from exc

    def has(self, layer_id: str) -> bool:
        with self._lock:
            return layer_id in self._layers

    def all(self) -> list[LayerManifest]:
        """All loaded manifests, sorted by (category, id)."""
        with self._lock:
            return sorted(
                self._layers.values(),
                key=lambda m: (m.category.value, m.id),
            )

    def filter(
        self,
        *,
        category: Optional[LayerCategory] = None,
        require_internet: Optional[bool] = None,
        available_offline: Optional[bool] = None,
        require_root: Optional[bool] = None,
        ids: Optional[Iterable[str]] = None,
    ) -> list[LayerManifest]:
        """Apply a conjunction of filters; missing kwargs are ignored."""
        id_set = set(ids) if ids is not None else None
        with self._lock:
            out: list[LayerManifest] = []
            for m in self._layers.values():
                if category is not None and m.category != category:
                    continue
                if require_internet is not None and m.require_internet != require_internet:
                    continue
                if available_offline is not None and m.available_offline != available_offline:
                    continue
                if require_root is not None and m.require_root != require_root:
                    continue
                if id_set is not None and m.id not in id_set:
                    continue
                out.append(m)
        return sorted(out, key=lambda m: (m.category.value, m.id))

    def categories(self) -> list[LayerCategory]:
        with self._lock:
            return sorted({m.category for m in self._layers.values()}, key=lambda c: c.value)

    def default_active_ids(self) -> list[str]:
        with self._lock:
            return sorted(m.id for m in self._layers.values() if m.default_active)

    def load_errors(self) -> list[tuple[str, str]]:
        with self._lock:
            return list(self._load_errors)

    @property
    def manifest_dir(self) -> Path:
        return self._manifest_dir

    # ── Public projection ───────────────────────────────────────────

    def public_index(self) -> list[dict]:
        """`/map/layers` payload — secret-free projection of every manifest."""
        return [m.public_dict() for m in self.all()]


# ── Process-wide singleton ─────────────────────────────────────────────────

_registry_lock = threading.Lock()
_registry: Optional[LayerRegistry] = None


def get_layer_registry() -> LayerRegistry:
    """Return (and lazily build) the global registry instance."""
    global _registry
    if _registry is not None:
        return _registry
    with _registry_lock:
        if _registry is None:
            _registry = LayerRegistry().load()
    return _registry


def reload_layer_registry() -> LayerRegistry:
    """Force a re-scan of the manifest directory; used by tests + dev."""
    global _registry
    with _registry_lock:
        _registry = LayerRegistry().load()
    return _registry
