"""
Action registry — name → Action class.

Central catalog so the planner can introspect available capabilities and the
executor can construct the right action from an LLM-supplied (name, args).
"""
from __future__ import annotations

from typing import Type

from pydantic import ValidationError
from pydantic_core import PydanticUndefined

from ..schemas import RiskLevel
from .ask_user import AskUser
from .base import Action
from .bash import BashRun
from .browser import BrowserClickByDescription, BrowserExtract, BrowserNavigate
from .device import (
    ATSPIClickByLabel, ATSPIFindByLabel,
    BlenderRun, ESP32Haptic, ESP32OLEDText, ESP32RGB,
    GameInputBurst, ScreenCapture, ScreenClick,
    ScreenKeyCombo, ScreenOCR, ScreenScroll, ScreenType,
)
from .fs import FsRead, FsWrite
from .net import NetScan
from .notify import NotifyDesktop
from .process import ProcessList
from .research import WebResearch
from .self_introspect import SelfCapability, SelfRecall
from .time_ import TimeWait
from .voice_listen import VoiceListen
from .voice_say import VoiceSay
from .vision import SeeScreen
from .visual import (
    VisualClickTarget, VisualFindTarget, VisualSceneDescribe, VisualWaitFor,
)
from .esp32_aim import ESP32BuzzerAlert, ESP32ServoAim
from .delegate import AgentDelegate
from .map import MAP_ACTIONS
from .web import WebSearch

_REGISTERED: list[Type[Action]] = [
    FsRead, FsWrite,
    BashRun,
    BrowserNavigate, BrowserExtract, BrowserClickByDescription,
    NetScan,
    ProcessList,
    NotifyDesktop,
    TimeWait,
    SelfCapability, SelfRecall,
    WebSearch,
    # Phase 17a.5 — typed prompt to the operator.
    AskUser,
    # Phase 17a.5 — iterative corroboration search.
    WebResearch,
    # Phase 18 — desktop / screen / ESP32 actor control.
    ScreenCapture, ScreenOCR,
    ScreenClick, ScreenType, ScreenKeyCombo, ScreenScroll,
    ESP32Haptic, ESP32RGB, ESP32OLEDText,
    # Phase 18 — long-running headless apps + high-frequency game input.
    BlenderRun, GameInputBurst,
    # Phase 18-COMPLETE — semantic UI targeting via AT-SPI.
    ATSPIFindByLabel, ATSPIClickByLabel,
    # Phase 23-A — agent-initiated voice. `voice.say` lets a step emit
    # synthesized speech (gated on GHOST/SHADOW unless force=True);
    # `voice.listen` blocks until the next user transcript arrives via
    # the always-on pipeline event_bus republisher.
    VoiceSay, VoiceListen,
    # Phase 23-B — agent-initiated vision via Gemini multimodal.
    SeeScreen,
    # Phase 23-C — agent-driven ESP32 servo aim + buzzer alert.
    ESP32ServoAim, ESP32BuzzerAlert,
    # Phase 24-V — visual acting layer. Composes screen capture +
    # OmniParser grounding + desktop_control into description-based
    # find / click / wait / scene-describe so the planner can name UI
    # in natural language without ever reasoning about pixel coords.
    VisualFindTarget, VisualClickTarget, VisualWaitFor, VisualSceneDescribe,
    # Phase 24-B — `map.*` agent action surface. 12 verbs, every
    # mutation broadcast on the `"map"` WS channel via
    # `agent.actions.map._common.broadcast_map_mutation`.
    *MAP_ACTIONS,
    # Phase 26-A — agent.delegate primitive. Lets the planner spawn
    # specialist sub-agents (senior_backend, reviewer, researcher,
    # etc.), await their TaskReports, and merge results back as
    # Observations. The mechanism that turns the single-loop agent
    # into a real team. Recursion + concurrency capped via
    # agent_max_delegation_depth + agent_max_team_concurrency.
    AgentDelegate,
]


class ActionRegistry:
    def __init__(self) -> None:
        self._by_name: dict[str, Type[Action]] = {cls.name: cls for cls in _REGISTERED}

    def all(self) -> list[Type[Action]]:
        return list(self._by_name.values())

    def names(self) -> list[str]:
        return list(self._by_name.keys())

    def get(self, name: str) -> Type[Action] | None:
        return self._by_name.get(name)

    def build(self, name: str, args: dict) -> Action:
        cls = self.get(name)
        if cls is None:
            raise KeyError(f"Unknown action: {name}")
        try:
            return cls(**args)
        except ValidationError as exc:
            raise ValueError(f"bad_args for {name}: {exc.errors()}") from exc

    def catalog(self) -> list[dict]:
        """Compact catalog for planner prompt — name + risk + arg signatures."""
        out = []
        for cls in self._by_name.values():
            fields = {}
            for fname, finfo in cls.model_fields.items():
                # Pull a stable representation of the type
                anno = finfo.annotation
                ann_str = getattr(anno, "__name__", None) or str(anno)
                default = finfo.default
                if default is PydanticUndefined or default is ...:
                    default = None
                fields[fname] = {
                    "type": ann_str,
                    "default": default,
                    "required": finfo.is_required(),
                    "description": finfo.description or "",
                }
            out.append({
                "name": cls.name,
                "risk_level": int(cls.risk_level),
                "risk_label": RiskLevel(cls.risk_level).name,
                "args": fields,
                "reversible": bool(cls.reversible),
            })
        return out


registry = ActionRegistry()
