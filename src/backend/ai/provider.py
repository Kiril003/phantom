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
from datetime import datetime, timezone
from typing import AsyncIterator

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

    Inherits from RuntimeError (not PlannerLLMError) so json_response /
    llm_json's `except JsonResponseError` does NOT swallow it — quota
    exhaustion is a control signal, not a parse problem.
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
        """Return a complete AIResponse (non-streaming).

        Phase 10 — ``user_id`` is passed through so providers that support
        chat data-tools (see ``ai.chat_tools``) can query user-scoped
        resources inside the generate loop. Providers that don't implement
        tool-use should accept and ignore the kwarg.
        """

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

        # Phase 9.2.1 — provider cooling state. Maps provider name → monotonic
        # epoch when the cooldown ends. quota_until is a wall-clock UTC ISO
        # string with a separate reason channel ("rate_limit" vs "quota").
        # Inspected by AIRouter.call_with_tools() and surfaced via
        # GET /api/v1/agent/router_state.
        self._cooling: dict[str, dict[str, float | str]] = {}
        self._quota_exhausted: dict[str, dict[str, str]] = {}
        # Min-interval throttle — last-attempt monotonic time per provider.
        self._last_call_at: dict[str, float] = {}
        # Last-call summary for the router_state endpoint.
        self._last_call_summary: dict[str, dict] = {}

    # ── Public API ─────────────────────────────────────────────────────────────

    @property
    def active_provider_name(self) -> str:
        return self._active

    async def generate(
        self,
        user_message: str,
        system_prompt: str,
        history: list[dict],
        *,
        task_id: str | None = None,
        user_id: str | None = None,
    ) -> AIResponse:
        """Generate response — primary with fallback, sharing the resilience
        policy (cooling, quota lock, backoff) used by call_with_tools.

        Phase 9.2.2 (F-02): the previous one-shot try/except fell straight to
        fallback on any error and bypassed the 9.2.1 policy entirely. Now
        429s drive the same backoff/cooling/quota machinery as tactical's
        tool-use path.
        """
        if not await _runtime_note_llm_call(task_id):
            # Phase 9.2.3 (F-15): audit row mirrors the call_with_tools path
            # so the ai_tool_use_log consistently records budget exhaustion
            # regardless of which entry point was used.
            await _write_budget_exhausted_audit(task_id, caller="generate")
            raise RuntimeError(
                f"call_budget_exhausted: per-task LLM-call cap "
                f"({config.agent_max_llm_calls_per_task}) reached"
            )

        from ai.tool_use import ToolErrorKind

        primary_name = config.ai_primary_provider
        fallback_name = config.ai_fallback_provider
        sequence = self._available_sequence()

        if not sequence:
            primary_blocked = primary_name in self._quota_exhausted
            fallback_disabled = (
                fallback_name == "none" or fallback_name not in self._providers
            )
            if primary_blocked and (
                fallback_disabled or fallback_name in self._quota_exhausted
            ):
                raise BlockedQuotaError(
                    f"all providers quota-exhausted: primary={primary_name}, "
                    f"fallback={fallback_name}"
                )
            raise RuntimeError(
                f"AIRouter.generate: no providers available "
                f"(primary={primary_name} cooling/quota: "
                f"{self._unavailable_reason(primary_name)})"
            )

        last_exc: Exception | None = None

        for prov_idx, prov_name in enumerate(sequence):
            provider = self._providers.get(prov_name)
            if provider is None:
                continue
            is_fallback_attempt = prov_idx > 0
            extra_retries = 0 if is_fallback_attempt else _RATE_LIMIT_RETRIES
            tries = 0
            while True:
                tries += 1
                await self._respect_min_interval(prov_name)
                t0 = time.monotonic()
                try:
                    result = await asyncio.wait_for(
                        provider.generate(
                            user_message, system_prompt, history, user_id=user_id,
                        ),
                        timeout=config.ai_timeout_s,
                    )
                except Exception as exc:
                    self._last_call_at[prov_name] = time.monotonic()
                    kind, _retr, retry_after_s = _classify_provider_exception(prov_name, exc)
                    self._last_call_summary[prov_name] = {
                        "at": _utc_now_iso(), "success": False, "kind": str(kind),
                    }
                    last_exc = exc
                    logger.warning(
                        "AIRouter.generate: %s failed (%s/%s): %s",
                        prov_name, type(exc).__name__, kind, exc,
                    )
                    if kind == ToolErrorKind.QUOTA_EXHAUSTED:
                        self._mark_quota_exhausted(prov_name)
                        break
                    if kind == ToolErrorKind.RATE_LIMIT and tries <= extra_retries:
                        await asyncio.sleep(self._compute_backoff(retry_after_s, tries))
                        continue
                    if kind == ToolErrorKind.RATE_LIMIT:
                        self._mark_cooling(prov_name, _COOLING_RATE_LIMIT_S, "rate_limit")
                        break
                    if (
                        kind in {ToolErrorKind.PROVIDER_UNAVAILABLE,
                                 ToolErrorKind.NETWORK,
                                 ToolErrorKind.TIMEOUT}
                        and tries <= _TRANSIENT_RETRIES
                    ):
                        await asyncio.sleep(0.5 if kind != ToolErrorKind.PROVIDER_UNAVAILABLE else 1.0)
                        continue
                    if kind == ToolErrorKind.PROVIDER_UNAVAILABLE:
                        self._mark_cooling(prov_name, _COOLING_PROVIDER_5XX_S, "provider_unavailable")
                    break
                # Success
                result.latency_ms = int((time.monotonic() - t0) * 1000)
                self._active = prov_name
                self._sync_context(prov_name)
                self._last_call_at[prov_name] = time.monotonic()
                self._last_call_summary[prov_name] = {
                    "at": _utc_now_iso(), "success": True, "tool": None,
                }
                return result

        # Both providers failed.
        primary_blocked = primary_name in self._quota_exhausted
        fallback_disabled = (
            fallback_name == "none" or fallback_name not in self._providers
        )
        fallback_blocked = (
            fallback_disabled or fallback_name in self._quota_exhausted
        )
        if primary_blocked and fallback_blocked:
            raise BlockedQuotaError(
                f"all providers quota-exhausted: primary={primary_name}, "
                f"fallback={fallback_name}"
            )
        if last_exc is not None:
            raise last_exc
        raise RuntimeError(
            f"AIRouter.generate: providers exhausted "
            f"(primary={primary_name}, fallback={fallback_name})"
        )

    async def generate_stream(
        self,
        user_message: str,
        system_prompt: str,
        history: list[dict],
        *,
        task_id: str | None = None,
    ) -> AsyncIterator[str]:
        """
        Stream from primary, with cooling/quota awareness (Phase 9.2.2).
        Falls back to chunked non-streaming if primary is unavailable or fails
        mid-stream. Raises BlockedQuotaError when all providers are
        quota-exhausted so the loop can park the task.
        """
        if not await _runtime_note_llm_call(task_id):
            # Phase 9.2.3 (F-15): audit row for the stream entry point too.
            await _write_budget_exhausted_audit(task_id, caller="generate_stream")
            raise RuntimeError(
                f"call_budget_exhausted: per-task LLM-call cap "
                f"({config.agent_max_llm_calls_per_task}) reached"
            )

        from ai.tool_use import ToolErrorKind

        primary_name = config.ai_primary_provider
        fallback_name = config.ai_fallback_provider
        primary_available = self._is_provider_available(primary_name)

        if primary_available:
            primary = self._providers[primary_name]
            try:
                await self._respect_min_interval(primary_name)
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
                self._last_call_at[primary_name] = time.monotonic()
                self._last_call_summary[primary_name] = {
                    "at": _utc_now_iso(), "success": True, "tool": None,
                }
                return
            except Exception as exc:
                self._last_call_at[primary_name] = time.monotonic()
                kind, _retr, _ra = _classify_provider_exception(primary_name, exc)
                self._last_call_summary[primary_name] = {
                    "at": _utc_now_iso(), "success": False, "kind": str(kind),
                }
                logger.warning(
                    "Primary stream (%s) failed (%s): %s — falling back",
                    primary_name, kind, exc,
                )
                if kind == ToolErrorKind.QUOTA_EXHAUSTED:
                    self._mark_quota_exhausted(primary_name)
                elif kind == ToolErrorKind.RATE_LIMIT:
                    self._mark_cooling(primary_name, _COOLING_RATE_LIMIT_S, "rate_limit")
                elif kind == ToolErrorKind.PROVIDER_UNAVAILABLE:
                    self._mark_cooling(primary_name, _COOLING_PROVIDER_5XX_S, "provider_unavailable")
        else:
            logger.info(
                "AIRouter.generate_stream: skipping primary '%s' — %s",
                primary_name, self._unavailable_reason(primary_name),
            )

        if fallback_name == "none" or fallback_name not in self._providers:
            if primary_name in self._quota_exhausted:
                raise BlockedQuotaError(
                    f"primary={primary_name} quota-exhausted and no fallback"
                )
            raise RuntimeError("Primary stream failed and no fallback configured.")

        if not self._is_provider_available(fallback_name):
            if (primary_name in self._quota_exhausted
                    and fallback_name in self._quota_exhausted):
                raise BlockedQuotaError(
                    f"all providers quota-exhausted: primary={primary_name}, "
                    f"fallback={fallback_name}"
                )
            raise RuntimeError(
                f"AIRouter.generate_stream: fallback {fallback_name} unavailable "
                f"({self._unavailable_reason(fallback_name)})"
            )

        fallback = self._providers[fallback_name]
        await self._respect_min_interval(fallback_name)
        response = await fallback.generate(user_message, system_prompt, history)
        self._active = fallback_name
        self._sync_context(fallback_name)
        self._last_call_at[fallback_name] = time.monotonic()
        self._last_call_summary[fallback_name] = {
            "at": _utc_now_iso(), "success": True, "tool": None,
        }

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

    # ── Tool-use routing (Phase 9.2 + 9.2.1 resilience) ──────────────────────

    async def call_with_tools(
        self,
        *,
        system_prompt: str,
        user_message: str,
        tools: list,
        task_id: str | None = None,
        step_idx: int | None = None,
        max_total_retries: int | None = None,
    ):
        """
        Try primary.call_with_tools → on retriable error apply the policy
        from Phase 9.2.1 spec:

          RATE_LIMIT     → backoff(retry_after_s or 2**attempt, capped 16s),
                           up to _RATE_LIMIT_RETRIES; then cool 60s + fallback.
          QUOTA_EXHAUSTED → mark provider until midnight UTC; immediate fallback.
          PROVIDER_UNAVAILABLE / NETWORK / TIMEOUT
                         → 1 retry on same provider; then fallback.
          UNKNOWN_TOOL / INVALID_ARGS / PARSE_FAILED / MODEL_REFUSED
                         → semantic; do NOT fall through (different model =
                           different hallucination, not a fix).

        Audits every attempt — fields retry_count, retry_after_s,
        fell_through_to_fallback, cooling_triggered are persisted so live
        acceptance can verify the resilience policy fired.
        """
        from ai.tool_use import (
            SEMANTIC_ERROR_KINDS,
            ToolCallResult,
            ToolErrorKind,
            ToolUseError,
        )
        from ai.tool_use_audit import write_log

        budget = max_total_retries if max_total_retries is not None else int(
            config.ai_tool_use_max_total_retries
        )
        attempts_total = 0
        primary_name = config.ai_primary_provider
        fallback_name = config.ai_fallback_provider
        sequence: list[str] = []

        # Skip primary entirely if it's quota-exhausted today or actively cooling.
        if self._is_provider_available(primary_name):
            sequence.append(primary_name)
        else:
            logger.info(
                "AIRouter.call_with_tools: skipping primary '%s' — %s",
                primary_name,
                self._unavailable_reason(primary_name),
            )

        if fallback_name != "none" and fallback_name in self._providers:
            if self._is_provider_available(fallback_name):
                sequence.append(fallback_name)

        # Per-task call-budget guard. Runtime is asked once per outer
        # call_with_tools (NOT per inner retry) — retries inside one logical
        # planner call shouldn't multiply the budget cost. Returns False when
        # the hard cap has been hit; we surface that as an UNKNOWN error
        # carrying error_kind='call_budget_exhausted' for audit clarity.
        if not await _runtime_note_llm_call(task_id):
            # Phase 9.2.3 (F-15): write a router-side audit row so the
            # ai_tool_use_log reflects that the task was capped. Without this,
            # inspecting the log after a runaway task shows NO ROW for the
            # stop reason — only the tactical_failed observation further
            # upstream. An explicit row here makes the cause obvious.
            with contextlib.suppress(Exception):
                await write_log(
                    task_id=task_id,
                    step_idx=step_idx,
                    provider="router",
                    model="",
                    tool_name=None,
                    success=False,
                    error_kind="call_budget_exhausted",
                    error_message=(
                        f"per-task LLM-call cap "
                        f"({config.agent_max_llm_calls_per_task}) reached"
                    ),
                    elapsed_ms=0,
                    retry_count=0,
                    retry_after_s=None,
                    fell_through_to_fallback=False,
                    cooling_triggered=False,
                )
            return ToolUseError(
                kind=ToolErrorKind.UNKNOWN,
                message=(
                    f"call_budget_exhausted: per-task LLM-call cap "
                    f"({config.agent_max_llm_calls_per_task}) reached"
                ),
                retriable=False,
                provider="router",
                model="",
                parse_attempts=0,
            )

        last_error: ToolUseError | None = None
        fell_through = False

        for prov_idx, prov_name in enumerate(sequence):
            if attempts_total >= budget:
                break
            provider = self._providers.get(prov_name)
            if provider is None or not hasattr(provider, "call_with_tools"):
                continue

            is_fallback_attempt = prov_idx > 0
            # Fallback is single-shot: no per-error retries.
            extra_retries = 0 if is_fallback_attempt else _RATE_LIMIT_RETRIES
            tries_for_this_provider = 0
            cooling_triggered = False

            while True:
                tries_for_this_provider += 1
                attempts_total += 1
                remaining = max(1, budget - attempts_total + 1)
                await self._respect_min_interval(prov_name)
                t0 = time.monotonic()
                try:
                    outcome = await provider.call_with_tools(
                        system_prompt=system_prompt,
                        user_message=user_message,
                        tools=tools,
                        max_retries=min(3, remaining),
                    )
                except Exception as exc:
                    outcome = ToolUseError(
                        kind=ToolErrorKind.UNKNOWN,
                        message=f"{prov_name} raised: {exc}",
                        retriable=True,
                        provider=prov_name,
                        model="",
                        parse_attempts=1,
                    )
                elapsed_ms = int((time.monotonic() - t0) * 1000)
                self._last_call_at[prov_name] = time.monotonic()

                if isinstance(outcome, ToolCallResult):
                    self._active = prov_name
                    self._sync_context(prov_name)
                    self._last_call_summary[prov_name] = {
                        "at": _utc_now_iso(),
                        "success": True,
                        "tool": outcome.tool_name,
                    }
                    await write_log(
                        task_id=task_id,
                        step_idx=step_idx,
                        provider=prov_name,
                        model=outcome.model,
                        tool_name=outcome.tool_name,
                        success=True,
                        error_kind=None,
                        error_message=None,
                        elapsed_ms=elapsed_ms,
                        retry_count=outcome.parse_attempts,
                        retry_after_s=None,
                        fell_through_to_fallback=is_fallback_attempt,
                        cooling_triggered=cooling_triggered,
                    )
                    return outcome

                last_error = outcome
                self._last_call_summary[prov_name] = {
                    "at": _utc_now_iso(),
                    "success": False,
                    "kind": str(outcome.kind),
                }
                kind = outcome.kind
                # Decide cooling FIRST so the audit row tagged with the
                # attempt that triggered cooling actually has the flag set.
                attempt_cools = (
                    kind == ToolErrorKind.RATE_LIMIT
                    and tries_for_this_provider > extra_retries
                ) or kind == ToolErrorKind.PROVIDER_UNAVAILABLE and (
                    tries_for_this_provider > _TRANSIENT_RETRIES
                )
                await write_log(
                    task_id=task_id,
                    step_idx=step_idx,
                    provider=prov_name,
                    model=outcome.model,
                    tool_name=None,
                    success=False,
                    error_kind=str(kind),
                    error_message=outcome.message,
                    elapsed_ms=elapsed_ms,
                    retry_count=outcome.parse_attempts,
                    retry_after_s=outcome.retry_after_s,
                    fell_through_to_fallback=is_fallback_attempt,
                    cooling_triggered=attempt_cools,
                )

                # Quota — mark and fall through immediately.
                if kind == ToolErrorKind.QUOTA_EXHAUSTED:
                    self._mark_quota_exhausted(prov_name)
                    break

                # Semantic — fallback won't help; surface as-is.
                if kind in SEMANTIC_ERROR_KINDS:
                    return outcome

                # Rate limit — backoff and retry up to N times on the SAME provider.
                if kind == ToolErrorKind.RATE_LIMIT and tries_for_this_provider <= extra_retries:
                    delay = self._compute_backoff(outcome.retry_after_s, tries_for_this_provider)
                    logger.info(
                        "AIRouter: %s rate-limited; backing off %.2fs (attempt %d)",
                        prov_name, delay, tries_for_this_provider,
                    )
                    await asyncio.sleep(delay)
                    continue

                # Rate limit exhausted on this provider → cool + fallback.
                if kind == ToolErrorKind.RATE_LIMIT:
                    self._mark_cooling(prov_name, _COOLING_RATE_LIMIT_S, "rate_limit")
                    cooling_triggered = True
                    break

                # 5xx / network / timeout — single inline retry, then fallback.
                if (
                    kind in {ToolErrorKind.PROVIDER_UNAVAILABLE,
                             ToolErrorKind.NETWORK,
                             ToolErrorKind.TIMEOUT}
                    and tries_for_this_provider <= _TRANSIENT_RETRIES
                ):
                    await asyncio.sleep(0.5 if kind != ToolErrorKind.PROVIDER_UNAVAILABLE else 1.0)
                    continue

                if kind == ToolErrorKind.PROVIDER_UNAVAILABLE:
                    self._mark_cooling(prov_name, _COOLING_PROVIDER_5XX_S, "provider_unavailable")
                    cooling_triggered = True

                # Anything else (UNKNOWN, exhausted retries) → break and try fallback.
                break

            # Outer loop: about to move to fallback (if any).
            if prov_idx == 0 and len(sequence) > 1:
                fell_through = True

        if last_error is None:
            last_error = ToolUseError(
                kind=ToolErrorKind.UNKNOWN,
                message="all providers exhausted",
                retriable=False,
                provider="router",
                model="",
                parse_attempts=attempts_total,
            )
        last_error.fell_through = fell_through
        return last_error

    # ── Phase 9.2.2 — provider sequence + accessors ──────────────────────────

    def _ensure_state_dicts(self) -> None:
        """Phase 9.2.2: tests instantiate AIRouter via `__new__` and skip
        __init__. Lazily install the empty state dicts so the resilience
        helpers don't AttributeError on those code paths."""
        for attr in ("_cooling", "_quota_exhausted", "_last_call_at", "_last_call_summary"):
            if not hasattr(self, attr):
                setattr(self, attr, {})

    def _available_sequence(self) -> list[str]:
        """Build (primary, fallback) call order, skipping cooling/quota-locked."""
        out: list[str] = []
        primary_name = config.ai_primary_provider
        fallback_name = config.ai_fallback_provider
        if self._is_provider_available(primary_name):
            out.append(primary_name)
        else:
            logger.info(
                "AIRouter.generate: skipping primary '%s' — %s",
                primary_name, self._unavailable_reason(primary_name),
            )
        if fallback_name != "none" and fallback_name in self._providers:
            if self._is_provider_available(fallback_name):
                out.append(fallback_name)
        return out

    def get_provider(self, name: str):
        """Public accessor for tests / probe — returns the underlying provider
        instance (no router resilience wrapping). Returns None if unknown."""
        return self._providers.get(name)

    # ── Cooling / quota helpers ────────────────────────────────────────────────

    def _is_provider_available(self, name: str) -> bool:
        self._ensure_state_dicts()
        if name in self._quota_exhausted:
            until = self._quota_exhausted[name].get("until_utc", "")
            try:
                if datetime.fromisoformat(until.replace("Z", "+00:00")) > datetime.now(tz=timezone.utc):
                    return False
                # Quota window has elapsed — clear and recheck.
                del self._quota_exhausted[name]
            except Exception:
                del self._quota_exhausted[name]
        if name in self._cooling:
            ends_at = float(self._cooling[name].get("ends_monotonic", 0.0))
            if ends_at > time.monotonic():
                return False
            del self._cooling[name]
        return name in self._providers

    def _unavailable_reason(self, name: str) -> str:
        if name in self._quota_exhausted:
            return f"quota_exhausted_until={self._quota_exhausted[name].get('until_utc')}"
        if name in self._cooling:
            ends = float(self._cooling[name].get("ends_monotonic", 0.0))
            return f"cooling reason={self._cooling[name].get('reason')} for_{int(ends - time.monotonic())}s"
        return "unknown"

    def _mark_cooling(self, name: str, seconds: float, reason: str) -> None:
        self._cooling[name] = {
            "ends_monotonic": time.monotonic() + seconds,
            "ends_iso": _utc_in(seconds),
            "reason": reason,
        }

    def _mark_quota_exhausted(self, name: str) -> None:
        # Free-tier quotas reset at midnight Pacific (Google) — but UTC midnight
        # is the conservative choice, since clients can't easily check Google's
        # exact reset boundary. Probe will pop the lock early when quota recovers.
        from datetime import time as _t
        now = datetime.now(tz=timezone.utc)
        midnight = datetime.combine(now.date(), _t.max, tzinfo=timezone.utc)
        self._quota_exhausted[name] = {"until_utc": midnight.isoformat()}

    def clear_provider_cooling(self, name: str | None = None) -> None:
        """Used by the blocked_quota probe in AgentRuntime when a real call
        succeeds — pop quota/cooling so the next task call goes back to primary."""
        if name is None:
            self._cooling.clear()
            self._quota_exhausted.clear()
            return
        self._cooling.pop(name, None)
        self._quota_exhausted.pop(name, None)

    def _compute_backoff(self, retry_after_s: float | None, attempt: int) -> float:
        if retry_after_s is not None and retry_after_s > 0:
            return min(float(retry_after_s), _BACKOFF_MAX_S)
        return min(_BACKOFF_BASE_S ** attempt, _BACKOFF_MAX_S)

    async def _respect_min_interval(self, prov_name: str) -> None:
        min_ms = int(getattr(config, "ai_call_min_interval_ms", 0) or 0)
        if min_ms <= 0:
            return
        last = self._last_call_at.get(prov_name)
        if last is None:
            return
        elapsed = time.monotonic() - last
        target = min_ms / 1000.0
        if elapsed < target:
            await asyncio.sleep(target - elapsed)

    # ── Inspection (for /agent/router_state) ───────────────────────────────────

    def router_state_snapshot(self) -> dict:
        """Snapshot of cooling/quota/last-call state for monitoring."""
        # Touch availability so expired locks self-clean before reporting.
        for n in list(self._providers.keys()):
            self._is_provider_available(n)
        cooling = {
            n: {"until_utc": v.get("ends_iso"), "reason": v.get("reason")}
            for n, v in self._cooling.items()
        }
        return {
            "primary": config.ai_primary_provider,
            "fallback": config.ai_fallback_provider,
            "active": self._active,
            "cooling": cooling,
            "quota_exhausted": dict(self._quota_exhausted),
            "last_calls": dict(self._last_call_summary),
        }

    # ── Internals ──────────────────────────────────────────────────────────────

    def _sync_context(self, provider_name: str) -> None:
        """Keep ContextEngine.system.ai_provider in sync."""
        try:
            from core.context_engine import context_engine
            context_engine.set_ai_provider(provider_name)
        except Exception as exc:
            logger.debug("_sync_context: could not update context engine: %s", exc)


def _classify_provider_exception(provider_name: str, exc: Exception):
    """
    Phase 9.2.2 — dispatch to the per-provider classifier so generate /
    generate_stream apply the same resilience policy as call_with_tools.

    Returns (kind, retriable, retry_after_s).
    """
    from ai.tool_use import ToolErrorKind

    # Audit-2026-04-28 F-34: previously these blocks swallowed every
    # exception silently. A bad import (Pydantic upgrade, missing dep)
    # would mask quota cooling — the router would then hammer the
    # provider at full rate and burn the API key. Narrow to ImportError
    # and log loudly so the failure is observable.
    if provider_name == "gemini":
        try:
            from ai.gemini_provider import _classify_gemini_error
            return _classify_gemini_error(exc)
        except ImportError:
            logger.exception(
                "provider.classify: gemini classifier unavailable — "
                "treating %r as NETWORK (quota cooling disabled)", exc,
            )
            return ToolErrorKind.NETWORK, True, None
    if provider_name == "ollama":
        try:
            from ai.ollama_provider import _classify_ollama_error
            return _classify_ollama_error(exc)
        except ImportError:
            logger.exception(
                "provider.classify: ollama classifier unavailable — "
                "treating %r as NETWORK", exc,
            )
            return ToolErrorKind.NETWORK, True, None
    if isinstance(exc, asyncio.TimeoutError):
        return ToolErrorKind.TIMEOUT, True, None
    return ToolErrorKind.NETWORK, True, None


async def _write_budget_exhausted_audit(task_id: str | None, *, caller: str) -> None:
    """Phase 9.2.3 (F-15) — shared audit sink for call-budget-exhausted so
    both generate() / generate_stream() and call_with_tools record a uniform
    router-side row before raising / returning. Always suppress failures —
    inability to audit should never block the cap itself.
    """
    with contextlib.suppress(Exception):
        from ai.tool_use_audit import write_log
        await write_log(
            task_id=task_id,
            step_idx=None,
            provider="router",
            model="",
            tool_name=None,
            success=False,
            error_kind="call_budget_exhausted",
            error_message=(
                f"{caller}: per-task LLM-call cap "
                f"({config.agent_max_llm_calls_per_task}) reached"
            ),
            elapsed_ms=0,
            retry_count=0,
            retry_after_s=None,
            fell_through_to_fallback=False,
            cooling_triggered=False,
        )


async def _runtime_note_llm_call(task_id: str | None) -> bool:
    """
    Phase 9.2.1 — bridge to AgentRuntime.note_llm_call without importing
    runtime at module load (would create an import cycle: ai.provider ←
    agent.planner.tactical ← agent.loop ← agent.runtime).

    Returns True when no task is active or budget has room; False when the
    runtime has decided this task is over-budget.

    Phase 9.2.2: when `agent_require_task_id_for_budget` is True (default),
    a missing task_id logs a WARNING with caller stack so we can detect new
    code paths that bypass the budget. The call is still allowed through
    (backwards compat).
    """
    if not task_id:
        if bool(getattr(config, "agent_require_task_id_for_budget", True)):
            import traceback

            stack = "".join(traceback.format_stack(limit=6)[:-1])
            logger.warning(
                "AIRouter call invoked without task_id — per-task LLM budget "
                "will NOT count this call. Wire task_id through the planner "
                "call site.\nCaller stack:\n%s",
                stack,
            )
            with contextlib.suppress(Exception):
                from ai.tool_use_audit import write_log
                await write_log(
                    task_id=None,
                    step_idx=None,
                    provider="router",
                    model="",
                    tool_name=None,
                    success=False,
                    error_kind="missing_task_id_in_budget_path",
                    error_message="router call invoked without task_id",
                    elapsed_ms=0,
                    retry_count=0,
                    retry_after_s=None,
                    fell_through_to_fallback=False,
                    cooling_triggered=False,
                )
        return True
    try:
        from agent.runtime import agent_runtime
        return await agent_runtime.note_llm_call(task_id)
    except Exception as exc:  # pragma: no cover — never block the call path
        logger.debug("_runtime_note_llm_call failed (allowing through): %s", exc)
        return True


def _utc_now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def _utc_in(seconds: float) -> str:
    from datetime import timedelta
    return (datetime.now(tz=timezone.utc) + timedelta(seconds=seconds)).isoformat()


# Lazy singleton — `from ai.provider import ai_router` materialises on first
# access, avoiding the import cycle when ai.gemini_provider is loaded as the
# entry-point.
_AI_ROUTER_SINGLETON: AIRouter | None = None


def __getattr__(name: str):
    global _AI_ROUTER_SINGLETON
    if name == "ai_router":
        if _AI_ROUTER_SINGLETON is None:
            _AI_ROUTER_SINGLETON = AIRouter()
        return _AI_ROUTER_SINGLETON
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
