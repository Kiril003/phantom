"""Day-4 Wave-2 Z-1 — AIHub class + ProviderCapability registry +
locality-first stub (ADR-HUB-001..003).

`AIHub` is a *capability registry + dispatch router* that sits
ALONGSIDE `AIRouter` (`src/backend/ai/provider.py:100-129`).

Responsibilities:
  1. Registry of available capabilities (provider + task_class + locality).
  2. Locality-aware picking logic (pick).
  3. One-stop dispatch logic (dispatch) for various task classes.
"""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from typing import Any, AsyncGenerator, Literal

from config import config

logger = logging.getLogger(__name__)

# ── Types ───────────────────────────────────────────────────────────────────

TaskClass = Literal["chat", "chat_subtask", "vision", "voice_stt", "voice_tts"]
Locality = Literal["local", "remote", "npu"]
QualityTier = Literal["fast", "balanced", "high"]
PreferLocality = Literal["auto", "local", "remote", "npu"]


@dataclass(frozen=True)
class ProviderCapability:
    provider: str
    task_class: TaskClass
    modality: str  # text|image|audio
    latency_ms_p50: float
    quality_tier: QualityTier
    locality: Locality
    available: bool = True


@dataclass(frozen=True)
class ProviderHandle:
    capability: ProviderCapability
    # Metadata for the caller to record (correlation_id, decision_path, etc.)
    routing_metadata: dict[str, Any]


class NoCapabilityError(Exception):
    """Raised when pick() finds zero candidates matching the task/locality
    requirements."""


# ── AIHub ───────────────────────────────────────────────────────────────────


class AIHub:
    def __init__(self) -> None:
        self._registry: dict[tuple[str, str], ProviderCapability] = {}
        self._last_provider_per_task: dict[str, str] = {}
        self._lock = threading.Lock()
        self._history: list[dict[str, Any]] = []  # last N routing decisions

    def reset_for_tests(self) -> None:
        with self._lock:
            self._registry.clear()
            self._history.clear()

    # ──────────────────────────────────────────────── registry ──

    def register(self, capability: ProviderCapability) -> None:
        """Register or update a capability.

        Idempotent — overwrites prior entries with same (provider, task)
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
            elif prefer == "npu":
                candidates = [c for c in candidates if c.locality == "npu"]

            if not candidates:
                raise NoCapabilityError(
                    f"No available provider for task={task_class!r} "
                    f"(prefer={prefer!r})"
                )

            # Locality-first auto-pick
            if prefer == "auto":
                local_c = [c for c in candidates if c.locality == "local"]
                if local_c:
                    candidates = local_c
                else:
                    remote_c = [c for c in candidates if c.locality == "remote"]
                    if remote_c:
                        candidates = remote_c

            # Pick winner by latency (lowest p50)
            winner = min(candidates, key=lambda x: x.latency_ms_p50)
            
            # Day-4 Z-1: track provider changes for the 'changed' flag in route_state
            prev = self._last_provider_per_task.get(task_class)
            changed = prev != winner.provider
            self._last_provider_per_task[task_class] = winner.provider

            # Record in history
            from datetime import datetime, timezone
            decision = {
                "task_class": task_class,
                "provider": winner.provider,
                "locality": winner.locality,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "changed": changed,
                "previous_provider": prev,
            }
            self._history.append(decision)
            if len(self._history) > 100:
                self._history.pop(0)

            return ProviderHandle(
                capability=winner,
                routing_metadata={"decision": decision}
            )

    def route_state(self, limit: int = 10) -> list[dict]:
        with self._lock:
            return list(self._history[-limit:])

    # ──────────────────────────────────────────────── dispatch ──

    async def dispatch(
        self,
        task_class: str,
        payload: dict[str, Any],
        *,
        task_id: str | None = None,
        prefer: PreferLocality = "auto",
        provider_hint: str | None = None,
    ) -> Any:
        """High-level dispatch entry point.

        Resolve a provider via `pick()` (or `provider_hint`) and forward
        the call to the target service (AIRouter / Voice / Vision).

        Phase 17b: forward to `ai_router.generate` or `call_with_tools`
        using the result of `pick()` as a provider_hint.

        Payload for chat tasks:
          - user_message: str
          - system_prompt: str
          - history: list[dict]
          - user_id: str | None
          - tools: list | None (triggers call_with_tools)
          - stream: bool (triggers generate_stream)
        """
        try:
            if provider_hint:
                provider_name = provider_hint
            else:
                handle = self.pick(task_class, prefer=prefer)
                provider_name = handle.capability.provider

            if task_class in ("chat", "chat_subtask"):
                from ai.provider import ai_router

                user_message = payload.get("user_message", "")
                system_prompt = payload.get("system_prompt", "")
                history = payload.get("history", [])
                user_id = payload.get("user_id")

                if "tools" in payload:
                    return await ai_router.call_with_tools(
                        system_prompt=system_prompt,
                        user_message=user_message,
                        tools=payload["tools"],
                        history=history,
                        user_id=user_id,
                        task_id=task_id,
                        provider_hint=provider_name,
                        step_idx=payload.get("step_idx"),
                        max_total_retries=payload.get("max_total_retries"),
                    )

                if payload.get("stream"):
                    return ai_router.generate_stream(
                        user_message=user_message,
                        system_prompt=system_prompt,
                        history=history,
                        task_id=task_id,
                        provider_hint=provider_name,
                    )

                return await ai_router.generate(
                    user_message=user_message,
                    system_prompt=system_prompt,
                    history=history,
                    task_id=task_id,
                    user_id=user_id,
                    provider_hint=provider_name,
                )

            # 2026-05-14 — if we have a provider but it's not a chat task,
            # and we don't have a specific handler, raise NotImplementedError
            # as expected by Day-4 audit tests.
            raise NotImplementedError(
                f"AIHub: dispatch not implemented for task_class={task_class!r}"
            )
        except Exception as exc:
            logger.error("AIHub.dispatch failed (task=%s, hint=%s): %s",
                         task_class, provider_hint, exc, exc_info=True)
            raise


# ── Singleton ─────────────────────────────────────────────────────────────────

_AI_HUB_SINGLETON: AIHub | None = None


def get_ai_hub() -> AIHub:
    global _AI_HUB_SINGLETON
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
    """Day-4 Z-1 stub: register Gemini (remote) tiers.
    
    Phase 30 — Removed Ollama (local) to avoid "lobotomy" on fallback.
    Registering tiered Gemini capabilities:
    - 'balanced': gemini-3.1-pro (Brain)
    - 'fast': gemini-2.0-flash (Execution)
    """
    h = hub if hub is not None else get_ai_hub()
    
    # Gemini — remote
    gemini_ok = bool(config.ai_gemini_api_key)
    
    # Pro Tier (Strategic/Reasoning)
    for task in ("chat", "chat_subtask"):
        h.register(
            ProviderCapability(
                provider="gemini",
                task_class=task,  # type: ignore[arg-type]
                modality="text",
                latency_ms_p50=1200.0, # Reasoning is slower
                quality_tier="high",
                locality="remote",
                available=gemini_ok,
            )
        )
    
    # Flash Tier (Tactical/Speed)
    h.register(
        ProviderCapability(
            provider="gemini-flash", # Virtual provider for routing
            task_class="chat", 
            modality="text",
            latency_ms_p50=300.0,
            quality_tier="fast",
            locality="remote",
            available=gemini_ok,
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
