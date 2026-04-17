"""
AIProvider — abstract interface + AIRouter with primary/fallback logic.
"""
from __future__ import annotations

import asyncio
import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import AsyncIterator

from config import config

logger = logging.getLogger(__name__)


# ── Response dataclass ─────────────────────────────────────────────────────────

@dataclass
class AIResponse:
    content: str
    response_form: str = "text"
    attachments: list[dict] = field(default_factory=list)
    provider: str = "unknown"
    tokens_used: int = 0
    latency_ms: int = 0


# ── Abstract provider ──────────────────────────────────────────────────────────

class AIProvider(ABC):
    """Abstract interface every AI provider must implement."""

    @abstractmethod
    async def generate(
        self,
        user_message: str,
        system_prompt: str,
        history: list[dict],
    ) -> AIResponse:
        """Return a complete AIResponse (non-streaming)."""

    @abstractmethod
    async def generate_stream(
        self,
        user_message: str,
        system_prompt: str,
        history: list[dict],
    ) -> AsyncIterator[str]:
        """Yield text deltas as they arrive."""

    @abstractmethod
    async def health_check(self) -> bool:
        """Return True if the provider endpoint is reachable."""


# ── Router ─────────────────────────────────────────────────────────────────────

class AIRouter:
    """
    Routes requests to primary provider; on timeout / any error falls back
    to the configured fallback provider.  Exposes the currently active
    provider name so ContextEngine can reflect it in snapshots.
    """

    def __init__(self) -> None:
        # Lazy-import to avoid circular deps at module load
        from ai.gemini_provider import GeminiProvider
        from ai.ollama_provider import OllamaProvider

        self._providers: dict[str, AIProvider] = {
            "gemini": GeminiProvider(),
            "ollama": OllamaProvider(),
        }
        self._active: str = config.ai_primary_provider

    # ── Public API ─────────────────────────────────────────────────────────────

    @property
    def active_provider_name(self) -> str:
        return self._active

    async def generate(
        self,
        user_message: str,
        system_prompt: str,
        history: list[dict],
    ) -> AIResponse:
        """Generate response — primary with fallback on failure."""
        primary_name = config.ai_primary_provider
        primary = self._providers[primary_name]

        t0 = time.monotonic()
        try:
            result = await asyncio.wait_for(
                primary.generate(user_message, system_prompt, history),
                timeout=config.ai_timeout_s,
            )
            result.latency_ms = int((time.monotonic() - t0) * 1000)
            self._active = primary_name
            self._sync_context(primary_name)
            return result
        except (asyncio.TimeoutError, Exception) as exc:
            logger.warning(
                "Primary AI provider '%s' failed (%s): %s — activating fallback",
                primary_name, type(exc).__name__, exc,
            )

        fallback_name = config.ai_fallback_provider
        if fallback_name == "none" or fallback_name not in self._providers:
            raise RuntimeError(
                f"Primary AI ({primary_name}) failed and no fallback is configured."
            )

        t0 = time.monotonic()
        fallback = self._providers[fallback_name]
        result = await fallback.generate(user_message, system_prompt, history)
        result.latency_ms = int((time.monotonic() - t0) * 1000)
        self._active = fallback_name
        self._sync_context(fallback_name)
        return result

    async def generate_stream(
        self,
        user_message: str,
        system_prompt: str,
        history: list[dict],
    ) -> AsyncIterator[str]:
        """
        Stream from primary.  Falls back to chunked non-streaming if primary
        stream raises immediately.

        Each chunk is gated by `config.ai_timeout_s` via asyncio.wait_for — a
        hung upstream (network stall, Ollama paging a cold model) can no
        longer pin the request indefinitely; after one chunk-interval without
        progress we raise and trigger the fallback path below.
        """
        primary_name = config.ai_primary_provider
        primary = self._providers[primary_name]

        try:
            stream = primary.generate_stream(user_message, system_prompt, history)
            while True:
                try:
                    chunk = await asyncio.wait_for(
                        stream.__anext__(),
                        timeout=config.ai_timeout_s,
                    )
                except StopAsyncIteration:
                    break
                self._active = primary_name
                yield chunk
            self._sync_context(primary_name)
            return
        except (asyncio.TimeoutError, Exception) as exc:
            logger.warning(
                "Primary stream (%s) failed: %s — falling back to non-stream",
                primary_name, exc,
            )

        fallback_name = config.ai_fallback_provider
        if fallback_name == "none" or fallback_name not in self._providers:
            raise RuntimeError("Primary stream failed and no fallback configured.")

        fallback = self._providers[fallback_name]
        response = await fallback.generate(user_message, system_prompt, history)
        self._active = fallback_name
        self._sync_context(fallback_name)

        # Yield in word-level chunks to simulate streaming for the client
        words = response.content.split(" ")
        for i, word in enumerate(words):
            yield word + (" " if i < len(words) - 1 else "")
            await asyncio.sleep(0.015)

    async def health_check_all(self) -> dict[str, bool]:
        results: dict[str, bool] = {}
        for name, provider in self._providers.items():
            try:
                results[name] = await asyncio.wait_for(provider.health_check(), timeout=5.0)
            except Exception:
                results[name] = False
        return results

    # ── Internals ──────────────────────────────────────────────────────────────

    def _sync_context(self, provider_name: str) -> None:
        """Keep ContextEngine.system.ai_provider in sync."""
        try:
            from core.context_engine import context_engine
            context_engine.set_ai_provider(provider_name)
        except Exception as exc:
            logger.debug("_sync_context: could not update context engine: %s", exc)


# Singleton — imported everywhere that needs AI
ai_router = AIRouter()
