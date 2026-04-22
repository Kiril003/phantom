# Phase 9.4c-qw — IpApi Spin Loop Hotfix

**Branch:** `autonomous-run`
**Base HEAD:** `2572caa` (after Quick Wins phase)
**Date:** 2026-04-22
**Driver:** live log inspection of running backend (PID 32005)

---

## Symptom

`/tmp/phantom-today.log` was being filled at **~155-170 lines/minute**
(≈2.5 lines/sec) with the same two-line pattern, sustained across 13+
minutes of capture and presumably hours before:

```
2026-04-22 21:54:04,050 INFO  httpx: HTTP Request: GET https://ipapi.co/json/ "HTTP/1.1 429 Too Many Requests"
2026-04-22 21:54:04,052 WARN  agent.localization.adapters.ipapi: ipapi lookup network/parse failure: Client error '429 Too Many Requests'
```

Total ipapi-related lines in the visible log window: **2,112**. Real
errors elsewhere in the log were drowned. Quick Wins phase still worked
correctly throughout (chat responses 200 OK, RECENT PLACES SQL fired,
TemporalAnchor writes succeeded), so this is an orthogonal bug — but a
loud one.

---

## Root cause

`agent/localization/adapters/ipapi.py` had no negative-result handling.
The flow per failure was:

1. Resolver tick (every ~500 ms) calls `IpEstimateSource.get_position()`
   → `IpApiLocator.locate_current_ip()`.
2. Cache empty (TTL never satisfied because no successful response ever
   landed); rate-limit allows the request (`_rate_limit.can_request()`
   stays True because **network failures intentionally don't burn budget**
   — see line 91-94 of pre-fix code).
3. HTTP GET → 429 → `httpx.HTTPError` → `logger.warning` → `return None`.
4. State unchanged. Next tick repeats step 1.

`IpEstimateSource.is_available()` only gated on
`can_request_or_has_cache()`, which returned True every time because
budget was never consumed and the breaker didn't exist yet.

The resolver itself was already correct — `resolve()` short-circuits on
the first valid source (line 88-103 of `resolver.py`), and IP is
deliberately the lowest-trust fallback. The bug was strictly inside the
adapter.

---

## Fix

Single change: `IpApiLocator` now carries an exponential-backoff circuit
breaker.

| Consecutive failures | Cooldown |
| -------------------- | -------- |
| 1 – 2                | 0 (transient — try again next tick) |
| 3 – 5                | 10 minutes |
| 6 – 9                | 30 minutes |
| 10+                  | 60 minutes |

State:
- `_consecutive_failures: int`
- `_disabled_until: datetime | None`

Wiring:
- `_record_failure(exc)` — called from every error path in
  `locate_current_ip()` (HTTP error, parse error, error-key payload).
- `_record_success()` — called once after a fully-validated payload is
  cached. Resets both fields and logs a `CLOSED` line at INFO so the
  recovery is visible.
- `_circuit_open()` — used by `can_request_or_has_cache()` so
  `IpEstimateSource.is_available()` flips to False the moment the
  breaker opens. Resolver then skips ip_estimate entirely until
  cooldown elapses.
- Cache hits **bypass the breaker** — the cache is the entire point of
  using ipapi sparingly, and a cached coordinate is just as valid when
  the upstream is sick.

Once cooldown elapses, exactly one retry is allowed through. If it
succeeds, breaker resets fully. If it fails, `_record_failure` ratchets
the cooldown up to the next stage.

---

## Spec's Fix B status: not needed

Spec optional Fix B (resolver short-circuit) was checked: **already
present** in `resolver.py:88-103` — `resolve()` returns the first valid
estimate from the highest-trust source it finds, never falling through
to lower-trust sources when a higher one succeeded.

Fix A alone resolves the spam because it severs the call from the inside:
when ipapi is sick, the source reports unavailable and the resolver
moves on without ever touching it.

---

## Tests

Added `TestIpApiCircuitBreaker` in
`src/backend/tests/test_phase09_4b_localization.py`:

| Case                                            | Asserts                                                |
| ----------------------------------------------- | ------------------------------------------------------ |
| `test_three_failures_open_breaker_for_ten_min`  | After 3 sequential 429s, `_disabled_until ≈ now+10min`, `can_request_or_has_cache` flips False, no further HTTP calls |
| `test_breaker_escalates_with_more_failures`     | After 6 failures cooldown ≈ 30 min; after 10, ≈ 60 min |
| `test_success_resets_breaker`                   | After tripping, swap mock to working response, breaker counter goes to 0 and `_disabled_until` clears |
| `test_first_two_failures_do_not_trip_breaker`   | 2 consecutive failures keep breaker armed but not open |
| `test_cached_result_bypasses_breaker_check`     | Cache hits still serve while breaker is open           |

Counts:

| Suite                                              | Before | After |
| -------------------------------------------------- | -----: | ----: |
| `tests/test_phase09_4b_localization.py`            |    24  |   29  |
| `tests/test_phase09_4b_localization::TestIpApiLocator` (regression) | 4 | 4 |

0 regressions.

---

## Verification plan after backend restart

```bash
# Wait ~30 s after restart for the resolver to tick a few times
tail -200 /tmp/phantom-today.log | grep -c "ipapi.*429"
# Expected: 3 (one per failure before breaker trips)

# Then wait 1 min and recount
tail -100 /tmp/phantom-today.log | grep -c "ipapi.*429"
# Expected: 0 — breaker is open, resolver skips the source

# Look for the explicit OPEN / CLOSED markers
grep -E "circuit breaker (OPEN|CLOSED)" /tmp/phantom-today.log
# Expected: at least one OPEN line after the 3rd failure
```

Pre-fix: 155-170 lines/min. Post-fix expected: 3 lines per cooldown
window, i.e. roughly 18 lines/hour during sustained 429s, going to
~0/hour the moment ipapi.co recovers and one cache-warming probe lands.

---

## Commit

| Hash       | Subject                                         |
| ---------- | ----------------------------------------------- |
| `ef30375`  | IpApi circuit breaker stops 429 spin loop       |

---

## What is NOT addressed (out of scope per spec hard rules)

- Other adapters (Overpass, Nominatim) may have similar patterns. Audit
  not performed this pass — separate item if log spam appears there.
- `service_health.mark_failure("ipapi", ...)` is still called on every
  error before the breaker check, so the health module sees every
  failure individually. Whether that's right depends on its TTL — left
  alone for now since spec said no related cleanup.
- Telemetry counter for "how many breaker trips per day" not added.
  The OPEN / CLOSED log lines are the only visibility today.
