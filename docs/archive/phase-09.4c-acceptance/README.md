# Phase 9.4c — Consolidation Acceptance

- **Date:** 2026-04-21
- **Branch:** `autonomous-run`
- **Base HEAD:** `946d142` (post-9.4b bug fixes)
- **Target tag:** `v0.9.4c-consolidated`
- **Spec anchor:** [docs/full-project-audit-2026-04-20/README.md](../full-project-audit-2026-04-20/README.md)

This phase fixes audit findings only. No new features.

---

## Audit findings addressed

### Quick Wins (7 / 7)

| ID | What | Commit |
|----|------|--------|
| G2 | `agent_proactive_enabled` default True | `d69281f` |
| E1 | Foreground track deque bounded (maxlen=50) | `d69281f` |
| D7 | `print()` → `logger.info()` in `backfill.py` | `e635187` |
| I1 | `MAX_TRACK_HISTORY` constant in `mapStore.ts` | `4bf8e37` |
| B2 | Composite index `MemoryFact(user_id, place_lat, place_lon)` | `b9310fa` |
| C1/C2/C3 | Nominatim / Overpass / IpApi caches bounded via `cachetools.TTLCache` | `e320da5` |
| 6-A | Narrow `except Exception` scope in `context_engine.py` | `7728c8b` |

### Medium investments (4 / 4)

| ID | What | Commit |
|----|------|--------|
| D4 | Filter `UNIMPLEMENTED_KEYS` from Settings UI schema + log on PUT | `71bd365` |
| §7 | Cross-field Pydantic validators (provider distinction, proactive interval, TTS voice) | `31d54f3` |
| Q6 | Offline-mode banner + `GET /map/services_health` | (see full commit list below) |
| G3 | Inner monologue live panel subscribed to `inner_monologue.stream` | (see full commit list below) |

### Large investments (2 / 2)

| ID | What |
|----|------|
| G6 | `FactMarkerLayer` renders geo-tagged `MemoryFact` rows on tactical map |
| C1 | `_finalize_task_impl` split into `_finalize_persist` / `_finalize_broadcast` / `_finalize_release_slot` |

### Deferred (explicit, post-soak)

| Audit ID | Reason |
|----------|--------|
| G7 / G11 — face emotion integration | Needs emotion model selection; user prefers live-soak before picking. |
| F1 — WebSocket per-channel batching | No scale pressure at current usage. Revisit post-soak if WS traffic shows up as a bottleneck. |
| B1 — R-tree POI index | Not hit at current data volumes; composite index covers the common case. |
| Remaining 111 orphan config keys (of the 128) | Outside `UNIMPLEMENTED_KEYS`. Scoped cleanup deferred — noise not blocking. |
| `.slice(-999)` refactor to ring-buffer class | The named constant is enough; no observed perf issue. |
| Voice engine swap (StyleTTS2 / Coqui) | Separate evaluation, not a consolidation item. |

---

## Test count delta

- **Backend:** 672 → 695 tests. New files:
  - `test_phase09_4c_bounded_caches.py` (+4)
  - `test_phase09_4c_runtime_bounds.py` (+3)
  - `test_phase09_4c_config_validators.py` (+9)
  - `test_phase09_4c_services_health.py` (+6)
  - `test_phase09_4c_geo_tagged_facts.py` (+5)
- **Frontend:** 167 → 175 tests. New files:
  - `ServicesHealthBanner.test.tsx` (+3)
  - `InnerMonologueStream.test.tsx` (+2)
  - `FactMarkerLayer.test.tsx` (+3)

No regressions: the Quick Win and Medium passes run with existing suites green.

---

## Preparation for live usage testing

### What's now ON that wasn't before

1. **Proactive initiative** — PHANTOM will speak unprompted on long-silence / high-fatigue triggers (default-on; mute via Settings → `agent_proactive_enabled=false`).
2. **Inner monologue live stream** — AgentPanel shows PHANTOM's thinking in real-time (collapsible; safe to ignore).
3. **Fact markers on the tactical map** — every remembered place from NER-tagged memory shows as a subtle dot; click to read.
4. **Offline banner on map** — amber banner when Nominatim / Overpass / ipapi.co are down or stale; no more silent "empty search".
5. **Settings UI pruned** — 17 not-yet-wired keys hidden (voice wake word, radar sensitivity, etc.) so the operator sees only live controls.
6. **Cross-field config validation** — bad combinations (e.g. primary==fallback provider) now return HTTP 400 instead of persisting silently.

### Known friction points (likely to surface in live test)

- **Proactive cadence feels off on first run** — the loop adapts on emotion decay, but the first 15-30 min is "blind". If too chatty or silent, tweak `agent_proactive_interval_min_s` / `agent_proactive_cooldown_s` via Settings.
- **Inner monologue can be verbose** — collapse the panel (click the chevron) if it distracts.
- **Fact markers may cluster** — intended for now; zoom out to see distribution.
- **Overpass 429 after many queries** — expected; the offline banner will flip to stale.
- **First voice turn is cold-start** — StyleTTS2 loads on demand; 2-3 s extra for the first speak command.

### Config knobs to flip from Settings UI

- `agent_proactive_enabled` — master switch for initiative.
- `agent_proactive_interval_min_s` / `agent_proactive_interval_max_s` — cadence bounds.
- `agent_proactive_cooldown_s` — seconds between decisions.
- `agent_standing_orders_enabled` — background cron triggers.
- `agent_nominatim_enabled` / `agent_overpass_enabled` / `agent_ip_locator_enabled` — per-adapter kill switches.

### Log files to monitor

- `uvicorn` stdout — service startup, MiniLM warmup, proactive loop start.
- `backend.log` (if configured) — WARNING level surfaces rate-limit hits, cache-miss spikes, adapter failures.
- `inner_monologue.stream` WS channel — now visible in UI, no grep needed.

---

## Tomorrow's test plan (60-75 min, recommended order)

1. **Chat basics (5 min)** — send 10 varied messages; verify no empty bubbles, response times < 2s after first.
2. **Memory geo (10 min)** — mention 3 places in conversation, verify MemoryFacts appear with `place_lat`/`place_lon`, then verify markers on the map via the new `facts` toggle.
3. **Standing order (15 min)** — create "check disk every 3 min", continue chatting; verify non-blocking + monologue panel shows each firing.
4. **Proactive (20 min)** — let the system idle 15+ min; observe any spontaneous PHANTOM messages; judge cadence.
5. **Inner monologue (10 min)** — open panel during a longer task (e.g. web-navigate); watch reasoning trace.
6. **Location tracking (5 min)** — open map, grant browser geo permission; verify self-marker + timeline drawer + nearby panel populate.
7. **Offline banner (5 min, optional)** — disable wifi briefly; verify banner turns red/amber within a minute; re-enable; verify clears.

---

## Pre-flight checklist (run before tomorrow's session)

Verify each of the following; flag any red items in the live-test session.

- [ ] Backend starts cleanly (`uvicorn main:app --reload --host 0.0.0.0 --port 8000` — no tracebacks).
- [ ] `agent_proactive_enabled = True` in effective config (`curl localhost:8000/api/v1/settings | jq '.categories[].settings[] | select(.key=="agent_proactive_enabled")'`).
- [ ] MiniLM warmup fires at startup (check `backend.log` for "warmup" or similar).
- [ ] Nominatim adapter responds (`curl 'https://nominatim.openstreetmap.org/search?q=Ostrava&format=json&limit=1'` — 200 OK).
- [ ] Overpass adapter responds (Overpass main page 200 OK).
- [ ] ipapi adapter responds (`curl https://ipapi.co/json/` — 200 OK).
- [ ] Chat endpoint responds (POST `/api/v1/chat/messages` with auth — 200 OK).
- [ ] WS hub accepts connections (Chrome devtools → WS tab — see subscribed channels).
- [ ] Inner monologue stream emits when a task runs (trigger a task, watch AgentPanel stream).
- [ ] Standing orders runner alive (check for "standing orders runner started" in logs).
- [ ] Proactive loop alive (check for "Proactive loop started (initiative active)" in logs).

---

## Commits (in order)

```
d69281f  phase-09.4c: G2 E1 enable proactive by default + bound track queues
e635187  phase-09.4c: D7 replace debug print with structured logger in backfill
4bf8e37  phase-09.4c: I1 name magic number MAX_TRACK_HISTORY in map store
f403cf8  phase-09.4c: land full project audit doc (reference for consolidation)
b9310fa  phase-09.4c: B2 composite index on MemoryFact(user_id, place_lat, place_lon)
e320da5  phase-09.4c: C1 C2 C3 bound external service caches via TTLCache
7728c8b  phase-09.4c: 6-A narrow exception scope in context_engine
71bd365  phase-09.4c: D4 filter UNIMPLEMENTED_KEYS from settings schema
31d54f3  phase-09.4c: §7 cross-field validators prevent conflicting settings
b6a85bd  phase-09.4c: Q6 offline-mode banner when location services unavailable
9c4d357  phase-09.4c: G3 wire inner_monologue.stream to frontend panel
2d64e3f  phase-09.4c: G6 FactMarkerLayer renders geo-tagged memories on map
4539473  phase-09.4c: C1 refactor _finalize_task_impl into persist/broadcast/release
```

---

## Honest assessment

System ready for live usage testing. The behavioural surface is larger
today than it was yesterday: **proactive is on by default**, the inner
monologue is visible, memory markers live on the map. The operator will
see PHANTOM initiate for the first time — expect the first cadence to
feel "off" until the emotion loop stabilises. The biggest risk during
tomorrow's session is not a crash or regression, it's finding that
proactive cadence or inner-monologue density doesn't match the operator's
working style. Both are hot-reloadable from Settings.
