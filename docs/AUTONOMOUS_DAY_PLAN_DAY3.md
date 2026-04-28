# PHANTOM OS — Autonomous Day Plan, Day 3 (2026-04-30)

**Source of truth.** When the next "me" lands mid-session post-compact, read this doc first, then `memory/active_day_plan.md`, then `git log --oneline 22760c7..HEAD`. Do not replan from scratch.

**Window:** 2026-04-30 (operator's choice, target ~12 h end-to-end).
**Branch:** continue on `autonomous-run`. Baseline: `c3602c8` (`autonomous-day-2026-04-29-acceptance`). Re-tag at end as `autonomous-day-2026-04-30-acceptance`.
**Productisation tag at exit:** `v0.19.0-jarvis-online` (Tier D ships chat tool-use). If Tier E frontend lands too: `v0.20.0-secure-saas`.

## Why Day 3 needs more agents

Day 2 closed 24 audit findings across 11 commits, ~5 wall-clock hours. The remaining work is wider but more parallelisable:

* Tier B (EventBus + dispatch package) is 4 mostly-independent sub-changes.
* Tier D (Phase 17b call_with_tools) sequences ~6 atomic steps but each has independent testing.
* Tier E remaining splits cleanly: backend (F-58, F-40, per-tenant ContextEngine) vs frontend (D2-FE1..FE5).
* Tier F latents (7 small fixes) can run as concurrent feature-pair commits.

**Agent allocation:** 8 parallel review agents on the Day-3 audit baseline (vs 6 on Day-2), then 4 concurrent implementation lanes during Tier B + Tier E. Use `oh-my-claudecode:team`, `superpowers:dispatching-parallel-agents`, or direct `Agent(...)` calls with `subagent_type=general-purpose` per lane.

---

## Block sequence

| # | Block | Window | Ship |
|---|---|---|---|
| **N** | Multi-perspective audit baseline (8 reviewers) | 03:00 → 04:30 | `docs/audit-2026-04-30-day3/FINDINGS.md` |
| **O** | Quick-win sweep from N | 04:30 → 05:30 | 3-4 atomic commits |
| **P** | Tier B — EventBus subscribers + `dispatch/` package | 05:30 → 08:00 | 3 commits, 4 sub-lanes parallel |
| **Q** | Tier D — Phase 17b chat `call_with_tools` | 08:00 → 10:00 | 3-4 commits, tag `v0.19.0-jarvis-online` |
| **R** | Tier E remainder (backend + frontend in parallel) | 10:00 → 11:30 | 4-5 commits, tag `v0.20.0-secure-saas` if frontend lands |
| **S** | Tier F latent correctness cleanup | 11:30 → 12:30 | 3-4 commits, no tag |
| **T** | Day-3 capstone + acceptance tag | 12:30 → 13:00 | 1 commit, tag `autonomous-day-2026-04-30-acceptance` |

**Hard rules** (carried from Day 2):
* atomic commits, tags as listed above
* `pytest` + `tsc` + `vite build` all green at every commit boundary
* `chroma_data/chroma.sqlite3` runtime drift restored before each commit
* `memory/active_day_plan.md` updated at each commit boundary
* Tier A-style false-completions explicitly looked for in Block N

---

## Block N — Day-3 audit baseline (8 reviewers)

Spawn 8 review agents in parallel (single message, multiple `Agent` calls, `run_in_background=true`):

| Agent | Subagent type | Focus |
|---|---|---|
| **N-cq** | `comprehensive-review:code-reviewer` | Code-quality drift since `c3602c8`; Day-2 commits' commit-msg-vs-code parity |
| **N-arch** | `comprehensive-review:architect-review` | EventBus/dispatch boundaries; `dispatch/` package proposal viability |
| **N-sec** | `security-scanning:security-auditor` | Auth surface re-audit (post-L items); chat tool-use threat re-test |
| **N-perf** | `full-stack-orchestration:performance-engineer` | `/readyz` cold-start budget; chat-turn p99; chroma janitor effectiveness |
| **N-tm** | `security-scanning:threat-modeling-expert` | STRIDE on Phase 17b `call_with_tools` (Tier D-blocking) |
| **N-fe** | `frontend-design:frontend-design` | Settings UI auto-render gaps (D2-FE1..FE5); 1024×600 layout regress check |
| **N-test** | `full-stack-orchestration:test-automator` | Coverage gaps in tier-A/C/E test surfaces; flake harvesting |
| **N-ops** | `full-stack-orchestration:deployment-engineer` | Dockerfile + CI workflow audit; D2-D-G2 follow-up; backup/restore story |

Deliverable: `docs/audit-2026-04-30-day3/FINDINGS.md` (consolidated punch-list ranked Tier A..F like Day-2).

**Anti-pattern guard.** Day-1 produced false-completions; Day-2 closed them. Block N MUST explicitly look for "claimed-closed-but-not-actually" rows from Day-2 — call those Tier A. Re-tag rollback only if Tier A non-empty.

---

## Block O — Quick-win sweep

Every Block-N finding ≤ 30 LOC fixable goes here as a batched commit. Targets:
* Day-2 deferred items that turned out cheaper than estimated.
* Test-coverage holes the audit calls out (≤ 50 LOC test additions).
* Documentation drift (commit messages vs code).
* CI workflow updates if `.github/workflows/ci.yml` test-count assertions need bumping (it expects "1091+ tests"; we're at 1194+).

Estimated: 3-4 commits, ~150 LOC total.

---

## Block P — Tier B (heaviest single block)

The audit's architect plan in `docs/audit-2026-04-29-day2/architecture.md`:

1. **New `src/backend/dispatch/` package outside `core/`** — houses `action_dispatcher`, `state_broadcaster`. Subscribes to `decision_action`, `state_changed`, `context_updated`. Collapses the duplicated `state.transition` inline broadcasts at `main.py:69-75 + 105-111`.
2. **F-44 layering inversion fix** — `agent/localization/lifecycle.py` writer task pushes via a new `ContextEngine.set_localization()` setter. Pure refactor; deletes `core/context_engine.py:331,362,388-437`.
3. **F-02 + F-03 EventBus subscribers** — `decision_action` subscriber routes to `action_dispatcher`; `state_changed` subscriber routes to WS broadcaster + `state_broadcaster`.
4. **F-06 dual proactive system collapse** — pick one of `decision_tree.py` (rule, 500 ms) vs `agent/proactive.py` (LLM, 30-300 s) as canonical; the other becomes a feature flag or deletes.

**Parallel dispatch:**
* Lane B-1 (general-purpose agent): create `dispatch/` skeleton + state_broadcaster + 8-12 tests.
* Lane B-2 (general-purpose agent): F-44 layering inversion refactor + tests.
* Lane B-3 (general-purpose agent): F-02 subscribers + integration tests.
* Lane B-4 (general-purpose agent): F-06 audit — write a recommendation doc, NOT yet code, then operator picks the keeper.

Lanes B-1, B-2, B-4 are independent; B-3 depends on B-1 (subscriber needs `dispatch/` to exist). Run B-1+B-2+B-4 first (parallel), then B-3.

**Each lane's contract:**
* one atomic commit at end
* full backend pytest still green
* commit message references audit finding (F-02 / F-03 / F-06 / F-44)
* update `docs/AUTONOMOUS_DAY_PLAN_DAY3.md` checklist on completion

---

## Block Q — Tier D Phase 17b chat `call_with_tools`

The phase 17b doc (`docs/phases/PHASE_17_CHAT_TOOLS.md`) lists the pre-flight checklist Tier C closed. Tier D wires the loop:

| Step | Change | Files |
|---|---|---|
| 1 | New `ai/chat_pipeline.py` — bounded `call_with_tools` loop with depth + wall-clock + per-call timeout caps. Reads `chat_tool_max_total_ms` (PERF-17b) and `chat_tool_max_calls_per_turn`. | `ai/chat_pipeline.py` |
| 2 | Thread `tool_config_mode: Literal["AUTO","ANY"] = "ANY"` through `AIProvider.call_with_tools`. Default keeps tactical planner; chat passes `"AUTO"`. | `ai/provider.py` ABC, `ai/gemini_provider.py`, `ai/ollama_provider.py`, `ai/tool_use.py` Protocol |
| 3 | `routes_chat._build_ai_response`: when `chat_tools_enabled`, route through `chat_pipeline.run(...)`. Else current path. Default flag stays `False`. | `routes_chat.py` |
| 4 | Tool-result envelope `{"_phantom_tool": "<name>", "ok": bool, "content": ...}` so the LLM cannot fake a tool-result marker. | `chat_tool_dispatcher.py` |
| 5 | `phantom_chat_tool_calls_total{tool=...,ok=...}` counter. | `observability.py` + `chat_pipeline.py` |
| 6 | `output_safety.sanitize` called between final LLM response and broadcast. | `chat_pipeline.py` |

Acceptance gate: a fresh chat session asking "де я був вчора?" produces `[search_locationhistory(hours_ago=24)]` → result rows → answer mentioning concrete `place_name`s. Tag `v0.19.0-jarvis-online`.

**No parallel lanes** — Tier D is sequential because each step builds on the previous. Test additions can be staged per-step.

---

## Block R — Tier E remainder (backend + frontend in parallel)

| Lane | Subagent | Scope |
|---|---|---|
| **R-be** | `backend-development:backend-architect` | F-58 subprocess sandbox + F-40 realpath workspace check + per-tenant `ContextEngine` skeleton (Phase 17b multi-tenant unblock) |
| **R-fe** | `frontend-design:frontend-design` | D2-FE1..FE5 — auto-render Day-2 config keys in SettingsPanel; 32 px → 44 px touch-target fix on NPU Refresh; agent_risk_tolerance legal-values constraint; setContext shallow-equality bail; per-field selectors in `StatusBar.tsx:42` |

Lanes are independent (backend vs frontend code paths). Each ships own atomic commits. If both green, tag `v0.20.0-secure-saas`. If only R-be green, defer the tag.

---

## Block S — Tier F latent correctness

7 small carry-overs from the Day-2 audit's Tier F. Each gets its own commit:

* **F-29** WS hub broadcast race
* **F-30** chat user_msg orphans (no transactional rollback)
* **F-32** single-writer race on `system.ai_provider`
* **F-33** `_can_initiate` side effect on check
* **F-35** `_first_visit` reads `where.place_known` (never written)
* **F-36** WS chat handler opaque error
* **F-41** `net.scan` ports mode SSRF

Estimated: 30-50 LOC each. Can be batched as 2-3 atomic commits if related (F-29 + F-30 + F-36 = WS feedback batch; F-32 + F-33 + F-35 = state-mgmt batch; F-41 = standalone).

---

## Block T — Day-3 capstone

* Update `docs/OPERATIONS.md` with new keys + Phase 17b enable instructions + per-tenant note.
* Update `README.md` with the v0.19/v0.20 release lines.
* Final pytest + frontend gate.
* Single commit "phase-19-acceptance: full chat tool-use baseline" or similar.
* Tag `autonomous-day-2026-04-30-acceptance`.

---

## Cross-cutting concurrency rules

* **Never let two lanes touch the same file in flight.** Block P and R have file-disjoint lanes by design; if a lane needs a file the audit didn't anticipate, it queues that change for a serialised handoff.
* **One pytest at a time.** Background pytest runs cost ~3 min wall + the cache-miss tax once they exceed 5 min. Lanes that finish their commits MUST schedule their full pytest after the prior lane's pytest exits.
* **Commit-message rigor.** Audit-finding ID (F-XX or D2-YY) MUST appear in every commit message so post-run verification can grep the closure trail.
* **Memory hygiene.** Update `memory/active_day_plan.md` at every commit boundary, NOT at block boundary — compact can fire mid-block.

## What NOT to do

* Don't flip `chat_tools_enabled` default to `True` in Tier D — that ship date is governed by per-tenant `ContextEngine` (D2-I2). Default stays `False`; operators opt in per deploy.
* Don't add `bash`/`shell`/`subprocess`/`exec` to `chat_tool_dispatcher._CHAT_SAFE_TOOL_NAMES`. Permanent invariant per Phase 17 doc.
* Don't `git stash` or `git reset --hard` to clear conflicts — investigate root cause; the multi-lane design assumes file-disjoint commits.
* Don't ship a frontend commit without `tsc --noEmit` + `vite build` green; CI will catch it but the wall-clock tax is high.

## Post-compact survival

If the conversation gets compacted mid-Day-3:

1. `cat memory/MEMORY.md` — load index.
2. `cat memory/active_day_plan.md` — find current block + last commit hash.
3. `cat docs/AUTONOMOUS_DAY_PLAN_DAY3.md` — this doc.
4. `cat docs/audit-2026-04-30-day3/FINDINGS.md` — the punch list (after Block N ships).
5. `git status --short` + `git log --oneline c3602c8..HEAD` — what shipped, what's in flight.
6. Continue from the next unfinished step in the active block. Do NOT re-spawn agents already running — check `TaskList` first.

The Day-2 plan's compact-survival protocol still applies (`memory/compact_protocol.md`).
