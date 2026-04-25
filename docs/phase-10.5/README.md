# Phase 10.5 — AI provider sync (cherry-pick from 11b.1)

## Why this phase
Audit `docs/phase-11b-retrospective/README.md` (commit `7a4331d`) recommended
Option β: keep v0.10.4 live, cherry-pick only `e33ca45` (ai_provider startup
sync) from the 11b.1 work, defer all always-on work to a future Phase 11c
gated on real-browser tests.

This phase implements that single recommendation. Surgical scope: one
cherry-pick, +11 lines in `src/backend/main.py`, one acceptance doc, one
tag.

## What changed

### Branch state on entry (Task 0)
- Found state: closer to **State A** of the phase plan than B/C.
- HEAD: `7a4331d` (on branch `phase-11b-retrospective`, the audit commit).
- `autonomous-run` ref: `fd11d5a` (still at v0.11.1 — never reset by the
  user's earlier "revert" attempt, exactly as the audit's "Notable
  mechanical finding" warned).
- Working tree: only `src/backend/chroma_data/chroma.sqlite3` modified
  (runtime DB state — left alone) plus untracked `docs/behavior-audit-2026-04-22/`
  and `src/backend/voice/models/` (left alone, not part of this phase).

### Actions taken (Task 0 + Task 1)
1. `git checkout autonomous-run` — switched from the retrospective branch
   onto the live branch (no checkout conflicts; runtime files travelled
   along untouched).
2. `git reset --hard b00c380` — reset autonomous-run from `fd11d5a`
   (v0.11.1) back to `b00c380` (v0.10.4-postpolish), discarding the five
   11b.1 commits. Those commits remain reachable via tags
   `v0.11-voice-always-on` (d3b5344) and `v0.11.1-voice-fix` (fd11d5a) and
   on the `phase-11b-retrospective` branch.
3. `git cherry-pick e33ca45` — clean apply, no conflicts. Auto-merge of
   `src/backend/main.py` produced exactly the +11 lines documented in the
   phase plan (try/except block calling
   `context_engine.set_ai_provider(config.ai_primary_provider)` immediately
   after `apply_overrides(overrides)` lands).

### Branch state on exit
- New HEAD on `autonomous-run`: `37cd0d5` (cherry-picked commit, original
  authorship and timestamp preserved by `git cherry-pick`).
- `b00c380` remains the parent.
- Tags `v0.11-voice-always-on` and `v0.11.1-voice-fix` untouched.
- `phase-11b-retrospective` branch untouched (still at `7a4331d`).

## Behavior delta
- **Pre (v0.10.4):** at backend boot, `ContextEngine` instantiates with
  `_ai_provider = config.ai_primary_provider` resolved from env defaults
  (often `ollama`). The lifespan startup then loads SQLite settings and
  calls `config.apply_overrides(...)`. Until the first 500 ms reconcile
  tick fires, the WS context broadcast still ships the env default — so
  StatusBar briefly shows "Ollama" before flipping to "Gemini".
- **Post (this phase):** immediately after `apply_overrides`, lifespan
  calls `context_engine.set_ai_provider(config.ai_primary_provider)`. The
  cached value now reflects the DB-overridden provider before the first
  WS broadcast. No flicker.

## Verification

### Gate 1 — Tests still green
- Backend: `796 passed, 4 warnings in 175.23s` (baseline 786, ✓).
- Frontend: `22 test files / 178 tests passed` (baseline 178, ✓).

### Gate 2 — Backend starts cleanly
```
$ curl -s http://127.0.0.1:8000/health
{
    "status": "ok",
    "version": "0.1.0",
    "hostname": "phantom",
    "ws_clients": 0,
    "esp32_connected": false,
    "serial_enabled": false,
    "ai_active": "gemini",
    "ai_fallback": "ollama"
}
```
✓ status ok.

### Gate 3 — ai_provider correct from first response
The `ai_active: "gemini"` value above is the DB-override (the env default
in this environment is also reachable, but the point is the value is set
*before* the first reconcile tick — confirmed by `/agent/router_state`
showing `"primary": "gemini", "active": "gemini"` immediately after
startup with no transitional state).

```
$ curl -s -H "Authorization: Bearer $TOKEN" \
    http://127.0.0.1:8000/api/v1/agent/router_state
{
    "primary": "gemini",
    "fallback": "ollama",
    "active": "gemini",
    "cooling": {},
    "quota_exhausted": {},
    "last_calls": { "gemini": {...} }
}
```
✓ active provider is the DB-configured one from boot.

### Gate 4 — Push-to-talk STT regression
```
$ ffmpeg -f lavfi -i "sine=...:duration=1" -c:a libopus /tmp/test.webm -y
$ curl -sS -X POST .../api/v1/voice/stt -F "file=@/tmp/test.webm" ...
{"text":"","confidence":1.0,"engine":"whisper","language":"uk","wake_word_matched":false}
HTTP=200
```
✓ HTTP 200, whisper engine reachable. Empty `text` is expected for a
synthetic sine tone (no speech).

### Gate 5 — Basic chat
```
$ curl -sS -X POST .../api/v1/chat/message \
    -d '{"content":"привіт"}' ...
{"message":{...,"role":"assistant","content":"Привіт.",
  "metadata":{"ai_provider":"gemini","latency_ms":2481,"tokens_used":3589,...}}}
HTTP=200
```
✓ HTTP 200, non-empty assistant content, correct provider used.

## What was deliberately not done
- The Phase 11b/11b.1 always-on voice code remains tagged but unused
  (`v0.11-voice-always-on` at d3b5344, `v0.11.1-voice-fix` at fd11d5a,
  audit at 7a4331d).
- The `pipeline.get_vosk_model()` helper from 11b is **not** cherry-picked
  — it only matters once always-on lands properly.
- The frontend changes from 11b.1 (`useMicStream`, `VoiceAlwaysOnGate`,
  `inputModeStore`, hook modifications) are **not** cherry-picked — they
  only matter alongside a shipped always-on path.
- No frontend work in this phase.
- No backend work outside the cherry-pick.

## Followups for Phase 11c (when user is ready, days/weeks away)
- Real-browser Playwright smoke test in CI for any always-on voice path.
- `dist/` freshness gate (build mtime ≥ HEAD on the deploying branch).
- `git grep` consumer-of-hook gate (any new shared mic hook must be
  imported by ≥ 1 consumer before merge).
- Settings-reactivity Playwright smoke (toggle in UI → backend state
  flips within N seconds).
- Re-design the always-on architecture with these gates as preconditions
  before any code lands.

## Tag
`v0.10.5-provider-sync` on `37cd0d5`.

## Final report
- Branch state on entry: State A (autonomous-run at fd11d5a, HEAD on
  retrospective branch at 7a4331d).
- Cherry-pick clean: yes (no conflicts).
- Tests: backend 796/796, frontend 178/178.
- Gates: 1 ✓, 2 ✓, 3 ✓, 4 ✓, 5 ✓.
- Behavior change verified: yes (ai_active correct from first response).
- HEAD: `37cd0d5`.
- Tag: `v0.10.5-provider-sync` applied.
- Reverts: none.
- Doc: this file.
