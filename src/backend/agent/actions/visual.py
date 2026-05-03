"""
Phase 24-V — Visual Acting Layer.

Composes the screen-capture + grounding + desktop-control primitives that
already ship in `vision/screen_capture.py`, `vision/grounding.py` and
`input/desktop_control.py` into FOUR high-level agent actions:

  • visual.find_target  — "where is the X button?"  (SAFE, no side effects)
  • visual.click_target — "click the X button"      (LOW)
  • visual.wait_for     — "wait until X appears"    (SAFE, polling)
  • visual.scene_describe — "list everything you see" (SAFE, debugging)

Two design choices that make this strictly more useful than driving the
underlying primitives directly from the planner:

  1. **Description-based targeting.** The planner names UIs in natural
     language ("кнопка Замовити червоного кольору"); the grounder
     resolves it to (x,y) via DOM accessibility first, OmniParser V2
     fallback. Coordinates are an implementation detail that the LLM
     never has to reason about.

  2. **Find-then-act atomicity.** click_target wraps grounder + dc.click
     in one step so the LLM can't accidentally split the find from the
     click across LLM turns and have the screen change between them.

All four actions degrade gracefully when the underlying capture or
grounder primitives are unavailable (Wayland without grim, OmniParser
not installed, X11 without xdotool/ydotool/uinput): the action returns
ok=False with a `*_unavailable` error_class so the loop's reflector can
escalate to AskUser instead of crashing the task.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any, ClassVar

from pydantic import Field

from ..schemas import ActionResult, RiskLevel
from .base import Action, ActionContext


# ─── 1. find_target ─────────────────────────────────────────────────────────


class VisualFindTarget(Action):
    """Resolve a natural-language description to on-screen coordinates.

    Returns (x, y) plus the matching element's bounding box and confidence
    so the planner can decide whether to act, ask the user, or refine the
    description. NO side effects — the cursor does not move; nothing is
    clicked. Cheap to call repeatedly during a 'visual loop'."""

    name: ClassVar[str] = "visual.find_target"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    reversible: ClassVar[bool] = True

    description: str = Field(
        description="Natural-language description of the target element "
                    "('кнопка Замовити', 'червоний x у правому верхньому "
                    "кутку', 'поле Email').",
        min_length=2, max_length=300,
    )
    expected_type: str = Field(
        default="button",
        description="One of: button | link | input | text | image | "
                    "checkbox | dropdown | tab | menu | icon | any",
        max_length=40,
    )

    async def execute(self, ctx: ActionContext) -> ActionResult:
        try:
            from vision.grounding import (
                GroundingFailed,
                GroundingUnavailable,
                OmniParserGrounder,
            )
        except Exception as exc:
            return ActionResult(
                ok=False,
                error=f"grounding module unimportable: {exc}",
                error_class="grounding_unavailable",
            )

        grounder = OmniParserGrounder()
        started = time.monotonic()
        try:
            x, y = await grounder.resolve_coords(
                description=self.description,
                expected_type=self.expected_type,
                page=None,  # screen-grounded path; DOM path is browser-only
            )
        except GroundingUnavailable as exc:
            return ActionResult(
                ok=False,
                error=str(exc),
                error_class="grounding_unavailable",
                elapsed_ms=int((time.monotonic() - started) * 1000),
            )
        except GroundingFailed as exc:
            return ActionResult(
                ok=False,
                error=str(exc),
                error_class="target_not_found",
                elapsed_ms=int((time.monotonic() - started) * 1000),
            )
        except Exception as exc:
            return ActionResult(
                ok=False,
                error=f"grounder threw: {exc}",
                error_class="grounding_error",
                elapsed_ms=int((time.monotonic() - started) * 1000),
            )

        return ActionResult(
            ok=True,
            output={
                "x": int(x),
                "y": int(y),
                "description": self.description,
                "expected_type": self.expected_type,
            },
            elapsed_ms=int((time.monotonic() - started) * 1000),
        )


# ─── 2. click_target ─────────────────────────────────────────────────────────


class VisualClickTarget(Action):
    """Atomic find-then-click for the planner so the screen can't shift
    between the resolve step and the click step.

    Risk LOW: a click is observable but reversible (the operator can undo
    most clicks; only "submit"-class buttons fall under MEDIUM and the
    planner is expected to use confirm_with_user beforehand for those)."""

    name: ClassVar[str] = "visual.click_target"
    risk_level: ClassVar[RiskLevel] = RiskLevel.LOW
    reversible: ClassVar[bool] = False

    description: str = Field(
        description="Natural-language description of the click target.",
        min_length=2, max_length=300,
    )
    expected_type: str = Field(default="button", max_length=40)
    button: str = Field(default="left", pattern=r"^(left|middle|right)$")
    double: bool = False

    async def execute(self, ctx: ActionContext) -> ActionResult:
        # Step 1 — find via the same grounder VisualFindTarget uses.
        find = VisualFindTarget(
            description=self.description,
            expected_type=self.expected_type,
        )
        find_result = await find.execute(ctx)
        if not find_result.ok or not isinstance(find_result.output, dict):
            return find_result

        x = int(find_result.output.get("x", -1))
        y = int(find_result.output.get("y", -1))
        if x < 0 or y < 0:
            return ActionResult(
                ok=False,
                error="grounder returned invalid coordinates",
                error_class="bad_coords",
            )

        # Step 2 — perform the click via desktop_control.
        try:
            from input import desktop_control as dc
            if self.double:
                ok = await dc.double_click(x, y, button=self.button)
            else:
                ok = await dc.click(x, y, button=self.button)
        except Exception as exc:
            cls_name = type(exc).__name__
            return ActionResult(
                ok=False,
                error=f"click backend failed: {exc}",
                error_class=cls_name,
            )

        return ActionResult(
            ok=bool(ok),
            output={
                "x": x, "y": y,
                "button": self.button,
                "double": self.double,
                "description": self.description,
            },
            side_effects=["mouse_click"],
        )


# ─── 3. wait_for ────────────────────────────────────────────────────────────


class VisualWaitFor(Action):
    """Poll the screen until a target matching `description` appears or
    the timeout expires. Bounded so a missing element does not hang the
    task forever; reports the elapsed time so the planner can adjust."""

    name: ClassVar[str] = "visual.wait_for"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    reversible: ClassVar[bool] = True

    description: str = Field(min_length=2, max_length=300)
    expected_type: str = Field(default="any", max_length=40)
    timeout_s: float = Field(default=10.0, gt=0.0, le=120.0)
    poll_ms: int = Field(default=400, ge=100, le=5000)

    async def execute(self, ctx: ActionContext) -> ActionResult:
        started = time.monotonic()
        deadline = started + float(self.timeout_s)
        attempts = 0
        last_error: str | None = None

        while time.monotonic() < deadline:
            attempts += 1
            find = VisualFindTarget(
                description=self.description,
                expected_type=self.expected_type,
            )
            res = await find.execute(ctx)
            if res.ok and isinstance(res.output, dict):
                elapsed = time.monotonic() - started
                return ActionResult(
                    ok=True,
                    output={
                        **res.output,
                        "attempts": attempts,
                        "elapsed_s": round(elapsed, 3),
                    },
                    elapsed_ms=int(elapsed * 1000),
                )
            last_error = res.error
            # Don't oversleep past the deadline.
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            await asyncio.sleep(min(self.poll_ms / 1000.0, remaining))

        return ActionResult(
            ok=False,
            error=f"target '{self.description[:80]}' not found in "
                  f"{self.timeout_s:.1f}s ({attempts} attempts; "
                  f"last={last_error or 'unknown'})",
            error_class="wait_timeout",
            elapsed_ms=int((time.monotonic() - started) * 1000),
        )


# ─── 4. scene_describe ──────────────────────────────────────────────────────


class VisualSceneDescribe(Action):
    """Return every element the grounder currently sees on screen, sorted
    by readability. Lets the planner 'look around' before deciding what
    to click — analogous to a human scanning the screen.

    Output is bounded to `max_elements` so a busy screen doesn't blow
    the LLM context window on the next turn."""

    name: ClassVar[str] = "visual.scene_describe"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    reversible: ClassVar[bool] = True

    max_elements: int = Field(default=30, ge=1, le=100)

    async def execute(self, ctx: ActionContext) -> ActionResult:
        try:
            from vision.grounding import (
                GroundingUnavailable,
                OmniParserV2,
            )
        except Exception as exc:
            return ActionResult(
                ok=False,
                error=f"grounding module unimportable: {exc}",
                error_class="grounding_unavailable",
            )

        parser = OmniParserV2()
        started = time.monotonic()
        try:
            elements = await parser.parse(page=None)
        except GroundingUnavailable as exc:
            return ActionResult(
                ok=False,
                error=str(exc),
                error_class="grounding_unavailable",
                elapsed_ms=int((time.monotonic() - started) * 1000),
            )
        except Exception as exc:
            return ActionResult(
                ok=False,
                error=f"OmniParser threw: {exc}",
                error_class="parser_error",
                elapsed_ms=int((time.monotonic() - started) * 1000),
            )

        seen: list[dict[str, Any]] = []
        for el in elements[: int(self.max_elements)]:
            try:
                cx, cy = el.center()
            except Exception:
                cx, cy = -1, -1
            seen.append({
                "type": getattr(el, "type", "any"),
                "text": (getattr(el, "text", "") or "")[:120],
                "x": int(cx), "y": int(cy),
            })

        return ActionResult(
            ok=True,
            output={"elements": seen, "count": len(seen)},
            elapsed_ms=int((time.monotonic() - started) * 1000),
        )


__all__ = [
    "VisualFindTarget",
    "VisualClickTarget",
    "VisualWaitFor",
    "VisualSceneDescribe",
]
