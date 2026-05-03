"""
Phase 24-V — Visual Acting Layer.

Four agent actions that close the see→target→act loop using natural-
language descriptions instead of pixel coordinates:
  • visual.find_target    — SAFE — describe → (x,y)
  • visual.click_target   — LOW  — describe → click
  • visual.wait_for       — SAFE — poll until visible
  • visual.scene_describe — SAFE — list every element on screen

Tests cover registration, happy path, both classes of grounder
failure (unavailable / target_not_found), wait_for timeout discipline,
and the find-then-act atomic property of click_target.
"""
from __future__ import annotations

import asyncio
import os
import time
from typing import Any

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase24v")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


from agent.actions.base import ActionContext  # noqa: E402
from agent.actions.visual import (  # noqa: E402
    VisualClickTarget,
    VisualFindTarget,
    VisualSceneDescribe,
    VisualWaitFor,
)


def _ctx() -> ActionContext:
    return ActionContext(task_id="t-24v", step_idx=0, workspace_dir="/tmp")


# ─── 1. Registration ────────────────────────────────────────────────────────


class TestRegistration:
    def test_all_four_in_registry(self) -> None:
        from agent.actions.registry import registry
        for name in (
            "visual.find_target",
            "visual.click_target",
            "visual.wait_for",
            "visual.scene_describe",
        ):
            cls = registry.get(name)
            assert cls is not None, f"{name} missing from registry"

    def test_risk_levels_match_intent(self) -> None:
        """find/wait/scene are SAFE (no side effects). click is LOW (it
        triggers an observable mouse event but is recoverable)."""
        from agent.actions.registry import registry
        from agent.schemas import RiskLevel
        assert registry.get("visual.find_target").risk_level == RiskLevel.SAFE
        assert registry.get("visual.wait_for").risk_level == RiskLevel.SAFE
        assert registry.get("visual.scene_describe").risk_level == RiskLevel.SAFE
        assert registry.get("visual.click_target").risk_level == RiskLevel.LOW


# ─── 2. find_target ─────────────────────────────────────────────────────────


class _FakeGrounder:
    """Stand-in for OmniParserGrounder used in find/click tests."""

    def __init__(self, *, coords=(123, 456), raises=None) -> None:
        self._coords = coords
        self._raises = raises
        self.calls: list[dict[str, Any]] = []

    async def resolve_coords(self, *, description, expected_type, page=None):
        self.calls.append({
            "description": description,
            "expected_type": expected_type,
            "page": page,
        })
        if self._raises is not None:
            raise self._raises
        return self._coords


class TestFindTarget:
    @pytest.mark.asyncio
    async def test_happy_path_returns_coords(self, monkeypatch) -> None:
        fake = _FakeGrounder(coords=(100, 200))
        monkeypatch.setattr(
            "vision.grounding.OmniParserGrounder", lambda *a, **k: fake
        )
        action = VisualFindTarget(description="Submit button", expected_type="button")
        result = await action.execute(_ctx())
        assert result.ok is True
        assert result.output == {
            "x": 100, "y": 200,
            "description": "Submit button",
            "expected_type": "button",
        }
        assert len(fake.calls) == 1
        assert fake.calls[0]["description"] == "Submit button"

    @pytest.mark.asyncio
    async def test_grounding_failed_yields_target_not_found(self, monkeypatch) -> None:
        from vision.grounding import GroundingFailed
        monkeypatch.setattr(
            "vision.grounding.OmniParserGrounder",
            lambda *a, **k: _FakeGrounder(raises=GroundingFailed("no match"))
        )
        action = VisualFindTarget(description="ghost element", expected_type="any")
        result = await action.execute(_ctx())
        assert result.ok is False
        assert result.error_class == "target_not_found"
        assert "no match" in (result.error or "")

    @pytest.mark.asyncio
    async def test_grounding_unavailable_distinct_class(self, monkeypatch) -> None:
        """Unavailable (parser not installed) and not-found (parser ran
        but missed) are different errors so the planner can react
        differently — escalate vs refine description."""
        from vision.grounding import GroundingUnavailable
        monkeypatch.setattr(
            "vision.grounding.OmniParserGrounder",
            lambda *a, **k: _FakeGrounder(raises=GroundingUnavailable("no omni"))
        )
        action = VisualFindTarget(description="xx", expected_type="any")
        result = await action.execute(_ctx())
        assert result.ok is False
        assert result.error_class == "grounding_unavailable"

    @pytest.mark.asyncio
    async def test_arbitrary_exception_caught_as_grounding_error(self, monkeypatch) -> None:
        monkeypatch.setattr(
            "vision.grounding.OmniParserGrounder",
            lambda *a, **k: _FakeGrounder(raises=RuntimeError("boom"))
        )
        action = VisualFindTarget(description="xx", expected_type="any")
        result = await action.execute(_ctx())
        assert result.ok is False
        assert result.error_class == "grounding_error"
        assert "boom" in (result.error or "")


# ─── 3. click_target — find-then-act atomicity ──────────────────────────────


class TestClickTarget:
    @pytest.mark.asyncio
    async def test_happy_path_finds_then_clicks(self, monkeypatch) -> None:
        fake = _FakeGrounder(coords=(300, 400))
        monkeypatch.setattr(
            "vision.grounding.OmniParserGrounder", lambda *a, **k: fake
        )
        clicks: list[dict[str, Any]] = []

        async def _click(x, y, *, button="left"):
            clicks.append({"x": x, "y": y, "button": button})
            return True

        async def _double_click(x, y, *, button="left"):
            clicks.append({"x": x, "y": y, "button": button, "double": True})
            return True

        monkeypatch.setattr("input.desktop_control.click", _click)
        monkeypatch.setattr("input.desktop_control.double_click", _double_click)

        action = VisualClickTarget(
            description="Order button",
            expected_type="button",
            button="left",
        )
        result = await action.execute(_ctx())
        assert result.ok is True
        assert "mouse_click" in result.side_effects
        assert clicks == [{"x": 300, "y": 400, "button": "left"}]

    @pytest.mark.asyncio
    async def test_double_click_dispatches_correct_backend(self, monkeypatch) -> None:
        fake = _FakeGrounder(coords=(50, 60))
        monkeypatch.setattr(
            "vision.grounding.OmniParserGrounder", lambda *a, **k: fake
        )
        called: list[str] = []

        async def _click(x, y, *, button="left"):
            called.append("single")
            return True

        async def _double_click(x, y, *, button="left"):
            called.append("double")
            return True

        monkeypatch.setattr("input.desktop_control.click", _click)
        monkeypatch.setattr("input.desktop_control.double_click", _double_click)

        action = VisualClickTarget(
            description="file icon", expected_type="icon", double=True,
        )
        result = await action.execute(_ctx())
        assert result.ok is True
        assert called == ["double"]

    @pytest.mark.asyncio
    async def test_find_failure_short_circuits_no_click_emitted(self, monkeypatch) -> None:
        """If the grounder doesn't find the target, the click backend
        must NOT be called. Critical: a phantom click on (0,0) would be
        worse than reporting failure."""
        from vision.grounding import GroundingFailed
        monkeypatch.setattr(
            "vision.grounding.OmniParserGrounder",
            lambda *a, **k: _FakeGrounder(raises=GroundingFailed("nope"))
        )
        clicks: list[Any] = []

        async def _click(x, y, *, button="left"):
            clicks.append((x, y))
            return True

        monkeypatch.setattr("input.desktop_control.click", _click)
        action = VisualClickTarget(description="ghost", expected_type="any")
        result = await action.execute(_ctx())
        assert result.ok is False
        assert clicks == [], "no click must be emitted when target not found"

    @pytest.mark.asyncio
    async def test_click_backend_failure_propagates(self, monkeypatch) -> None:
        fake = _FakeGrounder(coords=(10, 20))
        monkeypatch.setattr(
            "vision.grounding.OmniParserGrounder", lambda *a, **k: fake
        )

        async def _click(*_a, **_kw):
            raise RuntimeError("xdotool missing")

        monkeypatch.setattr("input.desktop_control.click", _click)
        action = VisualClickTarget(description="xx", expected_type="any")
        result = await action.execute(_ctx())
        assert result.ok is False
        assert result.error_class == "RuntimeError"


# ─── 4. wait_for — polling discipline ───────────────────────────────────────


class TestWaitFor:
    @pytest.mark.asyncio
    async def test_appears_before_timeout(self, monkeypatch) -> None:
        """Grounder fails twice then succeeds — wait_for must succeed
        on the third attempt and report attempts=3."""
        from vision.grounding import GroundingFailed

        attempts = {"n": 0}

        class _Sequenced:
            async def resolve_coords(self, *, description, expected_type, page=None):
                attempts["n"] += 1
                if attempts["n"] < 3:
                    raise GroundingFailed("not yet")
                return (10, 20)

        monkeypatch.setattr(
            "vision.grounding.OmniParserGrounder", lambda *a, **k: _Sequenced()
        )
        action = VisualWaitFor(
            description="Spinner gone, OK button",
            expected_type="button",
            timeout_s=5.0,
            poll_ms=100,
        )
        result = await action.execute(_ctx())
        assert result.ok is True
        assert result.output["attempts"] == 3
        assert result.output["x"] == 10

    @pytest.mark.asyncio
    async def test_timeout_returns_wait_timeout_class(self, monkeypatch) -> None:
        from vision.grounding import GroundingFailed

        class _AlwaysFail:
            async def resolve_coords(self, **_kw):
                raise GroundingFailed("never appears")

        monkeypatch.setattr(
            "vision.grounding.OmniParserGrounder", lambda *a, **k: _AlwaysFail()
        )
        action = VisualWaitFor(
            description="ghost", expected_type="any",
            timeout_s=0.6, poll_ms=200,
        )
        started = time.monotonic()
        result = await action.execute(_ctx())
        elapsed = time.monotonic() - started
        assert result.ok is False
        assert result.error_class == "wait_timeout"
        # Bounded — must not exceed timeout by more than one poll interval.
        assert elapsed < 0.6 + 0.5

    @pytest.mark.asyncio
    async def test_poll_ms_floor_and_ceiling(self) -> None:
        """Pydantic validation rejects unreasonable poll intervals so a
        misconfigured action can't busy-loop the agent CPU."""
        with pytest.raises(Exception):
            VisualWaitFor(description="x", poll_ms=5)  # below ge=100
        with pytest.raises(Exception):
            VisualWaitFor(description="x", poll_ms=99999)  # above le=5000


# ─── 5. scene_describe ──────────────────────────────────────────────────────


class _FakeElement:
    def __init__(self, type_, text, x, y):
        self.type = type_
        self.text = text
        self._x = x
        self._y = y

    def center(self):
        return (self._x, self._y)


class TestSceneDescribe:
    @pytest.mark.asyncio
    async def test_returns_bounded_element_list(self, monkeypatch) -> None:
        elements = [
            _FakeElement("button", "Замовити", 100, 200),
            _FakeElement("input", "Email", 100, 300),
            _FakeElement("link", "Назад", 50, 50),
        ]

        class _FakeOmni:
            async def parse(self, *, page=None):
                return list(elements)

        monkeypatch.setattr(
            "vision.grounding.OmniParserV2", lambda *a, **k: _FakeOmni()
        )
        action = VisualSceneDescribe(max_elements=10)
        result = await action.execute(_ctx())
        assert result.ok is True
        assert result.output["count"] == 3
        kinds = [e["type"] for e in result.output["elements"]]
        assert kinds == ["button", "input", "link"]
        assert result.output["elements"][0]["text"] == "Замовити"

    @pytest.mark.asyncio
    async def test_max_elements_cap_enforced(self, monkeypatch) -> None:
        big = [_FakeElement("any", f"el{i}", i, i) for i in range(50)]

        class _FakeOmni:
            async def parse(self, *, page=None):
                return list(big)

        monkeypatch.setattr(
            "vision.grounding.OmniParserV2", lambda *a, **k: _FakeOmni()
        )
        action = VisualSceneDescribe(max_elements=5)
        result = await action.execute(_ctx())
        assert result.ok is True
        assert result.output["count"] == 5

    @pytest.mark.asyncio
    async def test_grounding_unavailable_caught(self, monkeypatch) -> None:
        from vision.grounding import GroundingUnavailable

        class _Boom:
            async def parse(self, **_kw):
                raise GroundingUnavailable("OmniParser not installed")

        monkeypatch.setattr(
            "vision.grounding.OmniParserV2", lambda *a, **k: _Boom()
        )
        action = VisualSceneDescribe()
        result = await action.execute(_ctx())
        assert result.ok is False
        assert result.error_class == "grounding_unavailable"


# ─── 6. Validation — guards against LLM hallucinations ──────────────────────


class TestValidation:
    def test_description_min_length_enforced(self) -> None:
        with pytest.raises(Exception):
            VisualFindTarget(description="x")  # min_length=2 — single char must fail

    def test_button_pattern_enforced(self) -> None:
        with pytest.raises(Exception):
            VisualClickTarget(description="ok", button="middle-left")

    def test_wait_for_timeout_capped(self) -> None:
        with pytest.raises(Exception):
            VisualWaitFor(description="x", timeout_s=999.0)
