"""Every production module must import.

A module that cannot be imported is a feature that cannot run, and nothing else
in the suite catches it: the broken module is simply never reached, so the tests
that would have exercised it never execute and the failure looks like absence of
coverage rather than a defect.

Caught on 2026-08-06: `geo/trajectory_learner.py` imported `SessionLocal` from
`db.database`, which exports `AsyncSessionLocal` — the whole module was
unimportable, and nothing else in the suite noticed.

**Known limit — this only sees module-level imports.** A lazy import inside a
function is not evaluated here, so it stays invisible until that function runs.
`agent/missions/reports.py` had exactly that shape: `from .missions.store import
...` inside `compose()`, resolving to `agent.missions.missions.store` while
already inside `agent.missions`. Every `compose()` call raised
ModuleNotFoundError and this test passed throughout — it was found by running
the mission-reporting tests. Verified by reintroducing the bug: this file still
went green. So treat this as a backstop for import-time rot after a package
move, never as proof the import graph is sound.
"""
from __future__ import annotations

import importlib
import pathlib

import pytest

_BACKEND_ROOT = pathlib.Path(__file__).resolve().parents[1]

#: Directories that are not importable application code.
_SKIP_DIRS = {
    "tests", ".venv", "__pycache__", "scripts", "alembic",
    "test_script", "docs", "node_modules",
}

#: Whole packages known to be unimportable, with the reason and a pending owner
#: decision. Scoped per package rather than per module so the entry describes
#: the actual unit of debt. Shrink this — never grow it without a decision.
#:
#: Empty, and worth keeping that way. Its last entry was `tool_registry`, whose
#: `families/__init__.py` imported 11 family modules that were never committed.
#: Resolved by building them (G1.1, PHANTOM_FORGE_PLAN) rather than deleting the
#: package; tests/test_tool_registry_parity.py holds the result in place.
_KNOWN_BROKEN_PACKAGES: set[str] = set()


def _is_known_broken(module_name: str) -> bool:
    root = module_name.split(".", 1)[0]
    return root in _KNOWN_BROKEN_PACKAGES


def _iter_modules() -> list[str]:
    mods: list[str] = []
    for path in sorted(_BACKEND_ROOT.rglob("*.py")):
        rel = path.relative_to(_BACKEND_ROOT)
        if any(part in _SKIP_DIRS for part in rel.parts):
            continue
        if rel.name.startswith("test_") or rel.name == "conftest.py":
            continue
        mod = ".".join(rel.with_suffix("").parts)
        if mod.endswith(".__init__"):
            mod = mod[: -len(".__init__")]
        if mod:
            mods.append(mod)
    return mods


@pytest.mark.parametrize("module_name", _iter_modules())
def test_module_imports(module_name: str) -> None:
    if _is_known_broken(module_name):
        pytest.skip(f"known-broken package, pending an owner decision: {module_name}")
    try:
        importlib.import_module(module_name)
    except ImportError as exc:
        pytest.fail(
            f"{module_name} cannot be imported: {type(exc).__name__}: {exc}\n"
            "An unimportable module is a dead feature — usually a stale relative "
            "import left behind by a package move, or a symbol renamed in its "
            "source module."
        )
    except Exception as exc:  # noqa: BLE001
        # Import-time side effects (missing hardware, absent optional deps) are
        # a different problem from a broken import graph; surface but don't fail.
        pytest.skip(f"{module_name} raised {type(exc).__name__} at import: {exc}")


def _relative_import_targets() -> list[tuple[pathlib.Path, int, str, list[str]]]:
    """Every `from .x import a, b` in production code, with its resolved path."""
    import ast

    out = []
    for path in sorted(_BACKEND_ROOT.rglob("*.py")):
        rel = path.relative_to(_BACKEND_ROOT)
        if any(part in _SKIP_DIRS for part in rel.parts) or rel.name.startswith("test_"):
            continue
        try:
            tree = ast.parse(path.read_text(errors="ignore"))
        except SyntaxError:
            continue
        pkg = list(rel.parent.parts)
        for node in ast.walk(tree):
            if not isinstance(node, ast.ImportFrom) or not node.level:
                continue
            base = pkg[: len(pkg) - (node.level - 1)] if node.level > 1 else pkg
            target = base + (node.module.split(".") if node.module else [])
            if not target:
                continue
            names = [a.name for a in node.names]
            out.append((path, node.lineno, ".".join(target), names))
    return out


def test_relative_imports_resolve():
    """Static counterpart to the import test above, covering lazy imports.

    The parametrised test only executes module-level imports. A relative import
    inside a function body is invisible to it until that function runs — and in
    this codebase those are routinely wrapped in `try/except` or
    `contextlib.suppress`, so the failure never surfaces at all. Four dead
    features were found this way on 2026-08-06, including the proactive
    monologue emitter and the CONCERN_ADDED trigger, each silently skipped for
    an unknown length of time.
    """
    broken = []
    for path, lineno, target, names in _relative_import_targets():
        if target.split(".", 1)[0] in _KNOWN_BROKEN_PACKAGES:
            continue
        as_module = _BACKEND_ROOT / pathlib.Path(*target.split("."))
        if as_module.with_suffix(".py").exists():
            continue
        if (as_module / "__init__.py").exists():
            continue
        if as_module.is_dir():
            # A namespace package (no __init__.py) imports fine as a module but
            # exports no names — `from .pkg import thing` still fails.
            broken.append(
                f"{path.relative_to(_BACKEND_ROOT)}:{lineno} imports "
                f"{names} from '{target}', a namespace package with no __init__.py"
            )
            continue
        broken.append(
            f"{path.relative_to(_BACKEND_ROOT)}:{lineno} -> '{target}' does not exist"
        )
    assert not broken, "unresolvable relative imports:\n  " + "\n  ".join(broken)


def test_the_known_broken_list_stays_small():
    """A guard on the guard: this list is debt, not a parking lot."""
    assert len(_KNOWN_BROKEN_PACKAGES) <= 1, (
        f"_KNOWN_BROKEN_PACKAGES grew to {len(_KNOWN_BROKEN_PACKAGES)} — fix the "
        "package or record an explicit decision, don't accumulate unimportable code."
    )


def test_schema_constructions_use_real_field_names():
    """Keyword names at every construction site must exist on the model.

    Pydantic silently *ignores* unknown keywords (``extra='ignore'`` is the
    default), so a typo'd or renamed field does not fail where you typed it —
    it fails later, as a missing required field, or not at all, as a value that
    quietly never arrives.

    Caught on 2026-08-07: every ``ActionResult`` in
    ``agent/actions/git_checkpoint.py`` was built with ``success=`` while the
    field is ``ok``. ``success`` was dropped, ``ok`` was missing, and Pydantic
    raised ValidationError on the success path, the failure path, AND inside
    the ``except Exception`` handler meant to catch it. Both `git.checkpoint`
    and `git.rollback` therefore raised on every call since they were written —
    the agent's entire rollback safety net was fictional, and no test noticed
    because no test called them.
    """
    import ast
    import inspect

    from pydantic import BaseModel

    from agent import schemas as _schemas

    models = {
        name: obj
        for name, obj in vars(_schemas).items()
        if inspect.isclass(obj)
        and issubclass(obj, BaseModel)
        and obj.__module__ == _schemas.__name__
    }
    assert models, "no schema models discovered — the sweep would be vacuous"

    offenders: list[str] = []
    checked = 0

    for path in _BACKEND_ROOT.rglob("*.py"):
        if any(p in {".venv", "tests", "__pycache__", "scripts"} for p in path.parts):
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError):
            continue

        # Only trust the name if this module actually imported it from schemas.
        imported = {
            alias.asname or alias.name
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom) and (node.module or "").endswith("schemas")
            for alias in node.names
        }
        if not imported:
            continue

        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name):
                continue
            model = models.get(node.func.id)
            if model is None or node.func.id not in imported:
                continue
            if any(kw.arg is None for kw in node.keywords):
                continue  # **kwargs splat — nothing static to check
            checked += 1

            passed = {kw.arg for kw in node.keywords}
            # A field may legitimately be populated by an alias rather than its
            # attribute name — `MapAddMarker.name_` carries `alias="name"`
            # precisely because `name` collides with the Action ClassVar. Count
            # every spelling Pydantic would accept, or this sweep invents
            # failures for correct code.
            valid: set[str] = set()
            for fname, f in model.model_fields.items():
                valid.add(fname)
                for candidate in (f.alias, f.validation_alias):
                    if isinstance(candidate, str):
                        valid.add(candidate)
            where = f"{path.relative_to(_BACKEND_ROOT)}:{node.lineno} {node.func.id}"

            for unknown in sorted(passed - valid):
                offenders.append(f"{where} — unknown field {unknown!r} (silently dropped)")

            if node.args:
                continue  # positional args fill required fields we can't map
            for fname, f in sorted(model.model_fields.items()):
                if not f.is_required():
                    continue
                spellings = {fname}
                for candidate in (f.alias, f.validation_alias):
                    if isinstance(candidate, str):
                        spellings.add(candidate)
                if not (spellings & passed):
                    offenders.append(f"{where} — missing required field {fname!r}")

    assert checked, "sweep matched no construction sites — it would be vacuous"
    assert not offenders, "schema constructions with bad field names:\n" + "\n".join(offenders)
