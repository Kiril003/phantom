"""Day-4 Wave-1 — Block X-3: AST import gate over `src/backend/ai/**`.

Pre-emptive AST gate that closes audit U3-ORCH-G3 (TM-17B-E4 dimension):
the future `ai/agents/**` orchestrator layer (lands in Wave-2 via Block
X-1 per `docs/PHASE1_BLOCK_ORDER.md:62`) MUST route every tool dispatch
through `ai.chat_tool_dispatcher.dispatch`. Direct calls into
`ai.tool_executor.execute_tool` or `_HANDLERS` from agents would
re-create the TM-17B-E2/E4 leak the dispatcher is *designed to close*
(the dispatcher applies the safe-tool name filter, the 4000-char content
cap, and the nonce-prefix envelope; tool_executor itself does none of
those).

Today `ai/agents/` does NOT exist; X-1 ships the skeleton in Wave-2.
This test enumerates the *contract* now so the first file landed under
`ai/agents/**` that bypasses the dispatcher fails CI immediately, before
the layering rot ships behind a feature flag. The same gate also pins
the existing minimal allow-list of direct `tool_executor` callers in
`ai/`:

    1. ai/chat_tool_dispatcher.py  — the dispatcher itself, Day-1 contract.
    2. ai/gemini_provider.py       — Phase-10 legacy `call_with_tools`
                                     loop, predates the dispatcher.

Adding a third caller is a wire-break — landing it requires (a) an ADR
amendment AND (b) explicit edit to `ALLOWED_TOOL_EXECUTOR_CALLERS`
below.

Approach: walk every `*.py` under `src/backend/ai/**`, parse with
`ast.parse`, and inspect every `Import` / `ImportFrom` node. The
following are forbidden outside the allow-list:

    * `from ai.tool_executor import execute_tool` (or `_HANDLERS`)
    * `from .tool_executor import execute_tool` (relative)
    * `import ai.tool_executor` (whole-module qualifier)

Imports of names other than `execute_tool` / `_HANDLERS` (e.g.,
`MAX_TOOL_CALLS_PER_TURN`, `_safe_query_str`) are ALLOWED — they are
constants / utility helpers that don't bypass the safe-tool filter.

The gate also forbids `from ai.tool_executor import *` everywhere
(silent surface broadening), and forbids attribute-style calls like
`tool_executor.execute_tool(...)` once the module is imported by name —
implementing the latter requires a second AST walk over `Attribute`
nodes after binding the import alias.
"""
from __future__ import annotations

import ast
from pathlib import Path

# Resolve repository layout: this file lives at
# .../phantom-os/src/backend/tests/test_phase_x3_*.py — parents[1] = backend.
_BACKEND_ROOT = Path(__file__).resolve().parents[1]
_AI_ROOT = _BACKEND_ROOT / "ai"
_AGENTS_ROOT = _AI_ROOT / "agents"

# Files in ai/ allowed to import the raw tool_executor surface.
# Adding a third entry is a wire-break per X-3 contract — keep this
# tuple in lock-step with the ADR's stated allow-list.
ALLOWED_TOOL_EXECUTOR_CALLERS: frozenset[str] = frozenset(
    {
        "chat_tool_dispatcher.py",
        "gemini_provider.py",
        # tool_executor.py itself — it imports its own _HANDLERS internally.
        "tool_executor.py",
    }
)

# Names that are *unsafe* to import from `ai.tool_executor` outside the
# allow-list. These are the surfaces that bypass the dispatcher's
# TM-17B-S1/S2/E2 mitigations.
FORBIDDEN_TOOL_EXECUTOR_NAMES: frozenset[str] = frozenset(
    {"execute_tool", "_HANDLERS"},
)


def _iter_ai_python_files() -> list[Path]:
    """Every `*.py` under `src/backend/ai/**`, deterministic order.

    Includes any future `ai/agents/**` module the moment X-1 lands it —
    the gate fires from that commit forward.
    """
    if not _AI_ROOT.is_dir():
        # Should be impossible — `ai/` is the cluster root. If it ever
        # disappears the test should yell.
        raise AssertionError(
            f"ai/ root missing at {_AI_ROOT}; layout invariant broken"
        )
    return sorted(p for p in _AI_ROOT.rglob("*.py") if "__pycache__" not in p.parts)


def _parse(path: Path) -> ast.Module:
    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


def _is_tool_executor_module(module: str | None) -> bool:
    """Match both absolute (`ai.tool_executor`) and relative-from-ai
    (`tool_executor`) module references."""
    if module is None:
        return False
    if module == "ai.tool_executor":
        return True
    # `from .tool_executor import ...` parses to module='tool_executor'
    # with `level=1` — see _scan_imports below for the level guard.
    return module == "tool_executor"


def _scan_imports(tree: ast.Module) -> list[tuple[ast.AST, str]]:
    """Yield (node, message) pairs for every forbidden import in `tree`.

    Empty list = file is clean.
    """
    findings: list[tuple[ast.AST, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            module = node.module or ""
            level = node.level or 0
            # `from ai.tool_executor import x` → level=0, module='ai.tool_executor'.
            # `from .tool_executor import x`   → level=1, module='tool_executor'.
            # `from ..ai.tool_executor import x` → level=2, module='ai.tool_executor'.
            is_tool_executor = (
                (level == 0 and module == "ai.tool_executor")
                or (level >= 1 and module.endswith("tool_executor"))
            )
            if not is_tool_executor:
                continue
            for alias in node.names:
                imported = alias.name
                if imported == "*":
                    findings.append(
                        (
                            node,
                            "wildcard import `from ai.tool_executor import *` is "
                            "forbidden — it silently broadens the surface every "
                            "time tool_executor adds a new symbol.",
                        )
                    )
                    continue
                if imported in FORBIDDEN_TOOL_EXECUTOR_NAMES:
                    findings.append(
                        (
                            node,
                            f"direct import of `{imported}` bypasses "
                            "ai.chat_tool_dispatcher.dispatch (TM-17B-E2/E4). "
                            "Route through dispatcher OR add this file to "
                            "ALLOWED_TOOL_EXECUTOR_CALLERS with ADR amendment.",
                        )
                    )
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name == "ai.tool_executor":
                    findings.append(
                        (
                            node,
                            "whole-module import `import ai.tool_executor` is "
                            "forbidden — call sites can then dot-access "
                            "execute_tool with no surface review. Use the "
                            "dispatcher.",
                        )
                    )
    return findings


# ─────────────────────────────────────────────────────────────────── tests ──


class TestForbiddenImportsAcrossAi:
    """Every file under `src/backend/ai/**` (and by extension future
    `ai/agents/**`) is scanned. Files in ALLOWED_TOOL_EXECUTOR_CALLERS
    are exempt; everything else MUST stay clean."""

    def test_ai_tree_has_no_unauthorized_tool_executor_imports(self):
        offenders: list[str] = []
        for path in _iter_ai_python_files():
            if path.name in ALLOWED_TOOL_EXECUTOR_CALLERS:
                continue
            tree = _parse(path)
            findings = _scan_imports(tree)
            for node, msg in findings:
                offenders.append(
                    f"  {path.relative_to(_BACKEND_ROOT)}:{node.lineno} — {msg}"
                )
        assert not offenders, (
            "X-3 / TM-17B-E4 regression: at least one ai/** file imports the "
            "raw tool_executor surface without dispatcher routing. The "
            "dispatcher applies the safe-tool name filter and the 4000-char "
            "content cap; bypassing it re-opens the TM-17B-E2/E4 leak.\n\n"
            + "\n".join(offenders)
        )

    def test_allow_list_is_exactly_three_entries(self):
        """Catch a future commit that grows the allow-list silently. The
        exact entries are validated below — a structural change here makes
        the failure obvious in CI."""
        assert len(ALLOWED_TOOL_EXECUTOR_CALLERS) == 3, (
            f"X-3 contract regression: ALLOWED_TOOL_EXECUTOR_CALLERS now has "
            f"{len(ALLOWED_TOOL_EXECUTOR_CALLERS)} entries — adding/removing "
            "a caller requires an ADR amendment alongside this edit."
        )

    def test_allow_list_entries_actually_exist(self):
        for fname in ALLOWED_TOOL_EXECUTOR_CALLERS:
            assert (_AI_ROOT / fname).is_file(), (
                f"X-3 contract regression: allow-list entry {fname!r} no longer "
                "exists in ai/. If the file moved, update both the allow-list "
                "and the ADR; if it was deleted, drop the entry."
            )


class TestFutureAgentsLayer:
    """`ai/agents/**` does not exist on Day-4 — Block X-1 (Wave-2) lands
    the skeleton. These tests document the gate so the first commit that
    lands a file under `ai/agents/**` MUST also keep the contract."""

    def test_agents_dir_absent_today_xfail_when_x1_lands(self):
        """If `ai/agents/` materialises, the gate above ALREADY scans
        it (via rglob). This test snapshots the current Day-4 layout
        — when X-1 lands, this assertion needs flipping. Treat the
        failure as a TODO breadcrumb, not a regression."""
        assert not _AGENTS_ROOT.exists(), (
            "X-3 follow-up: ai/agents/ now exists — Block X-1 has landed. "
            "Flip this assertion to `_AGENTS_ROOT.is_dir()` and add at "
            "least one positive-case test that confirms a new agents/ "
            "file is scanned + clean."
        )

    def test_synthetic_agents_file_with_forbidden_import_is_caught(self, tmp_path):
        """End-to-end of the gate: a synthetic file that mimics what an
        ai/agents/** file might look like (direct execute_tool import)
        produces a finding. Uses tmp_path so we never touch the real
        tree — keeps the test isolated from CWD state."""
        bad = tmp_path / "bad_agent.py"
        bad.write_text(
            "from ai.tool_executor import execute_tool\n"
            "async def run():\n"
            "    return await execute_tool('search_locationhistory', {}, 'u')\n",
            encoding="utf-8",
        )
        tree = _parse(bad)
        findings = _scan_imports(tree)
        assert findings, (
            "X-3 self-test: scanner missed a synthetic forbidden import — "
            "the gate is not actually firing."
        )
        node, msg = findings[0]
        assert "execute_tool" in msg
        assert isinstance(node, ast.ImportFrom)

    def test_synthetic_agents_file_clean_via_dispatcher_is_accepted(self, tmp_path):
        """The intended pattern: agents go through chat_tool_dispatcher.
        The gate must NOT flag it."""
        good = tmp_path / "good_agent.py"
        good.write_text(
            "from ai.chat_tool_dispatcher import dispatch\n"
            "async def run():\n"
            "    return await dispatch('search_locationhistory', {}, "
            "user_id='u', db=None)\n",
            encoding="utf-8",
        )
        tree = _parse(good)
        findings = _scan_imports(tree)
        assert not findings, (
            "X-3 false-positive: dispatcher-routed import was flagged. "
            f"Findings: {[m for _, m in findings]}"
        )

    def test_wildcard_tool_executor_import_is_caught(self, tmp_path):
        ugly = tmp_path / "wildcard_agent.py"
        ugly.write_text(
            "from ai.tool_executor import *\n",
            encoding="utf-8",
        )
        findings = _scan_imports(_parse(ugly))
        assert findings, "wildcard import sneaked past the gate"
        assert "wildcard" in findings[0][1].lower()

    def test_whole_module_import_is_caught(self, tmp_path):
        whole = tmp_path / "module_agent.py"
        whole.write_text(
            "import ai.tool_executor\n"
            "async def run():\n"
            "    return await ai.tool_executor.execute_tool('x', {}, 'u')\n",
            encoding="utf-8",
        )
        findings = _scan_imports(_parse(whole))
        assert findings, "whole-module import sneaked past the gate"
        assert "import ai.tool_executor" in findings[0][1]

    def test_safe_constant_import_is_not_flagged(self, tmp_path):
        """Importing a CONSTANT (e.g., MAX_TOOL_CALLS_PER_TURN) from
        tool_executor is allowed — these don't bypass the dispatcher's
        safe-tool filter. Mirrors the legacy gemini_provider.py shape."""
        constant_only = tmp_path / "constants_only.py"
        constant_only.write_text(
            "from ai.tool_executor import MAX_TOOL_CALLS_PER_TURN\n"
            "X = MAX_TOOL_CALLS_PER_TURN\n",
            encoding="utf-8",
        )
        findings = _scan_imports(_parse(constant_only))
        assert not findings, (
            "X-3 false-positive: constant-only import was flagged. "
            f"Findings: {[m for _, m in findings]}"
        )
