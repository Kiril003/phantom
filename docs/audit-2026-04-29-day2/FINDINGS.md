# PHANTOM OS — Day 2 Audit, 2026-04-29

Consolidated punch list from six parallel reviewers (code-quality, architecture, security, performance, STRIDE threat-model for F-01, frontend) at HEAD `111181e` (tag `autonomous-day-2026-04-28-acceptance`). Source dimensions shown as `[CQ]` `[ARCH]` `[SEC]` `[PERF]` `[TM]` `[FE]`.

**Headline (and it's bad):** the Day-1 swarm closed 14 audit findings on paper but the post-Day-1 swarm finds **5 P0 false-completions** that ship in `v0.18.0-saas-base`. Two of them (voice + settings unauthenticated) are the LAN-takeover surface the original audit explicitly flagged P0. One of them (the F-25 silent-NPU fix) populates an `engine_error` field that no caller reads, so the bug stays observable. One (the middleware order) reverses the documented invariant. One (the parallel chat-tool dispatchers) is architectural drift introduced this same Day 1.

**Productisation tag rollback recommended.** `v0.18.0-saas-base` should NOT be considered ship-quality until the Tier-A items below close. We re-tag as `v0.18.1-saas-base` after Tier A lands.

The new big finding: chat tool-use (Phase 17b — the Jarvis unlock) cannot be enabled in production until 13 hardening items from the threat model land. The chain is `user message → recall_memory_facts → search_web` (F-11) plus four newly-mapped exfil paths (location history → TTS, anchors → audit log, sensor status across tenants, prompt-section flags via the new prompt-logging table). The dispatcher's argument clamps have multiple bypasses (`bool` → `int(True)`, RTL Unicode, unescaped `ILIKE %query%`).

---

## Tier A — Day-1 false completions (P0, must close FIRST)

| ID | Where | Issue + fix | Source |
|---|---|---|---|
| **D2-A1** | `routes_voice.py:76,113,152` | F-08 voice routes still have no `Depends(require_auth)` despite Day-1 commit `f488298` claiming it was deferred. Tag `v0.18.0-saas-base` ships LAN-takeover surface. **Must add auth + a TestClient fixture so the existing voice tests survive the gate.** | [CQ] [SEC] |
| **D2-A2** | `routes_settings.py:437,442,636` | F-09 settings GET / `_value` / export still unauthenticated. Same root cause as A1: deferred to "Block E with auth fixture" but tag shipped anyway. | [CQ] [SEC] |
| **D2-A3** | `voice/whisper_npu_provider.py:384`, `mms_npu_provider.py:293`, `routes_voice.py:47-110` | F-25 half-wired: provider populates `engine_error` but `STTResponse` schema has no field, route at line 110 doesn't check it, and `voice/pipeline.py` ignores it. Operator still sees silent-empty-transcript. Provider also doesn't reset `_session = None`, so a wedged HTP stays wedged. **Wire to 503 + reset on next call.** | [CQ] |
| **D2-A4** | `main.py:497-498` | Q-03: middleware registration order is documented as "correlation-id first, counter second" but FastAPI middleware decorators are LIFO so the counter actually runs OUTER. Counter exception path runs without the contextvar bound. Swap the order. | [CQ] |
| **D2-A5** | `ai/tool_executor.py` (Phase 10) + `ai/chat_tool_dispatcher.py` (Phase 17a) | D-04: two parallel chat-tool implementations co-exist. The legacy `tool_executor` IS used in production via `gemini_provider.call_with_tools`; the new `chat_tool_dispatcher` is only exercised by tests. Handler drift is already visible. **Consolidate before Phase 17b enables the wiring.** | [ARCH] |
| **D2-A6** | `observability._probe_chroma`, `memory/strategic_memory._get_client` | G-1: `/readyz` cold first hit pays the 2-3 s `client.list_collections()` scan over 537 leaked collection dirs (audit F-17 still open). Fails K8s default `livenessProbe` (1 s timeout). **Open chroma client at lifespan startup; ship the F-17 janitor at the same time.** | [PERF] |

**Rollup:** Tier A closes 5 audit findings (F-08, F-09, F-17, F-25 properly, plus the architectural drift D-04). Estimated effort ~150 LOC + 2-3 commits. Lands BEFORE any Tier B work.

---

## Tier B — Jarvis unlock (Tier 0 from Day 1, still open)

| ID | Title | Where | Effort |
|---|---|---|---|
| **F-02** | EventBus has emitters but zero subscribers | `core/event_bus.py:18` (lib) + emitters at `context_engine.py:179`, `state_machine.py:297`, `decision_tree.py:70`, `serial_bridge.py:202` | M (~2 d) |
| **F-03** | DecisionTree output discarded | `decision_tree.py:78-87` `consume_initiative()` zero callers | M (depends on F-02) |
| **F-06** | Two parallel autonomous-decision systems | `decision_tree.py` (rule, 500 ms) vs `agent/proactive.py:_DECIDE_TEMPLATE` (LLM, 30-300 s) | L (~3 d) |
| **F-44** | Layering inversion (core → agent) | `core/context_engine.py:331,362` imports `agent.localization` | M |
| **F-01** | Chat ignores tool-use catalog | `routes_chat.py:226` calls `generate()` not `call_with_tools()` | M (~3 d) |

**Architect's plan** (`docs/audit-2026-04-29-day2/architecture.md`):
1. New `src/backend/dispatch/` package outside `core/` housing `action_dispatcher`, `state_broadcaster`. Subscribes to `decision_action`, `state_changed`, `context_updated`. Collapses the duplicated `state.transition` inline broadcasts at `main.py:69-75 + 105-111`.
2. New `src/backend/ai/chat_pipeline.py` calling `ai_router.call_with_tools(mode="AUTO")` per iteration. Threads `tool_config_mode` kwarg through `AIProvider.call_with_tools` (incidentally closes audit F-52).
3. Step 1 of F-44: `agent/localization/lifecycle.py` writer task pushes via a new `ContextEngine.set_localization()` setter. Pure refactor; deletes `core/context_engine.py:331,362,388-437`.

---

## Tier C — Phase 17b prerequisites (security + threat-model)

13 items from the STRIDE threat model + security re-audit. **Phase 17b's `chat_tools_enabled=True` MUST NOT ship to production until these land.** Each is small in isolation; together they're ~250-350 LOC.

### Spoofing / Tampering (input integrity)

| ID | Where | Fix |
|---|---|---|
| **D2-S2** | `chat_tool_dispatcher.py:111` (`_trim_str`) | Reject Unicode RTL/zero-width and `%`/`_` in any arg that lands in an `ILIKE` clause. Escape `%` with backslash. |
| **D2-T1** | `chat_tool_dispatcher.py:104` (`_clamp_int`) | `int(True)` returns `1`. Reject non-`int` types explicitly. |
| **D2-T2** | `routes_chat.py:319` `extract_and_store_facts(user_msg + ai_response)` | Tool-result content can be persisted into ChromaDB and re-emitted on the next turn — self-poisoning loop. **Only persist `user_message`; never the AI tool-result text** until output classifier ships. |

### Repudiation (audit completeness)

| ID | Where | Fix |
|---|---|---|
| **D2-R1** | `db/models.py:393-427` `AiToolUseLog` | Add `tool_args_json`, `tool_result_summary` columns + migration `005_chat_tool_audit.py`. |
| **D2-R3** | `routes_chat.py:289` | `user_id` only set when `chat_prompt_logging_enabled=True`. Always set it for chat-tool rows. |

### Information disclosure / Cross-tenant isolation

| ID | Where | Fix |
|---|---|---|
| **D2-I1** | `ai/personality.py:86` `DATA_TOOLS_GUIDANCE` | After 17b lands, the LLM is told "tools available". Output classifier on the final assistant message before TTS / chat broadcast — sanitise any string that looks like a memory fact verbatim quote. **Implement as `ai/output_safety.py`.** |
| **D2-I2** | `chat_tool_dispatcher._h_get_sensor_status` | Currently reads `context_engine.get_snapshot()` — process-global. In a multi-tenant cloud deploy, every tenant sees every other tenant's sensors. **Phase doc must explicitly forbid multi-tenant deploy until per-tenant ContextEngine lands.** |
| **D2-I4** | `routes_chat.py` chat-prompt log + audit F-09 | If F-09 settings/audit log is fixed under Tier A, this chain is closed. Re-verify after Tier A. |

### Denial of service (per-turn budget)

| ID | Where | Fix |
|---|---|---|
| **D2-D1** | `chat_tool_dispatcher.dispatch` | No per-call timeout. **Add `asyncio.wait_for(handler, timeout=config.chat_tool_call_timeout_s)` (default 10 s).** |
| **PERF-17b** | New `config.chat_tool_max_total_ms` | 4 iterations × Gemini ~2.1 s p50 = 8.4 s wall, 25 s p99. **Add per-turn wall-clock cap (default 12 s); abort with last-good response.** |
| **D2-D-cpu** | `chat_tool_dispatcher._h_get_system_metrics` | `psutil.cpu_percent(interval=0.05)` blocks 50 ms × up to 4 calls = 200 ms event-loop block per turn. **Pre-sample on a 1 Hz background tick; tool reads cached value.** |

### Elevation of privilege (must NOT ship in 17b)

| ID | Where | Fix |
|---|---|---|
| **D2-E1** | `ai/chat_tools.py:147` `create_calendar_event` | DO NOT register in dispatcher's `_HANDLERS` until: per-tool consent flow, mutating-tool risk gate (mirror `agent_risk_tolerance`), and audit row ALWAYS WRITTEN even on dispatcher failure. **Phase 17b doc must say: 5 read-only tools only.** |
| **D2-E2** | `agent/actions/bash.py` reachability from chat | Phase 17b doc MUST explicitly forbid wiring chat → `bash.run`. The current `chat_tool_dispatcher` doesn't expose it; document the "we will never expose it from chat" invariant. |

---

## Tier D — Phase 17b implementation

| Step | Change | Files | Tests |
|---|---|---|---|
| 1 | New `ai/chat_pipeline.py` — bounded `call_with_tools` loop with depth + wall-clock + per-call timeout caps. Returns `ChatResult(content, response_form, attachments, provider, tokens_used, tool_calls=list[dict])`. | `ai/chat_pipeline.py` | unit (mock router) + e2e |
| 2 | Thread `tool_config_mode: Literal["AUTO","ANY"] = "ANY"` through `AIProvider.call_with_tools` ABC. Default keeps tactical planner behaviour; chat passes `"AUTO"`. | `ai/provider.py` ABC, `ai/gemini_provider.py`, `ai/ollama_provider.py`, `ai/tool_use.py` Protocol | unit |
| 3 | `routes_chat._build_ai_response`: when `chat_tools_enabled`, route through `chat_pipeline.run(...)`. Else current path. Default flag stays `False`. | `routes_chat.py` | smoke + e2e |
| 4 | Tool-result envelope: every dispatcher result wrapped in `{"_phantom_tool": "<name>", "ok": bool, "content": ...}` so the LLM cannot fake a tool-result marker. | `chat_tool_dispatcher.py` | unit |
| 5 | Counter integration: `phantom_chat_tool_calls_total{tool=...,ok=...}`. | `observability.py` + `chat_pipeline.py` | unit |
| 6 | Settings UI: `chat_tools_enabled`, `chat_tool_max_total_ms`, `chat_tool_call_timeout_s` plus the existing 4 keys all surfaced in the chat category. | `routes_settings.py` `CATEGORY_SPEC` | smoke |

Tag: `v0.19.0-jarvis-online` once Tier B + Tier C + Tier D pass full pytest + frontend gates.

---

## Tier E — Productisation hardening

13 items from the security re-audit + frontend audit. Each ≤ 60 LOC.

| ID | Title | Source |
|---|---|---|
| **F-07** | Refuse auto-login when PIN matches default `000000` + force-rotate UI prompt | [SEC] |
| **F-14** | JWT `orig_iat` claim + 30-day absolute lifetime cap | [SEC] |
| **F-15** | per-IP + per-username lockout via in-memory `dict[str, deque]` | [SEC] |
| **D2-FE1** | All 7 Day-1 config keys auto-render in Settings UI via `CATEGORY_SPEC` metadata | [FE] |
| **D2-FE2** | `systemStore.setContext` shallow-equality bail (kills F-19 setContext storm) | [FE] |
| **D2-FE3** | `StatusBar.tsx:42` switches to per-field selectors instead of whole-store destructure | [FE] |
| **D2-FE4** | `agent_risk_tolerance` legal-values constraint in editor (`SettingsPanel.tsx:534-557`) | [FE] |
| **structlog** | JSON renderer wired on top of existing `CorrelationFilter` | [SEC] [OPS] |
| **D2-CI1** | CI workflow `JWT_SECRET_KEY=ci-fixed-secret-do-not-reuse` is in public history. Add a runtime guard that refuses to start with that exact value. | [SEC] |
| **D2-D-G2** | Dockerfile bundles tracked `phantom.db` — exclude from `COPY` | [SEC] |
| **D2-FE5** | NPU diagnostics "Refresh" button is 32 px (`SettingsPanel.tsx:1015`); CLAUDE.md commandment 44 px | [FE] |
| **F-58** | Route every subprocess (net.scan ping, notify.send, mcp/adapter) through `safety/sandbox.py` | [SEC] |
| **F-40** | `fs.write` workspace check uses `realpath` not `abspath`; reject any path component that's a symlink | [SEC] |

Tag: `v0.20.0-secure-saas` after Tier E lands.

---

## Tier F — Latent correctness carry-overs from Day 1

Filed but not blocking the v0.19 / v0.20 tags. Each gets its own commit when touched.

`F-29` WS hub broadcast race · `F-30` chat user_msg orphans · `F-32` single-writer race on `system.ai_provider` · `F-33` `_can_initiate` side effect on check · `F-35` `_first_visit` reads `where.place_known` (never written) · `F-36` WS chat handler opaque error · `F-41` `net.scan` ports mode SSRF.

---

## Block plan (this engagement)

| Block | Scope | Artefacts |
|---|---|---|
| **G** | Audit consolidation (this file) + commit | `audit-2026-04-29-day2: multi-perspective day-2 baseline` |
| **H** | Tier A — Day-1 false completions | 5-6 atomic commits; re-tag `v0.18.1-saas-base` |
| **I** | Tier C — chat tool security hardening | 2-3 commits; ilike escape, dispatcher timeouts, audit columns, output safety stub |
| **J** | Tier B — EventBus subscribers + action_dispatcher (`Phase 19a`) | 1-2 commits; new `dispatch/` package |
| **K** | Tier D — Phase 17b chat call_with_tools loop | 2-3 commits; tag `v0.19.0-jarvis-online` |
| **L** | Tier E — productisation hardening | 4-5 commits; tag `v0.20.0-secure-saas` |
| **M** | Day-2 capstone + tag `autonomous-day-2026-04-29-acceptance` | 1 commit |

Cross-cutting hard rules same as Day 1:
- atomic commits, prefixed `tier-X-Y: <short title>` or `phase-NN-Y: ...`;
- pytest + tsc green at every commit boundary;
- chroma.sqlite3 runtime drift restored before each commit;
- MEMORY.md updated at each commit boundary;
- Tier A ships before Tier B regardless of how shiny F-02 looks.

## Things confirmed safe (Day-2 pass)

- 1024×600 layouts: zero overflow. `min-h-0` flex containers + explicit `overflow-hidden` everywhere it matters.
- Touch-target compliance: only 1 known violation (NPU Refresh button 32 px).
- No dead modules/hooks/stores under `src/frontend/src/`.
- Animation discipline (CLAUDE.md #9): zero P0/P1 decorative violations.
- `.env`, `.env.local`, `chroma_data/`, `voice/models/` correctly gitignored.
- `bash.run` env scrub from Day 1 holds; sentinel test still passes.
