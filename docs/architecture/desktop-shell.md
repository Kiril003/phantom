# Cluster ADR: desktop-shell

**Status**: Phase-2 architecture decisions for the `desktop-shell` + `runtime-perf`
cluster. Day-4 baseline: `53d16bc`. Authored against
`docs/PHASE1_CONTEXTS.md:13-27`, `docs/PHASE1_BLOCK_ORDER.md:31-39,55,103-105`,
`docs/PHASE1_DEPENDENCY_GRAPH.md:107-108`, and audit findings
`docs/audit-2026-05-01-day4/FINDINGS.md` U5-PKG-* (lines 405-505) and U8-PERF-*
(lines 688-799).

This file is the **single consolidated ADR** for the cluster (operator brief).
Five ADRs (DSH-001..003 + RTP-001..002) plus shared interfaces, test plan,
budgets, and back-compat invariants.

---

## ADR-DSH-001 — Tauri 2.x packaging recipe

**Decision**: ship the desktop installer as **Tauri 2.x with a PyInstaller
`--onedir` Python sidecar** that runs the existing
`uvicorn main:app` (`src/backend/main.py:766-778`) bound to **127.0.0.1 only**.
The Rust shell hosts the existing React bundle (`src/frontend/`) inside the
OS-native WebView (Edge WebView2 on Windows, WebKitGTK on Linux). One installer
artefact per (`x86_64-pc-windows-msvc`, `aarch64-unknown-linux-gnu`,
`x86_64-unknown-linux-gnu`) target.

**Drivers**:
- U5-PKG-C1 (FINDINGS.md:407-411) — no desktop scaffold exists today
  (`ls src/frontend/src-tauri/` returns empty); Block V-1 must scaffold.
- U5-PKG-G1 recommendation (FINDINGS.md:471-486) — Tauri ~3 MB Rust core +
  OS WebView vs. Electron's 150 MB baseline; we already pay ~3 GB in Python deps
  (torch via sentence-transformers ~800 MB, faster-whisper, vosk, piper-tts,
  opencv, playwright per-platform).
- Existing static-mount path at `main.py:705-712` (`PHANTOM_FRONTEND_DIST`) is
  already env-overridable — Tauri sidecar inherits without code change.

**Alternatives rejected**:
- **Electron** — bundle baseline 150 MB doubles a runtime cost we can't afford
  at 2.5–3.5 GB total (FINDINGS.md:434-438).
- **PyInstaller alone** — ships no native window; needs separate frontend launcher.
- **Briefcase** — Windows MSI only, no signed installer pipeline mature enough
  for a 3 GB payload.
- **WebView2 manual bootstrap** — Tauri's installer already handles Win10<19041.

**Sidecar contract**:
- Command: `phantom-backend --no-server-binding` (force `host=127.0.0.1` —
  see ADR-DSH-003).
- Lifecycle: Tauri owns process; `Drop` impl sends `SIGTERM`, 2 s grace, `kill`
  (mirrors the `mcp/adapter.py:79-89` shutdown shape cited in FINDINGS.md:393-394).
- Splash gate: Tauri's WebView shows a splash until `/readyz` returns 200; per
  ADR-RTP-001 G1+G2 lanes complete in ≤ 2 s (FINDINGS.md:691-705).
- Updater: Tauri ships an updater; Day-4 Block V-1 stops at scaffold + signed
  manifest stub. Code-signing keys (Authenticode + Apple notarisation —
  FINDINGS.md:464-466) deferred to Day-5 per `docs/PHASE1_CONTEXTS.md:19`
  (V-1 belongs to desktop-shell context, signing tagged Day-5).

---

## ADR-DSH-002 — OS-aware data-path resolver

**Decision**: introduce `src/backend/paths.py` that exports
`resolve_data_dir(kind)` returning a `pathlib.Path` derived from
`platformdirs` (already vendored — `.venv/.../platformdirs-4.9.6.dist-info`
present). All four currently-hardcoded paths flip to lazy resolver calls:
- `config.chroma_path` default `"./chroma_data"` (`config.py:40`) →
  `resolve_data_dir("chroma")`.
- `config.database_url` default `"sqlite+aiosqlite:///./phantom.db"` (`config.py:37`)
  → `f"sqlite+aiosqlite:///{resolve_data_dir('sqlite')/'phantom.db'}"`.
- `silero_path` hardcoded relative in `main.py:357-359` →
  `resolve_data_dir("voice_models") / "silero-vad" / "silero_vad.onnx"`.
- `PHANTOM_FRONTEND_DIST` default `/app/dist` (`main.py:706`) →
  `resolve_data_dir("frontend_dist")` with env override preserved.

**Drivers**:
- U5-PKG-H1 (FINDINGS.md:428-433) — `./chroma_data` cwd in `Program Files\PHANTOM\`
  hits UAC; defaults must be Linux `~/.local/share/phantom-os/...`,
  Windows `%APPDATA%\PHANTOM\...`, macOS `~/Library/Application Support/PHANTOM/...`.
- U5-PKG-H3 (FINDINGS.md:440-443) — `PHANTOM_FRONTEND_DIST=/app/dist` POSIX
  path breaks Tauri sidecar layout where dist sits next to the exe.

**Alternatives rejected**:
- **Inline `os.name` branches at every call site** — five hardcoded paths
  decay independently; refactor pattern from FINDINGS.md U5-PKG-H1 prose explicit.
- **Roll our own platform detection** — `platformdirs` is already in deps
  (no new pin required), single-source-of-truth for XDG / Known-Folder /
  AppSupport semantics.

**Resolver semantics**: env override (`PHANTOM_DATA_DIR`,
`PHANTOM_FRONTEND_DIST`) wins; otherwise:
- packaged mode (`PHANTOM_PACKAGED=1`) → `platformdirs.user_data_dir("PHANTOM", "PHANTOM-OS")`
- dev mode → repo-root `.phantom-data/` (kept inside `.gitignore`).

`mkdir(parents=True, exist_ok=True)` is performed once at lifespan G1 (see
ADR-RTP-001) before any subsystem touches the path.

---

## ADR-DSH-003 — `_refuse_lan_bind_in_packaged_mode` lifespan refuse pattern

**Decision**: extend the existing "refuse to start" family
(`main.py:147-208`) with a third member that aborts startup when
`PHANTOM_PACKAGED=1` AND `config.host != "127.0.0.1"`. Mirrors the exact shape
of `_refuse_ci_default_secret` (`main.py:147-174`) and
`_refuse_unsupported_deployment_mode` (`main.py:177-208`): pure validation
function called early in `lifespan`, raising `RuntimeError` with an actionable
message; pytest exempt via existing `"pytest" in sys.modules` pattern.

**Drivers**:
- U5-PKG-H4 (FINDINGS.md:444-447) — `host: str = "0.0.0.0"` (`config.py:30`)
  default would expose the entire backend to LAN inside a packaged
  desktop; D3-A-1 default-PIN guard does NOT compensate.
- FINDINGS.md:501-504 explicitly names this function ("the `refuse to start`
  pattern is exactly what desktop build should extend with
  `_refuse_lan_bind_in_packaged_mode`").

**Alternatives rejected**:
- **Silently rewrite `config.host = "127.0.0.1"`** — silent mutation breaks
  the existing audit trail; refuse is louder and operator can fix once.
- **Tauri-side check only** — backend can also be launched outside Tauri
  (dev shell, future systemd unit); the refuse must live in the lifespan.

**Activation signal**: `PHANTOM_PACKAGED=1` set by Tauri's sidecar `Command`
spawn (one line in `tauri.conf.json` external binary entry). The signal is
positive (not derived from absent dev hints) so that a developer running
`uvicorn main:app` locally never trips the guard.

---

## ADR-RTP-001 — Lifespan parallelisation via asyncio.gather staged groups

**Decision**: split the current strictly-serial lifespan body
(`main.py:212-518`, ~15 ordered awaits) into three named coroutines plus
fire-and-forget background launcher:

- **G1 (sync deps, must complete before G2)** — `init_db` (`main.py:217`),
  settings overrides (`main.py:224-233`), context-engine ai-provider
  reconcile (`main.py:241-243`), logger reconfigure (`main.py:249-265`),
  `ensure_default_user` (`main.py:268-271`), `paths.ensure_data_dirs()`
  (new — see ADR-DSH-002), `_refuse_*` triple (incl. ADR-DSH-003). All on the
  same SQLite connection — must serialise.
- **G2 (parallel warmups, awaited via `asyncio.gather(..., return_exceptions=True)`)**
  — MiniLM warm (`main.py:274-281`), Chroma eager init (`main.py:283-301`),
  Chroma janitor (`main.py:316-339`), CPU sampler start (`main.py:344-349`),
  `preload_voice_models` (`main.py:352-366`). Each lane is independent
  (no shared state writes, all module-level singletons with their own locks);
  the slowest lane bounds the gate.
- **G3 (background tasks fired post-yield-ready)** — context loop
  (`main.py:427`), serial bridge (`main.py:399-402`), OLED animator
  (`main.py:432-433`), emotion decay (`main.py:455-465`), proactive loop
  (`main.py:470-485`), standing orders runner (`main.py:488-495`), episodic
  backfill (`main.py:498-508`), MCP discovery (`main.py:511-518`), state
  broadcaster (`main.py:377-395`). All `asyncio.create_task(...)`; any
  failure logs at WARN, never aborts startup. The HTTP listener accepts at
  G2-complete; the WS hub accepts at G2-complete (Whisper warm not required
  for first WS — voice path lazy-fails on cold).

**Drivers**:
- U8-PERF-C1 (FINDINGS.md:691-705) — current cold boot 8-15 s; "none of these
  block each other — they should run via `asyncio.gather(...)` or
  `asyncio.create_task(...)` so the HTTP listener accepts well before voice
  is warm".
- ADR-DSH-001 sidecar splash binds to `/readyz` — every 100 ms saved on G1+G2
  is 100 ms less black screen.

**Alternatives rejected**:
- **`asyncio.wait_for` on the gather** — cancels surviving tasks on first
  failure (FINDINGS.md:243-247 cites the same hazard for the orchestrator;
  identical reasoning here).
- **All three groups → one `gather`** — db + settings + janitor all touch
  SQLite; race window between janitor and `ensure_default_user` not worth
  the 50 ms shave.
- **Eager Whisper model load in G2** — `_ensure_model()` first transcribe
  costs 1-3 s (FINDINGS.md U8-PERF-H4 lines 727-735); preload is fine but
  the real bytes-decoded warmup belongs Day-5.

**Failure semantics**: Any G1 await raising aborts startup with the existing
error path. G2 is `return_exceptions=True`; per-lane failure logs WARN and
records a `phantom_lifespan_g2_failures_total` counter (Counter primitive,
existing — `observability.py:215-238`); operator-facing `/readyz` already
exposes the downstream effects (FINDINGS.md:412-433). G3 task failures log
WARN — the existing per-block try/except blocks (`main.py:283-301`,
`main.py:344-349`, etc.) carry over into the create_task wrapper.

---

## ADR-RTP-002 — Histogram primitive (peer of Counter/Gauge in observability.py)

**Decision**: add `Histogram` class to `src/backend/observability.py` (new lines,
no edits to existing `Counter` (line 215) / `Gauge` (line 241) / `_REGISTRY`
list (line 263) shape). Default bucket boundaries chosen for chat-turn /
STT / WS-broadcast latency in milliseconds: `(5, 10, 25, 50, 100, 250, 500,
1000, 2500, 5000, 10000, +Inf)`. Three concrete instruments registered in
`observability.py` immediately:

- `phantom_chat_response_latency_ms` — observed by `routes_chat._build_ai_response`
  (existing `latency_ms` JSON metadata at `routes_chat.py:502,752` per
  FINDINGS.md:723-726).
- `phantom_voice_stt_latency_ms` — labelled `engine` (`vosk`/`whisper`/
  `whisper_npu`/`mms_npu`); observation point: STT provider's existing
  `STTResult` carries durations.
- `phantom_ws_broadcast_latency_ms` — observed in `websocket_hub.broadcast`
  around the existing `_lock` block (FINDINGS.md U8-PERF-M1 lines 738-744).

**Drivers**:
- U8-PERF-G1 (FINDINGS.md:769-775) — "Charter promises p50 budget. There is
  no SLO defined, no histogram, no acceptance test that asserts a p50 on
  `/metrics`. Load-bearing observability gap".
- U8-PERF-H3 (FINDINGS.md:721-726) — chat / STT / TTS / AI all log
  `latency_ms` into JSON metadata but never aggregate.

**Alternatives rejected**:
- **Pull `prometheus_client`** — `observability.py:18-22` documents the
  intentional choice ("a Prometheus-client dep would be the obvious choice
  but the audit budget rejects 'broad pip install everything' without
  justification"). Hand-rolled Histogram fits the same precedent.
- **Summary (quantile) instead of Histogram** — quantiles can't be
  aggregated across instances; histogram buckets can. K8s / multi-instance
  forward-compat wins.
- **Per-call list of samples** — unbounded memory; bucket counters are O(buckets).

**Exposition shape** (Prometheus text format, matches existing `Counter.render`
convention at `observability.py:230-238`):

```
# HELP phantom_chat_response_latency_ms Chat AI response latency in ms.
# TYPE phantom_chat_response_latency_ms histogram
phantom_chat_response_latency_ms_bucket{le="5"} 0
phantom_chat_response_latency_ms_bucket{le="10"} 2
...
phantom_chat_response_latency_ms_bucket{le="+Inf"} 47
phantom_chat_response_latency_ms_sum 41250.5
phantom_chat_response_latency_ms_count 47
```

Render hook: `_REGISTRY` (`observability.py:263`) already iterates `.render()` —
Histogram conforms.

---

## Interfaces (concrete signatures)

```python
# ── src/backend/paths.py (NEW — ADR-DSH-002) ──────────────────────────────────
from pathlib import Path
from typing import Literal

DataKind = Literal["chroma", "sqlite", "voice_models", "frontend_dist", "workspace"]

def resolve_data_dir(kind: DataKind) -> Path:
    """OS-aware data-path resolver. Honours PHANTOM_DATA_DIR /
    PHANTOM_FRONTEND_DIST env overrides; in packaged mode (PHANTOM_PACKAGED=1)
    falls back to platformdirs.user_data_dir; in dev falls back to repo-root
    `.phantom-data/`. Idempotent — caller may invoke many times. Caller is
    responsible for `mkdir(parents=True, exist_ok=True)` only if intending
    to write. Use `ensure_data_dirs()` once at lifespan G1 to materialise
    all four canonical directories."""
    ...

def ensure_data_dirs() -> None:
    """Materialise chroma / sqlite / voice_models / workspace dirs. Idempotent.
    Called once at lifespan G1 in main.lifespan after settings load."""
    ...


# ── src/backend/observability.py (additions — ADR-RTP-002) ────────────────────
DEFAULT_BUCKETS_MS: tuple[float, ...] = (
    5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
)

class Histogram:
    def __init__(
        self,
        name: str,
        help_text: str,
        buckets_ms: tuple[float, ...] = DEFAULT_BUCKETS_MS,
    ) -> None: ...

    def observe(self, value_ms: float, **labels: str) -> None:
        """Record one observation. value_ms < 0 silently dropped (clock
        skew / monotonic regression). Same labels protocol as Counter."""
        ...

    def render(self) -> Iterable[str]:
        """Prometheus text-format exposition. Yields _bucket{le=…},
        _sum, _count rows, mirroring Counter.render line-yielding shape."""
        ...

# Concrete instruments registered alongside existing Counters:
chat_response_latency_ms: Histogram = _register(
    Histogram("phantom_chat_response_latency_ms", "Chat AI response latency (ms).")
)
voice_stt_latency_ms: Histogram = _register(
    Histogram("phantom_voice_stt_latency_ms", "STT latency (ms) by engine.")
)
ws_broadcast_latency_ms: Histogram = _register(
    Histogram("phantom_ws_broadcast_latency_ms", "WS broadcast fan-out latency (ms).")
)


# ── src/backend/main.py (ADR-RTP-001 staged groups) ───────────────────────────
async def _warmup_g1_sync_deps() -> None:
    """G1 — strictly-serial sync deps that share SQLite or mutate config singleton.
    init_db → settings load → context_engine.set_ai_provider → logger reconfigure
    → ensure_default_user → paths.ensure_data_dirs → _refuse_* triple."""
    ...

async def _warmup_g2_parallel() -> None:
    """G2 — parallel warmups via asyncio.gather(return_exceptions=True).
    MiniLM warm + Chroma eager + Chroma janitor + CPU sampler + preload_voice_models.
    Each lane wraps its own try/except → log WARN; counter
    phantom_lifespan_g2_failures_total{lane=…} bumps on per-lane failure."""
    ...

def _start_g3_background_tasks() -> list[asyncio.Task]:
    """G3 — fire-and-forget. Returns task handles for shutdown cancel.
    Context loop, serial bridge, OLED, emotion decay, proactive, standing
    orders, episodic backfill, MCP discovery, state broadcaster."""
    ...


# ── src/backend/main.py (ADR-DSH-003 lifespan refuse) ─────────────────────────
def _refuse_lan_bind_in_packaged_mode() -> None:
    """Refuse to start when PHANTOM_PACKAGED=1 AND config.host != '127.0.0.1'.
    Mirrors _refuse_ci_default_secret (main.py:147) and
    _refuse_unsupported_deployment_mode (main.py:177): pytest-exempt via
    'pytest' in sys.modules; raises RuntimeError with actionable message."""
    ...
```

---

## Test plan

| Block | Test | Acceptance |
|---|---|---|
| **V-2** | `test_data_dir_linux_dev` | `PHANTOM_PACKAGED` unset → `resolve_data_dir("chroma")` returns repo-root `.phantom-data/chroma`. |
| **V-2** | `test_data_dir_packaged_path` | `PHANTOM_PACKAGED=1` + monkeypatched `platformdirs.user_data_dir` → resolver returns `<mock>/chroma`. |
| **V-2** | `test_data_dir_env_override_wins` | `PHANTOM_DATA_DIR=/tmp/foo` set → resolver returns `/tmp/foo/chroma` regardless of packaged flag. |
| **V-3** | `test_npu_provider_skipped_on_win32` | `monkeypatch.setattr(sys, "platform", "win32")` → `build_stt_provider()` (`stt_engine.py:484`) does NOT import `voice.whisper_npu_provider` / `voice.mms_npu_provider`; falls through to faster-whisper or vosk. Verified via `sys.modules` post-call assertion. |
| **V-4** | `test_lan_bind_refused_in_packaged` | `monkeypatch.setenv("PHANTOM_PACKAGED", "1")` + `config.host = "0.0.0.0"` → calling `_refuse_lan_bind_in_packaged_mode()` raises `RuntimeError`. |
| **V-4** | `test_lan_bind_allowed_dev_mode` | `PHANTOM_PACKAGED` unset + `host=0.0.0.0` → no raise (dev parity preserved). |
| **V-5** | `test_lifespan_g1_serial` | Mock `init_db` to record call order; assert settings load runs strictly after `init_db` returns. |
| **V-5** | `test_lifespan_first_ws_under_2s` | Mock `preload_voice_models` to sleep 5 s. Boot lifespan; assert first `/ws` connect succeeds < 2 s (G2 voice lane no longer gates the WS accept). Uses existing TestClient fixture pattern from `tests/test_phase_audit_2026_04_29_h3_h4.py`. |
| **V-5** | `test_lifespan_g2_lane_failure_logged_not_fatal` | Mock Chroma eager to raise; assert lifespan completes, counter `phantom_lifespan_g2_failures_total{lane="chroma"}` == 1, `/healthz` 200. |
| **V-6** | `test_histogram_observe_renders` | `h.observe(150)` then `h.render()` includes `_bucket{le="250"} 1` and `_bucket{le="100"} 0`, plus `_sum 150` and `_count 1`. |
| **V-6** | `test_histogram_chat_latency_label` | After one `_build_ai_response` call, `/metrics` body contains `phantom_chat_response_latency_ms_bucket{le=…}` rows AND `phantom_chat_response_latency_ms_count > 0`. |
| **V-6** | `test_histogram_negative_dropped` | `h.observe(-1)` no-ops; count unchanged. |

All tests live under `src/backend/tests/`. Convention preserved from existing
suites (`test_phase_audit_2026_04_29_h3_h4.py` already in working tree).

---

## Performance budgets

- **Lifespan G1+G2 ready**: p95 ≤ **2000 ms** (today: 8000-15000 ms per
  FINDINGS.md:691-705). Splash-to-WS gate.
- **Lifespan G1 alone (sync deps)**: p95 ≤ **400 ms** — `init_db` + settings
  load + `ensure_default_user` are the floor.
- **Histogram `observe()` overhead**: p99 ≤ **50 µs** (single dict lookup +
  one float add + one bucket index). Hot-path safe for chat/STT.
- **/metrics render** of 3 histograms × 11 buckets + existing Counters/Gauges:
  p95 ≤ **5 ms** (string concat + sorted dict iteration only; no I/O).
- **Tauri sidecar splash**: black screen ≤ **2.5 s** on Q6A cold boot
  (G1+G2 ≤ 2 s + 500 ms Tauri WebView init).

---

## Day-4 ship contract (back-compat invariants)

1. **`/healthz`, `/readyz`, `/metrics` route shapes are frozen.** Histograms
   are ADDITIVE — they appear as new lines in `/metrics`; existing dashboards
   still parse `phantom_chat_messages_total` etc. unchanged.
2. **Counter/Gauge primitives untouched.** `Counter` (`observability.py:215`),
   `Gauge` (`observability.py:241`), `_REGISTRY` list (`observability.py:263`)
   all keep their current public shape. Day-3 dashboards do not break.
3. **Lifespan order rearrangement preserves error semantics.** Any G1 await
   failure aborts startup as today. Any G2 lane failure logs WARN (matches
   today's per-block `try/except` policy at `main.py:280, 300, 339, 348, 365`)
   AND increments `phantom_lifespan_g2_failures_total{lane=…}` so operators
   notice via `/metrics`.
4. **Path resolver is opt-in via env.** `PHANTOM_DATA_DIR` unset + dev mode →
   resolver returns repo-root `.phantom-data/` (already gitignored). Existing
   `./chroma_data` and `./phantom.db` artifacts on operator disks are
   migrated by a one-time symlink at first packaged-mode boot (Block V-2
   exit criterion).
5. **`_refuse_lan_bind_in_packaged_mode` only fires under `PHANTOM_PACKAGED=1`.**
   Dev `uvicorn main:app` with `host=0.0.0.0` continues to work — pytest +
   developer parity preserved (matches the exemption pattern at
   `main.py:164-167`).
6. **NPU win32 hard-skip is a factory branch, not import-time.** `sys.platform
   == "win32"` check inserted in `voice.stt_engine.build_stt_provider`
   (`stt_engine.py:484`) BEFORE the NPU provider modules are imported
   (FINDINGS.md U5-PKG-C3 lines 419-425 — "onnxruntime-qnn import alone may
   segfault on x86_64 Windows"). Linux behaviour unchanged.
7. **Chat hot-path latency observability is non-blocking.** `Histogram.observe()`
   is synchronous and dict-only; no asyncio yield, no I/O. Failure to record
   never raises (try/except in `observe`).

---

## Cross-context contract anchors

- `desktop-shell` ↔ `runtime-perf` cross-contract listed in
  `docs/PHASE1_DEPENDENCY_GRAPH.md:108`: "Tauri sidecar splash duration tied
  to `/readyz` G1 vs G2 voice-warm" — ADR-DSH-001 + ADR-RTP-001 jointly close it.
- `desktop-shell` consumes `runtime-perf` per
  `docs/PHASE1_CONTEXTS.md:16` (Histogram + lifespan optimisations land
  before V-1 splash demo).
- `runtime-perf` produces `chat-liveness`, `ai-hub`, `agent-orchestration` per
  `docs/PHASE1_CONTEXTS.md:24` — Histogram instruments will be reused by those
  clusters' Phase-3 ADRs (out of scope here; this ADR registers the primitive only).

---

## Phase-3 block sequencing (this cluster)

Per `docs/PHASE1_BLOCK_ORDER.md`:

- **Wave 1** (parallel-safe, no deps): V-2 (90 LOC), V-3 (30 LOC), V-4 (35 LOC).
- **Wave 2** (after V-2 lands): V-1 (220 LOC) Tauri scaffold; V-5 (110 LOC,
  blocks_by V-2) lifespan gather; V-6 (180 LOC) Histogram primitive.
- **Wave 3** (optional): V-7 (60 LOC) requirements split, V-8 (70 LOC) chat
  commit defer, V-9 (55 LOC) presence-aware context loop.
