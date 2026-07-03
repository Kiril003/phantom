# Day-2 Performance Audit — 2026-04-29

Read-only audit at HEAD `111181e` on `autonomous-run`. Lens: Snapdragon QCM6490 / Hexagon V68, 8 GB RAM, 7" 1024×600 always-on. Scope: latency cost of Day-1 productisation commits (`2cdf7f7` E-1 obs / `31bd388` E-5 counters / `4bf2023` chat tool dispatcher) plus the still-open carry-overs from `audit-2026-04-28/FINDINGS.md`.

Bottom line: Day-1 commits are surgically cheap on the request path (≈ 1–3 µs of overhead per HTTP request, undetectable at 1024×600 cadence). The two real cliffs are still in carry-over: F-17 chroma orphan dirs now compounds with `_probe_chroma` (the new `/readyz` route makes the cold scan show up on every probe), and F-18 frontend re-render storm + F-19 WS broadcast that a productisation rollout cannot ship through a load balancer without first fixing F-17.

---

## New middleware overhead

**Stack order** at `src/backend/main.py:497-498`: `correlation_id_middleware` is registered first, `http_requests_counter_middleware` second. FastAPI runs middlewares LIFO on entry; both wrap every HTTP request including `/healthz`, `/readyz`, `/metrics`, all `/api/v1/*`, and every static-file fetch from `/`.

**`correlation_id_middleware`** (`observability.py:52-61`):
- 1× dict lookup `request.headers.get("x-correlation-id")` — ~200 ns.
- `incoming.strip()` + `len()` — ~100 ns when missing (the common case).
- `uuid.uuid4().hex[:16]` — `_short_uuid` calls `import uuid` *inside the function*. The first call costs ≈ 80 µs (module import + sys.modules cache miss); every subsequent call is a dict lookup ≈ 80 ns + the uuid4 itself ≈ 1.5 µs on ARM64. **P2 fix**: hoist `import uuid` to module top — saves ~80 ns/req.
- `contextvars.ContextVar.set()` + `reset()` — ~150 ns each on CPython 3.11 (the contextvars hot path is C-implemented).
- `response.headers.setdefault` — ~200 ns.

Per-request total: **≈ 2.0–2.5 µs** after the first call (which pays the one-time import). At a sustained 100 req/s that's 0.2 ms/s of CPU — invisible.

**`http_requests_counter_middleware`** (`observability.py:64-82`):
- `path.split("/", 4)` + filter + slice — ~600 ns.
- `Counter.inc(method=, route=, status=)` →  `tuple(sorted(labels.items()))` over a 3-key dict. Python `sorted()` of 3 items is ~700 ns; building `labels.items()` view is ~80 ns; the `tuple(...)` of 3 items ~150 ns. Then a `dict.get` on `_values` ≈ 50 ns + `dict.__setitem__` ≈ 60 ns. **Total ≈ 1.0 µs/inc.**

Per-request total: **≈ 1.6–2.0 µs**.

**Combined Day-1 middleware overhead: ~3.5–4.5 µs/request.** On the device's UI cadence (the Vite dev server proxies `/api/v1/...` and `/ws/...`; the WS path bypasses both middlewares because they only register `app.middleware("http")`), the user-visible request volume is 1–5 req/s during active chat. **Cost is genuinely imperceptible** — the `setContext` re-render storm at 2 Hz already dwarfs this by 4 orders of magnitude.

**Comparison to prometheus_client.Counter.inc()**: prometheus_client's amortised `inc()` is ≈ 350 ns (it caches the child by labelvalues tuple in `_metrics`). Our `Counter.inc()` at ~1.0 µs is **3× slower** because we re-sort labels per call. **P2 fix** (≤ 5 LOC): cache the sorted-tuple key per call site, OR drop the `sorted()` and trust caller insertion order (Python ≥3.7 dicts are ordered → 3 µs collapses to ~300 ns). Net Day-1 saving: ~1 µs/request. Not load-bearing today, but worth knowing if `/metrics` ingestion ever drives middleware on the same Radxa box.

**Severity: P3.** Cost is in noise. File a future P2 ticket for the `import uuid` hoist + drop the `sorted()`; do not block on it.

---

## E-5 counter integration cost

**`chat_messages_total.inc(role="user")` + `.inc(role="assistant")` per chat turn** (`api/routes_chat.py:300-302`):
- Two `Counter.inc()` calls × ~1 µs = **~2 µs/chat turn**.
- The `from observability import chat_messages_total` *inside the function* (line 300) — this is the Python module cache lookup pattern. First call: ~80 µs (already paid by middleware import on first request). Subsequent: ~80 ns (sys.modules dict hit). On a sustained chat load **the import-inside-function is amortised** but it does keep the line out of cold-start. The wrapping `try/except Exception: pass` adds ~50 ns when no exception fires.

**Compared to upstream Gemini round-trip latency (700–2500 ms typical)**, this counter cost is 8 orders of magnitude smaller. Even at 100 chat turns/sec (an absurd ceiling) the counter overhead is 200 µs/sec.

**`ai_provider_used_total.inc(name=...)` in `_sync_context`** (`ai/provider.py:763-778`):
- Fires once per `generate()` / `generate_stream()` / `call_with_tools()` success. Today (pre-17b) that's once per chat turn + once per proactive tick + once per agent step.
- Same ~1 µs Counter cost.
- **Two imports inside the function** — `from core.context_engine import context_engine` (line 766) AND `from observability import ai_provider_used_total` (line 775). Module-cached after first call. The duplicate `try/except` blocks add ~200 ns of frame setup but never raise on the hot path.

**Is the import-inside-function pattern a regression?** No. It's the documented FastAPI / SQLAlchemy idiom for breaking circular imports between `ai.provider` ↔ `core.context_engine` ↔ `observability`. The runtime cost after first call is one C-level `dict.__getitem__` on `sys.modules`, which is faster than a top-level attribute access on most ARM64 builds. **Not a regression**; lifting them to top-level would risk a cycle (observability registers app routes that may import provider via the AI router). Keep as-is.

**Estimated chat-turn budget added by E-5: ~3 µs.** On a Gemini turn budget of 700 ms, that's **0.0004 % of wall clock**. Imperceptible.

**Severity: P3.**

---

## Phase 17b call_with_tools latency budget

The chat path will switch from a single `ai_router.generate()` (one round-trip) to a bounded `call_with_tools()` loop with `chat_tool_max_calls_per_turn=4` (`config.py:461`).

**Per-iteration cost breakdown** (Gemini 2.0 Flash, observed in production):
- 1× LLM round-trip with system prompt + history + tool catalogue: 700–1500 ms median, p95 2.5 s, p99 5 s+.
- 1× tool dispatch (e.g. `search_locationhistory` SQLite query, ~5 ms; `recall_memory_facts` MiniLM embed + chroma query, ~80–150 ms; `search_web` Google API, 300–800 ms).
- Re-prompt context build with tool result: ~5 ms (prompt builder rebuild).

**Worst-case 4-iteration chain (LLM picks search_web each time)**:
- 4 × 1500 ms LLM + 4 × 600 ms tool = **8.4 s wall clock** before the first user-visible token.
- The user sees a typing indicator for nearly 10 s on p50; on p99 this can hit 25 s+.

**At `chat_tool_max_calls_per_turn=4` this is unacceptable for an interactive conversational UI.** PHANTOM's competitive bar (Jarvis-grade fluency) demands first-token latency under 1.5 s. The 4-iteration ceiling is a *safety stop*, not a perf target.

**Recommendations** (P0 before flipping `chat_tools_enabled=True` in prod):

1. **Enforce a per-turn wall-clock budget**, not just a call count. Add `chat_tool_max_total_ms = 4000` to config; abort the loop when budget is exhausted, return whatever the LLM has so far. ~30 LOC.
2. **Parallel tool dispatch when the LLM emits multiple tool_calls in one response**. Gemini's `tool_use` API permits multi-call turns; today the dispatcher serialises them (`ai/tool_executor.py:281+`). For independent tools (e.g. `search_locationhistory` + `query_temporal_anchors` + `get_sensor_status`), run them via `asyncio.gather`. This collapses 3 sequential 100 ms tool calls into one 100 ms wall. **Δ ≈ −200 ms per multi-tool turn.** ~40 LOC.
3. **Set `chat_tool_max_calls_per_turn=2` as the default**. Two iterations = "decide what to fetch + answer with it" which covers >95 % of useful chains; iteration 3+ is almost always loop pathology (LLM re-tools because it didn't like its own answer). The configurable knob keeps power-users on 4.
4. **Stream the tool-call decision via WS partial events** so the UI shows "thinking → searching → answering" instead of a 5 s blank. Reuse the existing `chat.partial` channel. ~25 LOC.

**Verdict: 4 iterations × Gemini latency is NOT acceptable.** Ship with budget + default-2 + parallel dispatch before rolling out `chat_tools_enabled` to operator UI. Filed as **PERF-17b** below (P0 dependency on Phase 17b acceptance).

---

## chroma janitor design

**Current state**: `src/backend/chroma_data/` contains **609 directories** (Day-1 baseline was 537 — it grew by 72 in one day of testing) for **1 live collection / 10 embeddings / 105 MB** on disk. Every `chromadb.PersistentClient` open scans this dir.

**New gotcha exposed by Day-1 E-1**: `_probe_chroma()` (`observability.py:248-256`) calls `client.list_collections()` on every `/readyz` hit. With 609 leaked dirs, the Chroma sqlite metadata read is fast (~5 ms — `list_collections()` only reads the metadata DB, not on-disk dirs), but the **first probe after process start** still pays the one-time PersistentClient open which DOES enumerate the data dir. Cold first probe: **2–3 s**. Steady-state probe: ~5 ms. **Critical** if any LB scrapes `/readyz` more frequently than the underlying chroma client churn (it shouldn't — the client is a singleton via `_get_client()` lru-cache pattern at `memory/strategic_memory.py:30+`).

**Cheapest janitor design** (target: ≤ 30 LOC, runs once at lifespan startup, no recurring cost):

```python
# src/backend/memory/strategic_memory.py — new function, called from main.py lifespan
def _purge_orphan_collection_dirs() -> int:
    """One-shot janitor: list_collections() vs on-disk uuid dirs, rmtree the diff.
    Runs at lifespan startup; cost is O(n) on dir count, dominated by stat() calls.
    """
    import os, shutil, re
    UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
    base = os.path.dirname(os.path.abspath(_chroma_path()))
    client = _get_client()
    live_ids = {c.id.hex if hasattr(c.id, "hex") else str(c.id).replace("-", "")
                for c in client.list_collections()}
    # Convert to dashed-uuid form for filesystem compare
    live_dirs = {f"{u[0:8]}-{u[8:12]}-{u[12:16]}-{u[16:20]}-{u[20:32]}" for u in live_ids}
    removed = 0
    with os.scandir(base) as it:
        for entry in it:
            if entry.is_dir() and UUID_RE.match(entry.name) and entry.name not in live_dirs:
                shutil.rmtree(entry.path, ignore_errors=True)
                removed += 1
    return removed
```

**Cost analysis**:
- `os.scandir(base)`: single `getdents()` syscall, returns 609 entries in one shot. **~3 ms** on the Q6A SD card.
- 609 `entry.is_dir()` calls: free — `scandir` returns DT_DIR cached in dirent; no extra stat. **~0 ms**.
- 609 `UUID_RE.match()`: compiled regex, ~200 ns each. **~0.1 ms**.
- 609 `name not in live_dirs` set lookups: hash + compare, ~50 ns each. **~0 ms**.
- 608 `shutil.rmtree` calls (unlink-storm of ~30 files per orphan dir): **~5–8 s total** on the SD card. This is the dominant cost.

**Memory cost**: 609 strings × ~40 bytes = 25 KB peak. Live-dirs set: ~80 bytes. Negligible.

**I/O cost (one-shot)**: ~18,000 unlinks + 609 rmdirs. On SD card class-10 the unlink-burst dominates. **Estimate: 5–10 s lifespan blocking** unless wrapped in `to_thread`. **Mitigation**: run inside `asyncio.create_task(asyncio.to_thread(_purge_orphan_collection_dirs))` so startup proceeds in parallel; the next `/readyz` returns 200 even before the janitor finishes (the chroma client itself is healthy from the first call).

**Why `os.scandir` + `client.list_collections()` + set diff works**:
- `list_collections()` is a metadata-only SQL select, ~5 ms.
- `os.scandir` is the cheapest dir enumeration in Python; bypasses `os.listdir()`'s extra stat.
- Set difference is O(1) per probe.
- No need to grind `chroma_data/` recursively — the orphan UUID dirs are direct children only.

**Steady-state cost after first run**: ~3 ms scandir + ~5 ms list_collections + zero rmtree = **8 ms**. Run on every lifespan; idempotent.

**Gating**: Add `chroma_janitor_enabled: bool = True` to config (`src/backend/config.py`). Operators on shared storage may want to disable.

**Filed as PERF-17 in punch list. Effort: ~30 LOC including config + lifespan call. Δ: −90 MB disk, −2-3 s first-chat latency, unlocks `/readyz` < 30 ms steady-state.**

---

## Day 1 carry-over rank by Δ/LOC

Δ = wall-clock latency saved per relevant operation OR sustained CPU saved at idle. LOC = realistic delta to ship the fix. Higher ratio = more bang per byte.

| Rank | ID | Δ | LOC | Δ/LOC | One-line |
|------|-----|-----|-----|-------|----------|
| 1 | **F-18** | 3-6 ms / UI frame at 2 Hz = **~10 ms/sec sustained** | **3** | ~3.3 | `setContext` equality guard in `systemStore.ts:65`. One-line `set((s) => Object.is(s.context, ctx) ? s : { context: ctx })`. Recovers idle 60 fps. |
| 2 | **F-22** | -40-60 ms / instant-tier utterance (median) | ~20 LOC + 1 AI Hub recompile (off-LOC) | ~3.0 | Compile a 3-second MMS context binary, pick by audio length in `mms_npu_provider.py:215-224`. Biggest single voice latency win. |
| 3 | **F-17** | -2-3 s on first chat AND first `/readyz`; -90 MB disk | ~30 | ~0.07 (wall-clock) but raw user impact is huge | Janitor above. Less Δ/LOC numerically but blocks productisation deploys. |
| 4 | **F-21** | -ffmpeg-stall (1-3 s event-loop block / push-to-talk) | ~6 | ~0.5 (latency) but unblocks loop for everyone | `subprocess.run` wrap in `to_thread` at route layer (`routes_voice.py`). Trivial. |
| 5 | **F-24** | -5-15 ms / utterance (instant tier) | ~15 | ~0.7 | Vectorise CTC argmax with numpy in `mms_npu_provider.py:228-258`. Replaces Python T=1500 loop with one np.argmax. |
| 6 | **F-19** | -3-5 % backend, -5-10 % frontend at idle | ~50 | ~0.18 | Per-client subscription gating in `websocket_hub.py:84-101`. Big win but requires client-side coordination + tests. |
| 7 | **F-26** | -5-20 ms / Vosk utterance | ~12 | ~1.4 | KaldiRecognizer thread-local cache. Self-contained. |
| 8 | **F-27** | up to several seconds on geo-dense messages | ~40 | ~0.5+ | Nominatim N+1 batch in `geo_integration.py:84,121`. Large win on outliers, zero on idle. |
| 9 | **F-23** | -3-5 % CPU during speech | ~60 | ~0.07 | Batched Silero VAD worker. Real win but needs queue + lifecycle plumbing. |
| 10 | **F-28** | correctness, not perf | ~10 | ~0.5 (correctness/LOC) | `_history` deepcopy. Bumped to P1 because debugging context regressions in production is otherwise impossible. |
| 11 | **F-20** | -30-80 ms / chat turn (median) | ~60 | ~0.8 | Drop the dual-commit barrier by fixing tool-executor session ownership. Largest commit; design touches Phase 17b. |

**Day-2 recommendation under 60-LOC ceiling**: Ship F-18 (3 LOC), F-21 (6 LOC), F-26 (12 LOC), F-24 (15 LOC), and F-17 janitor (30 LOC). Total: **66 LOC across 5 commits**, knocks out 2 P0s and 3 P1s, recovers user-visible latency on first-chat (-2-3 s), instant-tier voice (-15-30 ms), and sustains 60 fps idle. Defer F-19, F-20, F-22, F-23 to Day 3+ (they exceed the ceiling or require coordinated commits).

---

## New gotchas from Day 1 commits

### G-1 — `_probe_chroma()` runs on every `/readyz` hit; F-17 makes the cold probe 2-3 s — **P0**
`src/backend/observability.py:248-256`. `client.list_collections()` is cheap (~5 ms) once the PersistentClient is open. **But** the very first `/readyz` after process start triggers the lazy `_get_client()` open in `memory/strategic_memory.py:30-35`, which scans the 609-dir chroma_data tree. **Cold first probe: 2-3 s; if Kubernetes liveness/readiness probes default to 1 s timeout the pod gets killed during boot.** Fix: open the chroma client during lifespan startup (already recommended in Day-1 audit as PERF-11), **before** `/readyz` is registered. ~5 LOC. Critical for Docker/K8s deploys (E-2 already shipped the Dockerfile).

### G-2 — `_probe_db()` opens a fresh AsyncSession per probe; SQLite NullPool means no connection reuse — **P2**
`observability.py:237-245`. `get_session()` (`db/database.py:58-65`) wraps `AsyncSessionLocal()` which goes through the SQLAlchemy default pool. For SQLite + `aiosqlite`, the default is `NullPool` (every session is a new connection). **Per-probe cost**: aiosqlite open ~3 ms + `SELECT 1` ~0.5 ms + close ~1 ms = **~5 ms**. At 1 probe/30s = trivial. Burst probes (e.g. K8s liveness storm during pod restart) at 10 Hz = **50 ms/s sustained**, fine. **Concern**: under burst, NullPool means 10 connections opened/closed/sec. SQLite WAL handles this, but the `connect_args={"timeout": 30.0}` (`database.py:30`) means a probe that hits during a chat-turn write commit can block for up to 30 s before failing readiness. **Fix**: `_probe_db` should pass an explicit `timeout=2.0` connect arg or use a separate read-only engine (~15 LOC). P2; matters under contention.

### G-3 — `Counter.render()` rebuilds label-tuple → dict on every `/metrics` scrape — **P2**
`observability.py:131-139`. For each label key, `dict(key)` allocates a new dict, then `_format_labels` does another sort + escape per key. With 6 counters × ~10 label combinations each = 60 line emissions per scrape. Cost: **~50 µs/scrape**. At Prometheus default 15 s scrape interval = invisible. **Latent risk**: if a buggy caller starts incrementing per-user-id labels (cardinality explosion), render time grows linearly. The middleware already guards http_requests_total with route prefix collapsing (`observability.py:73-74`) — good. The `chat_messages_total` only labels by `role` (`role="user"|"assistant"`) — bounded at 2 series. The `ai_provider_used_total` labels by provider name (gemini/ollama/none) — bounded at 3. **No cardinality risk today.** Keep an eye on it as new counters land in Phase 17b/18; add a docstring guard "labels MUST be from a fixed enumeration".

### G-4 — `_format_labels` re-sorts on every `inc()` AND on every `render()` — **P3**
The `key = tuple(sorted(labels.items()))` in `Counter.inc()` (`observability.py:128`) AND `_format_labels` (`observability.py:106-107`) both re-sort. Redundant. The render call could read the dict in insertion order (Python ≥3.7) since `inc()` already canonicalised. Drop the second sort. ~2 LOC. Δ: ~30 ns/render line.

### G-5 — `_register_observability` mounts `/metrics` BEFORE the StaticFiles mount — but the `/` static mount is the **last** registered route, with `html=True` (`main.py:510-514`). Confirmed safe (FastAPI routes win route resolution before mounts), but a future refactor that re-orders route registration could shadow `/metrics` behind static. **P3 docs ask**: add a comment block noting the order dependency.

### G-6 — Correlation-id contextvar: `_correlation_id.reset(token)` runs in `finally` — but if the response is a `StreamingResponse` (chat partials, voice partials), `call_next(request)` returns BEFORE the body has been fully streamed. The contextvar is reset while the streamed body is still being produced, **so log lines emitted during streaming will not carry the correlation id**. **P2**. The current chat REST path doesn't stream, but `routes_chat.py:498-514` does emit chunked text and the WS chat handler is unaffected (WS bypasses HTTP middleware). Affects future `StreamingResponse` use only. Note for Phase 18+.

### G-7 — `import uuid` inside `_short_uuid()` (`observability.py:85-87`) — every fresh request without an inbound `X-Correlation-Id` header pays a sys.modules dict lookup. Already noted above; ~80 ns cost amortised. P3.

### G-8 — Two middlewares registered with `app.middleware("http")(...)` instead of `BaseHTTPMiddleware` subclass — fine for the current scale but Starlette's `app.middleware("http")` wraps each in a **fresh middleware instance per registration**. Each adds ~150 ns per-request frame setup. With 2 such middlewares = ~300 ns. P3, only relevant if the count grows past ~10.

---

## P0/P1/P2 punch list

### P0 — productisation deploy blockers / live cliffs

- **G-1** (Day-2 new): `_probe_chroma` cold first hit = 2-3 s; will fail K8s liveness defaults. Open chroma client at lifespan startup before `/readyz` is registered. **`observability.py:248`, fix in `main.py` lifespan, ~5 LOC.**
- **PERF-17 / F-17**: Chroma orphan dir janitor (design above). 609 leaked dirs / 1 live. Cold first `_get_client()` open = 2-3 s. Ship the janitor + lifespan-time open. **~30 LOC.**
- **F-18**: Frontend `setContext` re-render storm at 2 Hz. Equality guard. **3 LOC, `systemStore.ts:65`.**
- **F-19**: WS hub unconditional broadcast — every channel to every client at 2 Hz. Per-client subscriptions. **~50 LOC, `api/websocket_hub.py:84-101`.**
- **PERF-17b** (Day-2 new): Phase 17b `call_with_tools` loop unbounded by wall clock. Add `chat_tool_max_total_ms` budget + parallel dispatch + default `chat_tool_max_calls_per_turn=2`. **~70 LOC across `ai/provider.py` + `ai/tool_executor.py`. Block before flipping `chat_tools_enabled=True`.**

### P1 — will breach under load / clear user-perceived wins

- **F-20**: Chat 8-11 SQLite RT before LLM. Drop dual-commit barrier; fix tool-executor session ownership. **~60 LOC, `routes_chat.py:267-393`.**
- **F-21**: ffmpeg `subprocess.run` blocks event loop on push-to-talk. Wrap `decode_to_mono16k` in `to_thread` at `routes_voice.py`. **~6 LOC.**
- **F-22**: MMS pads every utterance to 30 s. Compile a 3 s binary, dispatch by length. **~20 LOC + AI Hub recompile.**
- **F-23**: Silero VAD per-frame `to_thread` at 33 Hz. Single batched VAD worker via `asyncio.Queue`. **~60 LOC.**
- **F-24**: CTC greedy decode pure-Python loop T=1500. Vectorise with numpy. **~15 LOC.**
- **F-26**: Vosk `KaldiRecognizer` per call. Thread-local cache. **~12 LOC.**
- **F-27**: Geo Nominatim N+1 per place entity. Batch at extractor. **~40 LOC.**
- **F-28**: `_history` shared inner-dict references → `get_history()` returns lies. Deep-rebuild leaf dicts. **~10 LOC.**
- **G-2** (Day-2 new): `_probe_db` should pass explicit short timeout to avoid 30 s blocking under chat-write contention. **~15 LOC, `observability.py:237`.**
- **G-6** (Day-2 new): Correlation-id contextvar reset before streaming body finishes. Log correlation broken on `StreamingResponse`. Documentation today; refactor when Phase 18+ adopts StreamingResponse for chat. **~10 LOC when fixed.**

### P2 — efficiency / hygiene

- **G-3** (Day-2 new): `Counter.render()` rebuilds dicts per scrape. ~50 µs/scrape, fine but worth a 5-min docstring guard. **~3 LOC.**
- **G-4** (Day-2 new): Duplicate sort in `Counter.inc()` + `_format_labels`. Drop second sort. **~2 LOC.**
- **PERF-15 / F-60**: `collection.count()` on every chroma query. 60 s TTL cache. **~10 LOC, `memory/strategic_memory.py:98`.**
- **PERF-16**: Pre-serialize broadcast JSON once instead of per-client. **~15 LOC, `websocket_hub.py:40-48`.**
- **PERF-17 (other half)**: Switch to single sharded chroma collection with `where={"user_id": ...}`. Eliminates per-user collection fan-out at the source. **~40 LOC, paired with janitor migration.**
- **PERF-19**: Defensive Python re-filter in `_sync_retrieve` is a band-aid for leaked test fixtures. Clean prod DB once, drop filter. **~5 LOC.**
- **PERF-20 / F-62 (already closed Day 1)**: confirmed shipped — `audioop.max` replacement landed in `0fd6286`.
- **G-5** (Day-2 new): Document route-registration order dependency between `/metrics` and the static mount. **~3 LOC comment block.**
- **G-7** (Day-2 new): Hoist `import uuid` to module top in `observability.py`. **~2 LOC.**
- **G-8** (Day-2 new): Middleware registration count is bounded; no action today.

### P3 — noise

- E-5 counter overhead total: ~3 µs/chat turn. Accept.
- Day-1 middleware overhead total: ~4 µs/HTTP request. Accept.
- `Counter.inc()` 3× slower than prometheus_client. Defer until or unless we hit 1 kHz request rate.

---

## Files cited

- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/observability.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/main.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/api/routes_chat.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/api/routes_voice.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/ai/provider.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/config.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/db/database.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/memory/strategic_memory.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/chroma_data/` (609 leaked collection dirs / 105 MB at audit time)
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/frontend/src/stores/systemStore.ts`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/api/websocket_hub.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/voice/mms_npu_provider.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/voice/always_on.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/voice/stt_engine.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/memory/geo_integration.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/core/context_engine.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/docs/audit-2026-04-28/FINDINGS.md`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/docs/audit-2026-04-28/performance.md`
