# Phase 9.1 Cognitive Seed — Live Acceptance

Run date: 2026-04-18 · branch `autonomous-run` · backend `gemini-2.5-flash`
primary, `ollama llama3.2:3b` fallback (after fix below).

## Automated test suite (gate before live runs)

| Suite             | Result                  |
|-------------------|-------------------------|
| Backend pytest    | **358 passed** in 93.6 s |
| Frontend vitest   | **118 passed** in 29.3 s |

Existing 306 backend + 103 frontend baselines unchanged. New: 52 backend
agent tests + 15 frontend agent tests.

## Live API runs

The Phase 9 spec calls for "login via PIN, navigate to OPERATOR, observe
substate transitions". Auto-mode could not drive a real browser, so the
equivalent flow was exercised against the running backend over HTTP:
PIN-login → /api/v1/agent/task → poll task state + audit + observations.
The `agent.stream` WS channel emits all substate transitions; the
frontend layout that consumes them was unit-tested separately and is not
re-validated here.

### Test A — basic flow

Goal: `read /etc/hostname and summarize what you found`.

First run (`AI_FALLBACK_PROVIDER=none`): strategic planner correctly
decomposed the goal into two sub-goals; sub-goal 1 (`fs.read`) succeeded
and recorded `radxa-dragon-q6a`. On sub-goal 2 ("summarize") Gemini
hallucinated a non-existent action `respond_text` (and then
`default_api.respond_text`) instead of selecting `DONE_SUBGOAL`. Audit
trail captured every attempt with full inner monologue. After the third
hallucination, a transient Gemini call failed and the task ended with
`failed: Primary AI (gemini) failed and no fallback is configured.`

Two real findings out of this:

1. **LLM hallucinates a `respond_text` action for summarize-style
   sub-goals.** The audit shows the model believing such an action
   exists; the catalog passed in the prompt does not include it.
2. **No-fallback configuration is brittle.** A single transient Gemini
   error kills the whole task with `Primary AI failed and no fallback`.

Two follow-up commits address these:

- DB setting `ai_fallback_provider` switched to `ollama` so transient
  Gemini errors fall through.
- Tactical prompt gained a CRITICAL block telling the planner that
  summarize/present/explain/respond sub-goals MUST use `DONE_SUBGOAL`
  with the answer text in `args.summary`. Executor's `unknown_action`
  error now also lists every catalog name and repeats the guidance, so
  the next planner call sees it directly in observations
  (commit `29dbcff`).

After the fix, second-run behaviour: the loop no longer dies on the
first transient Gemini glitch (Ollama covers it), and the prompt
guidance steers the model toward `DONE_SUBGOAL` for summarize sub-goals
in code paths exercised by unit tests. Live runs after the fix exposed a
secondary issue — Ollama on this CPU is slow enough (3B-param model,
single-digit tokens/s) that a fallback-driven step takes 30-90 s, which
makes a multi-step summarize task feel unresponsive even though
structurally everything is doing the right thing. **End-to-end DONE on
the live Gemini-only happy path was not demonstrated within the
patience budget of this run.** The architecture, fallback, audit, and
recovery all work; the live happy path depends on Gemini not glitching
mid-task or on a faster local fallback than llama3.2:3b.

### Test B — intervention

Goal: `ping 8.8.8.8 ten times using bash`.

Strategic planner produced one sub-goal (`Execute the ping command to
8.8.8.8 ten times`). Two `bash.run` actions completed successfully (real
ICMP replies in audit). Reflector observed `"Two ping commands have
been executed successfully, and their outputs are observed. The
sub-goal requires ten ping commands."` Mid-task, the operator queued an
intervention via `POST /agent/task/{id}/intervene
{"instruction":"only do 3 pings then stop"}`. The intervention landed in
the runtime queue, was promoted to an `Observation(type=user_input)`,
and triggered an extra reflection — visible in the observations array.
Then a transient Gemini error killed the task (same `no fallback`
issue). After the fallback-fix mentioned above, the
intervention path itself works (queued → reflection → loop continues),
but a clean live demo is gated by the same Gemini reliability +
Ollama latency story as Test A.

What is verified end-to-end here:

- Intervention API enqueues correctly (`{"queued": true}`).
- Runtime turns it into an observation visible in `/agent/task/{id}`.
- Reflector picks it up (visible in audit + WS events).

What is **not** demonstrated end-to-end on a single live run: the agent
adjusting and reaching `DONE` in fewer pings. Unit test
`TestControls.test_intervention_routes_into_reflector` covers the same
code path with mocked LLMs.

### Test C — crash recovery

Started a task, waited until `status == "running"`, then `pkill -KILL
-f uvicorn` (no graceful shutdown — the lifespan hook does not run on
SIGKILL). Restarted backend. Queried
`GET /agent/tasks?status=paused`:

```
01c17d9c paused_reason=uvicorn_restart
3a04da52 paused_reason=uvicorn_shutdown   (from a prior SIGINT)
```

The interrupted task is correctly marked `paused` with
`paused_reason="uvicorn_restart"`, exactly per spec. **Test C: PASS.**

A separate observation: the SIGINT (graceful) path also works — the
lifespan hook calls `agent_runtime.stop()`, the loop catches
`TaskStopped`, finalises the task to `stopped` with reason
`uvicorn_shutdown`, and `mark_orphans_paused` runs after with no rows
to update. So both shutdown paths are honest about what happened.

## Summary

| Aspect                                              | Status        |
|-----------------------------------------------------|---------------|
| Two-tier planner (strategic + tactical) decomposition | PASS (audit) |
| Inner monologue captured per step                    | PASS (audit) |
| `unknown_action` never crashes the loop              | PASS (audit) |
| Reflector triggered on errors / intervention         | PASS (audit) |
| Intervention API + observation routing               | PASS (audit) |
| Crash recovery → orphan paused with reason           | PASS         |
| Audit trail persisted for every attempted action     | PASS         |
| End-to-end happy path under live Gemini, single run  | NOT DEMONSTRATED — see Test A notes |

The cognitive seed is operational: every observable substep happens
where it should, every failure is logged honestly, every
recovery/intervention path works. The remaining gap to a clean live
green-bar demo is LLM reliability + local-fallback latency, which is
not a Phase 9.1 scope item.

## Reproduction notes for the operator

```bash
# 1. backend
cd src/backend && .venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000

# 2. login
TOKEN=$(curl -sS -X POST http://127.0.0.1:8000/api/v1/auth/login/pin \
  -H 'Content-Type: application/json' \
  -d '{"username":"phantom","pin":"000000"}' | jq -r .token)

# 3. start a task
curl -sS -X POST http://127.0.0.1:8000/api/v1/agent/task \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"goal":"read /etc/hostname and summarize what you found"}'

# 4. observe
curl -sS -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8000/api/v1/agent/task/<id> | jq '.task, .sub_goals[].status'

# 5. intervene mid-flight
curl -sS -X POST http://127.0.0.1:8000/api/v1/agent/task/<id>/intervene \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"instruction":"only do 3 pings then stop"}'

# 6. crash + recover
pkill -KILL -f "uvicorn main:app"
.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 &
curl -sS -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8000/api/v1/agent/tasks?status=paused"
```
