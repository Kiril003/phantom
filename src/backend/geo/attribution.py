"""AttributionStore — per-session active-layer + attribution accumulator.

Phase 24-A. Two responsibilities:

1. **State** — for each session (or `"global"` when no session is in
   play) remember which layer ids are active. The frontend may
   ``POST /map/layers/<id>/enable`` and ``DELETE /map/layers/<id>``;
   the chat agent flips the same set via verbs. Anything that wants
   to know "is the operator currently looking at the frontline?" reads
   :meth:`is_active`.
2. **Attribution union** — every active layer carries a single
   attribution string in its manifest (e.g. ``"Дані: alarms.in.ua"``).
   The drawer in the top-right of the OmniMap HUD shows the *union*
   of those strings, deduplicated, in stable order. The Map Doctrine
   says no license may ever be omitted; this store is what enforces it.

Storage is in-memory and per-process. Mobile companions and the
chat agent share the same backend, so a single accumulator suffices.
Sessions never persist — restart = clean slate, which is the right
default for an attribution UI.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Optional

from .layer_registry import LayerRegistry, get_layer_registry


GLOBAL_SESSION = "global"


@dataclass(frozen=True)
class AttributionEntry:
    """A single attribution string + which layers contributed it."""

    text: str
    layer_ids: tuple[str, ...]
    license: str


@dataclass(frozen=True)
class LayerActivation:
    """Bookkeeping for an active layer."""

    layer_id: str
    activated_at: float
    via: str  # "default" | "operator" | "agent"


class AttributionStore:
    """Thread-safe per-session active layer + attribution accumulator."""

    def __init__(self, registry: Optional[LayerRegistry] = None) -> None:
        self._registry = registry  # late-bind via _registry_or_default
        self._sessions: dict[str, dict[str, LayerActivation]] = {}
        self._lock = threading.RLock()

    # ── Helpers ─────────────────────────────────────────────────────

    def _registry_or_default(self) -> LayerRegistry:
        return self._registry if self._registry is not None else get_layer_registry()

    def _seed_session(self, session_id: str) -> dict[str, LayerActivation]:
        """Lazily install default-active layers when a session is first seen."""
        active: dict[str, LayerActivation] = {}
        registry = self._registry_or_default()
        now = time.time()
        for manifest in registry.all():
            if manifest.default_active:
                active[manifest.id] = LayerActivation(
                    layer_id=manifest.id,
                    activated_at=now,
                    via="default",
                )
        self._sessions[session_id] = active
        return active

    def _ensure_session(self, session_id: str) -> dict[str, LayerActivation]:
        # Caller holds the lock.
        sess = self._sessions.get(session_id)
        if sess is None:
            sess = self._seed_session(session_id)
        return sess

    # ── Mutators ────────────────────────────────────────────────────

    def enable(
        self,
        layer_id: str,
        *,
        session_id: str = GLOBAL_SESSION,
        via: str = "operator",
    ) -> LayerActivation:
        """Mark a layer active in `session_id`. Idempotent."""
        registry = self._registry_or_default()
        # Validate up-front so callers see a clear error.
        manifest = registry.get(layer_id)
        with self._lock:
            sess = self._ensure_session(session_id)
            existing = sess.get(layer_id)
            if existing is not None:
                return existing
            activation = LayerActivation(
                layer_id=manifest.id,
                activated_at=time.time(),
                via=via,
            )
            sess[manifest.id] = activation
            return activation

    def disable(self, layer_id: str, *, session_id: str = GLOBAL_SESSION) -> bool:
        """Remove a layer from the active set. Returns True if it was active."""
        with self._lock:
            sess = self._ensure_session(session_id)
            return sess.pop(layer_id, None) is not None

    def reset(self, session_id: str = GLOBAL_SESSION) -> None:
        """Drop all activations for the session and re-seed defaults."""
        with self._lock:
            self._sessions.pop(session_id, None)
            self._ensure_session(session_id)

    # ── Read ────────────────────────────────────────────────────────

    def is_active(self, layer_id: str, *, session_id: str = GLOBAL_SESSION) -> bool:
        with self._lock:
            return layer_id in self._ensure_session(session_id)

    def active_ids(self, *, session_id: str = GLOBAL_SESSION) -> list[str]:
        """All currently-active layer ids in the session, sorted."""
        with self._lock:
            return sorted(self._ensure_session(session_id).keys())

    def active_with_meta(
        self, *, session_id: str = GLOBAL_SESSION
    ) -> list[LayerActivation]:
        with self._lock:
            return sorted(
                self._ensure_session(session_id).values(),
                key=lambda a: a.layer_id,
            )

    def attribution_lines(
        self, *, session_id: str = GLOBAL_SESSION
    ) -> list[AttributionEntry]:
        """Deduplicated attribution union for `session_id`.

        Layers that share the same `attribution` string collapse to one
        entry whose `layer_ids` lists every contributor. Sort is stable
        and follows the registry's own (category, id) order.
        """
        registry = self._registry_or_default()
        with self._lock:
            active_ids = set(self._ensure_session(session_id).keys())
        if not active_ids:
            return []
        seen: dict[str, AttributionEntry] = {}
        for manifest in registry.all():
            if manifest.id not in active_ids:
                continue
            text = manifest.attribution.strip()
            if not text:
                continue
            existing = seen.get(text)
            if existing is None:
                seen[text] = AttributionEntry(
                    text=text,
                    layer_ids=(manifest.id,),
                    license=manifest.license,
                )
            else:
                seen[text] = AttributionEntry(
                    text=existing.text,
                    layer_ids=tuple(sorted({*existing.layer_ids, manifest.id})),
                    license=existing.license,
                )
        return list(seen.values())

    def public_payload(
        self, *, session_id: str = GLOBAL_SESSION
    ) -> dict:
        """Frontend-ready snapshot: active list + attribution lines."""
        return {
            "session_id": session_id,
            "active_layer_ids": self.active_ids(session_id=session_id),
            "attribution": [
                {
                    "text": entry.text,
                    "license": entry.license,
                    "layer_ids": list(entry.layer_ids),
                }
                for entry in self.attribution_lines(session_id=session_id)
            ],
        }


# ── Singleton ─────────────────────────────────────────────────────────────


_store_lock = threading.Lock()
_store: Optional[AttributionStore] = None


def get_attribution_store() -> AttributionStore:
    global _store
    if _store is not None:
        return _store
    with _store_lock:
        if _store is None:
            _store = AttributionStore()
    return _store


def reset_attribution_store_for_tests(
    registry: Optional[LayerRegistry] = None,
) -> AttributionStore:
    """Replace the singleton — pytest helper, never call from runtime."""
    global _store
    with _store_lock:
        _store = AttributionStore(registry=registry)
    return _store
