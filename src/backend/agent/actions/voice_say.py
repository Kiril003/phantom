"""voice.say — agent-initiated speech.

Phase 23-A: until now the agent could only respond after the user spoke;
``voice.say`` lets a step in the agent loop emit synthesized audio of its
own accord (e.g. a standing-order reminder, a finished-task chime with a
spoken acknowledgement, or a proactive nudge).

Design notes:

* **Quietness contract.** GHOST and SHADOW system-states must stay silent
  by default — those are the "I am invisible" / "background watch" modes.
  The action returns ``ok=False, output={"reason": "..."} `` instead of
  speaking, and the planner treats that as a soft skip (the standing-order
  runner will retry next tick when the state may have changed).

* **Config gates.** ``voice_tts_enabled`` is the master switch. When false
  we behave the same as GHOST — silent skip, never raise. We also respect
  ``voice_tts_voice`` (per-call ``voice`` arg overrides) and the cyrillic
  auto-voice picker for empty ``voice``.

* **Delivery.** Audio is streamed to the frontend via the existing
  ``agent.stream`` WS channel as base64 WAV — the existing voice queue
  client (used for /voice/tts replies) plays it. We don't try to dump
  audio to the local sound card from inside the action: the operator
  surface is the browser tab on the Radxa display, and that already
  has working audio output.
"""
from __future__ import annotations

import base64
import logging
import time
from typing import ClassVar

from pydantic import Field

from ..schemas import ActionResult, RiskLevel
from .base import Action, ActionContext

logger = logging.getLogger(__name__)


# System states where proactive speech is muted by default. The operator
# can still ask the agent to speak — this only affects unsolicited audio.
SILENT_STATES = {"GHOST", "SHADOW"}


class VoiceSay(Action):
    """Synthesize and emit a spoken line."""

    name: ClassVar[str] = "voice.say"
    # LOW because it produces audible output the operator's environment may
    # not expect (e.g. someone else in the room overhears). Not SAFE.
    risk_level: ClassVar[RiskLevel] = RiskLevel.LOW
    requires_consent: ClassVar[bool] = False
    reversible: ClassVar[bool] = False

    text: str = Field(
        ..., min_length=1, max_length=512,
        description="What to say. Keep short — proactive speech is friction.",
    )
    voice: str = Field(
        default="",
        description="Override TTS voice. Empty = auto-pick UA/EN by content.",
    )
    speed: float = Field(
        default=0.0,
        ge=0.0, le=3.0,
        description="Override TTS speed. 0 = use voice_tts_speed setting.",
    )
    force: bool = Field(
        default=False,
        description=(
            "Bypass the GHOST/SHADOW silence guard. Use only when the "
            "operator explicitly requested speech (e.g. they asked a "
            "question that needs a spoken answer regardless of mode)."
        ),
    )

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()

        # --- master config gate -------------------------------------------------
        from config import config as cfg

        if not cfg.voice_tts_enabled:
            return ActionResult(
                ok=False,
                output={
                    "reason": "voice_tts_disabled",
                    "hint": "voice_tts_enabled is False in settings",
                },
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        # --- system-state guard -------------------------------------------------
        # The state machine is a singleton; importing it lazily keeps
        # this action import-safe in test envs that mock the runtime.
        if not self.force:
            try:
                from core.state_machine import state_machine
                # `current_state` is a @property — never call it.
                current = state_machine.current_state
            except Exception:
                # Not having a state machine should never silence speech
                # — that's a worse failure mode than speaking when we
                # shouldn't. Default to "speak" if we can't tell.
                current = None
            if current in SILENT_STATES:
                return ActionResult(
                    ok=False,
                    output={
                        "reason": "silent_state",
                        "state": current,
                        "hint": "set force=True to override",
                    },
                    side_effects=[],
                    elapsed_ms=int((time.monotonic() - t0) * 1000),
                )

        # --- voice + speed resolution ------------------------------------------
        if self.voice.strip():
            voice = self.voice.strip()
        else:
            try:
                from voice.tts_engine import select_voice_for_text
                voice = select_voice_for_text(self.text)
            except Exception:
                voice = cfg.voice_tts_voice
        speed = self.speed if self.speed > 0 else cfg.voice_tts_speed

        # --- synthesize --------------------------------------------------------
        try:
            from voice.pipeline import synthesize_text
            result = await synthesize_text(self.text, voice, speed)
        except Exception as exc:
            logger.warning("voice.say synthesis failed: %s", exc)
            return ActionResult(
                ok=False,
                output={"reason": "tts_failed", "error": str(exc)},
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        # --- deliver to operator surface ---------------------------------------
        # Push audio over WS so the active browser tab plays it. We don't
        # await playback — the action is "spoken into the room" the moment
        # the WS frame leaves the server; downstream playback latency is
        # the operator's audio device, not ours.
        delivered = False
        try:
            from api.websocket_hub import hub
            audio_b64 = base64.b64encode(result.audio_wav).decode("ascii")
            await hub.broadcast(
                "agent.stream",
                "voice_say",
                {
                    "task_id": ctx.task_id,
                    "step_idx": ctx.step_idx,
                    "audio_b64": audio_b64,
                    "media_type": "audio/wav",
                    "engine": result.engine,
                    "voice": result.voice,
                    "sample_rate": result.sample_rate,
                    "text": self.text,
                },
            )
            delivered = True
        except Exception as exc:
            # Non-fatal: synthesis succeeded, only delivery failed. Caller
            # can read the side_effect to know we tried.
            logger.warning("voice.say delivery failed: %s", exc)

        # Phase 18 E-5 sibling — count proactive utterances separately so the
        # /metrics endpoint can distinguish "agent spoke" from "user asked
        # for TTS". Counter is created on demand to keep this action
        # importable in environments without prometheus.
        try:
            from observability import voice_tts_total
            voice_tts_total.inc()
        except Exception:
            pass

        return ActionResult(
            ok=delivered,
            output={
                "engine": result.engine,
                "voice": result.voice,
                "sample_rate": result.sample_rate,
                "wav_bytes": len(result.audio_wav),
                "delivered_via": "ws" if delivered else "none",
            },
            side_effects=[
                f"spoke: {self.text[:80]}{'…' if len(self.text) > 80 else ''}"
            ],
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
