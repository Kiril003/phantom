"""V4 — self-synthesizing capability core.

Public API used by SynthesizeCapability action and the kernel loop:

  build_draft_prompt(spec)           — build the LLM prompt for Action drafting
  draft_action_source(spec, ...)     — LLM call → raw Python source string
  write_synth_file(slug, source)     — persist source to _synth/<slug>.py
  run_smoke_test(slug, source, ctx)  — bwrap sandbox smoke run → bool
  register_synth(slug, source)       — dynamic import + ActionRegistry.register
  record_synth_lesson(...)           — write_lesson for success / failure
  SynthCounter                       — per-task mutable cap tracker

Design invariants (spec §3 V4):
  • Synth code ONLY executes inside the existing bwrap sandbox (wrap_argv /
    SandboxProfile.compute). The smoke test writes source to a temp file then
    calls `python -c "import <slug>"` inside bwrap — no raw exec() on host.
  • Registration is fail-closed: any exception during import or registry
    insertion leaves the registry unchanged.
  • unsafe_mode on the owning task is forwarded to the smoke-test executor
    so the existing waiver contract is respected (sandbox skipped iff task
    already waived it — we don't add a new bypass).
"""
from __future__ import annotations

import importlib.util
import logging
import os
import re
import sys
import tempfile
import textwrap
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

from config import config

if TYPE_CHECKING:
    from agent.actions.registry import ActionRegistry

logger = logging.getLogger(__name__)

# Absolute path to the _synth package so writes survive cwd changes.
_SYNTH_DIR = Path(__file__).parent

# Hard-coded ABC source injected into the prompt so the LLM sees the real
# interface without needing a live import inside the prompt-building path.
_ACTION_ABC_EXCERPT = textwrap.dedent("""\
    # agent/actions/base.py  (excerpt — implement EXACTLY this interface)
    from abc import ABC, abstractmethod
    from typing import ClassVar, Any
    from pydantic import BaseModel, ConfigDict
    from agent.schemas import ActionResult, RiskLevel

    class ActionContext(BaseModel):
        task_id: str
        step_idx: int
        workspace_dir: str
        runtime: Any | None = None
        extras: dict[str, Any] = {}
        unsafe_mode: bool = False

    class Action(BaseModel, ABC):
        model_config = ConfigDict(arbitrary_types_allowed=True)
        name: ClassVar[str] = "abstract"
        risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
        requires_consent: ClassVar[bool] = False
        reversible: ClassVar[bool] = False
        estimated_peak_ram_mb: ClassVar[int] = 50
        estimated_disk_write_mb: ClassVar[int] = 0
        estimated_wall_seconds: ClassVar[int] = 10
        requires_network: ClassVar[bool] = False

        @abstractmethod
        async def execute(self, ctx: ActionContext) -> ActionResult: ...
""")

_EXAMPLE_ACTION = textwrap.dedent("""\
    # Example — a minimal concrete Action (self.capability pattern):
    from typing import ClassVar
    from pydantic import Field
    from agent.schemas import ActionResult, RiskLevel
    from agent.actions.base import Action, ActionContext
    import time

    class ExampleEcho(Action):
        name: ClassVar[str] = "example.echo"
        risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE

        message: str = Field(default="hello")

        async def execute(self, ctx: ActionContext) -> ActionResult:
            t0 = time.monotonic()
            return ActionResult(
                ok=True,
                output={"echo": self.message},
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )
""")

_DRAFT_SYSTEM = (
    "Ти — Python-розробник. Генеруєш ОДИН повний файл Python: підклас Action "
    "для системи PHANTOM. Без прози, без markdown-огорожі, без коментарів "
    "'# TODO', без заглушок. Тільки виконуваний Python."
)

_DRAFT_TEMPLATE = """\
ЗАВДАННЯ: синтезувати нову дію-підклас Action.

СПЕЦИФІКАЦІЯ GAP:
{spec}

АБСТРАКТНИЙ КЛАС (дотримуватись ТОЧНО):
{abc}

ПРИКЛАД КОНКРЕТНОЇ ДІЇ:
{example}

ПРАВИЛА:
1. `name` — унікальний рядок виду "synth.<slug>" (slug = лише [a-z0-9_]).
2. `risk_level` — найбільш відповідний (SAFE/LOW/MEDIUM/HIGH).
3. `execute` — реальна реалізація, НІЯКИХ заглушок або `pass`.
4. Усі залежності стандартні (stdlib/pydantic/asyncio) або вже імпортовані в codebase.
   НЕ використовуй мережу, зовнішні API, бінарники що можуть бути відсутні.
5. Файл має бути самодостатнім: один клас, усі імпорти вгорі.
6. ВИВІД: ТІЛЬКИ Python-файл від першого `from`/`import` до кінця класу.

Slug для файлу: {slug}
"""


def _slugify(text: str) -> str:
    """Derive a filesystem-safe slug from a free-form spec string."""
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "_", text)
    text = text.strip("_")[:40] or "custom"
    return text


def build_draft_prompt(spec: str, slug: str) -> tuple[str, str]:
    """Return (system_prompt, user_message) for the Action-drafting LLM call."""
    user_msg = _DRAFT_TEMPLATE.format(
        spec=spec[:2000],
        abc=_ACTION_ABC_EXCERPT,
        example=_EXAMPLE_ACTION,
        slug=slug,
    )
    return _DRAFT_SYSTEM, user_msg


async def draft_action_source(
    spec: str,
    slug: str,
    *,
    repair_error: str | None = None,
    previous_source: str | None = None,
    generate_raw_fn: Any = None,  # injectable for tests
) -> str:
    """Call LLM to draft an Action subclass source. Returns raw Python source.

    If ``repair_error`` is provided, we perform a fix-up call using the
    previous source + error message as context.
    """
    system_prompt, user_msg = build_draft_prompt(spec, slug)

    if repair_error:
        user_msg += textwrap.dedent(f"""

            ВАЖЛИВО: попередня спроба провалила smoke-test з помилкою:
            {repair_error}

            ПОПЕРЕДНІЙ КОД (НЕПРАВИЛЬНИЙ):
            {previous_source}

            ВИПРАВ ЦЕ. Поверни ПОВНИЙ виправлений файл, що пройде імпорт та виконання.
        """)

    if generate_raw_fn is None:
        from ai.provider import ai_router
        generate_raw_fn = ai_router.generate_raw

    raw = await generate_raw_fn(
        system_prompt=system_prompt,
        user_message=user_msg,
        model=getattr(config, "ai_artifact_model", config.ai_gemini_model),
        max_output_tokens=getattr(config, "ai_artifact_max_tokens", 4096),
        temperature=0.2 if repair_error else 0.3, # lower temp for repair
    )

    # Strip markdown fences if the model ignored the rule.
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-zA-Z0-9_]*\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw.strip())
    return raw.strip()


def write_synth_file(slug: str, source: str) -> Path:
    """Write ``source`` to ``_synth/<slug>.py``. Returns the Path."""
    dest = _SYNTH_DIR / f"{slug}.py"
    dest.write_text(source, encoding="utf-8")
    logger.info("agent-synth: wrote %s (%d bytes)", dest, len(source))
    return dest


async def run_smoke_test(
    slug: str,
    source: str,
    *,
    workspace_dir: str,
    unsafe_mode: bool = False,
    _subprocess_run: Any = None,  # injectable for tests
) -> tuple[bool, str]:
    """Write source to a temp file then import it inside the bwrap sandbox.

    Returns ``(passed, reason)`` where ``reason`` is empty on success.

    The smoke test runs ``python -c "import importlib.util, sys; …"`` inside
    the EXISTING bwrap compute profile (same as BashRun). unsafe_mode on the
    owning task is forwarded: if the task already waived the sandbox we follow
    the same waiver here rather than introducing a NEW bypass.

    ``_subprocess_run`` is injectable for deterministic testing.
    """
    import asyncio

    from agent.operations.safety.sandbox import (
        SandboxProfile,
        assert_env_safe,
        clean_env,
        host_env_unsafe,
        wrap_argv,
    )

    # Write source to a temp file inside workspace_dir so the compute-profile
    # workspace bind (/workspace) exposes it inside the sandbox.
    tmp_dir = Path(workspace_dir)
    tmp_dir.mkdir(parents=True, exist_ok=True)
    tmp_path = tmp_dir / f"_synth_smoke_{slug}.py"
    tmp_path.write_text(source, encoding="utf-8")

    # Smoke command: load the module from the temp file and check it defines
    # an Action subclass. We do NOT instantiate (no args known), just import.
    # Path inside the environment:
    inner_path = f"/workspace/_synth_smoke_{slug}.py" if not unsafe_mode else str(tmp_path.absolute())

    smoke_cmd = (
        f"python3 -c \""
        f"import importlib.util, sys; "
        f"spec = importlib.util.spec_from_file_location('_smoke', '{inner_path}'); "
        f"mod = importlib.util.module_from_spec(spec); "
        f"spec.loader.exec_module(mod); "
        f"from agent.actions.base import Action; "
        f"actions = [v for v in vars(mod).values() if isinstance(v, type) and issubclass(v, Action) and v is not Action]; "
        f"assert actions, 'no Action subclass found'; "
        f"print('OK:', actions[0].name)"
        f"\""
    )

    argv_cmd = ["/bin/sh", "-c", smoke_cmd]

    if unsafe_mode:
        argv, sandboxed = argv_cmd, False
        env = host_env_unsafe()
    else:
        argv, sandboxed = wrap_argv(
            SandboxProfile.compute,
            argv_cmd,
            workspace_dir=workspace_dir,
        )
        env = clean_env(workspace_dir=workspace_dir)

    assert_env_safe(env)

    try:
        if _subprocess_run is not None:
            # Test injection: synchronous callable returning (returncode, stdout, stderr)
            rc, stdout, stderr = _subprocess_run(argv, env)
        else:
            proc = await asyncio.create_subprocess_exec(
                *argv,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
            stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=30)
            rc = proc.returncode if proc.returncode is not None else -1
            stdout = stdout_b.decode("utf-8", errors="replace")
            stderr = stderr_b.decode("utf-8", errors="replace")
    except Exception as exc:
        return False, f"smoke_run_error: {exc}"
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass

    if rc == 0:
        return True, ""
    return False, f"rc={rc} stderr={stderr[:500]}"


def register_synth(slug: str, source: str, registry: "ActionRegistry") -> str:
    """Dynamically import the synthesized module and register its Action class.

    Returns the registered action name on success. Raises on any failure so
    the caller can treat registration as fail-closed (no partial state).

    The module is added to ``sys.modules`` under
    ``agent.actions._synth.<slug>`` so subsequent imports resolve correctly
    and the registry can store a live class reference.
    """
    module_name = f"agent.actions._synth.{slug}"

    # Write to the package directory so it's importable from the real path too.
    dest = write_synth_file(slug, source)

    spec = importlib.util.spec_from_file_location(module_name, str(dest))
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot build module spec from {dest}")

    mod = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = mod
    try:
        spec.loader.exec_module(mod)  # type: ignore[union-attr]
    except Exception as exc:
        del sys.modules[module_name]
        raise ImportError(f"exec_module failed: {exc}") from exc

    from agent.actions.base import Action

    candidates = [
        v for v in vars(mod).values()
        if isinstance(v, type) and issubclass(v, Action) and v is not Action
    ]
    if not candidates:
        del sys.modules[module_name]
        raise ImportError("module defines no Action subclass")

    action_cls = candidates[0]

    # Fail-closed: if the name collides with an existing registered action
    # we refuse (don't silently override a production action).
    existing = registry.get(action_cls.name)
    if existing is not None and existing is not action_cls:
        del sys.modules[module_name]
        raise ValueError(
            f"action name '{action_cls.name}' already registered by {existing}; "
            "choose a unique name (synth.<slug>)"
        )

    # ActionRegistry._by_name is the live dict — extend it in place.
    registry._by_name[action_cls.name] = action_cls
    logger.info("agent-synth: registered action '%s' from %s", action_cls.name, dest)
    return action_cls.name


async def record_synth_lesson(
    *,
    task_id: str,
    goal_class: str,
    action_name: str,
    success: bool,
    failure_reason: str = "",
    user_id: str | None = None,
) -> None:
    """Write a lesson to the lessons store recording the synth outcome."""
    try:
        from agent.cognition.memory.lessons import write_lesson
    except ImportError:
        logger.debug("agent-synth: lessons module unavailable, skipping lesson write")
        return

    if success:
        lesson = {
            "what_worked": f"synthesized action '{action_name}' for goal class '{goal_class[:80]}'",
            "what_avoid": "",
            "applicability": goal_class[:80],
        }
        outcome = "synth_success"
    else:
        lesson = {
            "what_worked": "",
            "what_avoid": (
                f"synth attempt for '{goal_class[:60]}' failed: {failure_reason[:100]}"
            ),
            "applicability": goal_class[:80],
        }
        outcome = "synth_failure"

    try:
        await write_lesson(
            task_id=task_id or f"synth_{int(time.time())}",
            goal=f"синтез дії для: {goal_class}",
            outcome=outcome,
            lesson=lesson,
            user_id=user_id,
        )
    except Exception as exc:
        logger.debug("agent-synth: lesson write failed (non-fatal): %s", exc)


# ── Per-task synthesis counter ────────────────────────────────────────────────


class SynthCounter:
    """Mutable per-task counter tracking how many syntheses have been done.

    Stored in ``ActionContext.extras['_synth_counter']`` by
    SynthesizeCapability so the cap persists across repeated calls within
    the same task execution context.
    """

    def __init__(self) -> None:
        self._count = 0

    @property
    def count(self) -> int:
        return self._count

    def increment(self) -> None:
        self._count += 1

    def cap_reached(self) -> bool:
        cap = int(getattr(config, "agent_synth_max_per_task", 3))
        if cap <= 0:
            return False
        return self._count >= cap

    @classmethod
    def from_ctx(cls, ctx_extras: dict) -> "SynthCounter":
        """Get-or-create the counter stored in ActionContext.extras."""
        if "_synth_counter" not in ctx_extras:
            ctx_extras["_synth_counter"] = cls()
        return ctx_extras["_synth_counter"]
