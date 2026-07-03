# Phase 9.4c.1 Hotfix — Localization Replay Loop

Branch: `autonomous-run` · Base: `v0.9.4c-consolidated` · No new tag yet.

Investigation report: see [`investigation.md`](./investigation.md).

## What was broken

Live diagnostic on 2026-04-21 showed the Map view stuck on "NO LOCATION"
despite the 9.4c release having landed. Backend log at `/tmp/phantom-test.log`
carried ~2363 `rejecting implausible fix` warnings over 19 minutes —
2.07 rejections/s, exactly matching the 500 ms ContextEngine tick rate.
Only `ip_estimate` and `browser_geolocation` sources were being produced,
so every tick produced an estimate and every estimate was rejected.

Root cause, commit-level: `e320da5` (the 9.4c C1/C2/C3 TTLCache audit item).
The switch to `cachetools.TTLCache` cached the entire `LocationEstimate`
Pydantic object rather than the raw coordinates. `LocationEstimate.timestamp`
is immutable (`frozen=True`), so every retrieval within the 10-min TTL
returned an object whose timestamp matched the previous history entry
exactly. `LocalizationResolver._passes_sanity()` treats `dt_s <= 0` as a
clock-skew replay and rejects the estimate, trapping the chain in a
500 ms rejection loop that only cleared briefly when the TTL itself
expired.

Four secondary issues were surfaced by the same sweep and fixed here:

- The same "cache-returns-same-object" pattern existed in
  `BrowserGeolocationSource` and `UserStatedSource`.
- The resolver's `dt_s <= 0` blanket reject is brittle against future
  regressions of the same class.
- `navigator.geolocation.watchPosition` on a stationary device fires its
  success callback once and then falls silent, starving the backend
  browser source after its 60 s freshness window.
- The Overpass adapter sent no `User-Agent` header, so the public mirror
  replied `406 Not Acceptable` to every request — blocking the
  nearby-features panel entirely.

## Commits (in order)

| Commit | Subject |
|---|---|
| `6440217` | **B.1** adapter caches store raw data, build LocationEstimate with fresh timestamp |
| `b1c6a77` | **B.2** resolver treats identical consecutive fixes as no-op not replay |
| `892bef5` | **B.4** send custom User-Agent to Overpass to unblock 406 Not Acceptable |
| `3c8fd98` | **B.3** frontend keep-alive re-submits position every 20s for stationary devices |

## Files changed

### Backend
- `src/backend/agent/localization/adapters/ipapi.py` — cache `(lat, lon, accuracy_m)` tuple; mint fresh `LocationEstimate` on every call via new `_build_estimate()` helper.
- `src/backend/agent/localization/sources/browser_geolocation.py` — `_fresh_estimate()` returns `model_copy(update={"timestamp": now()})`.
- `src/backend/agent/localization/sources/user_stated.py` — `_fresh()` returns `model_copy(update={"timestamp": now()})`.
- `src/backend/agent/localization/resolver.py` — new `_is_identity_duplicate()` method called before `_passes_sanity()`; resolver skips `self._history.append()` on identity duplicates so the deque isn't polluted.
- `src/backend/agent/localization/adapters/overpass.py` — `httpx.AsyncClient(headers={"User-Agent": ua})` inside `features_near()`.
- `src/backend/config.py` — new setting `agent_overpass_user_agent: str = "PHANTOM-OS/0.9 (localhost)"`.

### Frontend
- `src/frontend/src/services/geolocation.ts` — added `keepAliveId` timer and `resendLast()` that re-POSTs the most recent `GeolocationSubmission` every 20 s with a refreshed `timestamp`; `stop()` cleans up both the watch and the interval.

### Tests (new)
- `src/backend/tests/test_phase09_4c_hotfix_cache_timestamps.py` — 6 tests:
  - Adapter cache hit returns fresh timestamp.
  - Browser source repeated get returns fresh timestamp.
  - User-stated source repeated get returns fresh timestamp.
  - Identity-duplicate fixes are accepted without growing history.
  - Backwards-clock replay with *different* coords still rejected.
  - 200 resolver ticks against a locked ipapi mock → ≥ 198 accepts.
- `src/backend/tests/test_phase09_4b_overpass_nearby.py::test_sends_custom_user_agent` — spies on httpx.AsyncClient headers, asserts PHANTOM UA is sent and default httpx UA is not.
- `src/frontend/src/__tests__/geolocation.test.ts` — 3 tests:
  - Keep-alive fires every 20 s after an initial fix, preserving lat/lon.
  - No re-submits before the first watch callback arrives.
  - `stop()` cancels the keep-alive timer.

## Test suite

```
backend :  706 passed (was 699; +7 new hotfix tests)
frontend:  178 passed (was 175; +3 new hotfix tests)
```

No regressions. Run log:

```
$ cd src/backend && .venv/bin/pytest -q
706 passed, 5 warnings in 157.42s

$ cd src/frontend && npx vitest run
Test Files  22 passed (22)
     Tests  178 passed (178)
```

## Live verification

### Pre-hotfix evidence (running backend, unchanged during this pass)

The backend that the user had running throughout the diagnostic was not
restarted during either phase of this hotfix. As of
`2026-04-21T15:04:27`, it is still executing pre-hotfix code and exhibits
all three backend bugs live:

```
$ curl -s http://127.0.0.1:8000/api/v1/map/services_health
{
  "services": {
    "nominatim": {"status": "stale", "seconds_since_success": 3061, …},
    "overpass":  {"status": "down",
                  "last_failure_reason":
                    "Client error '406 Not Acceptable' for url
                     'https://overpass-api.de/api/interpreter'", …},
    "ipapi":     {"status": "ok", "seconds_since_success": 130, …}
  }
}
```

Rejection stream (last 200 log lines):

```
$ grep -c "rejecting implausible" /tmp/phantom-test.log  # last 200 lines
138
…
2026-04-21 15:04:26  rejecting implausible fix from ip_estimate: 49.85420,18.26330
2026-04-21 15:04:27  rejecting implausible fix from browser_geolocation: 49.83815,18.15641
2026-04-21 15:04:27  rejecting implausible fix from ip_estimate: 49.85420,18.26330
```

`location_history` confirms the "accept only at cache-TTL boundary"
pattern:

```
2026-04-21 14:59:44.91   browser_geolocation   49.8382,18.1564
2026-04-21 14:59:24.88   ip_estimate           49.8542,18.2633
2026-04-21 14:59:04.84   browser_geolocation   49.8382,18.1564
2026-04-21 14:54:44.70   ip_estimate           49.8542,18.2633
2026-04-21 14:49:44.58   ip_estimate           49.8542,18.2633
2026-04-21 14:44:44.43   ip_estimate           49.8542,18.2633
```

IP estimates land every 5 minutes (cache-TTL expiry) rather than every
500 ms (tick rate), and browser fixes land only sporadically — exactly
the shape the two bugs predict.

### Post-hotfix validation — deferred to user's tomorrow live test

Proper end-to-end validation requires a backend restart to load the new
code. The spec explicitly forbids restarting the user's live backend
("user won't restart during diagnostic"), so live verification of the
fixed behavior is deferred to the user's next session.

Live test plan for tomorrow:

1. `./scripts/dev.sh` or equivalent — restart backend + frontend.
2. Open the Map view, grant geolocation permission.
3. Within 5 s, the coordinate readout must flip from
   `NO LOCATION` to `BROWSER · 75 %` (or `IP · 30 %` if permission
   denied). The value should stay stable for the session, not cycle
   back to `NO LOCATION` every tick.
4. Over the next minute, `/tmp/phantom-test.log` should carry
   **zero** `rejecting implausible fix` warnings. Regardless of how
   long the session runs.
5. `location_history` should accumulate one entry per
   `agent_location_history_min_interval_s` (default 300 s, not per
   500 ms tick), monotonically increasing timestamps, matching the
   actual resolver source.
6. NearbyPanel should populate with the OSM features surrounding
   the user's position — 9 features showed up in my live curl test
   within 500 m of Ostrava. Services-health panel should flip
   `overpass` from `down` → `ok`.
7. TimelineDrawer should start accumulating `NEAR_REMEMBERED_PLACE`
   entries as the user navigates around areas with geo-tagged
   memories (this depends on Phase 9.4b memory facts being in the DB).
8. FactMarkerLayer should render its 34 markers.

If any of those signals don't appear, re-grep the log for the
`rejecting implausible` pattern and for `overpass` errors — the
hotfix specifically targets both of those strings.

## Issues NOT fixed in this pass

- **Nominatim stale (3061 s)**: the live instance's Nominatim has not
  had a successful call in ~51 minutes. Cache TTL is 7 days, so this is
  "no new queries arrived that missed cache" — not a bug. No action.
- **Historical `location_history` rows with `source=ip_estimate`** from
  the broken period are not cleaned up. The rows are truthful — the
  resolver genuinely did accept those IP fixes at those timestamps, just
  too rarely. Leaving them in place; they'll age out via the
  90-day retention policy (`agent_location_history_retention_days`).
- **TypeScript `watchId` return type mismatch** (pre-existing): our
  code stores `watchId: number | null`, but DOM's
  `watchPosition` returns `number` on Node-typed envs but `Number` on
  some browser typings. Not touching; orthogonal to the hotfix.

## Honest assessment

Localization will be stable on the next session start. All three backend
bug classes have regression guards that exercise the exact shapes that
failed live (same-object cache, 200-tick replay loop, identity
duplicates, backwards-clock, User-Agent header). The frontend
keep-alive is verified with three targeted vitest cases.

The one gap I cannot close without a restart: **I have not run the
full pipeline end-to-end against the real `ipapi.co` / Overpass /
frontend browser in a single session.** The backend test uses a locked
httpx mock; the frontend test uses fake timers. Integration at the
whole-stack level is a restart away. If anything slips through the
unit-test guard, it'll show up in the tomorrow live test's log.

## Handoff

**For the user's tomorrow live test, watch for:**

- Stable `BROWSER · 75 %` readout on the map (the exact percentage
  depends on the browser-reported accuracy).
- No repeating `rejecting implausible fix` warnings. If you see them at
  all, paste the first 5 here and we dig again.
- `services_health` showing `overpass: ok` within 30 s of load.
- Map centering on real position rather than the Kyiv fallback.
- NearbyPanel listing 5-15 OSM features around you.

Tag `v0.9.4c.1-hotfix` can be cut after the above all check out green.
