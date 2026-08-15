"""
AIProvider — abstract interface + AIRouter with primary/fallback logic.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from typing import AsyncIterator, AsyncGenerator

from config import config

logger = logging.getLogger(__name__)


# ── Phase 9.2.1 — resilience tuning constants ─────────────────────────────────
#
# Cooling means "back off this provider for a fixed window after we've
# exhausted retries on a transient error so the very next request doesn't
# slam right back into the same wall."

_COOLING_RATE_LIMIT_S = 60.0       # post-retry-exhaustion cooldown for 429s
_COOLING_PROVIDER_5XX_S = 30.0     # post-retry cooldown for upstream 5xx
_BACKOFF_MAX_S = 16.0              # cap on per-attempt sleep
_BACKOFF_BASE_S = 2.0              # 2 ** attempt growth
_RATE_LIMIT_RETRIES = 3            # extra retries on RATE_LIMIT before cooling
_TRANSIENT_RETRIES = 1             # extra retries for NETWORK / TIMEOUT / 5xx


# ── Phase 9.2.1 / 9.2.2 — router-level signal exception ───────────────────────


class BlockedQuotaError(RuntimeError):
    """
    Raised by the router (call_with_tools, generate, generate_stream) when
    every configured provider is currently quota-exhausted. The agent loop
    catches this and parks the task on `blocked_quota`, then probes for
    provider recovery before resuming.
    """


# ── Response dataclass ─────────────────────────────────────────────────────────

@dataclass
class AIResponse:
    content: str
    response_form: str = "text"
    attachments: list[dict] = field(default_factory=list)
    provider: str = "unknown"
    tokens_used: int = 0
    latency_ms: int = 0


def _coerce_tool_schemas(tools: list) -> list:
    """Normalize a mixed tools list to `ToolSchema`. chat_pipeline passes
    raw function-declaration dicts; planner/hub pass `ToolSchema`. Every
    provider's `call_with_tools` does attribute access (`t.name`,
    `t.parameters`), so a dict here crashed every round-1 tool pick with
    "'dict' object has no attribute 'name'". ToolSchema instances pass
    through by identity; dicts are wrapped."""
    from ai.tool_use import ToolSchema

    out: list = []
    for t in tools:
        if isinstance(t, ToolSchema):
            out.append(t)
        else:
            out.append(
                ToolSchema(
                    name=t["name"],
                    description=t.get("description", ""),
                    parameters=t.get("parameters")
                    or {"type": "object", "properties": {}},
                )
            )
    return out


# ── Abstract provider ──────────────────────────────────────────────────────────

class AIProvider(ABC):
    """Abstract interface every AI provider must implement."""

    @abstractmethod
    async def generate(
        self,
        user_message: str,
        system_prompt: str,
        history: list[dict],
        *,
        user_id: str | None = None,
    ) -> AIResponse:
        """Return a complete AIResponse (non-streaming)."""

    async def generate_no_tools(
        self,
        user_message: str,
        system_prompt: str,
        history: list[dict],
        *,
        model_override: str | None = None,
    ) -> AIResponse:
        """Tool-free generation — the ONLY method a caller that wants a
        genuinely tool-free turn (e.g. chat_pipeline's 'final answer, no
        tools advertised' step) may call.

        Default implementation: delegate to `generate()` with `user_id`
        omitted. Every provider's `generate()` merge logic for the chat
        data-tool catalog is gated on `user_id is not None`
        (see gemini_provider.py), so dropping it here keeps this base
        path tool-free by construction — without a caller-supplied flag
        that could be forgotten.

        `GeminiProvider` overrides this with a stronger guarantee: a
        method body that has zero references to CHAT_DATA_TOOLS or
        `execute_tool` at all, so it cannot regress even if a future
        change loosens the user_id gate inside `generate()`
        (docs/design/tools-audit.md §3a — the TM-17B-E2 gate leak this
        closes).
        """
        kwargs: dict[str, object] = {"user_id": None}
        generate_code = getattr(self.generate, "__code__", None)
        if (
            model_override
            and generate_code is not None
            and "model_override" in generate_code.co_varnames
        ):
            kwargs["model_override"] = model_override
        return await self.generate(user_message, system_prompt, history, **kwargs)

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
    to the configured fallback provider.
    """

    def __init__(self) -> None:
        self._providers: dict[str, AIProvider] = {}
        self._active: str = config.ai_primary_provider
        self._cooling: dict[str, dict[str, float | str]] = {}
        self._quota_exhausted: dict[str, dict[str, str]] = {}
        self._last_call_at: dict[str, float] = {}
        self._last_call_summary: dict[str, dict] = {}

    def get_provider(self, name: str) -> AIProvider | None:
        """Lazily builds and returns a provider instance."""
        # Phase 30 — map virtual 'gemini-flash' to 'gemini' but ensure 
        # it uses the tactical model configuration.
        real_name = "gemini" if name == "gemini-flash" else name
        
        if real_name in self._providers:
            return self._providers[real_name]

        try:
            if real_name == "anthropic":
                from ai.anthropic_provider import AnthropicProvider
                self._providers[real_name] = AnthropicProvider()
            elif real_name == "gemini":
                from ai.gemini_provider import GeminiProvider
                self._providers[real_name] = GeminiProvider()
            elif real_name == "ollama":
                from ai.ollama_provider import OllamaProvider
                self._providers[real_name] = OllamaProvider()
            else:
                return None
            return self._providers[real_name]
        except (ImportError, Exception) as exc:
            _logger.error("AIRouter: failed to load provider '%s': %s", real_name, exc)
            return None

    async def generate_raw(
        self,
        *,
        system_prompt: str,
        user_message: str,
        model: str,
        max_output_tokens: int,
        temperature: float = 0.7,
    ) -> str:
        """Raw no-tools generation on the Gemini provider with a forced
        model/budget. Raises if the provider is unavailable — callers
        degrade (ArtifactStudio falls back; never a dead bubble)."""
        prov = self.get_provider("gemini")
        if prov is None or not hasattr(prov, "generate_raw"):
            raise RuntimeError("generate_raw: gemini provider unavailable")
            
        effective_model = model
        if effective_model == "auto":
            effective_model = config.ai_gemini_model

        return await prov.generate_raw(
            system_prompt=system_prompt,
            user_message=user_message,
            model=effective_model,
            max_output_tokens=max_output_tokens,
            temperature=temperature,
        )

    @property
    def active_provider_name(self) -> str:
        """Surfaces the responder name for the ContextEngine.

        Day-4 Z-3: prioritises the most recent AIHub decision over the
        static _active field to ensure the UI reflects dynamic routing."""
        try:
            from ai.hub import get_ai_hub
            hub = get_ai_hub()
            last = hub.route_state(limit=1)
            if last and last[0]["task_class"] in ("chat", "chat_subtask"):
                return last[0]["provider"]
        except (ImportError, Exception):
            pass
        return self._active

    async def generate(
        self,
        user_message: str,
        system_prompt: str,
        history: list[dict],
        *,
        task_id: str | None = None,
        user_id: str | None = None,
        provider_hint: str | None = None,
        model_override: str | None = None,
    ) -> AIResponse:
        """Generate response with primary-fallback resilience. May offer
        (and execute) chat data tools when the resolved provider supports
        it — see `generate_no_tools` for the call that structurally
        cannot."""
        return await self._generate_impl(
            user_message, system_prompt, history,
            task_id=task_id, user_id=user_id, provider_hint=provider_hint,
            model_override=model_override, method_name="generate",
        )

    async def generate_no_tools(
        self,
        user_message: str,
        system_prompt: str,
        history: list[dict],
        *,
        task_id: str | None = None,
        provider_hint: str | None = None,
        model_override: str | None = None,
    ) -> AIResponse:
        """Tool-free generation with the same primary/fallback resilience
        as `generate()`. This is the ONLY router entry point a caller that
        needs a genuinely tool-free turn may use — e.g. chat_pipeline's
        Step 5 ('final answer, no tools advertised this round').

        Deliberately takes no `user_id`: every provider's tool-merge gate
        keys off `user_id is not None`, and dropping the parameter here
        means there is no argument a caller could pass that would
        re-enable it. Dispatches to `provider.generate_no_tools(...)`,
        which `GeminiProvider` overrides with a method that has zero code
        path to `CHAT_DATA_TOOLS` / `execute_tool` at all — closing
        docs/design/tools-audit.md §3a's TM-17B-E2 gate leak by removing
        the capability, not by asking the call not to use it.
        """
        return await self._generate_impl(
            user_message, system_prompt, history,
            task_id=task_id, user_id=None, provider_hint=provider_hint,
            model_override=model_override, method_name="generate_no_tools",
        )

    async def _generate_impl(
        self,
        user_message: str,
        system_prompt: str,
        history: list[dict],
        *,
        task_id: str | None,
        user_id: str | None,
        provider_hint: str | None,
        model_override: str | None,
        method_name: str,
    ) -> AIResponse:
        """Shared primary/fallback resilience loop behind `generate()` and
        `generate_no_tools()`. `method_name` selects which bound method is
        actually awaited on the provider — the two public wrappers exist
        so the CALL SITE states its intent unambiguously; this helper only
        avoids duplicating the retry/cooldown machinery between them."""
        if not await _runtime_note_llm_call(task_id):
            await _write_budget_exhausted_audit(task_id, caller=method_name)
            raise RuntimeError(f"call_budget_exhausted: cap reached")

        from ai.tool_use import ToolErrorKind

        primary_name = provider_hint or config.ai_primary_provider
        sequence = self._available_sequence(primary_override=provider_hint)

        if not sequence:
            raise BlockedQuotaError("No AI providers available (cooling or quota-locked)")

        last_exc: Exception = RuntimeError("All providers failed")

        for prov_idx, prov_name in enumerate(sequence):
            provider = self.get_provider(prov_name)
            if provider is None: continue

            bound_method = getattr(provider, method_name)

            # Phase 30 — Model selection logic
            effective_model = model_override
            if not effective_model:
                if prov_name == "gemini-flash":
                    effective_model = config.ai_tactical_model if config.ai_tactical_model != "auto" else config.ai_gemini_model
                elif prov_name == "gemini":
                    effective_model = config.ai_gemini_model
                elif prov_name == "ollama":
                    effective_model = config.ai_ollama_model
                elif prov_name == "anthropic":
                    effective_model = config.ai_anthropic_model

            is_fallback = prov_idx > 0
            extra_retries = 0 if is_fallback else _RATE_LIMIT_RETRIES
            tries = 0

            while True:
                tries += 1
                await self._respect_min_interval(prov_name)
                t0 = time.monotonic()
                try:
                    # Pass model override to provider if supported
                    gen_kwargs = {
                        "user_message": user_message,
                        "system_prompt": system_prompt,
                        "history": history,
                    }
                    if method_name == "generate":
                        gen_kwargs["user_id"] = user_id
                    bound_code = getattr(bound_method, "__code__", None)
                    if (
                        effective_model
                        and bound_code is not None
                        and "model_override" in bound_code.co_varnames
                    ):
                        gen_kwargs["model_override"] = effective_model

                    timeout_to_use = config.ai_timeout_s if is_fallback else config.ai_primary_timeout_s
                    result = await asyncio.wait_for(
                        bound_method(**gen_kwargs),
                        timeout=timeout_to_use,
                    )
                    # Success
                    result.latency_ms = int((time.monotonic() - t0) * 1000)
                    # Phase 30: Map technical name back to canonical for the UI
                    ui_name = "gemini" if prov_name == "gemini-flash" else prov_name
                    result.provider = ui_name

                    self._active = prov_name
                    self._sync_context(prov_name)
                    self._last_call_at[prov_name] = time.monotonic()
                    self._last_call_summary[prov_name] = {
                        "at": _utc_now_iso(), "success": True, "tool": None,
                    }
                    if is_fallback:
                        # D3-E-6: `phantom_ai_router_fallthrough_total` was
                        # registered in observability.py but never incremented
                        # anywhere, so it read zero forever — operators had no
                        # signal for how often the primary provider was failing
                        # over (quota exhaustion, outages), which is exactly what
                        # the metric exists to surface.
                        from observability import ai_router_fallthrough_total
                        ai_router_fallthrough_total.inc()
                    return result
                except Exception as exc:
                    last_exc = exc
                    kind, _, _ = _classify_provider_exception(prov_name, exc)
                    logger.warning("AIRouter.%s: %s failed (%s): %s", method_name, prov_name, kind, exc)

                    if kind == ToolErrorKind.QUOTA_EXHAUSTED:
                        self._mark_quota_exhausted(prov_name)
                        break

                    if kind == ToolErrorKind.INVALID_ARGS:
                        # Technical error (like Gemini 400) — don't retry same provider,
                        # fall through to NEXT provider immediately.
                        logger.warning("AIRouter.%s: %s rejected arguments, falling through to next", method_name, prov_name)
                        break

                    # Handle your specific memory error
                    if prov_name == "ollama" and "memory" in str(exc).lower():
                        self._mark_cooling(prov_name, 300, "out_of_memory")
                        break

                    if kind == ToolErrorKind.RATE_LIMIT and tries <= extra_retries:
                        await asyncio.sleep(self._compute_backoff(None, tries))
                        continue

                    if kind == ToolErrorKind.RATE_LIMIT:
                        self._mark_cooling(prov_name, _COOLING_RATE_LIMIT_S, "rate_limit")
                        break

                    if kind in {ToolErrorKind.PROVIDER_UNAVAILABLE, ToolErrorKind.NETWORK, ToolErrorKind.TIMEOUT} and tries <= _TRANSIENT_RETRIES:
                        await asyncio.sleep(0.5)
                        continue

                    if kind == ToolErrorKind.PROVIDER_UNAVAILABLE:
                        self._mark_cooling(prov_name, _COOLING_PROVIDER_5XX_S, "provider_unavailable")
                    break

        # If we got here, every provider in the sequence failed.
        # If any of them were quota-exhausted, raise the specific error
        # so the loop can park.
        if any(p in self._quota_exhausted for p in sequence):
            raise BlockedQuotaError("All providers exhausted (quota-locked)")
        raise last_exc

    async def generate_stream(
        self,
        user_message: str,
        system_prompt: str,
        history: list[dict],
        *,
        task_id: str | None = None,
        provider_hint: str | None = None,
        model_override: str | None = None,
    ) -> AsyncGenerator[str, None]:
        """Stream from primary, fall back to generate() on failure."""
        if not await _runtime_note_llm_call(task_id):
            raise RuntimeError("LLM budget exhausted")

        primary_name = provider_hint or config.ai_primary_provider
        if self._is_provider_available(primary_name):
            primary = self.get_provider(primary_name)
            if primary:
                try:
                    await self._respect_min_interval(primary_name)
                    stream_kwargs = {}
                    import inspect as _inspect
                    _stream_code = primary.generate_stream
                    if "model_override" in _inspect.signature(_stream_code).parameters:
                        stream_kwargs["model_override"] = model_override
                    stream = primary.generate_stream(user_message, system_prompt, history, **stream_kwargs)
                    async for chunk in stream:
                        yield chunk
                    self._active = primary_name
                    self._sync_context(primary_name)
                    self._last_call_at[primary_name] = time.monotonic()
                    return
                except Exception as exc:
                    logger.warning("Stream failed for %s, falling back to generate", primary_name)

        # Fallback to non-streaming generate
        resp = await self.generate(user_message, system_prompt, history, task_id=task_id, provider_hint=provider_hint, model_override=model_override)
        yield resp.content

    async def health_check_all(self) -> dict[str, bool]:
        results: dict[str, bool] = {}
        for name in ["anthropic", "gemini", "ollama"]:
            provider = self.get_provider(name)
            if provider:
                try:
                    results[name] = await asyncio.wait_for(provider.health_check(), timeout=5.0)
                except Exception:
                    results[name] = False
            else:
                results[name] = False
        return results

    async def call_with_tools(
        self,
        *,
        system_prompt: str,
        user_message: str,
        tools: list,
        history: list[dict] | None = None,
        user_id: str | None = None,
        task_id: str | None = None,
        step_idx: int | None = None,
        max_total_retries: int | None = None,
        provider_hint: str | None = None,
    ):
        """Tool-use routing with resilience and audit logging."""
        from ai.tool_use import ToolCallResult, ToolErrorKind, ToolUseError
        from ai.tool_use_audit import write_log

        if not await _runtime_note_llm_call(task_id):
            await _write_budget_exhausted_audit(task_id, caller="call_with_tools")
            return ToolUseError(
                kind=ToolErrorKind.UNKNOWN,
                message="call_budget_exhausted",
                retriable=False,
            )

        tools = _coerce_tool_schemas(tools)
        sequence = self._available_sequence(primary_override=provider_hint)
        if not sequence:
            raise BlockedQuotaError("No AI providers available")

        last_error: ToolUseError | None = None
        for prov_idx, prov_name in enumerate(sequence):
            provider = self.get_provider(prov_name)
            if not provider or not hasattr(provider, "call_with_tools"):
                continue

            is_fallback = prov_idx > 0
            # Phase 9.2.1 — fallback providers don't get extra rate-limit retries.
            extra_retries = 0 if is_fallback else _RATE_LIMIT_RETRIES
            tries = 0

            # Phase 30 — Model selection logic for tool calling
            effective_model = None
            if prov_name == "gemini-flash":
                effective_model = config.ai_tactical_model if config.ai_tactical_model != "auto" else config.ai_gemini_model
            elif prov_name == "gemini":
                effective_model = config.ai_gemini_model
            elif prov_name == "ollama":
                effective_model = config.ai_ollama_model
            elif prov_name == "anthropic":
                effective_model = config.ai_anthropic_model

            while True:
                tries += 1
                await self._respect_min_interval(prov_name)
                t0 = time.monotonic()
                try:
                    call_kwargs = {
                        "system_prompt": system_prompt,
                        "user_message": user_message,
                        "tools": tools,
                        "history": history or [],
                        "user_id": user_id,
                    }
                    call_with_tools_code = getattr(
                        provider.call_with_tools, "__code__", None
                    )
                    if (
                        effective_model
                        and call_with_tools_code is not None
                        and "model_override" in call_with_tools_code.co_varnames
                    ):
                        call_kwargs["model_override"] = effective_model

                    timeout_to_use = config.ai_timeout_s if is_fallback else config.ai_primary_timeout_s
                    outcome = await asyncio.wait_for(
                        provider.call_with_tools(**call_kwargs),
                        timeout=timeout_to_use,
                    )
                    elapsed = int((time.monotonic() - t0) * 1000)

                    if isinstance(outcome, ToolCallResult):
                        # Success — write audit log + update router state
                        ui_name = "gemini" if prov_name == "gemini-flash" else prov_name
                        outcome.provider = ui_name
                        
                        await write_log(
                            task_id=task_id,
                            step_idx=step_idx,
                            provider=prov_name,
                            model=getattr(provider, "model", config.ai_gemini_model if prov_name == "gemini" else "?"),
                            tool_name=outcome.tool_name,
                            success=True,
                            error_kind=None,
                            error_message=None,
                            elapsed_ms=elapsed,
                            retry_count=tries - 1,
                            fell_through_to_fallback=is_fallback,
                            user_id=user_id,
                        )
                        self._active = prov_name
                        self._sync_context(prov_name)
                        self._last_call_at[prov_name] = time.monotonic()
                        return outcome

                    # Provider returned a ToolUseError (refusal, invalid args, etc.)
                    last_error = outcome
                    is_rate_limit = outcome.kind == ToolErrorKind.RATE_LIMIT
                    is_unavail = outcome.kind == ToolErrorKind.PROVIDER_UNAVAILABLE
                    will_cool = (
                        (is_rate_limit and tries > extra_retries) or
                        (is_unavail and tries > _TRANSIENT_RETRIES)
                    )
                    await write_log(
                        task_id=task_id,
                        step_idx=step_idx,
                        provider=prov_name,
                        model=getattr(outcome, "model", config.ai_gemini_model if prov_name == "gemini" else "?"),
                        tool_name=None,
                        success=False,
                        error_kind=outcome.kind,
                        error_message=outcome.message,
                        elapsed_ms=elapsed,
                        retry_count=tries - 1,
                        retry_after_s=outcome.retry_after_s,
                        fell_through_to_fallback=is_fallback,
                        cooling_triggered=will_cool,
                        user_id=user_id,
                    )

                    if not outcome.retriable:
                        if outcome.kind == ToolErrorKind.QUOTA_EXHAUSTED:
                            self._mark_quota_exhausted(prov_name)
                        break

                    # Retry logic for RATE_LIMIT / TIMEOUT / PROVIDER_UNAVAILABLE
                    if outcome.kind == ToolErrorKind.RATE_LIMIT and tries <= extra_retries:
                        await asyncio.sleep(self._compute_backoff(outcome.retry_after_s, tries))
                        continue
                    if outcome.kind == ToolErrorKind.RATE_LIMIT:
                        self._mark_cooling(prov_name, _COOLING_RATE_LIMIT_S, "rate_limit")
                        break
                    if outcome.kind in {ToolErrorKind.PROVIDER_UNAVAILABLE, ToolErrorKind.NETWORK, ToolErrorKind.TIMEOUT} and tries <= _TRANSIENT_RETRIES:
                        await asyncio.sleep(0.5)
                        continue
                    if outcome.kind == ToolErrorKind.PROVIDER_UNAVAILABLE:
                        self._mark_cooling(prov_name, _COOLING_PROVIDER_5XX_S, "provider_unavailable")
                    break

                except Exception as exc:
                    elapsed = int((time.monotonic() - t0) * 1000)
                    kind, retriable, retry_after_s = _classify_provider_exception(prov_name, exc)
                    logger.warning("AIRouter.call_with_tools: %s failed (%s): %s", prov_name, kind, exc)

                    last_error = ToolUseError(
                        kind=kind,
                        message=str(exc),
                        retriable=retriable,
                        retry_after_s=retry_after_s,
                    )

                    is_rate_limit = kind == ToolErrorKind.RATE_LIMIT
                    is_unavail = kind == ToolErrorKind.PROVIDER_UNAVAILABLE
                    will_cool = (
                        (is_rate_limit and tries > extra_retries) or
                        (is_unavail and tries > _TRANSIENT_RETRIES)
                    )
                    await write_log(
                        task_id=task_id,
                        step_idx=step_idx,
                        provider=prov_name,
                        # `outcome` is only bound on the ToolUseError-return
                        # path; in this hard-exception handler it is unbound,
                        # so referencing it raised UnboundLocalError and
                        # masked the real provider error (broke cooling /
                        # fallthrough). Log the provider's configured model.
                        model=(
                            config.ai_gemini_model if prov_name == "gemini"
                            else config.ai_ollama_model if prov_name == "ollama"
                            else config.ai_anthropic_model if prov_name == "anthropic"
                            else "?"
                        ),
                        tool_name=None,
                        success=False,
                        error_kind=kind,
                        error_message=str(exc),
                        elapsed_ms=elapsed,
                        retry_count=tries - 1,
                        retry_after_s=retry_after_s,
                        fell_through_to_fallback=is_fallback,
                        cooling_triggered=will_cool,
                        user_id=user_id,
                    )

                    if kind == ToolErrorKind.QUOTA_EXHAUSTED:
                        self._mark_quota_exhausted(prov_name)
                        break

                    if kind == ToolErrorKind.INVALID_ARGS:
                        # Technical error (like Gemini 400) — don't retry same provider,
                        # fall through to NEXT provider immediately.
                        logger.warning("AIRouter.call_with_tools: %s rejected arguments, falling through to next", prov_name)
                        break

                    if retriable and tries <= (extra_retries if kind == ToolErrorKind.RATE_LIMIT else _TRANSIENT_RETRIES):
                        wait = self._compute_backoff(retry_after_s, tries) if kind == ToolErrorKind.RATE_LIMIT else 0.5
                        await asyncio.sleep(wait)
                        continue

                    if kind == ToolErrorKind.RATE_LIMIT:
                        self._mark_cooling(prov_name, _COOLING_RATE_LIMIT_S, "rate_limit")
                    elif kind == ToolErrorKind.PROVIDER_UNAVAILABLE:
                        self._mark_cooling(prov_name, _COOLING_PROVIDER_5XX_S, "provider_unavailable")
                    break

        # If any provider was quota-exhausted, propagate that signal.
        if any(p in self._quota_exhausted for p in sequence):
            raise BlockedQuotaError("All providers exhausted (quota-locked)")

        return last_error or ToolUseError(
            kind=ToolErrorKind.UNKNOWN,
            message="All providers failed",
            retriable=False,
        )

    async def call_with_tools_stream(
        self,
        *,
        system_prompt: str,
        user_message: str,
        tools: list,
        history: list[dict] | None = None,
        user_id: str | None = None,
        task_id: str | None = None,
        provider_hint: str | None = None,
        on_delta=None,
    ):
        """B1 liveness — round-1 with live text deltas. Tries ONLY the
        primary provider's streaming function-call path; any failure
        (error outcome or exception) falls back to the fully-resilient
        non-streaming `call_with_tools`. Deltas already emitted before a
        fallback are harmless — the final WS message replaces the bubble."""
        from ai.tool_use import ToolCallResult, ToolErrorKind

        tools = _coerce_tool_schemas(tools)
        primary = provider_hint or config.ai_primary_provider
        real_primary = "gemini" if primary == "gemini-flash" else primary
        provider = (
            self.get_provider(primary)
            if self._is_provider_available(primary)
            else None
        )
        if provider is not None and hasattr(provider, "call_with_tools_stream"):
            if not await _runtime_note_llm_call(task_id):
                await _write_budget_exhausted_audit(task_id, caller="call_with_tools_stream")
                from ai.tool_use import ToolUseError
                return ToolUseError(
                    kind=ToolErrorKind.UNKNOWN,
                    message="call_budget_exhausted",
                    retriable=False,
                )
            effective_model = (
                config.ai_tactical_model
                if primary == "gemini-flash" and config.ai_tactical_model != "auto"
                else config.ai_gemini_model if real_primary == "gemini"
                else None
            )
            try:
                await self._respect_min_interval(primary)
                outcome = await asyncio.wait_for(
                    provider.call_with_tools_stream(
                        system_prompt=system_prompt,
                        user_message=user_message,
                        tools=tools,
                        history=history or [],
                        user_id=user_id,
                        model_override=effective_model,
                        on_delta=on_delta,
                    ),
                    timeout=config.ai_primary_timeout_s,
                )
                if isinstance(outcome, ToolCallResult):
                    outcome.provider = real_primary
                    self._active = primary
                    self._sync_context(primary)
                    self._last_call_at[primary] = time.monotonic()
                    return outcome
                if outcome.kind == ToolErrorKind.QUOTA_EXHAUSTED:
                    self._mark_quota_exhausted(primary)
                elif outcome.kind == ToolErrorKind.PROVIDER_UNAVAILABLE:
                    self._mark_cooling(primary, _COOLING_PROVIDER_5XX_S, "provider_unavailable")
                logger.warning(
                    "AIRouter.call_with_tools_stream: %s failed (%s), falling back to sync path",
                    primary, outcome.kind,
                )
            except Exception as exc:
                kind, _, _ = _classify_provider_exception(real_primary, exc)
                if kind == ToolErrorKind.QUOTA_EXHAUSTED:
                    self._mark_quota_exhausted(primary)
                logger.warning(
                    "AIRouter.call_with_tools_stream: %s raised (%s): %s — falling back",
                    primary, kind, exc,
                )

        return await self.call_with_tools(
            system_prompt=system_prompt,
            user_message=user_message,
            tools=tools,
            history=history,
            user_id=user_id,
            task_id=task_id,
            provider_hint=provider_hint,
        )

    def _is_provider_available(self, name: str) -> bool:
        self._ensure_state_dicts()
        if name in self._quota_exhausted:
            return False
        if name in self._cooling:
            if self._cooling[name].get("ends_monotonic", 0.0) > time.monotonic():
                return False
            del self._cooling[name]
        # Availability must mean "can be obtained", not "already cached".
        # `self._providers` is only populated lazily by get_provider(),
        # which runs INSIDE the generation loop — but _available_sequence()
        # gates that loop via this check. Returning `name in self._providers`
        # therefore reports every provider unavailable on a fresh process
        # until something else happens to warm it, so chat 503s with
        # "No AI providers available (cooling or quota-locked)" despite a
        # valid key. get_provider() lazily constructs + caches and returns
        # None only on real import/construction failure.
        return self.get_provider(name) is not None

    def _available_sequence(self, primary_override: str | None = None) -> list[str]:
        primary = primary_override or config.ai_primary_provider
        fallback = config.ai_fallback_provider
        out = []
        if self._is_provider_available(primary): out.append(primary)
        if fallback != "none" and fallback != primary and self._is_provider_available(fallback):
            out.append(fallback)
        return out

    def _ensure_state_dicts(self) -> None:
        for attr in ("_cooling", "_quota_exhausted", "_last_call_at", "_last_call_summary"):
            if not hasattr(self, attr): setattr(self, attr, {})

    def _mark_cooling(self, name: str, seconds: float, reason: str) -> None:
        self._cooling[name] = {"ends_monotonic": time.monotonic() + seconds, "reason": reason}

    def _mark_quota_exhausted(self, name: str) -> None:
        self._quota_exhausted[name] = {"until": "midnight"}

    def _sync_context(self, provider_name: str) -> None:
        try:
            from core.context_engine import context_engine
            context_engine.set_ai_provider(provider_name)
        except Exception: pass

    async def _respect_min_interval(self, prov_name: str) -> None:
        last = self._last_call_at.get(prov_name)
        if last:
            elapsed = time.monotonic() - last
            if elapsed < 0.2: await asyncio.sleep(0.2 - elapsed)

    def _compute_backoff(self, retry_after_s: float | None, attempt: int) -> float:
        return min(retry_after_s or (2 ** attempt), 16.0)

    def reset_cooling(self, provider_name: str | None = None) -> None:
        """Manually clear cooling/quota state for a provider or all."""
        self._ensure_state_dicts()
        if provider_name:
            if provider_name in self._cooling:
                del self._cooling[provider_name]
            if provider_name in self._quota_exhausted:
                del self._quota_exhausted[provider_name]
            logger.info("AIRouter: reset cooling state for provider '%s'", provider_name)
        else:
            self._cooling.clear()
            self._quota_exhausted.clear()
            logger.info("AIRouter: reset cooling state for ALL providers")

    def router_state_snapshot(self) -> dict:
        """Returns a full snapshot of the router state for the frontend."""
        self._ensure_state_dicts()
        now = time.monotonic()
        
        # Clean up stale cooling entries
        for name in list(self._cooling.keys()):
            if self._cooling[name].get("ends_monotonic", 0.0) <= now:
                del self._cooling[name]
        
        # Convert monotonic cooling to UTC ISO strings for FE
        cooling_out = {}
        for name, info in self._cooling.items():
            ends = info.get("ends_monotonic", 0.0)
            remaining = max(0.0, ends - now)
            until_dt = datetime.now(tz=timezone.utc) + timedelta(seconds=remaining)
            cooling_out[name] = {
                "until_utc": until_dt.isoformat(),
                "reason": info.get("reason", "unknown")
            }

        # Quota exhausted mapping
        quota_out = {}
        for name, info in self._quota_exhausted.items():
            quota_out[name] = {"until_utc": info.get("until", "midnight")}

        return {
            "primary": config.ai_primary_provider,
            "fallback": config.ai_fallback_provider,
            "active": self.active_provider_name,
            "cooling": cooling_out,
            "quota_exhausted": quota_out,
            "last_calls": self._last_call_summary
        }


def _classify_provider_exception(provider_name: str, exc: Exception):
    from ai.tool_use import ToolErrorKind
    import asyncio
    if isinstance(exc, (TimeoutError, asyncio.TimeoutError)):
        return ToolErrorKind.TIMEOUT, True, None
        
    if provider_name == "anthropic":
        from ai.anthropic_provider import _classify_anthropic_error
        return _classify_anthropic_error(exc)
    if provider_name == "gemini":
        from ai.gemini_provider import _classify_gemini_error
        return _classify_gemini_error(exc)
    if provider_name == "ollama":
        from ai.ollama_provider import _classify_ollama_error
        return _classify_ollama_error(exc)
    return ToolErrorKind.NETWORK, True, None

async def _write_budget_exhausted_audit(task_id: str | None, *, caller: str) -> None:
    if not task_id:
        return
    try:
        from db.database import get_session
        from db.models import AgentAudit
        async with get_session() as db:
            audit = AgentAudit(
                user_id="system",  # fall back if user unknown
                task_id=task_id,
                event="budget_exhausted",
                details_json={"caller": caller},
            )
            db.add(audit)
            await db.commit()
    except Exception as exc:
        logger.debug("failed to write budget_exhausted audit: %s", exc)


async def _runtime_note_llm_call(task_id: str | None) -> bool:
    """Increment the per-task LLM call counter via the runtime.
    
    Returns False if the budget is exhausted.
    """
    if task_id is None:
        if config.agent_require_task_id_for_budget:
            logger.warning(
                "LLM call without task_id; budget tracking skipped. "
                "Set AI_REQUIRE_TASK_ID=false to silence."
            )
        return True
    
    try:
        from agent.kernel.runtime import agent_runtime
        return await agent_runtime.note_llm_call(task_id)
    except Exception as exc:
        logger.debug("failed to note llm call in runtime: %s", exc)
        return True

def _utc_now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()

_AI_ROUTER_SINGLETON: AIRouter | None = None

def __getattr__(name: str):
    global _AI_ROUTER_SINGLETON
    if name == "ai_router":
        if _AI_ROUTER_SINGLETON is None: _AI_ROUTER_SINGLETON = AIRouter()
        return _AI_ROUTER_SINGLETON
    raise AttributeError(name)
