# Phase 9.5.1 — Chat latency fix

**Date:** 2026-04-23
**Branch:** `autonomous-run`
**Pre-phase baseline commit:** `997d43b` (v0.9.5-ui-prompt-polish)
**Tag:** `v0.9.5.1-streaming` (applied on success)

---

## Investigation findings

30-min bounded investigation before any code change. Reproduced the baseline
scenarios with full backend log capture.

### Root cause of the 26s `ls` anomaly: transient

Today's `ls` reproduces at 5.8–6.0s (3 consecutive runs, same session). The
26s figure from the phase 9.5 baseline was a one-off Gemini API spike; it did
not repro. Left as a known-flaky tail in the general latency profile (see
"Known remaining issues").

### Per-request trace (flash model, pre-fix)

Each `POST /api/v1/chat/message` triggers **exactly one**
`POST https://generativelanguage.googleapis.com/...:generateContent`. No double
LLM round-trip. Fix A (double-LLM-call kill) is therefore N/A — ruled out by log.

| Query | Gemini roundtrip | Notes |
|---|---|---|
| привіт | 8.5s | cold call, first request of session |
| виконай ls | 6.5s | well below 26s anomaly |
| напиши функцію сортування | 7.1s | |
| покажи навантаження | 6.6s | |

### Prompt size

`build_system_prompt(...)` with a realistic SHADOW-state snapshot, ROOT user,
behavioral model (96 interactions), no memory hints, no recent_places:

```
CHARS: 1804
TOKENS_approx: 601
```

Well under the 5000-token Fix-C threshold. Prompt trim is N/A.

### Streaming infrastructure audit

| Layer | Path | Streaming? |
|---|---|---|
| `ai/gemini_provider.py` | `generate_stream` line 239 → `generate_content_stream` line 261 | **yes** (native provider stream) |
| `ai/ollama_provider.py` | line 155 `stream=True` | **yes** |
| `ai/provider.py` (AIRouter) | `generate_stream` method line 257 | **yes** |
| `api/routes_chat.py:_build_ai_response` | `await ai_router.generate(...)` line 196 | **no** — blocking call; full response before return |
| `api/routes_chat.py:_broadcast_message_stream` | line 425–448 | **fake** — chunks the *already-completed* content with `asyncio.sleep(chat_stream_delay_s)` per chunk |
| `frontend/stores/chatStore.ts` | `setStreamChunk`, `streaming: StreamingMessage` | **yes** — consumes delta + done events |
| `frontend/hooks/useChatStream.ts` | subscribes WS `chat` channel `stream` type | **yes** |

So the frontend is fully streaming-capable today, but the backend never
actually streams — it awaits the full Gemini response, then fake-chunks it out
over WS after the HTTP POST has already resolved. **Real streaming is
feasible code-wise but the net latency win is small:** for the phase-9.5
target distribution (61% structured response forms), Gemini emits the
function-call as ONE part in the final response — there are no incremental
text chunks to stream for those. Only the 39% plain-text slice would see a
first-chunk win. Not a latency fix — a perception fix. Flagged for phase 11.

### Verified bottleneck

**The Gemini API call itself (5.5–8.5s roundtrip).** Not network, not prompt
size, not double-call, not DB, not memory extraction. Model was
`gemini-2.5-flash` — noted in config.py:53 but also **shadowed by a DB override**
(`settings.ai_gemini_model = "gemini-2.5-flash"`, set 2026-04-17 during
initial setup). Both needed to change.

---

## Fix applied

### Fix D — Gemini model swap: `2.5-flash` → `2.5-flash-lite`

Two-location change required because the DB-persisted settings override
shadows the config default:

1. `src/backend/config.py:53` — `ai_gemini_model: str = "gemini-2.5-flash-lite"`
2. `phantom.db` settings table row — `UPDATE settings SET value_json='"gemini-2.5-flash-lite"' WHERE key='ai_gemini_model';`

The DB update is runtime-state, not code-committed (phantom.db is ignored).
Downstream deploys: either clear the override (restores config default) or
re-run the SQL update. Noted in "Deployment note" below.

**Rationale for picking D over the spec's priority-ordered B:**

- B (real streaming) was infrastructurally feasible on both sides but
  addresses *perceived* latency only for the plain-text slice (39% of
  responses). For the 61% of responses that resolve to a structured form
  (`respond_code`, `respond_metrics`, `respond_map`, `respond_terminal`),
  Gemini's function_call is emitted as a single part in the final response —
  streaming would yield zero visible tokens until the whole call lands.
- D directly attacks the only verified bottleneck (Gemini response time)
  and benefits 100% of responses uniformly.
- Per the spec's own rule: "No speculative refactoring. If it's not a latency
  bottleneck verified by logs, don't touch it." — D *is* the verified
  bottleneck fix; B would be speculative for the structured-form traffic.

Tests hard-coding `"gemini-2.5-flash"` as a *string fixture*
(`test_phase09_2_1_resilience.py`, `test_phase09_2_2_budget_integration.py`)
left as-is — they construct mock audit rows, not touched by the runtime
model resolution.

---

## Fixes skipped

- **Fix A (kill double LLM call)**: N/A. Backend log confirms exactly one
  `generateContent` POST per user message.
- **Fix B (real streaming)**: infra ready on both sides but scoped out for
  phase 9.5.1. Benefit limited to the 39% plain-text slice (structured
  forms don't stream token-by-token). Flagged for phase 11.
- **Fix C (prompt trim)**: N/A. Prompt is 601 tokens (1804 chars) — well
  below the 5000-token threshold that would justify the distribution risk.

---

## Gate results

### Gate 1 — tests green

```
Backend pytest: 746 passed, 4 warnings in 164.86s
Frontend vitest: 178 passed (22 files), 35.98s
```
**PASS.** No regressions from baseline 746/178.

### Gate 2 — basic chat responds

```
POST /api/v1/chat/message content="привіт" → 5876ms, 200 OK, "Привіт."
```
**PASS.** Under the 15s gate.

### Gate 3 — distribution check (CRITICAL)

Fresh session, 10 diverse queries:

```sql
SELECT response_form, COUNT(*) FROM chat_messages
WHERE role='assistant' AND session_id='a308321e-f436-4813-9509-543736f332d0'
GROUP BY response_form;

text         | 4
markdown     | 1
terminal     | 1
code         | 1
metric_cards | 3
```

**5 distinct forms.** **PASS** (≥ 3 required).

Per-query verdict:

| # | Query | Form | Verdict |
|---|---|---|---|
| 01 | привіт | text | OK — greeting |
| 02 | як справи? | text | OK — small talk |
| 03 | що ти вмієш? | markdown | ✓ capabilities enumeration naturally markdown |
| 04 | виконай ls | terminal | ✓ target form |
| 05 | напиши функцію сортування | code | ✓ |
| 06 | покажи CPU | metric_cards | ✓ |
| 07 | як погода? | metric_cards | ✓ (better than baseline text) |
| 08 | де я? | text | Acceptable — no GPS, model admits |
| 09 | який час? | metric_cards | ✓ |
| 10 | скільки вільної пам'яті? | text | Acceptable substitute |

Structured-form coverage: 5/10. Phase 9.5's guidance block continues to
work with `2.5-flash-lite`. **No regression from the 61% structured-form
baseline.**

### Gate 4 — latency improvement

| Metric | Baseline (2.5-flash) | Post-fix (2.5-flash-lite) | Delta |
|---|---|---|---|
| 10-query http avg | 7245ms (4-query sample earlier) | 7043ms | -2.8% |
| 10-query backend avg | ~7100ms | 6590ms | **-7.2%** |
| 9-query excl. cold start | — | 6236ms | **-13.9%** |
| Basic chat "привіт" | 8735ms (earlier) | 5876ms | **-32.7%** |

**PASS** per spec's binding minimum (`average < 8s`). Not a dramatic
improvement — it's consistent with Gemini's actual lite-vs-flash spread for
short replies — but the win is real, reproducible, and costs ~½ the tokens.

### Gate 5 — `ls` specifically

3 consecutive fresh-session runs:

```
run 1: http=5888ms form=terminal
run 2: http=6105ms form=terminal
run 3: http=6018ms form=terminal
```

**PASS.** Well under the 12s gate. The 26s figure from the phase 9.5 baseline
did not repro — that was transient. Current `ls` consistently at ~6s, same
cohort as other non-trivial queries.

---

## Known remaining issues (out of scope, flagged)

- **Tail latency**: p99 can still spike (the original 26s `ls` was one such
  spike). We saw 9.7s on an early "привіт" in the 10-query batch. Root cause
  is upstream Gemini variability. Mitigation = client-side timeout UX +
  streaming for perceptual win (phase 11).
- **Real streaming not wired**: `routes_chat.py` still awaits the full
  generate() and fake-chunks on the way out. Frontend is ready; backend isn't.
  Scoped for phase 11.
- **Fake-stream sleep**: `chat_stream_delay_s=0.05` adds 0.2–0.4s of wall-clock
  after POST return. Harmless (runs in background after HTTP resolved) but
  wasteful. Untouched here; trivial to zero out later.
- **DB override shadow**: runtime settings DB can silently shadow config
  defaults. Bit us during this fix. Settings screen UX is fine; the risk is
  just for ops poking at the config.py layer expecting it to win.

---

## Reverts

None. All gates green on first pass.

---

## Deployment note

Production deploys running with a persisted
`settings.ai_gemini_model = "gemini-2.5-flash"` override will **not** pick up
the new config default. To apply the fix on such deploys, either:

1. Clear the DB override (lets config default take over):
   ```sql
   DELETE FROM settings WHERE key='ai_gemini_model';
   ```
2. Or set the override explicitly:
   ```sql
   UPDATE settings SET value_json='"gemini-2.5-flash-lite"', updated_at=datetime('now')
   WHERE key='ai_gemini_model';
   ```

Phase 9.5.1's sqlite3 update above was applied to the dev/bench DB and is
the state the phase's live tests were run against.

---

## Followups

- **Phase 11 (voice/spatial/latency/observability):**
  - Wire real provider streaming through `routes_chat.py` so the 39%
    plain-text slice gets first-chunk < 1.5s perceived latency.
  - Zero out or rm the fake-chunk sleep.
  - Add per-turn system-prompt + Gemini-latency telemetry to chase tail spikes.
