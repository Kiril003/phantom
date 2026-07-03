# 9.4c Hotfix — Investigation Findings

Read-only sweep performed on branch `autonomous-run` at HEAD `v0.9.4c-consolidated`
on 2026-04-21, after the live diagnostic on phantom-os identified localization stuck
in "NO LOCATION" despite the 9.4c release having landed.

Trigger hypothesis: commit `e320da5` (TTLCache refactor for C1/C2/C3 audit items)
regressed the localization pipeline by caching `LocationEstimate` objects whose
frozen `timestamp` field then trips the resolver's `dt_s <= 0` replay guard.

## A.1 — Timestamp-carrying-object caches

| File | Line | Cache var | Caches what | Reader path | Verdict |
|---|---|---|---|---|---|
| `agent/localization/adapters/ipapi.py` | 44 | `self._cache` | `LocationEstimate` | `locate_current_ip()` returns cached object | **BUGGY** |
| `agent/localization/sources/browser_geolocation.py` | 21 | module `_latest` | `LocationEstimate` | `_fresh_estimate()` returns `_latest` unchanged | **BUGGY** |
| `agent/localization/sources/user_stated.py` | 22 | module `_cache` | `LocationEstimate` | `_fresh()` returns `_cache` unchanged | **BUGGY** |
| `agent/localization/sources/gps_hardware.py` | 52 | *none* — stateless | `LocationEstimate` minted each call | `get_position()` mints fresh object with `datetime.now(UTC)` | SAFE |
| `agent/localization/adapters/nominatim.py` | 71-74 | `_fwd_cache` / `_rev_cache` | `list[GeocodeResult]` / `ReverseGeocodeResult` | Results have no timestamp; caller uses them as static data | SAFE |
| `agent/localization/adapters/overpass.py` | 65 | `self._cache` | `list[OSMFeature]` | Features have no timestamp; caller reads list directly | SAFE |

### Why the three "BUGGY" entries are all the same bug

Each of them caches a Pydantic `LocationEstimate` (which is `frozen=True` — the
`timestamp` field is immutable once constructed) at call time, and returns the
*same object* on subsequent reads during the cache/freshness window. The
resolver's sanity check (`resolver.py:109-110`) then computes
`dt_s = (est.ts - last.ts).total_seconds()` and, because `est is last`, gets
zero, falling into the `<= 0 → reject as replay` branch.

**Cadence of the failure:** context engine ticks the resolver every 500 ms.
On the first successful resolve the estimate is appended to `_history`. On every
subsequent tick within the cache/freshness window the same object is returned
→ rejected → logged (`rejecting implausible fix from …`). The pattern clears
only when the cache/freshness expires and a fresh `LocationEstimate` is minted,
which then immediately falls into the same trap again.

The empirical 2363 rejections / 19 min from `/tmp/phantom-test.log` matches
`2.07 rejections/s`, equivalent to one per ~500 ms — exactly the tick rate.

### Scope of the fix

- **ipapi.py**: cache a raw `(lat, lon, accuracy_m)` tuple and mint a fresh
  `LocationEstimate(..., timestamp=datetime.now(UTC))` on each retrieval.
- **browser_geolocation.py**: `_latest` stays a `LocationEstimate` (it records
  the frontend-reported timestamp, which is meaningful data), but
  `_fresh_estimate()` must return a *new* estimate with `timestamp=datetime.now(UTC)`
  when the underlying submission is within the freshness window. The cached
  submission's timestamp is still used internally for the freshness check.
- **user_stated.py**: same treatment as browser_geolocation.py.
- **nominatim.py / overpass.py**: no change. Those caches hold static results.

## A.2 — Replay-guard paths

Only one site computes time deltas against cached estimate timestamps in a way
that assumes strict monotonic freshness:

| File:line | Check | Assessment |
|---|---|---|
| `agent/localization/resolver.py:109-110` | `dt_s = (est.ts - last.ts).total_seconds(); if dt_s <= 0: reject` | **Misfires** when cached LocationEstimate is returned twice. Needs hardening. |
| `agent/localization/sources/browser_geolocation.py:82` | `age = now - _latest.timestamp` — freshness window check | Safe. Source-internal; not a replay guard. |
| `agent/localization/sources/user_stated.py:72` | TTL check | Safe. Same shape as above. |
| `agent/localization/nearby_watch.py:42` | Dedup `now - _last_trigger_at` | Safe. Local `now = datetime.now()` each call. |
| `agent/proactive.py:81,202,218,474,657` | Cooldown / streak / fatigue windows | Safe. All compare to locally owned `now`. |
| `agent/localization/history_writer.py:103` | Min-interval guard for writes | Safe. Local `now`. |

### Proposed hardening

Replace the blanket `dt_s <= 0 → reject` at `resolver.py:110-112` with a
same-identity short-circuit: when the incoming estimate has the same
`(source, lat, lon)` as the most recent history entry, accept it as an
idempotent no-op (return True, but callers should not append to history a
second time). Keep the original rejection for the genuine "backwards clock +
different coords" case.

## A.3 — `where.source="none"` downstream risk

Producers of `snapshot["where"]`:
- `core/context_engine.py:289` — `_apply_gps()` sets `lat/lon/fix/satellites/speed_kmh`.
- `core/context_engine.py:306-346` — `resolve_localization()` writes `source/confidence/accuracy_m`, and in the None branch sets `source="none"` while leaving `lat/lon` untouched.

Consumers that read `snapshot["where"]` and could be surprised by
`source == "none"`:
- `agent/localization/sources/gps_hardware.py:29` — reads `where.get("fix")`/`lat`/`lon`. Source kind is never consulted. Safe.
- `api/routes_context.py:19` — returns snapshot verbatim to frontend. Safe.
- `api/routes_map.py:224` and related — surface `where` for UI; UI's `TacticalMap.tsx` handles `source === 'none'` explicitly (coordinate-readout falls through to "NO LOCATION" label). Safe — that is the intended user-visible state when we cannot localize.
- `api/routes_chat.py` (several sites) — reads `snapshot["system"]["state"]`, does not key off `where.source`. Safe.
- Proactive triggers (`agent/proactive.py`) — region-change and place-remembered logic uses `where.get("lat")`/`lon` directly. When resolver leaves lat/lon set (the preserve-prior behaviour at `context_engine.py:328-334`) the proactive path still sees valid coords; source label is irrelevant. Safe.
- `agent/localization/history_writer.py` — only writes when it has a fresh `LocationEstimate` from the resolver. Never sees `source="none"`. Safe.

**Verdict:** no downstream consumer crashes or misbehaves on `source="none"`.
The user-visible "NO LOCATION" label is the correct rendering of a genuine
"no resolver source produced an estimate this tick" state; the bug is upstream
in the resolver, not in how consumers handle the None-state.

## A.4 — watchPosition single-fire pattern (frontend)

Confirmed: `src/frontend/src/services/geolocation.ts:76-86` uses
`navigator.geolocation.watchPosition(...)` with
`{ enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 }`. On a
stationary device the browser only invokes the success callback once at
subscription, and then not again until the position materially changes or the
`maximumAge` window elapses — and even then, only if a new fix is acquired.

Consequence: `_submit()` fires once at mount (throttle gate `lastSentAt=0`
lets the first call through). After that, the backend
`BrowserGeolocationSource._latest` stops being refreshed. Its 60 s freshness
window lapses and the source goes unavailable, even though the browser still
knows perfectly well where the user is.

### Other continuous-data frontend paths (checked)

- `services/geolocation.ts:62` — `navigator.permissions.query({ name: 'geolocation' })`, one-shot probe. Not a stream. OK.
- Grep for `watchPosition` in `src/frontend/src` only turns up `services/geolocation.ts`. No other browser-API stream relies on `watchPosition`-style single-fire semantics.
- MediaPipe and any other browser sensor code are out of scope of 9.4c.

### Proposed fix

Add a `setInterval` keep-alive inside `BrowserGeolocationService` that
re-POSTs the last known `GeolocationPosition` every ~20 s (comfortably inside
the 60 s freshness window), so the backend source stays live for a stationary
device. `stop()` must clear both the watcher and the interval. The existing
3 s throttle for change-driven submits is left in place.

## A.5 — Overpass 406 Not Acceptable

Reproduced with a minimal httpx script (Python 3.11, httpx 0.28.1,
`User-Agent: python-httpx/0.28.1` default) against the adapter's exact request
shape:

```
POST https://overpass-api.de/api/interpreter  data={"data": "[out:json]…"}
→ 406 Not Acceptable
body: "<html>…<h1>Not Acceptable</h1>…"
```

Repeating the same query via `curl` (UA `curl/8.x`) → 200 OK.
Repeating via `curl -H "User-Agent: PHANTOM-OS/0.9"` → 200 OK.

**Root cause:** Overpass filters by `User-Agent`. The default httpx UA is
blocklisted. Nominatim adapter already sends a custom UA
(`agent_nominatim_user_agent`, default `"PHANTOM-OS/0.9"`); Overpass adapter
does not.

**Not root cause:** query syntax, body encoding, method, rate limit, Accept
header.

### Proposed fix

Send the same `PHANTOM-OS/0.9` UA in the Overpass adapter, via
`httpx.AsyncClient(headers=…)` (matching how the Nominatim adapter does it).
Make it configurable with the same setting key pattern
(`agent_overpass_user_agent`, defaulting to the same value).

## A.6 — Other 9.4c-era cache audit

`e320da5` (subject: "C1 C2 C3 bound external service caches via TTLCache")
touched exactly 5 files:

```
src/backend/agent/localization/adapters/ipapi.py      +27 -?
src/backend/agent/localization/adapters/nominatim.py  +35 -?
src/backend/agent/localization/adapters/overpass.py   +19 -?
src/backend/requirements.txt                          +3
src/backend/tests/test_phase09_4c_bounded_caches.py   +60 (new)
```

Of those:
- `ipapi.py` — introduces the bug (already covered in A.1).
- `nominatim.py` — caches static results. Safe.
- `overpass.py` — caches static results. Safe.

No other post-9.4b commit introduced caches that could exhibit the same class
of bug. The regression is contained to the single adapter file introduced by
this audit item.

## Summary

Bugs confirmed — **three instances of the same root cause, one in a different
subsystem, one network-behaviour issue:**

1. **Cache-returns-same-object with stale timestamp** (3 files)
   - `ipapi.py` — adapter (BUGGY)
   - `browser_geolocation.py` — source (BUGGY)
   - `user_stated.py` — source (BUGGY, latent — only manifests if user
     states a location and then GPS/browser both go unavailable for several
     ticks in a row)

2. **Resolver blanket `dt_s <= 0` rejection** (1 file)
   - `resolver.py` — hardening needed independent of (1). Even after (1) is
     fixed, the guard should distinguish "same fix repeated" from "clock went
     backwards with different coords". Defensive against future regressions.

3. **Frontend stationary-device starvation** (1 file)
   - `services/geolocation.ts` — keep-alive re-submit.

4. **Overpass 406 Not Acceptable** (1 file)
   - `overpass.py` — add User-Agent header.

### Priority ranking

1. **P0 — ipapi.py + resolver.py**: fix the live replay loop that blocks all
   localization downstream of IP estimate. Without this the user sees
   "NO LOCATION" continuously.
2. **P0 — browser_geolocation.py**: same bug, same severity as (1) for the
   browser source. Without this, even a correctly-submitting frontend
   stops working after the first tick.
3. **P1 — overpass.py UA**: blocks the "nearby features" panel entirely.
4. **P1 — geolocation.ts keep-alive**: stationary devices lose browser source
   after 60 s regardless of backend fixes.
5. **P2 — user_stated.py**: latent, not observed live. Fix while we are in
   the same code area; prevents recurrence if GPS drops out during a chat
   session where the user stated a location.

**Nothing else surfaced.** No scope creep beyond the four files above plus
the frontend service. Test file updates will accompany each commit.
