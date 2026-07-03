# PHANTOM OS — Day-3 Multi-Perspective Audit (2026-04-30)

**Baseline commit:** `c3602c8` (`autonomous-day-2026-04-29-acceptance`).
**HEAD at audit time:** `d3ca9a6`.
**Branch:** `autonomous-run`.
**Reviewers spawned:** 8 (vs 6 on Day-2). One perspective file each, all read-only.

This document is the consolidated punch list. Per-perspective evidence
lives in the sibling files; this doc routes work into Day-3 blocks.

| Perspective | File | Findings written |
|---|---|---|
| Code-quality | `code-quality.md` | 14 |
| Architecture | `architecture.md` | 22 + 3 D2 confirmations + 6 cross-cutting |
| Security | `security.md` | 16 (3 Critical, 6 High, 5 Med, 2 Low) |
| Performance | `performance.md` | 10 |
| Threat-model 17b | `threat-model-phase17b.md` | 22 (4 Critical, 8 High) |
| Frontend | `frontend.md` | 4 (+ 5 D2 carry-overs) |
| Tests | `tests.md` | 16 + 4 flakes + 2 D2-FALSE |
| Ops | `ops.md` | 15 |

Total: ~120 unique findings across the swarm. After deduping (multiple
perspectives flagging the same issue), the consolidated punch list below
covers the work assigned to Day-3.

---

## Tier A — false-completions (Day-2 claimed closed but didn't)

These MUST close in Block O before any Tier B/D work begins. Day-2's
re-tag `v0.18.1-saas-base` is technically lying as long as any of these
is open, so a re-tag rollback or a `v0.18.2-fixup` is part of Block O's
exit gate.

| ID | Severity | Source | One-line | Closure cost |
|---|---|---|---|---|
| **D3-A-1** | Critical | sec | F-07 default-PIN refusal only patches `get_auto_login_user`; explicit `POST /auth/login/pin` still accepts `phantom`/`000000`. One curl from any LAN host = ROOT. | ~30 LOC + test |
| **D3-A-2** | Critical | sec | F-15 lockout uses `request.client.host` with no XFF parsing. Behind any reverse proxy (Caddy, Tailscale, Cloudflare, k8s ingress) `client.host == 127.0.0.1` for every request — system-wide DoS amplifier AND no-op against the actual attacker. The `security_trust_xff` knob the L-3 commit message promised does not exist in `config.py`. | ~50 LOC + test |
| **D3-A-3** | High | cq, sec | `/api/v1/auth/refresh` is the third unauthenticated auth endpoint and L-3 forgot to wire lockout into it. `register_failure` is never called for `/refresh`. F-15 invariant ("neither IP-rotation NOR username-spray bypasses") is silently false. | ~20 LOC + test |
| **D3-A-4** | High | cq | `_VERSION = "0.18.0-saas-base"` at `observability.py:38` was never bumped despite the Day-2 capstone announcing the v0.18.1 re-tag. `phantom_build_info` and `/healthz` payload lie about the running build. | 1 LOC + test |
| **D3-A-5** | High | perf | F-17 chroma-janitor regressed: function exists, was never wired to lifespan or cron. `chroma_data/` grew 105 MB → 122 MB / 609 → 705 dirs in 24 h. Monotonic test-fixture leak. | ~20 LOC + test |
| **D3-A-6** | Med | perf | `_probe_chroma` trusts a once-set `client_initialized()` flag — `/readyz` keeps reporting healthy after a runtime chroma collapse. Day-2 redesign traded one class of false-positive for another. | ~15 LOC + test |
| **D3-A-7** | High | sec | `NEW-SEC-01` — both `/ws` and `/ws/voice` accept JWT in the query string. Default nginx/uvicorn access logs capture the full URL. 8-hour token leaks to every operator with `journalctl` access. Day-2 did not flag. | ~30 LOC + test |
| **D3-A-8** | Med | ops | `OPERATIONS.md:96-98` claims metrics "are not yet incremented" — they are. Documentation lies; integrators see "stub" and skip the dashboard. | doc-only |
| **D3-A-9** | Med | test | H-2 (F-08/F-09 closure) covers specific routes but cannot detect a *new* unauthed route. Need a programmatic `app.routes` walker against a public whitelist. | ~50 LOC test |
| **D3-A-10** | Med | test | I-5 (CPU sampler) has no lifespan-integrated start/stop test; a wiring break in `main.py` lifespan would not be caught. | ~30 LOC test |
| **D3-A-11** | High | test | FLAKE-01: no autouse conftest fixture resets `system_metrics_sampler` between tests. Under pytest-asyncio `auto` the old sampler task is on a dead loop → `RuntimeError: Task attached to a different loop`. Already manifesting as flaky `test_phase07_voice` / `test_phase08_face`. | ~15 LOC fixture |
| **D3-A-12** | Med | test | FLAKE-02: `conftest._ensure_seed_phantom_user` calls `asyncio.run()` inside try/except RuntimeError — silently swallowed under pytest-asyncio session loop, so the seed row may not exist, sporadic 401s. | ~15 LOC |

**Block O exit gate:** all 12 Tier-A items closed, full pytest still
green, the new tests above land, and the Day-2 re-tag situation
addressed (either fixup tag or note in OPERATIONS.md).

---

## Tier B — architectural / coupling (mostly Block P)

| ID | Source | One-line | Block |
|---|---|---|---|
| **D3-B-1** | arch | F-44 inversion plan misses the second writer site `_refresh_nearby` — needs TWO setters (`set_localization` + `set_nearby_features`), ~80 LOC not 50. | P, lane B-2 |
| **D3-B-2** | arch | NEW-ARCH-03: `command_sender.send_actuator(payload)` does not exist. The real API is `command_sender.send(payload)` — fix the plan before lane B-3 starts. | P plan-fix |
| **D3-B-3** | arch | NEW-ARCH-04: `ProactiveLoop.enqueue_initiative(action)` does not exist. Recommend `ProactiveTrigger(kind=RULE_ACTION, ...)` route via `push_trigger`. Pairs with F-06 collapse. | P, lane B-3 |
| **D3-B-4** | arch | NEW-ARCH-09: F-33 `_can_initiate` mutation-on-check must close in Block O before lane B-3 (subscriber would leak cooldown burns under stress). | O |
| **D3-B-5** | cq | `output_safety.sanitize` (D2-I1) has zero production callers. Sanitizer is a stub library. Either wire into `routes_chat._build_ai_response` (Block O) or delete (Tier D will rewire anyway). | O |
| **D3-B-6** | cq | `tool_executor._HANDLERS` registers `create_calendar_event` despite D2-E1 explicitly deferring it. `gemini_provider.call_with_tools` agent path can already reach it. | O — drop from registry |
| **D3-B-7** | arch | `system_metrics_sampler.py` lives at backend root — should fold into `observability/` package or split observability into a package. Naming "kitchen sink" forming alongside observability.py. | E or T |
| **D3-B-8** | arch | NEW-ARCH-10: 4 `api/`-layer imports inside `agent/proactive.py`. F-06 keeper needs to invert this. | P, lane B-4 |
| **D3-B-9** | fe | NEW-FE-01: 3 backend keys (`chat_tool_call_timeout_s`, `chat_tool_max_total_ms`, `log_json_enabled`) absent from `routes_settings.CATEGORY_SPEC`. UI auto-renders zero rows. | R-fe |
| **D3-B-10** | fe | NEW-FE-03: `StatusBar.tsx:42` whole-store destructure — D2-FE5 still open, voice-amplitude 30 Hz cascades into 5 children. | R-fe |
| **D3-B-11** | fe | NEW-FE-04: `LoginScreen` does not parse `Retry-After` / `X-Error-Code: LOCKED_OUT` from 429. Backend lockout is invisible to the UI. | R-fe |
| **D3-B-12** | sec | NEW-SEC-13: `/auth/refresh` CSRF surface — accepts cookies-on-token without explicit CSRF check. | R-be |
| **D3-B-13** | perf | NEW-PERF-01: `ai_tool_use_log` has 3 producers, no rotation, no index on `tool_name`. Year-1 projection 175 MB. | E or T |

---

## Tier C — security (Block O for ≤30 LOC; Block R-be for the rest)

Day-2's security closures are mostly real. The remaining surface:

| ID | Severity | Source | One-line | Block |
|---|---|---|---|---|
| **D3-C-1** | High | sec NEW-SEC-02 | `/auth/login/pin` + `/auth/config` timing-oracle username enumeration (no constant-time burn on user-not-found). | O |
| **D3-C-2** | High | sec NEW-SEC-03 | JWT `orig_iat` back-fill bypass: tokens issued before the cap landed have no `orig_iat` and the verify-side fallback to `iat` lets a refresh chain past 30 d for grandfathered tokens. | O |
| **D3-C-3** | High | sec NEW-SEC-04 | `RoleChecker` reads `token_data.role` (token claim, not DB) → role demotion takes effect only at next re-auth. | R-be |
| **D3-C-4** | High | sec NEW-SEC-05 | `tool_args_json` is unbounded by row but truncated at 1000 chars — single audit row capped, but no global rotation. Disk-fill DoS via repeated chat tool-use. | R-be (rotation policy) |
| **D3-C-5** | High | sec NEW-SEC-06 | `output_safety.sanitize` paraphrase + tool-arg bypass: only catches verbatim substring matches; LLM rewording defeats it. 3-token floor + 200-row cap on facts examined are settable bypasses. | Q (Tier D rewires) |
| **D3-C-6** | High | sec NEW-SEC-07 | `_safe_query_str` Unicode list misses soft-hyphen U+00AD, NUL, tab, NFD-NFC mismatch. | O |
| **D3-C-7** | High | sec NEW-SEC-08 | `/healthz`, `/readyz`, `/metrics` unauthenticated — fine for trusted-network k8s but exposes internal version + dep status if reverse-proxied externally. | E (doc) or O (auth gate behind config flag) |
| **D3-C-8** | High | sec NEW-SEC-09 | `chroma.sqlite3` still tracked in git. Operator data history in commit graph. | O |
| **D3-C-9** | Med | sec NEW-SEC-10 | Lockout state is in-process module globals — multi-worker uvicorn defeats it. `--workers 1` is the implicit deploy invariant; needs documenting + `RuntimeError` at boot if `WORKERS > 1`. | R-be |
| **D3-C-10** | Med | sec NEW-SEC-11 | No constant-time burn on user-not-found (paired with D3-C-1). | O |
| **D3-C-11** | Med | sec NEW-SEC-12 | Per-IP key burns out legit users sharing NAT. Need exemption when XFF trust-mode validates a known proxy. | R-be (after D3-A-2 lands) |
| **D3-C-12** | Med | sec NEW-SEC-14 | D2-T2 closure left geo-fact poisoning leftover: a fact extracted from a previous turn's user_message that was attacker-controlled can still poison a later session. | Q (Tier D output sanitization across turns) |
| **D3-C-13** | Low | sec NEW-SEC-15 | Secret-blocklist is too narrow; misses Gemini key prefixes other than the current single one. | E |
| **D3-C-14** | Low | sec NEW-SEC-16 | `/auth/refresh` query-string token (paired with D3-A-7). | O |

---

## Tier D — correctness / bugs

| ID | Source | One-line | Block |
|---|---|---|---|
| **D3-D-1** | perf NEW-PERF-02 | Chat hot path: 8-12 SQLite roundtrips + dual `await db.commit()` barrier (F-20 still open). | Q hot-path scope |
| **D3-D-2** | perf NEW-PERF-03 | Proactive loop comment says "every 5th cycle" but emits every cycle. | O |
| **D3-D-3** | perf NEW-PERF-04 | `_audit_dispatch` blocks chat hot path despite docstring "telemetry must never block". | Q |
| **D3-D-4** | perf NEW-PERF-06 | `chat_messages_total` increments before DB write succeeds. Counter drifts above DB row count under failure. | O |
| **D3-D-5** | cq | output_safety unbounded SELECT-200 + regex compile per fact + magic-literal thresholds. | Q rewires anyway |
| **D3-D-6** | cq | sampler globals without asyncio lock under reload. | E or T |
| **D3-D-7** | cq | `engine_error` plumbing across `voice/stt_engine.py` not verified by H-3's test set. Add a 503 round-trip from the Whisper provider. | O |
| **D3-D-8** | cq | `extract_and_store_facts` runs on the live request session against the H-5 deadlock invariant. | Q |
| **D3-D-9** | tests NEW-TEST-01..16 | 16 hot-path coverage gaps in output_safety, login_lockout, jwt_manager, system_metrics_sampler, JsonFormatter. | O for the ≤30 LOC ones |

---

## Tier E — ops / maintainability

| ID | Source | One-line | Block |
|---|---|---|---|
| **D3-E-1** | ops NEW-OPS-02 | No automated ChromaDB backup. `phantom_chroma` volume backup story missing entirely. | T (doc) + post-Day-3 cron |
| **D3-E-2** | ops NEW-OPS-03 | Multi-tenant deploy "forbidden" only in docs — no runtime guard. Need `RuntimeError` on lifespan startup if user count > 1 AND `deployment_mode == "multi"` not explicitly set. | R-be |
| **D3-E-3** | cq | Dead `db: AsyncSession` parameter in `chat_tool_dispatcher.dispatch` (collapsed during H-5 consolidation). | O |
| **D3-E-4** | cq | Three independent truncation conventions across `_args_snippet`, audit row, log line. Standardize. | O |
| **D3-E-5** | cq | `chroma_janitor._safe_id` duplicates `_collection_name`'s regex with "kept identical" comment. Extract shared helper. | O |
| **D3-E-6** | perf NEW-PERF-07 | `phantom_chat_tool_calls_total` planned but not implemented; `ai_router_fallthrough_total` registered but **never incremented anywhere**. | Q (chat metric) + O (fallthrough wire-up) |
| **D3-E-7** | ops NEW-OPS-04 | OPERATIONS.md slightly stale on PUT-route landing dates. | T |
| **D3-E-8** | ops NEW-OPS-09 | OPERATIONS.md test-count assertion "1091+" — actual is 1194. | O |
| **D3-E-9** | fe NEW-FE-02 | `AmbientGlows` 3 pulsing blobs are decorative-only. CLAUDE.md rule 9 violation. Couple to `breathing_bpm` or system state. | R-fe |

---

## Tier F — latents (Block S)

These are the original Day-2 Tier F carry-overs plus a few new ones.

| ID | Source | One-line |
|---|---|---|
| F-29 | Day-2 | WS hub broadcast race |
| F-30 | Day-2 | chat user_msg orphans (no transactional rollback) |
| F-32 | Day-2 | single-writer race on `system.ai_provider` |
| F-33 | Day-2 | `_can_initiate` side effect on check (now also flagged Tier B by N-arch — promote to O) |
| F-35 | Day-2 | `_first_visit` reads `where.place_known` (never written) |
| F-36 | Day-2 | WS chat handler opaque error |
| F-41 | Day-2 | `net.scan` ports mode SSRF |
| **D3-F-1** | perf NEW-PERF-05 | `wait_for(stop_event.wait, timeout=...)` allocates a future per second × 4 sites |
| **D3-F-2** | perf NEW-PERF-08 | `login_lockout._failures` dict keys never evicted |
| **D3-F-3** | tests | output_safety `_BARE_TEXT_LEN_FLOOR = 4` is a settable boundary; add boundary-value test |

---

## TM-17B ship-blockers for Tier D (Block Q)

The threat-model agent flagged 4 Critical and 8 High items that gate
Phase-17b chat tool-use loop. These belong inside Block Q (not Block O)
because they require new code in `chat_pipeline.py`. Listed for routing
visibility:

| ID | Severity | Mitigation requirement |
|---|---|---|
| **TM-17B-S1** | Critical | Native `FunctionResponse` channel + per-process nonce + request-boundary marker strip + 4000-char content cap |
| **TM-17B-T2** | Critical | Cross-tenant `get_sensor_status` leak (multi-tenant only) — runtime catalog filter on `deployment_mode == "multi"` |
| **TM-17B-E2** | Critical | `chat_pipeline` MUST go through `chat_tool_dispatcher.dispatch` only; never `tool_executor.execute_tool` directly |
| **TM-17B-E4** | Critical | Import-gate CI test forbidding `agent.actions`/`agent.runtime`/`agent.proactive` imports inside `ai/chat_pipeline.py` |
| TM-17B-S2 | High | Ollama fallback string-concat re-spawns S1 → toggle `chat_tools_enabled=False` for the affected turn |
| TM-17B-S5 | High | Stream-chunk pre-classifier window |
| TM-17B-R1 | High | Audit log gap on recursion + `turn_id` migration |
| TM-17B-I1 | High | Intermediate tool-result content not sanitized — paraphrase-leak |
| TM-17B-I2 | High | `tool_args_json` exposes pasted credentials → tighter redaction |
| TM-17B-D1 | High | Wall-clock cap reserve budget |
| TM-17B-E1 | High | `chat_tools_enabled` flip without D2-I2 awareness — runtime guard |
| TM-17B-E3 | High | `tool_config_mode="ANY"` regression risk |

**Recommended Tier-D scope adjustment:** chat tool-use is **Gemini-only**
for v0.19.0. Ollama fallback toggles `chat_tools_enabled=False` for the
affected turn until cross-provider verification ships post-v0.19.

---

## Block-O scope (final)

After dedupe, Block O lands as 5-7 atomic commits. Estimated 250-400 LOC + ~250 LOC tests.

**Commit O-1 — Tier-A auth false-completions** (D3-A-1, D3-A-3, D3-A-7, D3-C-14):
- Refuse explicit `/login/pin` for users whose PIN is bootstrap default.
- Wire login_lockout into `/auth/refresh` (IP key + sub-claim user key).
- Move JWT off WS query-string into `Sec-WebSocket-Protocol` header (front + back).
- Tests: bypass-attempt regression + WS-401-without-query.

**Commit O-2 — Lockout XFF awareness** (D3-A-2):
- Add `security_trust_xff: bool = False` config knob.
- When trusted, parse rightmost `X-Forwarded-For` IP for the IP-key.
- Tests: behind-proxy + spoof-XFF-when-untrusted regression.

**Commit O-3 — Janitor lifespan wire-up + cron hint** (D3-A-5, D3-A-6):
- Run `prune_orphan_collections` + `prune_orphan_dirs` from lifespan.
- `_probe_chroma` does a lightweight `client.heartbeat()` not just the cached flag.
- Test: collection added then ghost-orphan dir made → next lifespan boot prunes both.

**Commit O-4 — Build-info + version bump + chroma.sqlite3 untrack** (D3-A-4, D3-A-8, D3-C-8):
- `_VERSION = "0.18.2-fixup"` (Day-3 fixup tier; v0.19 lands later).
- Update `OPERATIONS.md` metrics-incremented section.
- `git rm --cached src/backend/chroma_data/chroma.sqlite3` + add to `.gitignore`.

**Commit O-5 — Test infra hardening** (D3-A-9, D3-A-10, D3-A-11, D3-A-12):
- Programmatic `app.routes` walker against public whitelist.
- Lifespan-integrated sampler start/stop test.
- Async autouse fixture resetting sampler.
- Replace `_ensure_seed_phantom_user` `asyncio.run()` with proper async fixture.

**Commit O-6 — Tier-C ≤30LOC + Tier-D fast** (D3-B-4, D3-B-5, D3-B-6, D3-C-1+10, D3-C-6, D3-D-2, D3-D-4, D3-D-7, D3-E-3, D3-E-4, D3-E-5, D3-E-6 fallthrough wire-up, D3-E-8):
- F-33 `_can_initiate` no-mutation rename (`peek_can_initiate` for read).
- Wire `output_safety.sanitize` into `routes_chat._build_ai_response`.
- Drop `create_calendar_event` from `_HANDLERS`.
- Constant-time burn on user-not-found in `/auth/login/pin`.
- Extend `_UNICODE_DANGER_SET` with U+00AD, NUL, tab, ZWSP family completions.
- Fix proactive "every 5th cycle" to actually skip 4.
- Move `phantom_chat_messages_total` increment to *after* DB commit.
- Add 503 round-trip test for whisper provider engine_error.
- Drop dead `db: AsyncSession` from `chat_tool_dispatcher.dispatch`.
- Standardize truncation helper.
- Wire `ai_router_fallthrough_total` increment.
- Bump CI test-count assertion.

**Commit O-7 — JWT orig_iat hardening + audit doc commit** (D3-C-2):
- Refuse legacy tokens with no `orig_iat` after a 7-day grace window — issue a re-auth request.
- Document the absolute-cap math in OPERATIONS.md.

---

## Updates to Day-3 plan (`AUTONOMOUS_DAY_PLAN_DAY3.md`)

The architect agent caught two phantom APIs in the Day-3 Block-P plan;
these need correction before Lane B-3 fires. The plan doc itself is not
edited here — Block P will plan-fix in its first commit. The corrections:

* "command_sender.send_actuator(payload)" → "command_sender.send(payload)"
* "ProactiveLoop.enqueue_initiative(action)" → "ProactiveLoop.push_trigger(ProactiveTrigger(kind=RULE_ACTION, payload=...))"
* Block-P plan shows F-44 as one setter (~50 LOC); reality requires two setters (~80 LOC).

These three corrections are propagated as comments in the lane-handoff
files inside `dispatch/` once Block P starts.

---

## Block sequence (re-confirmed)

| Block | Status | Notes |
|---|---|---|
| N | DONE | This doc + 8 perspective files. |
| O | NEXT | 7 atomic commits, ~700 LOC total (code + tests). Closes 12 Tier-A items + ~15 Tier-B/C/D fast wins. |
| P | After O | Tier B EventBus + dispatch — uses corrected plan from D3-B-1..B-3 above. |
| Q | After P | Tier D Phase-17b — gated by 4 Critical TM-17B items. |
| R | After Q | Backend (R-be) + Frontend (R-fe) parallel. |
| S | After R | 7 Day-2 carry-overs + 3 new D3-F items. |
| T | After S | Capstone, OPERATIONS update, Day-3 acceptance tag. |

**Day-3 acceptance criteria:** all Tier-A items closed, Phase-17b ships
with 12 TM-17B blockers mitigated, frontend Settings UI auto-renders the
3 Day-2 keys, multi-tenant runtime guard in place, ChromaDB backup
documented in OPERATIONS, full backend pytest green at every commit
boundary.
