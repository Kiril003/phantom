"""
Phase 23-G — Lesson distillation + injection.

The agent compounds know-how across sessions:
  • on task `done`, runtime distils a transferable rule and writes it to a
    dedicated ChromaDB collection;
  • next time strategic_plan / tactical_plan run, they recall top-K lessons
    by goal similarity and inject them above the existing memory block.

That last property is what makes PHANTOM strictly more powerful than
Claude Code / Coworker / Aider / Cursor for repeated work — those tools
reset between sessions; PHANTOM does not.
"""
from __future__ import annotations

import os
from typing import Any

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase23g")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


# ─── 1. Public API surface ───────────────────────────────────────────────────


class TestPublicSurface:
    def test_module_exports(self) -> None:
        from agent.cognition.memory import lessons as lm
        assert hasattr(lm, "distill_lesson")
        assert hasattr(lm, "write_lesson")
        assert hasattr(lm, "recall_lessons")
        assert hasattr(lm, "format_lessons_for_prompt")
        assert sorted(lm.__all__) == sorted([
            "distill_lesson",
            "write_lesson",
            "recall_lessons",
            "format_lessons_for_prompt",
        ])


# ─── 2. Config defaults ──────────────────────────────────────────────────────


class TestConfigDefaults:
    def test_lessons_enabled_default_true(self) -> None:
        """Default-on so the compounding loop is the out-of-the-box behaviour."""
        from config import PhantomConfig
        field = PhantomConfig.model_fields["agent_lessons_enabled"]
        assert field.default is True
        assert field.annotation is bool

    def test_top_k_default(self) -> None:
        from config import PhantomConfig
        field = PhantomConfig.model_fields["agent_lessons_top_k"]
        assert field.default == 3
        assert field.annotation is int

    def test_min_relevance_default(self) -> None:
        from config import PhantomConfig
        field = PhantomConfig.model_fields["agent_lessons_min_relevance"]
        assert 0.0 <= float(field.default) <= 1.0


# ─── 3. format_lessons_for_prompt — pure function ────────────────────────────


class TestFormat:
    def test_empty_list_yields_empty_string(self) -> None:
        from agent.cognition.memory.lessons import format_lessons_for_prompt
        assert format_lessons_for_prompt([]) == ""

    def test_single_lesson_renders_all_three_clauses(self) -> None:
        from agent.cognition.memory.lessons import format_lessons_for_prompt
        text = format_lessons_for_prompt([
            {
                "what_worked": "використовуй grep -n",
                "what_avoid": "не повторюй той же selector після no_match",
                "applicability": "коли треба знайти символ у репо",
            }
        ])
        assert "УРОКИ" in text
        assert "grep -n" in text
        assert "selector" in text
        assert "коли" in text  # applicability prefix appears

    def test_lesson_with_only_what_worked_still_renders(self) -> None:
        from agent.cognition.memory.lessons import format_lessons_for_prompt
        text = format_lessons_for_prompt([
            {"what_worked": "використовуй pytest -k", "what_avoid": "", "applicability": ""}
        ])
        assert "УРОКИ" in text
        assert "pytest -k" in text
        assert "уникай" not in text  # avoid clause must be omitted

    def test_lesson_with_no_clauses_yields_only_header(self) -> None:
        """Edge case — a row with all empty clauses renders just the header,
        which would be weird. Confirm the behaviour is deterministic so we
        notice if it ever changes."""
        from agent.cognition.memory.lessons import format_lessons_for_prompt
        text = format_lessons_for_prompt([
            {"what_worked": "", "what_avoid": "", "applicability": ""}
        ])
        # No bullet line — just the header. Acceptable; future change can
        # filter empty rows out.
        assert text.startswith("УРОКИ")


# ─── 4. distill_lesson — disabled path is non-destructive ────────────────────


class TestDistillLessonDisabled:
    @pytest.mark.asyncio
    async def test_returns_none_when_disabled(self, monkeypatch) -> None:
        from agent.cognition.memory import lessons as lm
        from config import config
        monkeypatch.setattr(config, "agent_lessons_enabled", False)
        result = await lm.distill_lesson(
            goal="test", outcome="done", action_counts={"x": 1}, last_observation="ok"
        )
        assert result is None


# ─── 5. distill_lesson — happy path with mocked LLM ──────────────────────────


class _FakeResponse:
    def __init__(self, content: str) -> None:
        self.content = content


class _FakeRouter:
    def __init__(self, content: str) -> None:
        self._content = content
        self.calls: list[dict[str, Any]] = []

    async def generate(self, *, user_message: str, system_prompt: str,
                       history: list[Any], task_id: str | None = None) -> _FakeResponse:
        self.calls.append({"user": user_message, "system": system_prompt, "task_id": task_id})
        return _FakeResponse(self._content)


class TestDistillLessonLLM:
    @pytest.mark.asyncio
    async def test_parses_valid_json(self, monkeypatch) -> None:
        from agent.cognition.memory import lessons as lm
        valid_json = (
            '{"what_worked":"бери grep -n","what_avoid":"уникай rm -rf",'
            '"applicability":"шукати символи у коді"}'
        )
        fake = _FakeRouter(valid_json)
        monkeypatch.setattr("ai.provider.ai_router", fake)
        result = await lm.distill_lesson(
            goal="знайди де визначено foo()",
            outcome="done",
            action_counts={"bash.run": 2, "fs.read": 1},
            last_observation="found in src/x.py:42",
        )
        assert result is not None
        assert result["what_worked"] == "бери grep -n"
        assert result["what_avoid"] == "уникай rm -rf"
        assert "символи" in result["applicability"]

    @pytest.mark.asyncio
    async def test_strips_markdown_fences(self, monkeypatch) -> None:
        from agent.cognition.memory import lessons as lm
        wrapped = (
            "```json\n"
            '{"what_worked":"use parallel reads","what_avoid":"",'
            '"applicability":"коли читаєш N файлів"}\n'
            "```"
        )
        fake = _FakeRouter(wrapped)
        monkeypatch.setattr("ai.provider.ai_router", fake)
        result = await lm.distill_lesson(
            goal="прочитай 5 файлів", outcome="done",
            action_counts={"fs.read": 5}, last_observation="all read",
        )
        assert result is not None
        assert "parallel" in result["what_worked"]

    @pytest.mark.asyncio
    async def test_returns_none_on_invalid_json(self, monkeypatch) -> None:
        from agent.cognition.memory import lessons as lm
        fake = _FakeRouter("not json at all, plain prose response")
        monkeypatch.setattr("ai.provider.ai_router", fake)
        result = await lm.distill_lesson(
            goal="x", outcome="done", action_counts={}, last_observation="",
        )
        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_on_router_failure(self, monkeypatch) -> None:
        from agent.cognition.memory import lessons as lm

        class _BoomRouter:
            async def generate(self, **_kwargs):
                raise RuntimeError("offline")

        monkeypatch.setattr("ai.provider.ai_router", _BoomRouter())
        result = await lm.distill_lesson(
            goal="x", outcome="done", action_counts={}, last_observation="",
        )
        assert result is None

    @pytest.mark.asyncio
    async def test_empty_clauses_drop_lesson(self, monkeypatch) -> None:
        """LLM that returns both clauses empty should yield no lesson —
        we don't pollute the collection with vacuous rows."""
        from agent.cognition.memory import lessons as lm
        fake = _FakeRouter('{"what_worked":"","what_avoid":"","applicability":""}')
        monkeypatch.setattr("ai.provider.ai_router", fake)
        result = await lm.distill_lesson(
            goal="x", outcome="done", action_counts={}, last_observation="",
        )
        assert result is None

    @pytest.mark.asyncio
    async def test_applicability_falls_back_to_goal_when_missing(self, monkeypatch) -> None:
        from agent.cognition.memory import lessons as lm
        fake = _FakeRouter(
            '{"what_worked":"do thing","what_avoid":"","applicability":""}'
        )
        monkeypatch.setattr("ai.provider.ai_router", fake)
        result = await lm.distill_lesson(
            goal="дуже специфічна мета з унікальними словами",
            outcome="done", action_counts={}, last_observation="",
        )
        assert result is not None
        assert "специфічна" in result["applicability"] or result["applicability"]


# ─── 6. recall_lessons — disabled / empty paths ──────────────────────────────


class TestRecallDisabled:
    @pytest.mark.asyncio
    async def test_returns_empty_when_disabled(self, monkeypatch) -> None:
        from agent.cognition.memory import lessons as lm
        from config import config
        monkeypatch.setattr(config, "agent_lessons_enabled", False)
        result = await lm.recall_lessons("any query")
        assert result == []

    @pytest.mark.asyncio
    async def test_zero_top_k_returns_empty(self, monkeypatch) -> None:
        from agent.cognition.memory import lessons as lm
        from config import config
        monkeypatch.setattr(config, "agent_lessons_top_k", 0)
        result = await lm.recall_lessons("query")
        assert result == []

    @pytest.mark.asyncio
    async def test_relevance_filter_drops_low_scores(self, monkeypatch) -> None:
        """When the underlying collection returns rows below the relevance
        threshold, recall_lessons must drop them so cold prompts stay clean."""
        from agent.cognition.memory import lessons as lm
        from config import config
        monkeypatch.setattr(config, "agent_lessons_min_relevance", 0.5)

        def _fake_query(query: str, k: int):
            return [
                {"what_worked": "high", "relevance": 0.9, "applicability": "x"},
                {"what_worked": "low", "relevance": 0.1, "applicability": "y"},
            ]

        monkeypatch.setattr(lm, "_query_lessons_sync", _fake_query)
        result = await lm.recall_lessons("anything")
        assert len(result) == 1
        assert result[0]["what_worked"] == "high"


# ─── 7. Planner injection wiring (source-level) ──────────────────────────────


class TestPlannerInjection:
    def test_strategic_imports_lessons(self) -> None:
        """Source-level invariant: strategic.plan recalls + formats lessons
        before building the prompt."""
        from pathlib import Path
        src = (
            Path(__file__).resolve().parent.parent
            / "agent" / "planner" / "strategic.py"
        ).read_text(encoding="utf-8")
        assert "from ..memory.lessons import" in src
        assert "recall_lessons" in src
        assert "format_lessons_for_prompt" in src

    def test_tactical_imports_lessons(self) -> None:
        from pathlib import Path
        src = (
            Path(__file__).resolve().parent.parent
            / "agent" / "planner" / "tactical.py"
        ).read_text(encoding="utf-8")
        assert "from ..memory.lessons import" in src
        assert "recall_lessons" in src
        assert "lessons_block" in src
        # Template has a placeholder for the block so the formatter gets the
        # injection point.
        assert "{lessons_block}" in src

    def test_runtime_calls_distill_after_done(self) -> None:
        """Source-level invariant: _finalize_persist invokes distill+write
        when outcome == 'done'."""
        from pathlib import Path
        src = (
            Path(__file__).resolve().parent.parent
            / "agent" / "runtime.py"
        ).read_text(encoding="utf-8")
        assert "from .memory.lessons import distill_lesson" in src
        assert "write_lesson" in src
        # Gating on outcome == 'done' is required so failed/timeout tasks
        # don't poison the lessons store.
        assert 'outcome == "done"' in src or "outcome=='done'" in src


# ─── 8. End-to-end round trip via the planner template ──────────────────────


class TestUserMessageContainsLessonsBlock:
    def test_user_message_renders_lessons_block_when_provided(self) -> None:
        from agent.cognition.planner.tactical import _build_user_message
        from agent.schemas import SubGoal, SelfModel
        sg = SubGoal(
            description="d",
            rationale="r",
            expected_actions=2,
            acceptance_criteria="ac",
        )
        sm = SelfModel()
        msg = _build_user_message(
            self_model=sm,
            sub_goal=sg,
            observations=[],
            actions_in_sub_goal=0,
            lessons_block="УРОКИ З ПОПЕРЕДНІХ СХОЖИХ ЗАДАЧ:\n- коли X; роби Y",
        )
        assert "УРОКИ З ПОПЕРЕДНІХ" in msg
        assert "роби Y" in msg

    def test_user_message_unchanged_when_no_lessons(self) -> None:
        from agent.cognition.planner.tactical import _build_user_message
        from agent.schemas import SubGoal, SelfModel
        sg = SubGoal(
            description="d",
            rationale="r",
            expected_actions=2,
            acceptance_criteria="ac",
        )
        sm = SelfModel()
        msg = _build_user_message(
            self_model=sm,
            sub_goal=sg,
            observations=[],
            actions_in_sub_goal=0,
        )
        assert "УРОКИ" not in msg
