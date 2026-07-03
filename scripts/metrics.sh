#!/usr/bin/env bash
# G0.2 baseline metrics (PHANTOM_FORGE_PLAN Part II). Re-run after every
# G-phase — every number here must go down or stay flat, never up.
#
# Test-suite runtime is deliberately NOT part of this script: on this
# hardware `npx vitest run` (60 files) pins two workers at 100% CPU past
# the same point (58/60 files) for 10-15min without exiting in two
# independent runs — reproducible hang, not raw slowness (see baseline
# table in PHANTOM_FORGE_PLAN.md). Full pytest (2523 tests) was not
# attempted given that evidence + the documented board-freeze risk
# (memory: overload_protection.md). G8.4's CI ratchet list doesn't
# track test runtime anyway (LoC/routes/monoliths/cycles only) — time
# it separately, on CI hardware, once G8 exists.
set -euo pipefail
cd "$(dirname "$0")/.."

EXCLUDE_RE='/(node_modules|venv|\.venv|__pycache__|dist|build|\.git|chroma_data|graphify-out|\.pytest_cache|\.mypy_cache|coverage|htmlcov|\.pio)/'

loc_dir() {
  find "$1" -type f \( -name '*.py' -o -name '*.ts' -o -name '*.tsx' -o -name '*.cpp' -o -name '*.h' \) 2>/dev/null \
    | grep -vE "$EXCLUDE_RE" \
    | xargs -r cat 2>/dev/null | wc -l
}

echo "# PHANTOM Forge — Baseline Metrics"
echo "date: $(date +%Y-%m-%d)"
echo "commit: $(git rev-parse --short HEAD)"
echo

echo "## LoC by domain"
printf "%-10s %10s\n" "backend"  "$(loc_dir src/backend)"
printf "%-10s %10s\n" "frontend" "$(loc_dir src/frontend/src)"
printf "%-10s %10s\n" "shared"   "$(loc_dir src/shared)"
printf "%-10s %10s\n" "firmware" "$(loc_dir src/firmware)"
echo

echo "## Files >500 lines"
BIG_FILES="$(find src -type f \( -name '*.py' -o -name '*.ts' -o -name '*.tsx' \) 2>/dev/null \
  | grep -vE "$EXCLUDE_RE" \
  | xargs -r wc -l 2>/dev/null \
  | grep -v ' total$' \
  | awk '$1>500{print $1, $2}' \
  | sort -rn)"
echo "$BIG_FILES"
echo "count: $(echo "$BIG_FILES" | grep -c . || true)"
echo

echo "## Route files (src/backend/api/routes_*.py)"
ROUTE_COUNT=$(find src/backend/api -maxdepth 1 -iname 'routes_*.py' 2>/dev/null | wc -l)
echo "count: $ROUTE_COUNT"
echo

echo "## Zustand stores (src/frontend/src/stores/*.ts)"
STORE_COUNT=$(find src/frontend/src/stores -maxdepth 1 -name '*.ts' 2>/dev/null | wc -l)
echo "count: $STORE_COUNT"
echo

echo "## Repo size"
echo "total (incl. venv/node_modules/build artifacts): $(du -sh . 2>/dev/null | cut -f1)"
echo "excl. vendor/build: $(du -sh --exclude=node_modules --exclude=venv --exclude=.venv \
  --exclude=dist --exclude=build --exclude=.git --exclude=chroma_data \
  --exclude=graphify-out --exclude='*.egg-info' . 2>/dev/null | cut -f1)"
echo

echo "## Import cycles (static, stdlib-only Tarjan SCC — no pydeps/madge dep)"
python3 - <<'PYEOF'
import ast, os, sys
from pathlib import Path

def tarjan_sccs(graph):
    index_counter = [0]
    stack, indices, lowlink, on_stack = [], {}, {}, {}
    result = []

    def strongconnect(node):
        indices[node] = lowlink[node] = index_counter[0]
        index_counter[0] += 1
        stack.append(node)
        on_stack[node] = True
        for succ in graph.get(node, ()):
            if succ not in indices:
                strongconnect(succ)
                lowlink[node] = min(lowlink[node], lowlink[succ])
            elif on_stack.get(succ):
                lowlink[node] = min(lowlink[node], indices[succ])
        if lowlink[node] == indices[node]:
            scc = []
            while True:
                w = stack.pop()
                on_stack[w] = False
                scc.append(w)
                if w == node:
                    break
            result.append(scc)

    sys.setrecursionlimit(10000)
    for n in list(graph):
        if n not in indices:
            strongconnect(n)
    return result

def backend_graph(root):
    root = Path(root)
    skip = {"venv", ".venv", "__pycache__", "tests", "site-packages"}
    files = [p for p in root.rglob("*.py")
             if not (skip & set(p.parts)) and not any(part.startswith(".") for part in p.parts)]
    mod_of = {}
    for p in files:
        rel = p.relative_to(root).with_suffix("")
        parts = rel.parts
        mod = "main" if parts == ("main",) else ".".join(parts)
        if p.name == "__init__.py":
            mod = ".".join(parts[:-1]) or mod
        mod_of[mod] = p
    top_packages = {p.parts[0] for p in [f.relative_to(root) for f in files] if len(p.parts) > 1}

    graph = {m: set() for m in mod_of}
    for mod, path in mod_of.items():
        try:
            tree = ast.parse(path.read_text(errors="ignore"), filename=str(path))
        except SyntaxError:
            continue
        pkg_parts = mod.split(".")[:-1]
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    top = alias.name.split(".")[0]
                    if top in top_packages and alias.name in mod_of:
                        graph[mod].add(alias.name)
            elif isinstance(node, ast.ImportFrom):
                if node.level and node.level > 0:
                    base = pkg_parts[: len(pkg_parts) - (node.level - 1)] if node.level > 1 else pkg_parts
                    prefix = ".".join(base)
                    target = f"{prefix}.{node.module}" if node.module else prefix
                elif node.module:
                    top = node.module.split(".")[0]
                    target = node.module if top in top_packages else None
                else:
                    target = None
                if target and target in mod_of:
                    graph[mod].add(target)
    return graph

def frontend_graph(root):
    root = Path(root)
    files = [p for p in root.rglob("*.ts*")
             if "node_modules" not in p.parts and not p.name.endswith(".d.ts")
             and "__tests__" not in p.parts and not p.name.endswith((".test.ts", ".test.tsx"))]
    files_set = {str(p) for p in files}

    def resolve(base_dir, spec):
        # Pure string/lexical resolution (no os.path.resolve()/stat calls —
        # base_dir and files_set are both repo-relative, keep them that way).
        joined = os.path.normpath(os.path.join(str(base_dir), spec))
        for suffix in ("", ".ts", ".tsx", f"{os.sep}index.ts", f"{os.sep}index.tsx"):
            cand = joined + suffix
            if cand in files_set:
                return cand
        return None

    import re
    import_re = re.compile(r"""from\s+['"](\.[^'"]+)['"]""")
    graph = {str(p): set() for p in files}
    for p in files:
        try:
            text = p.read_text(errors="ignore")
        except OSError:
            continue
        for m in import_re.finditer(text):
            target = resolve(p.parent, m.group(1))
            if target:
                graph[str(p)].add(target)
    return graph

def report(name, graph, root_label):
    sccs = [s for s in tarjan_sccs(graph) if len(s) > 1]
    total_nodes_in_cycles = sum(len(s) for s in sccs)
    print(f"{name}: {len(sccs)} cycle(s), {total_nodes_in_cycles} module(s) involved")
    for s in sorted(sccs, key=len, reverse=True)[:3]:
        short = [Path(x).name if "/" in x or x.endswith((".ts", ".tsx")) else x for x in s]
        print(f"  example ({len(s)} modules): {', '.join(sorted(short)[:6])}{' ...' if len(s) > 6 else ''}")

report("backend  (src/backend, excl. tests/)", backend_graph("src/backend"), "src/backend")
report("frontend (src/frontend/src)", frontend_graph("src/frontend/src"), "src/frontend/src")
PYEOF
