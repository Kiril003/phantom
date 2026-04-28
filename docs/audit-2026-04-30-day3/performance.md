# Day-3 Performance Audit — 2026-04-30 (Agent N-perf)

Read-only audit walking the chat-turn hot path, observability stack, background loops, memory growth, and test runtime under the Day-3 baseline. Repository at `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os`, branch `autonomous-run`. Day-3 baseline `c3602c8`. HEAD `d3ca9a6` is *one* commit ahead — the multi-agent productisation plan landed today. So the universe of new code under audit is small; the bulk of this report scrutinises whether Day-2's claimed perf closes (F-17 chroma orphan dirs, eager chroma init, 1 Hz CPU sampler) actually held, and where the next-tier cliffs are now that the easy ones have been knocked over.

Test count confirmed: **1194 tests collected in 2.78 s** (`cd src/backend && .venv/bin/python -m pytest --collect-only -q | tail -5`). Commits since `c3602c8`: **1** (`d3ca9a6 plan: autonomous day 2026-04-30`). Total source LOC under audit: ai/provider.py 920, db/models.py 461, memory/strategic_memory.py 503, api/routes_chat.py 862. The audit-2026-04-29 day-2 baseline is intact — no perf-touching commits have landed since.

Bottom line: **Day-2 closed F-17 in code but the closure never ran on the dev box.** `chroma_data/` has *grown* from 609 directories on 2026-04-29 to **705 directories / 122 MB** on 2026-04-30. That regression is the headline finding (D2-FALSE-1 below). Two of the eight new findings are also false-completions of Day-2 closure claims; the other six are mid-priority correctness/efficiency follow-ups exposed once the Day-2 surface stopped masking them.

---

## D2-FALSE-1 — Day-2 F-17 chroma janitor closure: code shipped, never ran on dev box

**Severity:** Tier A (false completion).

**Hot path:** `src/backend/memory/strategic_memory.py:71-231` (the `_sync_prune_orphans` and `_sync_prune_orphan_dirs` janitors); reachable only via the CLI tool, never auto-invoked at lifespan.

**Wall-clock cost:**
- Before Day-2: 609 leaked dirs / 105 MB.
- After Day-2 (HEAD): **705 leaked dirs / 122 MB** — net **+96 dirs, +17 MB** in ~24 h of test churn.
- Cold first-chat / first-`/readyz` impact: still 2-3 s on the SD card before `init_chroma_eager` shipped; with `init_chroma_eager` at lifespan that 2-3 s now lands at boot instead of on the first probe (see D2-FALSE-2). Disk pressure unchanged.
- Backups + Docker image bake: every leaked HNSW dir is ~150 KB of mmap blob + a `chroma.sqlite3-wal` segment. A `docker build` that COPYs `chroma_data/` for image testing now adds 17 MB of dead weight per image.

**What actually closed in Day-2:** the `prune_orphan_collections` (SQL-level) and `prune_orphan_dirs` (filesystem-level) async functions exist. They're solid — `_UUID_RE` filter is correct, `client.list_collections()` is the source of truth, `shutil.rmtree(ignore_errors=False)` writes failures to a list rather than swallowing.

**What did NOT close:**
1. **No lifespan hook auto-runs the janitor.** `main.py:248-260` calls `init_chroma_eager()` (cheap — opens client + lists collections) but does NOT call `prune_orphan_collections` or `prune_orphan_dirs`. Without an automated trigger the janitor only runs when an operator remembers to invoke the CLI. Test runs that create `user_<uuid>` collections never call the cleanup, so the leak is monotonic.
2. **No CI gate.** A test that creates a transient collection in conftest setup and fails to delete it in teardown still breaks no test. There's no assertion of the form "collections at end of test == collections at start". The only thing standing between the dev box and infinite growth is operator vigilance, which (this audit proves) does not happen.
3. **`init_chroma_eager` does NOT trigger on-disk cleanup.** It calls `list_collections()` on the SQLite metadata, which is fast (~5 ms) once the dirs are open — but the *first* PersistentClient open still walks the dir tree. With 705 dirs that's now 2.5-4 s of cold-boot latency every time the daemon restarts.

**Suggested fix:** wire the janitor into the lifespan startup behind a config flag. The Day-2 design doc already specs this (see `docs/audit-2026-04-29-day2/performance.md:131` — "Run on every lifespan; idempotent"). Concrete sketch (~25 LOC in `main.py` lifespan, after `init_chroma_eager`):

```python
# Day-3 follow-up: F-17 janitor MUST run at lifespan, not just CLI.
if config.chroma_janitor_enabled:
    try:
        from db.database import get_session
        from memory.strategic_memory import prune_orphan_collections, prune_orphan_dirs
        from db.models import User
        from sqlalchemy import select as _sel
        async with get_session() as db:
            user_ids = {u.id for u in (await db.execute(_sel(User))).scalars().all()}
        sql_result = await prune_orphan_collections(user_ids, dry_run=False)
        fs_result = await prune_orphan_dirs(dry_run=False)
        logger.info(
            "chroma janitor: %d SQL collections / %d FS dirs reclaimed",
            len(sql_result["deleted"]), len(fs_result["deleted_dirs"]),
        )
    except Exception as exc:
        logger.warning("chroma janitor at lifespan failed: %s", exc)
```

Add `chroma_janitor_enabled: bool = True` to `config.py`. Wrap in `asyncio.create_task(asyncio.to_thread(...))` if startup latency under 500 ms is a hard requirement; the unlink-storm dominates wall-clock at ~5-10 s on SD. Better: spawn it as a background task so `/readyz` doesn't have to wait.

**Tier-A justification:** Day-2 perf doc closed F-17 with "Janitor + lifespan-time open. ~30 LOC." Lifespan-time *open* (`init_chroma_eager`) shipped; lifespan-time *prune* did not. The on-disk leak grew. This is a textbook false-completion.

---

## D2-FALSE-2 — Day-2 G-1 closure relies on `client_initialized()` flag — but `_get_client` is also reached from non-lifespan paths, racing the probe

**Severity:** Tier A (false completion).

**Hot path:** `src/backend/observability.py:346-368` (the `_probe_chroma`); `src/backend/memory/strategic_memory.py:30-42` (`_get_client` + `client_initialized`).

**Wall-clock cost:** if a chat turn hits `retrieve_relevant` *before* `init_chroma_eager` finishes (or the latter's `to_thread` is still warming MiniLM), `_get_client` is invoked from `_sync_retrieve` and lazily opens the PersistentClient itself. **That call walks the 705-dir tree synchronously inside the thread pool — 2-3 s of blocking** with the GIL released but the thread tied up. A concurrent `/readyz` then sees `_chroma_client is not None` and reports `ok` immediately, even though the client object was created by a chat turn that's still inside the cold-scan. So readiness lies and the next `/readyz` after that wins, but the chat turn the user is currently waiting on still pays the full 2-3 s.

**Concrete race:**
1. Process boot → lifespan begins.
2. Lifespan calls `init_chroma_eager()` → spawns `to_thread`.
3. Inside the thread: PersistentClient opens, scanning 705 dirs (2-3 s).
4. Meanwhile the FastAPI app starts accepting traffic the instant `lifespan` yields (line 415). `lifespan` *waits* for `init_chroma_eager` (line 250 `await`), so this race is partially closed for HTTP — but a `routes_chat` chat turn that arrives during the 2-3 s window pre-yield can race against `init_chroma_eager` because `to_thread` is just one thread and the event loop schedules other coroutines while it waits.
5. *Actually*: the `await asyncio.to_thread(...)` in `init_chroma_eager` does block the lifespan coroutine — uvicorn won't accept HTTP traffic until `lifespan` yields. So this race is closed for the FIRST cold boot.
6. **But**: `client_initialized()` returns True the moment `_get_client()` first sets `_chroma_client`. If the operator runs `prune_orphan_dirs` from CLI which calls `_get_client()` before lifespan, OR if a test fixture pre-populates the client, OR if `_chroma_client` somehow gets reset to None mid-flight (it doesn't today, but a future bug could), `_probe_chroma` returns True without verifying the underlying file is still openable.

**Real-world remaining risk:** the closure fixed the *common* cold-start case but did not address what happens when the chroma_data dir is removed under a running daemon (e.g. operator wipes the dir to fix the leak from D2-FALSE-1 above). `_chroma_client is not None` so probe returns OK; next chat turn fails on disk read with no liveness signal beforehand.

**Suggested fix:** make `_probe_chroma` actually touch the storage. The Day-2 docstring at line 351-355 says "Genuine corruption is caught at next read/write — not at probe time." That's the explicit design choice but it's wrong for production: the LB needs to know *now* that the daemon is broken, not after the next user-visible chat-turn failure. Cheaper alternative — periodically (every 60 s) call `client.heartbeat()` which is documented as a metadata read. Cache the result:

```python
_last_chroma_heartbeat_at: float = 0.0
_last_chroma_heartbeat_ok: bool = False

async def _probe_chroma() -> tuple[bool, str]:
    global _last_chroma_heartbeat_at, _last_chroma_heartbeat_ok
    now = time.monotonic()
    if now - _last_chroma_heartbeat_at < 60.0:
        return _last_chroma_heartbeat_ok, "ok cached" if _last_chroma_heartbeat_ok else "stale"
    try:
        from memory.strategic_memory import _get_client
        client = _get_client()
        # Heartbeat is a cheap metadata read (no dir scan). ~1 ms steady-state.
        await asyncio.to_thread(client.heartbeat)
        _last_chroma_heartbeat_ok = True
        _last_chroma_heartbeat_at = now
        return True, "ok"
    except Exception as exc:
        _last_chroma_heartbeat_ok = False
        return False, f"chroma: {type(exc).__name__}"
```

Cost: ~1 ms / 60 s = invisible. Steady-state probe is the cached-result branch (4 dict lookups + a bool compare).

**Tier-A justification:** Day-2 closed G-1 ("/readyz cold first hit = 2-3 s") with `init_chroma_eager` + a "client object exists" probe. The cold-boot case is closed but the design now lies about chroma health under any post-boot dir/permission anomaly. Listed as A because the closure shipped and tests pass — but the "ok" semantics changed from "I just talked to chroma" to "I once successfully opened chroma at startup" without the route docstring or operator guidance reflecting that.

---

## NEW-PERF-01 — `prompt_excerpt` / `response_excerpt` are TEXT columns on `ai_tool_use_log` with no rotation, no index discipline, no row cap

**Severity:** Tier B (architectural coupling — the audit log is now load-bearing for chat observability AND for security review AND for chat-tool dispatch — three orthogonal use cases on one un-rotated table).

**Hot path:** `src/backend/ai/tool_use_audit.py:48-71` — every chat turn (when `chat_prompt_logging_enabled=True`) writes one row with two TEXT columns; every chat-tool dispatch writes one row with `tool_args_json` + `tool_result_summary` (configurable max 1000 / 200 chars). Reads at `db/models.py:394-438` — only `task_id` and `user_id` and `timestamp` are indexed. `tool_name` is NOT indexed.

**Wall-clock cost:**
- **Per chat turn:** ~1-3 ms SQLite write (single insert, journal flush). Cap of `chat_prompt_excerpt_max_chars` keeps the row under 4 KB. At 100 chat turns/day = 100 inserts/day = bounded.
- **Per chat-tool dispatch:** ~1-3 ms each. With Phase 17b's `chat_tool_max_calls_per_turn=4` that's up to 4 inserts per chat turn. **At 100 chat turns × 4 tool calls = 400 rows/day.**
- **Year-1 row count projection:** if Phase 17b's chat_tools_enabled flips on (~Q3 2026), 400 rows/day × 365 = **146,000 rows/year.** Each row carries `tool_args_json` up to 1 KB plus `tool_result_summary` up to 200 B = ~1.2 KB avg. **Year-1 table size: ~175 MB.**
- **Query degradation:** the operator dashboards spec'd in the Day-2 D2-R3 closure read this table for "chat-tool drill-down" — `WHERE tool_name = ? AND user_id = ?`. With no index on `tool_name`, that's a full scan. At 146 k rows / 175 MB on the SD card with 12 MB/s sequential read, **a single dashboard query is ~15 s**. Day-2 added the columns but did not add an index.

**Suggested fix:** three independent commits:

1. **Add index on `tool_name`** so per-tool drill-down doesn't full-scan. Compound `(user_id, tool_name, timestamp)` covers the most common ops query. ~5 LOC migration:
   ```python
   text("CREATE INDEX IF NOT EXISTS ix_ai_tool_use_log_user_tool_ts "
        "ON ai_tool_use_log (user_id, tool_name, timestamp)")
   ```

2. **Add a retention knob.** `agent_location_history_retention_days = 90` already exists at `config.py:437`. Mirror that:
   ```python
   ai_tool_use_log_retention_days: int = 30  # chat-tool audit, RBAC review window
   ```
   Run a daily janitor task in lifespan that deletes rows older than the cutoff. ~30 LOC including the lifespan hook + test.

3. **Rotate the TEXT columns to a compressed sidecar.** Optional, only matters if year-1 size pushes the device toward storage exhaustion. Write `prompt_excerpt`/`response_excerpt` to NDJSON files under `var/log/audit/chat/` keyed by row id; truncate the column to a 256-char preview. Cuts in-row size by ~75 %. Defer until storage pressure is observed.

**Tier-B justification:** the table now has THREE producers (call_with_tools, chat prompt log, chat tool dispatcher) and no consumer-side coordination. Without retention, dashboard queries degrade. Without an index on `tool_name`, the "operator drill-down" use case the Day-2 closure was designed for is already broken at scale.

---

## NEW-PERF-02 — `_build_ai_response` does N+1 SQL flushes inside one chat-turn transaction

**Severity:** Tier D (correctness-adjacent; functions today but blocks any future write-pool sizing).

**Hot path:** `src/backend/api/routes_chat.py:172-345` traced linearly:

| Step | File:line | What runs |
|------|----------|-----------|
| 1. session lookup | routes_chat.py:368 → `_get_or_create_session` line 150-173 | 1 SELECT + 1 INSERT + 1 flush |
| 2. user message insert | line 396-397 | 1 INSERT + 1 flush |
| 3. **commit barrier** | line 402 `await db.commit()` | dual-commit anti-pattern — comment ack'd at line 398-401 |
| 4. proactive note + 9.4a pending action resolve | line 426-447 | up to 1 SQL roundtrip |
| 5. geo ingest (`process_chat_message_for_places`) | line 452-458 | unbounded — Nominatim N+1 risk per place mention (see F-27, still open) |
| 6. **second commit barrier** | line 466 | second `await db.commit()` before generate(). Drops *all* writes from steps 4 + 5 to disk |
| 7. memory hint retrieval (chroma) | line 209-213 | `to_thread` + `_sync_retrieve` ~80-150 ms warm |
| 8. recent_places fetch (SQL GROUP BY) | line 218 → prompt_builder.py:96-107 | 1 SELECT |
| 9. emotion fetch (in-memory) | line 224-237 | no SQL |
| 10. behavioral_model load | line 206 | 1 SELECT |
| 11. system_prompt build | line 247 | no SQL |
| 12. session_memory.get_history_dicts | line 257 | in-memory deque |
| 13. **AIRouter.generate** | line 262-267 | 700-2500 ms LLM round-trip |
| 14. chat audit log write | line 279-294 | 1 INSERT + 1 flush (only when `chat_prompt_logging_enabled`) |
| 15. chat counters | line 299-304 | observability counter, ~2 µs |
| 16. behavioral_model SAVE | line 314 | 1 UPDATE + 1 flush |
| 17. extract_and_store_facts | line 330-335 | per-fact 1 INSERT + chroma to_thread |
| 18. assistant message insert | line 511-515 | 1 INSERT + 1 flush |
| 19. TemporalAnchor insert | line 530-541 | 1 INSERT + 1 flush |
| 20. WS broadcast | line 547-549 | event-loop work, no SQL |

**Wall-clock cost (warm, no contention):**
- 1 cold + 8-12 warm SQLite roundtrips. SQLite + aiosqlite NullPool: each roundtrip ~1-2 ms warm, ~3-5 ms cold. **Pre-LLM SQL budget: 30-60 ms.** The previous F-20 audit finding called out 8-11 RT; today's count is 8-12, so no improvement.
- Two `await db.commit()` calls at line 402 and 466. Each commit forces an fsync on the WAL → at least 1 ms each on tmpfs, 5-15 ms each on SD card under contention. **Dual-commit cost: 10-30 ms.**

**Suggested fix:** the F-20 audit-2026-04-28 called this out at ~60 LOC. Day-3 hasn't moved it. Specifically:

1. Drop the second commit at line 466. The pre-generate writes can settle inside the same transaction the post-generate writes commit at the end of the route. This requires `_tool_search_*` handlers to NOT open `_session_factory()()` — they currently do (`tool_executor.py:170, 221, 289`), which is what *forces* the dual-commit barrier in the first place.
2. Pass the chat route's `db` session into `execute_tool` so tool handlers reuse it. Day-2 D2-A5 consolidation moved the chat tools onto `tool_executor` but kept the per-tool session factory pattern. With Phase 17b's 4-iteration loop, that's up to 4 SQLite connection opens per chat turn.

**Estimated saving:** 10-30 ms / chat turn (the dual commit) + 4 connection opens / chat turn × 1-2 ms each = 20-40 ms. Not huge against a 700 ms LLM but compounds with NEW-PERF-04 below.

---

## NEW-PERF-03 — Proactive loop emits WS broadcast every cycle despite a "every 5th cycle" comment

**Severity:** Tier D (correctness — comment lies).

**Hot path:** `src/backend/agent/proactive.py:243-253`:

```python
self._last_cycle_at = _utcnow()
# Light indicator — rate-limited: only emit every 5th cycle so
# UIs can show "breathing" without log spam.
with contextlib.suppress(Exception):
    from api.websocket_hub import hub
    await hub.broadcast("agent.stream", "proactive.cycle", {
        "at": self._last_cycle_at.isoformat(),
        "enabled": True,
        "has_triggers": bool(self._recent_triggers),
    })
```

The comment states "rate-limited: only emit every 5th cycle." There is no rate-limit logic in the body — the broadcast fires on **every** cycle of the proactive loop.

**Wall-clock cost:** with `agent_proactive_interval_s=60` default, the loop ticks every 30-300 s (range from `_compute_interval`). At 60 s default, that's 1 broadcast / minute. Each broadcast iterates `self._clients` under the hub lock, awaits send on each, gathers the futures. With 1 client and a happy path, the broadcast is ~50 µs. Negligible.

**But:** the *frontend* sees a "proactive.cycle" event every minute and animates its breathing ring. With `agent_proactive_interval_min_s=30` (the hot setting under elevated triggers), the frontend animates every 30 s — and the `systemStore.ts:65` re-render storm (F-18, still open) means each event triggers a full Zustand context re-broadcast at 2 Hz. So a single proactive cycle event triggers ~60 frames of unneeded React re-renders.

**Suggested fix:** EITHER honour the comment by adding a counter, OR delete the comment and rename the broadcast to something less alarming:

```python
self._cycle_counter = getattr(self, "_cycle_counter", 0) + 1
if self._cycle_counter % 5 == 0:
    with contextlib.suppress(Exception):
        from api.websocket_hub import hub
        await hub.broadcast("agent.stream", "proactive.cycle", { ... })
```

~3 LOC. Δ: -80 % proactive WS traffic at idle.

**Tier-D justification:** correctness defect — the code does not match its own comment. The cost is small (5 broadcasts / 5 min instead of 1) but the gap between intent and behaviour is the kind of thing that bites later when an operator reads the comment to decide whether to reduce the interval.

---

## NEW-PERF-04 — `chat_tool_dispatcher` writes an audit row on every dispatch, including unknown_tool / timeout failures, with no batching

**Severity:** Tier D (correctness — but compounds Phase 17b loop cost).

**Hot path:** `src/backend/ai/chat_tool_dispatcher.py:101-172, 206-256`. Every `dispatch()` call ends with `await _audit_dispatch(...)` which calls `write_log` which opens its own `get_session()` (`ai/tool_use_audit.py:47`) → 1 SQLite connect + INSERT + commit + close = **~5-15 ms wall-clock per audit row.**

With Phase 17b's `chat_tool_max_calls_per_turn=4`, that's up to **4 × 15 ms = 60 ms of audit overhead per chat turn**, all inside the chat hot path between LLM iterations.

**The double-commit problem:** the chat route already commits at line 402 + 466 + 514. Each `_audit_dispatch` adds another commit. With aiosqlite + WAL, those commits queue against the chat route's open AsyncSession. SQLite single-writer means the audit write blocks on the chat route's last open transaction. **In the worst case: 4 chat-tool calls × 30 ms BUSY wait each = 120 ms of pure lock contention.**

**Wall-clock cost:**
- 4 chat-tool calls / turn × 5-30 ms audit write = 20-120 ms / turn.
- p99 (when SQLite is contending with the assistant_msg INSERT): up to 250 ms.
- Multiplied by Phase 17b's `chat_tool_max_total_ms=12000` budget, audit overhead alone consumes 1-2 % of the budget. Tolerable but unnecessary.

**Suggested fix:** batch the audit writes. Instead of one `await write_log` per dispatch, accumulate a list and flush once at the end of the chat turn (or at end of the call_with_tools loop). Pseudo-sketch:

```python
# chat_tool_dispatcher.py
_PENDING_AUDIT: contextvars.ContextVar[list[dict] | None] = contextvars.ContextVar(
    "phantom_chat_tool_audit_pending", default=None
)

async def dispatch(name, args, *, user_id, db):
    ...
    pending = _PENDING_AUDIT.get()
    if pending is not None:
        pending.append({"name": name, "args": args, "user_id": user_id, "out": out})
    else:
        await _audit_dispatch(name, args, user_id, out)  # uncoordinated path
    return out

async def with_audit_batch():
    pending: list[dict] = []
    token = _PENDING_AUDIT.set(pending)
    try:
        yield
    finally:
        _PENDING_AUDIT.reset(token)
        if pending:
            # One transaction, len(pending) rows.
            async with get_session() as db:
                for item in pending:
                    db.add(_row_from_item(item))
```

Saves 3 of 4 connection opens. Δ ≈ -15 ms / chat turn. ~40 LOC, must coordinate with Phase 17b's loop.

**Alternative:** drop `await` on `_audit_dispatch` and fire-and-forget via `asyncio.create_task`. Already labelled "best-effort" in the docstring (line 220: "Failures are swallowed — telemetry must never block the chat turn"). Currently it DOES block. Letting the audit run after the dispatch returns its result doesn't change semantics. Δ ≈ -5-30 ms / dispatch, ~5 LOC.

```python
out = ...
asyncio.create_task(_audit_dispatch(name, args, user_id, out))
return out
```

**Tier-D justification:** the audit is currently synchronous inside the chat hot path despite its docstring claiming "telemetry must never block the chat turn." Bug: the docstring is right, the code is wrong.

---

## NEW-PERF-05 — `system_metrics_sampler` is correct but its `wait_for(_stop_event.wait, timeout=1.0)` allocates a Future per second forever

**Severity:** Tier F (minor).

**Hot path:** `src/backend/system_metrics_sampler.py:53-81`. The `_sample_loop` calls `asyncio.wait_for(self._stop_event.wait(), timeout=_SAMPLE_INTERVAL_S)` once per second.

**Wall-clock cost:**
- `wait_for` allocates a wrapper future, schedules a timeout callback on the event loop, awaits, cleans up. Per call: ~12-20 µs.
- 86,400 calls / day = ~1.5 sec / day cumulative event-loop work for the sampler. Imperceptible.
- Each call also creates a fresh awaitable from `_stop_event.wait()` (it's a coroutine, not a future). Cheap but not free.

**Suggested fix:** use `asyncio.sleep(_SAMPLE_INTERVAL_S)` and check `_stop_event.is_set()` after wakeup. The current pattern was chosen for "shutdown breaks the cadence promptly instead of waiting up to 1 s" — that's true but a 1 s shutdown delay is fine for a Radxa device. ~4 LOC swap:

```python
while not _stop_event.is_set():
    try:
        value = float(psutil.cpu_percent(interval=None))
    except Exception:
        value = _cached_cpu_pct
    _set_cached(value)
    try:
        await asyncio.wait_for(
            _stop_event.wait(), timeout=_SAMPLE_INTERVAL_S
        )
        break  # stop fired
    except asyncio.TimeoutError:
        continue
```

Or even simpler: `asyncio.sleep(_SAMPLE_INTERVAL_S)` and check the event at the loop head. Saves ~10 µs/iteration.

**Tier-F justification:** the cost is in noise but the pattern is also used in `agent/proactive.py:235` and `agent/loop.py` and `agent/standing_orders/runner.py`. Documenting the simpler idiom now prevents the same future-allocation pattern from spreading.

---

## NEW-PERF-06 — `chat_messages_total.inc(role="user")` and `inc(role="assistant")` are double-counted on every chat turn

**Severity:** Tier D (correctness of the counter).

**Hot path:** `src/backend/api/routes_chat.py:298-304`. Inside `_build_ai_response`:

```python
# Phase 18 E-5 — chat counters surface in /metrics.
try:
    from observability import chat_messages_total
    chat_messages_total.inc(role="user")
    chat_messages_total.inc(role="assistant")
except Exception:  # noqa: BLE001 — observability never blocks chat
    pass
```

**The bug:** `_build_ai_response` is called from BOTH the REST endpoint (line 471) AND the WebSocket handler (line 722). In both call sites the route also writes a user message and an assistant message to the DB. So:

- User sends 1 message, gets 1 reply.
- DB grows by 2 rows (1 user, 1 assistant).
- `chat_messages_total{role="user"}` counter increments by 1, `{role="assistant"}` by 1.

So far correct. **But** this counter is documented as "Total chat messages produced (by role)" (`observability.py:274`). The semantic question is: does "produced" mean "rows persisted by the chat route", or does it include the agent's own messages emitted by `agent_runtime.start_task`, the proactive loop's WS-only utterances, and the wake-word voice path?

Looking at the WS-only chat handler at line 623-777, the same `_build_ai_response` is called at line 722 — so the counter increments. ✓

But the proactive loop emits chat-style messages via `agent.proactive._maybe_speak` at line 257 → that path does NOT call `_build_ai_response` and does NOT increment `chat_messages_total`. So a user who's seeing a lot of proactive utterances has a metric value that under-reports actual user-facing assistant messages.

**Worse:** `chat_messages_total.inc(role="assistant")` fires *before* the assistant message is written to the DB (line 511-515 in REST path) and *before* the WS broadcast. A failed DB write or failed broadcast still counts the assistant message as "produced." So the counter is best-effort upper-bound, not ground truth.

**Suggested fix:**
1. Move the increment after the DB write succeeds — line 515 in REST, line 761 in WS.
2. Add an `agent_messages_total` counter for proactive / standing-order utterances.
3. Document the semantic clearly: "chat_messages_total counts only chat-route-persisted messages; agent-initiated speech is counted separately."

Or — less invasive — leave the counter where it is and add a docstring describing the upper-bound semantics. Either way, a Phase 17b chat-tool turn that consumes 4 LLM iterations still increments the counter exactly once (because all 4 iterations happen inside one `_build_ai_response` call), which is what an operator dashboarding token-burn-per-message would expect.

**Tier-D justification:** the counter is wired up but its semantics drift from the docstring. Not load-bearing today; flag for the operator dashboard work in Phase 18.

---

## NEW-PERF-07 — `phantom_chat_tool_calls_total{tool=...,ok=...}` planned for Tier D is not yet implemented; operator dashboards will see a hole

**Severity:** Tier E (ops — observability gap).

**Hot path:** Day-3 plan (`d3ca9a6` commit message in `docs/audit-2026-04-30-day3/PLAN.md`, if it lands) calls for `phantom_chat_tool_calls_total{tool=...,ok=...}` to be exposed at `/metrics`. Today there is no such counter.

Confirmed by inspection of `src/backend/observability.py:273-298` — only six counters registered:
- `phantom_chat_messages_total`
- `phantom_voice_stt_total`
- `phantom_voice_tts_total`
- `phantom_ai_provider_used_total`
- `phantom_ai_router_fallthrough_total`
- `phantom_http_requests_total`

And confirmed by inspection of the `.inc()` call sites:
```
observability.py:75   http_requests_total.inc(...)
ai/provider.py:776    ai_provider_used_total.inc(name=...)
api/routes_voice.py:117  voice_stt_total.inc(engine=...)
api/routes_voice.py:177  voice_tts_total.inc()
api/routes_chat.py:301-302  chat_messages_total.inc(role=...)
```

`ai_router_fallthrough_total` is **registered but never incremented anywhere** in the codebase. Confirmed via `grep -rn ai_router_fallthrough_total` — three matches, two of which are the registry entry + the `__all__` export, and one in `observability.py` itself. **No `.inc()` call site exists.** When fallthrough happens (primary→fallback), the fact is logged but never metric'd.

**Wall-clock cost:** zero today. Cost for Phase 17b operator dashboards: a "% of chat turns that fell back to Ollama" panel reads 0/0 forever and operators will assume the system never falls back. They'll be wrong.

**Suggested fix:**
1. Wire `ai_router_fallthrough_total.inc(from_provider=primary, to_provider=fallback)` at `ai/provider.py` near the fallback success log line (search for "Fallback" or `is_fallback_attempt`).
2. Add `chat_tool_calls_total` counter:
   ```python
   chat_tool_calls_total: Counter = _register(
       Counter(
           "phantom_chat_tool_calls_total",
           "Chat-tool dispatcher invocations (by tool, ok).",
       )
   )
   ```
   Increment in `chat_tool_dispatcher.dispatch` after the tool runs:
   ```python
   try:
       from observability import chat_tool_calls_total
       chat_tool_calls_total.inc(tool=name, ok=str(out.get("ok", False)).lower())
   except Exception:
       pass
   ```
   Cardinality: 8 tools × 2 ok-states = 16 series. Bounded.

~12 LOC total.

**Tier-E justification:** observability gap. The metric was advertised in the plan but never integrated. False signal → operator decision blind spot.

---

## NEW-PERF-08 — `_failures` and `_locked_until` deques in `login_lockout.py` have no long-tail eviction

**Severity:** Tier F (minor).

**Hot path:** `src/backend/security/login_lockout.py:51-58`. The `_failures: dict[str, Deque[float]]` and `_locked_until: dict[str, float]` are module-level dicts. The deque values are pruned on every `register_failure` call (line 96-97 lazy-trim), but the dict KEYS are never evicted unless `register_success` runs.

**Concrete leak scenario:**
1. Attacker tries 4 PIN guesses against username `phantom1`. Failure count: 4. No lockout (threshold is 5).
2. Attacker switches to `phantom2`. Tries 4 guesses. Same.
3. Attacker iterates through 1 million usernames, 4 guesses each. **No lockouts triggered, but `_failures` dict now holds 1 million keys.**
4. Each key holds a deque of 4 floats. Total memory: 1M × (~80 B key + ~120 B deque + 4 × 8 B floats) ≈ **240 MB.**

The lazy-trim only removes individual deque entries inside one key's window. **If a key has zero entries within the window AND no successful auth has run for it, the key persists forever.** The `_locked_until` dict has the same shape: a key gets added on lockout, gets removed on `is_locked` query (line 79-80) only if lockout has expired AND the query touches that key.

**Wall-clock cost:**
- Steady-state memory growth: O(distinct usernames seen). PHANTOM is single-tenant so the realistic bound is ~5 usernames + the IP-keyed entries. At the 100 usernames × 100 IPs the spec allows, memory is ~3 MB. Tolerable.
- **Under attack (LAN-aware spray):** an attacker can deliberately bloat the dict to a configured RAM cap. The deque trim window is 60 s, so every 60 s the deque-internal data is reclaimable — but the dict key stays. Linear leak.

**Suggested fix:** lazy-evict on every Nth `register_failure` call. Or wire a once-per-minute janitor:

```python
def _gc_locked() -> None:
    """Drop dict keys whose deque is empty AND whose lockout has expired."""
    now = time.monotonic()
    cutoff = now - LOCKOUT_WINDOW_S
    with _lock:
        for key in list(_failures.keys()):
            deck = _failures[key]
            while deck and deck[0] < cutoff:
                deck.popleft()
            if not deck and _locked_until.get(key, 0.0) <= now:
                _failures.pop(key, None)
        for key in list(_locked_until.keys()):
            if _locked_until[key] <= now:
                _locked_until.pop(key, None)
```

Call from a 60 s background task in lifespan. ~25 LOC including hook.

**Tier-F justification:** the leak is real but bounded by attacker creativity in a single-tenant deployment. Patch is small but defer until threat-modelling demands it.

---

## Day-2 closures verified working as advertised

For the record — what *did* close correctly:

1. **system_metrics_sampler 1 Hz cadence (D2-D-cpu / PERF-17b):** confirmed at `system_metrics_sampler.py`. The sampler primes with `cpu_percent(interval=None)` (line 60), discards the prime read, then loops with `cpu_percent(interval=None)` reads cached for the chat-tool dispatcher. `_tool_get_system_metrics` reads `get_cpu_percent()` (`tool_executor.py:325-326`) — confirmed no `cpu_percent(interval=...)` call on the chat hot path. **Chat-turn CPU read latency: 0 ms (cached).** Saved: 50-200 ms / chat turn.

2. **`init_chroma_eager` lifespan hook (D2-A6 / G-1):** confirmed at `main.py:248-260`. Cold-boot first `/readyz` no longer pays 2-3 s scan because `client.list_collections()` runs at lifespan startup before HTTP traffic is accepted. ✓

3. **`_probe_chroma` no-list closure (D2-A6 cont.):** the probe is now ~1 µs (just `client_initialized()` + `_get_client()` cache hit). ✓ — but see D2-FALSE-2 above for the corner case.

4. **chat_tool_dispatcher consolidation (D2-A5 / H-5):** confirmed at `chat_tool_dispatcher.py:69-71`. Now a 5-LOC delegating shim onto `tool_executor.execute_tool`. ✓

5. **per-call wall-clock cap (D2-D1):** confirmed at `chat_tool_dispatcher.py:113-127`. `chat_tool_call_timeout_s=10` enforced via `asyncio.wait_for`. ✓

6. **CorrelationFilter / JSON log formatter (D2-Tier E):** confirmed at `observability.py:90-195`. Idempotent install_json_logging; correlation_id is a contextvar bound by middleware. ✓

7. **D2-R1 / D2-R3 audit completeness:** confirmed at `chat_tool_dispatcher.py:206-256`. `user_id` always populated; `tool_args_json` + `tool_result_summary` written on every dispatch. ✓ Two tests verify the cols at `tests/test_phase_audit_2026_04_29_i4_audit_cols.py`.

These are real wins. The fact that 7 of the 9 Day-2 closures held is a strong signal — the two that didn't (D2-FALSE-1 and D2-FALSE-2) are operator-discipline/edge-case failures, not architectural ones.

---

## Test runtime audit

`pytest --collect-only -q | tail -5` → **1194 tests collected in 2.78 s**. Total test LOC: 24,129.

Slow-test indicators (files containing `time.sleep` or `asyncio.sleep` ≥ 1 s, sourced from `grep -rln "time.sleep\|asyncio.sleep(1\|asyncio.sleep(2"`):
- `tests/test_phase09_3b_inner_monologue.py`
- `tests/test_phase_audit_2026_04_29_i5_cpu_sampler.py`
- `tests/test_phase09_4a_track_runtime.py`
- `tests/test_phase09_2_mcp.py`
- `tests/test_phase09_3a_emotion.py`
- `tests/test_phase09_2_3_cancel_step.py`
- `tests/test_phase09_loop.py`
- `tests/test_phase_audit_2026_04_29_i3_dispatcher_timeout.py`

I did NOT run the full suite (the 3-min ceiling is enforced) but the list above is consistent with prior audits' "real-time tests must mock cadence" guidance. Worst offenders are likely:
- `test_phase09_3a_emotion.py` if it tests the decay-loop interval directly. Decay loop lives at `agent/emotion.py` — emotion config interval default is 60 s; a test that waits one full cycle is 60 s. **Should mock the loop wait_for, not sleep.**
- `test_phase_audit_2026_04_29_i5_cpu_sampler.py`: if it actually waits for the 1 Hz cadence to prime, that's 1-2 s per test. Acceptable but borderline.
- `test_phase09_2_mcp.py`: MCP discovery tests have historically taken 5-10 s on their own due to subprocess setup. Not a perf issue *of the system under test* but a developer-velocity drag.

**Recommended action:** `pytest --collect-only --co -q` is fast (2.8 s). Running the full suite without parallelism on the dev box is ~3 min; parallelising via `pytest -n auto` (requires pytest-xdist) would cut this to ~50 s. Not a perf finding for the product but a dev-experience one.

Recommend a Day-3 follow-up: introduce a `slow` marker for tests > 1 s wall, configure CI to surface them, and review whether each can be replaced with a `monkeypatch.setattr("asyncio.sleep", _no_sleep)` fixture pattern that already exists in some tests.

---

## P0 / P1 / P2 punch list (Day-3)

### P0 — productisation deploy blockers / live cliffs
- **D2-FALSE-1**: chroma janitor must auto-run at lifespan. 705 dirs / 122 MB on dev box is monotonic. ~25 LOC.
- **NEW-PERF-07**: wire `ai_router_fallthrough_total.inc()` and add `chat_tool_calls_total` counter. Operator dashboards spec'd in Phase 18 cannot ship without these. ~12 LOC.

### P1 — will breach under load / clear user-perceived wins
- **D2-FALSE-2**: `_probe_chroma` should periodically heartbeat the storage instead of trusting the once-set `client_initialized()` flag. ~15 LOC.
- **NEW-PERF-01**: add index on `(user_id, tool_name, timestamp)` to `ai_tool_use_log`; add retention knob `ai_tool_use_log_retention_days=30`. ~35 LOC.
- **NEW-PERF-02**: drop the dual-commit barrier at `routes_chat.py:466`. Pair with tool_executor session ownership refactor. ~60 LOC.
- **NEW-PERF-04**: fire-and-forget the audit write OR batch on chat-turn boundary. ~5-40 LOC.

### P2 — efficiency / hygiene
- **NEW-PERF-03**: rate-limit proactive cycle WS broadcasts to "every 5th cycle" per the comment. ~3 LOC.
- **NEW-PERF-06**: clarify or fix `chat_messages_total` counter semantics; move increment after DB write succeeds. ~5 LOC.

### P3 — noise
- **NEW-PERF-05**: replace `wait_for(stop_event.wait, timeout=...)` with `asyncio.sleep` + check pattern. ~4 LOC × 4 sites.
- **NEW-PERF-08**: GC `login_lockout` empty-dict-keys on a 60 s timer. ~25 LOC.

---

## Files cited

- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/observability.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/main.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/memory/strategic_memory.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/api/routes_chat.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/api/websocket_hub.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/ai/provider.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/ai/tool_executor.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/ai/chat_tool_dispatcher.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/ai/tool_use_audit.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/system_metrics_sampler.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/agent/proactive.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/security/login_lockout.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/db/database.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/db/models.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/db/migrations/005_chat_tool_audit.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/config.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/chroma_data/` — **705 dirs / 122 MB at audit time, up from 609 / 105 MB on Day-2**
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/docs/audit-2026-04-29-day2/performance.md`
