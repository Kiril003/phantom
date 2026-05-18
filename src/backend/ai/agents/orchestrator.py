"""Day-4 Wave-2 X-1 — chat orchestrator entry (ADR-ORC-001).

`run_orchestrator()` is the single entry routes_chat invokes for every
chat turn. The orchestrator decides per-call between:

  - `single`     — call `chat_pipeline.run()` unchanged (back-compat
                   invariant; Day-3 single-turn path).
  - `parallel-K` — fan-out across K sub-agents (X-3/X-4 work).

Day-4 ships the SCAFFOLD only — `decide_mode` always returns `single`.
The flag-gate + provider-gate are wired so X-3 can drop the
parallel-K branch in without touching call sites.

Mode-decision rules (per ADR-ORC-001):
  1. ``config.chat_orchestrator_enabled`` False        → 'single'
  2. ``provider != "gemini"``                          → 'single'
     (Ollama tool-use path string-concats FunctionResponse JSON →
      re-spawns the TM-17B-S1 nonce-injection threat;
      `chat_pipeline.run` already mitigates that for Ollama.)
  3. Otherwise (Day-4) — return 'single'. X-3 lands the heuristic
     that flips this to 'parallel-K' for tool-heavy queries.

The decision is STATELESS w.r.t. history — operators can flip the
flag mid-session and the very next turn picks up the change.
"""
from __future__ import annotations

from enum import Enum
from typing import Any, Awaitable, Callable

from config import config


class OrchestratorMode(Enum):
    """Closed enum. Adding a value (e.g. 'sequential-debate' for the
    Day-5 critic vetoer pattern) requires an ADR amendment."""

    single = "single"
    parallel_k = "parallel-K"


def decide_mode(
    *,
    provider: str,
    flag_enabled: bool | None = None,
    user_text: str | None = None,
) -> OrchestratorMode:
    """Pure decision; no I/O. Public surface so tests + telemetry can
    pin the call shape without touching the live config singleton.

    `flag_enabled` defaults to ``config.chat_orchestrator_enabled``
    when None (the production path). Tests pass it explicitly to
    pin the gate without monkey-patching config."""
    flag = (
        flag_enabled
        if flag_enabled is not None
        else bool(config.chat_orchestrator_enabled)
    )
    if not flag:
        return OrchestratorMode.single
    # Gemini-only on Day-4 per TM-17B-S2.
    if provider != "gemini":
        return OrchestratorMode.single
    # Heuristic for parallel-K lands in X-3 (tool-call-count cue +
    # query-length cue + recall-hit-count cue). Day-4 hard-coded
    # single so the scaffold is observably idempotent — the orchestrator
    # delegate path is identical to the legacy chat_pipeline.run output.
    _user_text = user_text or ""
    return OrchestratorMode.single


# Type alias for the chat_pipeline.run callable. We don't import it at
# module level to keep this file's import surface minimal — `chat_pipeline`
# is a sibling under ai/, not a dependency the import-gate test needs to
# audit.
ChatPipelineRun = Callable[..., Awaitable[Any]]


async def run_orchestrator(
    *,
    user_text: str,
    provider: str,
    chat_pipeline_run: ChatPipelineRun,
    **chat_pipeline_kwargs: Any,
) -> Any:
    """Single entry point that routes_chat invokes per chat turn.

    The contract for X-1: when mode is `single`, this function calls
    `chat_pipeline_run(**kwargs)` and returns its result UNCHANGED.
    Routes_chat passes ``chat_pipeline.run`` as the callable so this
    module never imports chat_pipeline directly (keeps the import
    surface lean for the X-3 audit gate).

    When X-3 lands parallel-K, the `mode == OrchestratorMode.parallel_k`
    branch will fan out via `asyncio.wait` (no `gather` — orchestrator
    timeout MUST NOT cancel surviving leaves; ADR-ORC-005).
    """
    mode = decide_mode(provider=provider, user_text=user_text)
    # Forward the chosen provider to chat_pipeline.run as provider_hint
    # so nested ai_hub.dispatch calls bypass the hub's locality-first
    # auto-pick (which always grabs Ollama when both providers are
    # registered as available). Caller can still override by passing
    # provider_hint explicitly in chat_pipeline_kwargs.
    chat_pipeline_kwargs.setdefault("provider_hint", provider)
    if mode is OrchestratorMode.single:
        return await chat_pipeline_run(**chat_pipeline_kwargs)
    # X-3: parallel-K branch lands here. For now, the dispatcher's
    # safety contract is "single → identical to chat_pipeline.run".
    return await chat_pipeline_run(**chat_pipeline_kwargs)
