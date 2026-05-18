"""voice.listen — agent waits for the user to say something.

Phase 23-A companion to ``voice.say``: instead of passively reacting
when speech happens to land in chat, the agent can step ``voice.listen``
and pause until the next finalized transcript arrives (or the timeout
elapses). Useful for short prompts in a multi-step plan, e.g.::

    1. voice.say(text="Готовий, шеф. Що зробити?")
    2. voice.listen(timeout_s=10)
    3. plan based on the transcript that step 2 returned

Wire-in: ``api.routes_voice_stream._VoiceSession.send`` re-emits every
voice event on ``event_bus`` under the channel ``voice.event``. This
action subscribes for the duration of one execute() call, awaits a
``type == "final"`` (or "final_revised") payload, and returns the
transcript as the action's output. The bus subscription is always
torn down — the action neither leaks handlers nor holds a reference
between steps.

Quietness contract: unlike ``voice.say``, listening doesn't make
noise itself, so we don't gate on GHOST/SHADOW. We DO require the
voice subsystem to actually be capturing audio (``voice_mode != "off"``)
— otherwise no transcript will ever arrive and we'd burn the timeout
silently. Returning ``ok=False`` early lets the planner pick another
approach instead of a 30-second stall.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, ClassVar

from pydantic import Field

from ..schemas import ActionResult, RiskLevel
from .base import Action, ActionContext

logger = logging.getLogger(__name__)


# Event types that end a listen window. ``final`` is the canonical one;
# ``final_revised`` lands when the Whisper-refine pass disagrees enough
# with the live Vosk transcript to overwrite it (Phase 13b). Both carry
# `transcript` and `confidence` fields.
TERMINAL_EVENT_TYPES = {"final", "final_revised"}


class VoiceListen(Action):
    """Block until the next user transcript or the timeout fires."""

    name: ClassVar[str] = "voice.listen"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    requires_consent: ClassVar[bool] = False
    reversible: ClassVar[bool] = True  # purely observational

    # Block B — resource declarations. STT engine (faster-whisper) peaks
    # at ~1.5 GB RAM when loading the medium model on first call.
    estimated_peak_ram_mb: ClassVar[int] = 1500
    requires_network: ClassVar[bool] = False
    estimated_wall_seconds: ClassVar[int] = 10

    timeout_s: float = Field(
        default=15.0, gt=0.0, le=120.0,
        description="How long to wait for a transcript before giving up.",
    )
    min_confidence: float = Field(
        default=0.0, ge=0.0, le=1.0,
        description=(
            "Minimum acceptable confidence on the returned transcript. "
            "Below this, we keep waiting until the timeout. Use 0 to "
            "accept anything the recognizer emits."
        ),
    )
    require_substring: str = Field(
        default="",
        description=(
            "Optional case-insensitive substring filter — listen ignores "
            "transcripts that don't contain this. Leave empty to accept "
            "any transcript."
        ),
    )

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()

        # --- voice subsystem availability gate --------------------------------
        from config import config as cfg

        if cfg.voice_mode == "off":
            return ActionResult(
                ok=False,
                output={
                    "reason": "voice_mode_off",
                    "hint": "set voice_mode to continuous or wake_word",
                },
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        # --- bus subscription -------------------------------------------------
        # We resolve the future from inside the handler, then unsubscribe
        # before returning so we never leave a dangling listener bound to
        # this stack frame. Using a future (not a queue) means: only the
        # FIRST acceptable transcript matters; later events are ignored.
        loop = asyncio.get_running_loop()
        future: asyncio.Future[dict[str, Any]] = loop.create_future()
        require_sub = self.require_substring.strip().lower()

        def _on_voice_event(payload: Any) -> None:
            if future.done():
                return
            if not isinstance(payload, dict):
                return
            if payload.get("type") not in TERMINAL_EVENT_TYPES:
                return
            transcript = (payload.get("transcript") or "").strip()
            if not transcript:
                return
            confidence = float(payload.get("confidence") or 0.0)
            if confidence < self.min_confidence:
                return
            if require_sub and require_sub not in transcript.lower():
                return
            future.set_result(
                {
                    "transcript": transcript,
                    "confidence": confidence,
                    "source": payload.get("source", ""),
                    "type": payload.get("type"),
                }
            )

        from core.event_bus import event_bus
        unsubscribe = event_bus.subscribe("voice.event", _on_voice_event)

        try:
            try:
                result = await asyncio.wait_for(future, timeout=self.timeout_s)
            except asyncio.TimeoutError:
                return ActionResult(
                    ok=False,
                    output={
                        "reason": "timeout",
                        "timeout_s": self.timeout_s,
                        "hint": (
                            "no acceptable transcript in window — user "
                            "may be silent or below min_confidence"
                        ),
                    },
                    side_effects=[],
                    elapsed_ms=int((time.monotonic() - t0) * 1000),
                )
        finally:
            try:
                unsubscribe()
            except Exception as exc:
                logger.debug("voice.listen unsubscribe failed: %s", exc)

        return ActionResult(
            ok=True,
            output=result,
            side_effects=[
                f"heard: {result['transcript'][:80]}"
                f"{'…' if len(result['transcript']) > 80 else ''}"
            ],
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
