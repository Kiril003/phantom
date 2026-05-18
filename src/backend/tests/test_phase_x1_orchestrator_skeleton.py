"""Day-4 Wave-2 X-1 — chat orchestrator scaffold pin (ADR-ORC-001).

Coverage:

1. OrchestratorMode is a closed enum with values single / parallel-K.
2. decide_mode default with flag OFF → single (regardless of provider).
3. decide_mode flag ON + provider != "gemini" → single
   (Gemini-only gate; TM-17B-S2 inheritance).
4. decide_mode flag ON + provider == "gemini" → single (Day-4 hard
   default; X-3 flips to parallel-K for tool-heavy queries).
5. config.chat_orchestrator_enabled default = False.
6. config.chat_orchestrator_max_subagents = 3 (matches PHASE1_CONTEXTS).
7. config.chat_orchestrator_per_subagent_ms = 3500.
8. config.chat_orchestrator_merge_reserve_ms = 1500.
9. run_orchestrator(single mode) calls chat_pipeline_run UNCHANGED
   and returns its result identity.
10. The X-3 import-gate test still passes after adding ai/agents/
    (no orchestrator code imports from agent.actions / agent.runtime
    / agent.cognition.proactive.loop / agent.operations.standing_orders / agent.mcp).
"""
from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock

import pytest


_BACKEND = Path(__file__).resolve().parents[1]


# ────────────────────────────────────────────────────────── enum + flag ──


class TestOrchestratorEnum:
    def test_closed_to_two_values(self):
        from ai.agents import OrchestratorMode

        names = {m.name for m in OrchestratorMode}
        assert names == {"single", "parallel_k"}, (
            f"X-1: OrchestratorMode drifted; got {names!r}. Day-5 "
            "additions like 'sequential-debate' need an ADR amendment."
        )

    def test_value_strings_match_adr(self):
        from ai.agents import OrchestratorMode

        assert OrchestratorMode.single.value == "single"
        assert OrchestratorMode.parallel_k.value == "parallel-K"


class TestOrchestratorConfigDefaults:
    def test_flag_default_off(self):
        from config import PhantomConfig

        f = PhantomConfig.model_fields["chat_orchestrator_enabled"]
        assert f.default is False, (
            f"X-1: chat_orchestrator_enabled default flipped to "
            f"{f.default!r}. Back-compat invariant: default OFF."
        )

    def test_budget_defaults_match_phase1_contexts(self):
        """Phase-1 contexts pin K=3, per_subagent_ms=3500, merge_reserve=1500
        with chat_tool_max_total_ms=12000 → live split 12000-3*3500=1500."""
        from config import PhantomConfig

        assert PhantomConfig.model_fields["chat_orchestrator_max_subagents"].default == 3
        assert PhantomConfig.model_fields["chat_orchestrator_per_subagent_ms"].default == 3500
        assert PhantomConfig.model_fields["chat_orchestrator_merge_reserve_ms"].default == 1500


# ──────────────────────────────────────────────────────── decide_mode ──


class TestDecideMode:
    def test_flag_off_returns_single_for_any_provider(self):
        from ai.agents import OrchestratorMode, decide_mode

        assert decide_mode(provider="gemini", flag_enabled=False) is OrchestratorMode.single
        assert decide_mode(provider="ollama", flag_enabled=False) is OrchestratorMode.single
        assert decide_mode(provider="unknown", flag_enabled=False) is OrchestratorMode.single

    def test_flag_on_with_ollama_returns_single_gemini_only_gate(self):
        from ai.agents import OrchestratorMode, decide_mode

        assert decide_mode(provider="ollama", flag_enabled=True) is OrchestratorMode.single, (
            "X-1 Gemini-only gate: orchestrator must fall through to "
            "single-turn for Ollama (TM-17B-S2 inheritance)."
        )

    def test_flag_on_with_gemini_returns_single_on_day4(self):
        """Day-4 ships the scaffold: even with flag ON + Gemini, the
        decision is hard-coded 'single'. X-3 flips this to parallel-K
        for tool-heavy queries."""
        from ai.agents import OrchestratorMode, decide_mode

        assert decide_mode(provider="gemini", flag_enabled=True) is OrchestratorMode.single

    def test_flag_default_reads_from_config(self, monkeypatch):
        """When flag_enabled is None, decide_mode reads config.
        Sanity: monkey-patch config.chat_orchestrator_enabled=True and
        confirm decide_mode reaches the gemini-only check."""
        from ai.agents import OrchestratorMode, decide_mode
        from config import config

        monkeypatch.setattr(config, "chat_orchestrator_enabled", True)
        # Provider != gemini → single.
        assert decide_mode(provider="ollama") is OrchestratorMode.single
        # Provider == gemini → still single on Day-4 (X-3 flips later).
        assert decide_mode(provider="gemini") is OrchestratorMode.single


# ───────────────────────────────────────────────────── run_orchestrator ──


class TestRunOrchestratorSingleMode:
    @pytest.mark.asyncio
    async def test_single_mode_passes_through_to_chat_pipeline(self):
        """Back-compat invariant ADR-ORC-001: when mode is `single`,
        run_orchestrator MUST forward chat_pipeline_run with the caller's
        kwargs PLUS `provider_hint=<provider>` so nested ai_hub.dispatch
        calls bypass the locality-first auto-pick. Result identity is
        preserved (no wrapping)."""
        from ai.agents import run_orchestrator

        sentinel = object()
        run_mock = AsyncMock(return_value=sentinel)

        result = await run_orchestrator(
            user_text="hello",
            provider="gemini",
            chat_pipeline_run=run_mock,
            session_id="s1",
            user_id="u1",
        )

        assert result is sentinel, (
            "X-1: run_orchestrator must return chat_pipeline.run's result "
            "by IDENTITY (not equality) on the single path so the legacy "
            "behaviour is byte-perfect."
        )
        run_mock.assert_awaited_once_with(
            session_id="s1", user_id="u1", provider_hint="gemini"
        )

    @pytest.mark.asyncio
    async def test_explicit_provider_hint_overrides_provider_arg(self):
        """If the caller passes provider_hint explicitly in
        chat_pipeline_kwargs, the orchestrator must NOT clobber it with
        its own `provider` arg — `setdefault` semantics."""
        from ai.agents import run_orchestrator

        run_mock = AsyncMock(return_value=None)
        await run_orchestrator(
            user_text="hello",
            provider="gemini",
            chat_pipeline_run=run_mock,
            user_id="u1",
            provider_hint="ollama",
        )
        run_mock.assert_awaited_once_with(user_id="u1", provider_hint="ollama")


# ────────────────────────────────────────────────────────── import gate ──


class TestAiAgentsImportSurface:
    """X-3 (already shipped at tests/test_phase_x3_ai_agents_import_gate.py)
    enforces TM-17B-E4 — ai/agents/** must NOT import from agent.actions
    / agent.runtime / agent.cognition.proactive.loop / agent.operations.standing_orders / agent.mcp.
    Belt-and-braces here too: a static grep on the 2 X-1 files."""

    def test_orchestrator_does_not_import_agent_runtime(self):
        import ast as _ast

        path = _BACKEND / "ai" / "agents" / "orchestrator.py"
        tree = _ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        forbidden = {
            "agent.runtime",
            "agent.actions",
            "agent.cognition.proactive.loop",
            "agent.operations.standing_orders",
            "agent.mcp",
        }
        for node in _ast.walk(tree):
            if isinstance(node, _ast.ImportFrom) and node.module:
                assert node.module not in forbidden, (
                    f"X-1 import-gate regression: orchestrator.py imports "
                    f"{node.module!r}."
                )
            elif isinstance(node, _ast.Import):
                for alias in node.names:
                    assert alias.name not in forbidden, (
                        f"X-1 import-gate regression: orchestrator.py imports "
                        f"{alias.name!r}."
                    )

    def test_init_does_not_import_agent_runtime(self):
        """Use AST so the test pins the actual import surface, not
        docstring mentions of the forbidden module names."""
        import ast as _ast

        path = _BACKEND / "ai" / "agents" / "__init__.py"
        tree = _ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        forbidden = {
            "agent.runtime",
            "agent.actions",
            "agent.cognition.proactive.loop",
            "agent.operations.standing_orders",
            "agent.mcp",
        }
        for node in _ast.walk(tree):
            if isinstance(node, _ast.ImportFrom) and node.module:
                assert node.module not in forbidden, (
                    f"X-1 import-gate: __init__.py imports forbidden "
                    f"module {node.module!r}."
                )
            elif isinstance(node, _ast.Import):
                for alias in node.names:
                    assert alias.name not in forbidden, (
                        f"X-1 import-gate: __init__.py imports {alias.name!r}."
                    )
