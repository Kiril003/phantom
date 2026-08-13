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

* **Доставка.** Через `voice/incremental_tts.py`, тим самим шляхом, що й
  відповідь у чаті. Раніше тут був власний шлях: ціла репліка синтезувалась
  однією брилою і йшла в канал ``agent.stream`` подією ``voice_say``. Її не
  грав НІХТО — у фронтенді немає жодного споживача цієї події, — а дія при
  цьому поверталась ok=True зі словами «spoke: …». Разом із тим брилу не
  можна було ані спинити (жодної точки між реченнями), ані показати фільтру
  самопрослуховування — тож власний голос PHANTOM міг повернутись із
  мікрофона й лягти в чат як слова оператора.

  Канал ``chat``/``tts.sentence`` — єдиний, у якого є програвач
  (`services/ttsPlayer.ts`), єдиний, що реєструється в `voice/speaking_floor.py`
  (отже, спиняється перехопленням), і єдиний, що називає реєстрові свій
  текст. Голосовий WS для цього не годиться: ``voice_mode`` типово ``off``,
  тож на типовій машині проактивна мова просто зникла б.
"""
from __future__ import annotations

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

    # Piper is the current local TTS runtime; keep a conservative resource
    # declaration for first-call model load and synthesis.
    estimated_peak_ram_mb: ClassVar[int] = 512
    requires_network: ClassVar[bool] = False
    estimated_wall_seconds: ClassVar[int] = 10

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

        # --- чи вільна підлога --------------------------------------------------
        # Нагадування не ріже відповідь оператора на півслові: планувальник
        # перепитає наступним тиком, точно як на тихих станах.
        from voice.speaking_floor import speaking_floor

        if speaking_floor.is_speaking(ctx.user_id):
            return ActionResult(
                ok=False,
                output={
                    "reason": "voice_busy",
                    "hint": "PHANTOM говорить — спробувати наступним тиком",
                },
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        # --- сказати вголос -----------------------------------------------------
        from voice import incremental_tts

        message_id = f"say-{ctx.task_id}-{ctx.step_idx}"
        speaker = None
        try:
            speaker = await incremental_tts.start_speaker(
                ctx.user_id, message_id, ctx.task_id,
                voice=self.voice.strip(),
                speed=self.speed if self.speed > 0 else 0.0,
            )
            await speaker.feed(self.text)
            await speaker.finish()
            finished = await speaker.wait_done()
        except Exception as exc:
            logger.warning("voice.say delivery failed: %s", exc)
            if speaker is not None:
                await speaker.cancel(notify=False)
            return ActionResult(
                ok=False,
                output={"reason": "tts_failed", "error": str(exc)},
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        # Заявляти «сказав» можна лише за тим, що справді пішло в ефір.
        spoken = speaker.spoken_sentences

        # Phase 18 E-5 sibling — count proactive utterances separately so the
        # /metrics endpoint can distinguish "agent spoke" from "user asked
        # for TTS". Counter is created on demand to keep this action
        # importable in environments without prometheus.
        # Лічильник рахує сказане, а не спробуване: тиша не є реплікою.
        if spoken > 0:
            try:
                from observability import voice_tts_total
                voice_tts_total.inc()
            except Exception:
                pass

        said = f"{self.text[:80]}{'…' if len(self.text) > 80 else ''}"
        return ActionResult(
            ok=spoken > 0,
            output={
                "sentences_spoken": spoken,
                "interrupted": not finished,
                "voice": self.voice.strip() or "auto",
                "delivered_via": "chat_tts" if spoken else "none",
                **({} if spoken else {"reason": "nothing_spoken"}),
            },
            side_effects=[f"spoke: {said}"] if spoken else [],
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
