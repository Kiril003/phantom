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
from .fs import FsRead, FsWrite, FsBackup, FsCodeSearch, FsPatchHash
from .lsp import LspDiagnostics, LspGotoDefinition, LspGetSymbols
from .net import NetScan
from .notify import NotifyDesktop
from .process import ProcessList
from .research import WebResearch
from .self_introspect import SelfCapability, SelfRecall
from .time_ import TimeWait
from .voice_listen import VoiceListen
from .voice_say import VoiceSay
from .vision import SeeCamera, SeeScreen
from .visual import (
    VisualClickTarget, VisualFindTarget, VisualSceneDescribe, VisualWaitFor,
)
from .esp32_aim import ESP32BuzzerAlert, ESP32ServoAim
from .delegate import AgentDelegate
from .team_assemble import AgentAssembleTeam
from .map import MAP_ACTIONS
from .web import WebSearch
from .git_checkpoint import GitCheckpoint, GitRollback
from .git_branch import GitBranchManage
from .mission_assets import MissionSnapshot
from .grounded import TestRun
from .intelligence import DistillFactsFromChats, ExcludeFactFromPrompts, IntelligenceUpsertKnowledge
from .synthesize_capability import SynthesizeCapability
from .optimize_capability import OptimizeCapability

_REGISTERED: list[Type[Action]] = [
    FsRead, FsWrite, FsBackup, FsCodeSearch, FsPatchHash,
    LspDiagnostics, LspGotoDefinition, LspGetSymbols,
    BashRun,
    BrowserNavigate, BrowserExtract, BrowserClickByDescription,
    NetScan,
    ProcessList,
    NotifyDesktop,
    TimeWait,
    SelfCapability, SelfRecall,
    WebSearch,
    GitCheckpoint, GitRollback, GitBranchManage,
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
    # Day-NN — physical camera vision via OpenCV + Gemini multimodal.
    # Closes the audit-flagged Level-4 gap: agent can finally LOOK at
    # the room, not just the desktop. Same JSON shape as SeeScreen.
    SeeCamera,
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
    # Phase 26-C — agent.assemble_team. High-level "delegate to a
    # whole team" verb that bundles picker + delegate + parallel
    # await + result consolidation. Three modes: auto (picker), department
    # (spawns matching team_lead which re-delegates to its seniors),
    # explicit (caller names roles).
    AgentAssembleTeam,
    # Vertical V10 — mission.snapshot. Captures a visual PNG from screen /
    # camera / blender / file, optionally describes it via Gemini multimodal,
    # stores it in the mission asset dir, and appends an image directive to
    # the active ledger phase section.
    MissionSnapshot,
    TestRun,
    # Vertical V11 — intelligence.distill_from_chats + intelligence.exclude_fact.
    # Distillation scans recent chat history via Gemini and proposes new personal
    # facts; exclude_fact toggles the exclude_from_prompts gate on a UserFact.
    DistillFactsFromChats,
    ExcludeFactFromPrompts,
    IntelligenceUpsertKnowledge,
    # V4 — self-synthesizing capability. When the planner identifies a gap
    # (no registered action fits a step) it emits a synthesize_capability step.
    # The action drafts a Python Action subclass via LLM, smoke-tests it in the
    # existing bwrap sandbox, and on green registers it into THIS registry so
    # subsequent steps can pick it immediately.
    SynthesizeCapability,
    # Phase 28-IDEAL — autonomous code optimization. Rewrites existing synth
    # actions to improve performance based on latency warnings.
    OptimizeCapability,
]


def _load_synth_actions() -> list[Type[Action]]:
    """Discover persisted _synth/*.py files and return importable Action classes.

    Called once at registry construction so synthesized actions from previous
    sessions are available immediately after boot. Errors on individual files
    are logged and skipped — a corrupt synth file must not block startup.
    """
    import importlib.util
    import sys
    import logging as _log
    from pathlib import Path
    from .base import Action as _Action

    _logger = _log.getLogger(__name__)
    synth_dir = Path(__file__).parent / "_synth"
    result: list[Type[_Action]] = []

    for py_file in sorted(synth_dir.glob("*.py")):
        if py_file.name.startswith("_"):
            continue  # skip __init__.py and internal helpers
        slug = py_file.stem
        module_name = f"agent.actions._synth.{slug}"
        if module_name in sys.modules:
            mod = sys.modules[module_name]
        else:
            try:
                spec = importlib.util.spec_from_file_location(module_name, str(py_file))
                if spec is None or spec.loader is None:
                    continue
                mod = importlib.util.module_from_spec(spec)
                sys.modules[module_name] = mod
                spec.loader.exec_module(mod)  # type: ignore[union-attr]
            except Exception as exc:
                _logger.warning("agent-synth: skipping %s at boot: %s", py_file.name, exc)
                sys.modules.pop(module_name, None)
                continue

        for v in vars(mod).values():
            if (
                isinstance(v, type)
                and issubclass(v, _Action)
                and v is not _Action
                and getattr(v, "name", "abstract") != "abstract"
            ):
                result.append(v)

    return result


class ActionRegistry:
    def __init__(self) -> None:
        self._by_name: dict[str, Type[Action]] = {cls.name: cls for cls in _REGISTERED}
        # Boot-time auto-load: persisted synth actions from previous sessions.
        for cls in _load_synth_actions():
            if cls.name not in self._by_name:
                self._by_name[cls.name] = cls

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
