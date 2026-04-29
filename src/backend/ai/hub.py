"""Day-4 Wave-2 Z-1 — AIHub class + ProviderCapability registry +
locality-first stub (ADR-HUB-001..003).

`AIHub` is a *capability registry + dispatch router* that sits
ALONGSIDE `AIRouter` (`src/backend/ai/provider.py:100-129`), not in
front of it. It registers `gemini` and `ollama` as two of N providers
in its capability table; when the hub picks one of those, dispatch
delegates back to the existing `ai_router.generate` /
`ai_router.call_with_tools` so the cooling / quota / backoff state
machine remains the single source of truth for provider health.

Day-4 ships the SCAFFOLD:
  - dataclass `ProviderCapability`
  - registry + locality-first `pick()`
  - `list_providers()` for /api/v1/hub/providers (Z-2)
  - `route_state()` ring for /api/v1/hub/route_state (Z-2)
  - lazy singleton `ai_hub` (mirrors ai_router pattern)

Day-5 lands `dispatch()` wiring + the NPU registration. Day-4's
dispatch returns a `NotImplementedError` until Z-3 fills it in — but
the registry / pick / list_providers / route_state contract is
already callable and tested.
"""
from __future__ import annotations

import threading
from collections import deque
from dataclasses import dataclass, replace
from typing import Any, Deque, Literal


TaskClass = Literal["chat", "chat_subtask", "embeddings", "stt", "vision"]
Modality = Literal["text", "audio", "image", "embeddings"]
QualityTier = Literal["fast", "balanced", "best"]
Locality = Literal["local", "remote"]
PreferLocality = Literal["auto", "local", "remote"]


class NoCapabilityError(RuntimeError):
    """Raised by `AIHub.pick()` when no registered capability matches
    the requested task_class/preference. Distinct from
    `BlockedQuotaError` (`ai/provider.py:37`) — the hub cannot
    retroactively make a capability appear; the caller must downgrade
    or surface the error."""


@dataclass(frozen=True)
class ProviderCapability:
    """Immutable capability record. One provider may register multiple
    rows (e.g. Gemini for `chat` AND `chat_subtask`). Every field is
    needed by the locality-first policy (ADR-HUB-003) or by the
    /api/v1/hub/providers route (Z-2)."""

    provider: str
    task_class: TaskClass
    modality: Modality
    latency_ms_p50: float
    quality_tier: QualityTier
    locality: Locality
    available: bool


@dataclass
class ProviderHandle:
    """Returned by `AIHub.pick()`. Opaque to callers; `AIHub.dispatch()`
    is the supported invocation surface. Exposed only so type-aware
    tests can assert non-None without importing internal classes."""

    capability: ProviderCapability

    def __repr__(self) -> str:
        c = self.capability
        return (
            f"ProviderHandle(provider={c.provider!r}, "
            f"task_class={c.task_class!r}, locality={c.locality!r})"
        )


_DECISION_RING_MAX = 200


class AIHub:
    """Capability registry + dispatch router. Thread-safe for
    register/pick/list (the routes_chat / routes_voice paths run on
    different asyncio loops the hub must serve concurrently)."""

    def __init__(self) -> None:
        # Keyed by (provider, task_class) → ProviderCapability so a
        # re-register on the same key OVERWRITES (supports Day-5
        # "flip available=True" without process restart, ADR-HUB-002).
        self._registry: dict[tuple[str, str], ProviderCapability] = {}
        self._last_pick_per_task: dict[str, str] = {}
        self._decisions: Deque[dict[str, Any]] = deque(maxlen=_DECISION_RING_MAX)
        self._lock = threading.RLock()

    # ─────────────────────────────────────────────── registry ──

    def register(self, capability: ProviderCapability) -> None:
        """Idempotent registration. Raises ValueError on schema-invalid
        records — the field names are runtime-checked because the
        registry is a public-ish surface (Day-5+ tools may register
        new providers from outside the cluster)."""
        if not isinstance(capability, ProviderCapability):
            raise ValueError(
                "AIHub.register requires a ProviderCapability instance"
            )
        if not capability.provider:
            raise ValueError("ProviderCapability.provider must be non-empty")
        if capability.latency_ms_p50 < 0:
            raise ValueError(
                f"ProviderCapability.latency_ms_p50 must be >= 0, "
                f"got {capability.latency_ms_p50!r}"
            )
        with self._lock:
            self._registry[(capability.provider, capability.task_class)] = capability

    def list_providers(self) -> list[ProviderCapability]:
        """Snapshot of every registered ProviderCapability. Used by
        `GET /api/v1/hub/providers` (Z-2)."""
        with self._lock:
            return list(self._registry.values())

    # ──────────────────────────────────────────────── pick ──

    def pick(
        self,
        task_class: str,
        *,
        prefer: PreferLocality = "auto",
    ) -> ProviderHandle:
        """Resolve a capability for `task_class` per ADR-HUB-003.

        Locality-first policy (`prefer="auto"`):
          1. Filter by `task_class` AND `available=True`.
          2. Prefer `locality="local"` when present; else `remote`.
          3. Within a locality bucket, prefer the lower
             `latency_ms_p50`.

        Explicit `prefer="local"` / `"remote"` filters to that bucket
        only. NoCapabilityError when nothing matches.
        """
        with self._lock:
            candidates = [
                cap
                for cap in self._registry.values()
                if cap.task_class == task_class and cap.available
            ]
            if prefer == "local":
                candidates = [c for c in candidates if c.locality == "local"]
            elif prefer == "remote":
                candidates = [c for c in candidates if c.locality == "remote"]
            elif prefer == "auto":
                local = [c for c in candidates if c.locality == "local"]
                if local:
                    candidates = local
                # else fall through with the remaining `remote` set.
            if not candidates:
                raise NoCapabilityError(
                    f"AIHub: no available capability for task_class="
                    f"{task_class!r}, prefer={prefer!r}"
                )
            picked = min(candidates, key=lambda c: c.latency_ms_p50)
            self._record_pick(task_class, picked)
            return ProviderHandle(capability=picked)

    # ───────────────────────────────────────── decision ring ──

    def route_state(self, *, limit: int = 50) -> list[dict[str, Any]]:
        """Last N decisions from the in-memory ring. Used by
        `GET /api/v1/hub/route_state` (Z-2). `limit` clamped to
        `[1, _DECISION_RING_MAX]`."""
        n = max(1, min(int(limit), _DECISION_RING_MAX))
        with self._lock:
            return list(self._decisions)[-n:]

    def _record_pick(
        self, task_class: str, capability: ProviderCapability
    ) -> None:
        """Append to the decision ring. Records the pick + a
        ``changed`` flag so a Prometheus counter can fire only on
        actual route changes (ADR-HUB-005 telemetry hint)."""
        prev = self._last_pick_per_task.get(task_class)
        self._last_pick_per_task[task_class] = capability.provider
        self._decisions.append(
            {
                "task_class": task_class,
                "provider": capability.provider,
                "locality": capability.locality,
                "latency_ms_p50": capability.latency_ms_p50,
                "changed": prev != capability.provider,
                "previous_provider": prev,
            }
        )

    # ─────────────────────────────────────────────── dispatch ──

    async def dispatch(
        self,
        task_class: str,
        payload: dict[str, Any],
        *,
        task_id: str | None = None,
        prefer: PreferLocality = "auto",
    ) -> dict[str, Any]:
        """Day-4 stub. Z-3 (Day-5) wires this through to
        `ai_router.generate` for chat/chat_subtask + the NPU/MMS
        provider objects for stt. Until then, `pick()` works but
        `dispatch()` raises so call sites can't accidentally cut over
        to the hub before the router-delegate path is wired."""
        del payload, task_id, prefer  # silence linters
        raise NotImplementedError(
            "AIHub.dispatch lands in Z-3 (Day-5). Use AIHub.pick() to "
            "resolve a capability and call ai_router.generate / the "
            "STT provider object directly until then."
        )

    # ─────────────────────────────────────────── test utilities ──

    def reset_for_tests(self) -> None:
        """Clear the registry + decision ring. Tests use this to keep
        each pin independent without monkey-patching the singleton."""
        with self._lock:
            self._registry.clear()
            self._last_pick_per_task.clear()
            self._decisions.clear()


# ─────────────────────────────────────────────────── lazy singleton ──


_AI_HUB_SINGLETON: AIHub | None = None
_SINGLETON_LOCK = threading.Lock()


def get_ai_hub() -> AIHub:
    """Lazy module-level singleton — same pattern as
    `ai/provider.py:921-933`. Tests can call `reset_for_tests()` to
    clear state between runs."""
    global _AI_HUB_SINGLETON
    if _AI_HUB_SINGLETON is None:
        with _SINGLETON_LOCK:
            if _AI_HUB_SINGLETON is None:
                _AI_HUB_SINGLETON = AIHub()
    return _AI_HUB_SINGLETON


def __getattr__(name: str) -> Any:
    """Module-level `from ai.hub import ai_hub` lazy resolution."""
    if name == "ai_hub":
        return get_ai_hub()
    raise AttributeError(name)


# ────────────────────────────────────── default registrations (Z-1 stub) ──


def register_default_capabilities(*, hub: AIHub | None = None) -> None:
    """Day-4 Z-1 stub: register Gemini (remote) + Ollama (local) as
    `chat` + `chat_subtask` capabilities. Latency p50 numbers are
    placeholders that Z-3 will replace with a live read from the
    ai_router's `last_call_summary`. Day-5 adds the NPU slot per Z-5.

    `register` is idempotent so calling this from a lifespan hook
    never blows up; tests pass an explicit `hub=` so they don't
    pollute the singleton.
    """
    h = hub if hub is not None else get_ai_hub()
    # Gemini — remote, balanced quality.
    for task in ("chat", "chat_subtask"):
        h.register(
            ProviderCapability(
                provider="gemini",
                task_class=task,  # type: ignore[arg-type]
                modality="text",
                latency_ms_p50=900.0,
                quality_tier="balanced",
                locality="remote",
                available=True,
            )
        )
    # Ollama — local, fast.
    for task in ("chat", "chat_subtask"):
        h.register(
            ProviderCapability(
                provider="ollama",
                task_class=task,  # type: ignore[arg-type]
                modality="text",
                latency_ms_p50=1800.0,
                quality_tier="fast",
                locality="local",
                available=True,
            )
        )


__all__ = [
    "AIHub",
    "Locality",
    "NoCapabilityError",
    "PreferLocality",
    "ProviderCapability",
    "ProviderHandle",
    "QualityTier",
    "TaskClass",
    "get_ai_hub",
    "register_default_capabilities",
]
