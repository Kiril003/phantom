# PHANTOM OS — Day-3 Audit: Test Coverage Gaps & Flake Harvest

**Agent:** N-test  
**Perspective:** test coverage gaps + flake harvesting on Day-2 work  
**Date:** 2026-04-30  
**Baseline:** `c3602c8` (Day-2 capstone)  
**HEAD:** `d3ca9a6`  
**Backend test count at baseline:** 1194 (per Day-2 capstone commit message)

---

## 1. Day-2 Commit Walk: Regression-Test Coverage Assessment

### Commit Map (newest → baseline)

| Hash | Finding | Test file shipped | Finding count |
|------|---------|-------------------|---------------|
| `c3602c8` | Day-2 capstone / OPERATIONS doc | — | — |
| `0e18f8c` | L-5+L-6: dockerignore + JSON log formatter | `test_phase_audit_2026_04_29_l5_l6_ops_hardening.py` (10 cases) | closed L-5, L-6 |
| `54fe727` | L-1..L-4: auth boundary hardening | `test_phase_audit_2026_04_29_l1_l4_security_hardening.py` (17 cases) | closed F-7, F-14, F-15, D2-CI1 |
| `910ffbc` | I-8: Phase 17b doc invariants | no new test file | doc-only |
| `b385749` | I-7: output safety classifier | `test_phase_audit_2026_04_29_i7_output_safety.py` (10 cases) | closed D2-I1 |
| `f92aaad` | I-5+I-6: 1 Hz CPU sampler + wall-clock cap | `test_phase_audit_2026_04_29_i5_cpu_sampler.py` (7 cases) | closed D2-D-cpu, PERF-17b |
| `bb6b268` | I-4: AiToolUseLog audit completeness | `test_phase_audit_2026_04_29_i4_audit_cols.py` (8 cases) | closed D2-I4 |
| `4f5ee38` | I-1+I-2+I-3: chat-tool input hardening | 3 test files (19 cases) | closed D2-I1/I2/I3 |
| `91bbeb9` | H-5: collapse dispatcher onto tool_executor | `test_phase17a_chat_tool_dispatcher.py` (rewrite) | closed H-5 |
| `ac1e941` | H-6: chroma eager init + dual janitor | `test_phase_audit_2026_04_29_h6_chroma.py` (9 cases) | closed F-17 |
| `b2d2d39` | H-3+H-4: F-25 + middleware order | `test_phase_audit_2026_04_29_h3_h4.py` (6 cases) | closed F-25 |
| `fdb28f7` | H-1+H-2: TestClient fixture + F-08/F-09 | `test_phase_audit_2026_04_29_h2_auth_gates.py` (conftest) | closed F-08, F-09 |

Of the 24 Day-2 findings, the following have test files that would specifically catch re-introduction of the regression:

- **H-3/H-4 (F-25 / middleware order)** — 6 cases; catches the engine-error voice response and middleware sequencing regressions.
- **H-5 (dispatcher collapse)** — rewritten `test_phase17a_chat_tool_dispatcher.py`; catches any re-split of tool execution.
- **H-6 (chroma eager init)** — 9 cases; catches list_collections probe latency regression and orphan cleanup.
- **I-1/I-2/I-3 (input hardening / no-echo / timeout)** — 19 cases covering schema validation, no-tool-echo in DB, and timeout enforcement.
- **I-4 (audit log)** — 8 cases; covers AiToolUseLog completeness, missing columns would fail DB constraint tests.
- **I-5/I-6 (CPU sampler + wall-clock cap)** — 7 cases; covers sampler lifecycle and config knob.
- **I-7 (output safety)** — 10 cases; covers verbatim redaction, whitespace tolerance, graceful DB failure.
- **L-1..L-4 (auth hardening)** — 17 cases; covers default-PIN refusal, orig_iat cap, lockout, CI-secret guard.
- **L-5/L-6 (dockerignore + JSON formatter)** — 10 cases; covers .dockerignore glob and formatter contract.

The following findings have **no dedicated regression test** that would specifically catch future re-introduction:

- **H-1 (conftest fixture)** — The conftest fixtures themselves are infrastructure, not tested. If auth fixtures regress, every test using them silently degrades rather than explicitly failing.
- **H-2 (F-08/F-09 auth gates)** — `test_phase_audit_2026_04_29_h2_auth_gates.py` covers the gate but does not assert that all routes listed in the original F-08 finding are auth-gated (only spot-checks a subset). A new route added without auth would not be caught.

---

## 2. Hot-Path Coverage Gaps

### 2.1 `ai/output_safety.py`

**Existing coverage** (`test_phase_audit_2026_04_29_i7_output_safety.py`): medical/credential/location category redaction, high-importance floor (0.92), sealed flag, whitespace tolerance, 1-word short-circuit, DB failure graceful degradation, user-with-no-facts short-circuit, empty text guard. Total: 10 cases in 8 classes.

---

**NEW-TEST-01**

- **Severity:** Tier B
- **File:line:** `src/backend/ai/output_safety.py:98` (`_is_sensitive`: importance >= 0.85)
- **Evidence:** The importance floor is `_IMPORTANCE_FLOOR_FOR_SENSITIVE = 0.85`. The existing test only exercises `importance=0.92`. There is no test at the exact boundary (`0.85`) nor just below it (`0.84`). A future change that accidentally shifts the operator (e.g. `>` instead of `>=`) would not be caught by any existing test. The boundary is both a security decision and a performance tradeoff — over-redacting at 0.84 or under-redacting at 0.85 are both regressions.
- **Suggested test sketch:**
  ```
  test_importance_boundary_exactly_at_floor_is_sensitive:
      create fact(category="fact", importance=0.85) in DB
      call sanitize(text containing verbatim fact content)
      assert result.safe is False  # == 0.85 must trigger

  test_importance_just_below_floor_is_not_redacted:
      create fact(category="fact", importance=0.849) in DB
      call sanitize(text containing verbatim fact content)
      assert result.safe is True   # < 0.85 must NOT trigger
  ```
  Both cases use a non-sensitive category ("fact") so only the importance floor decides the outcome. The test must use a fact with >= 3 tokens to clear the `_MIN_FACT_TOKENS` gate.

---

**NEW-TEST-02**

- **Severity:** Tier B
- **File:line:** `src/backend/ai/output_safety.py:178-213` (the `for fact in rows` loop, multi-fact scenario)
- **Evidence:** Every existing test inserts exactly one fact and then calls `sanitize`. The production threat is a response that quotes two separate facts — one sensitive (should be redacted) and one non-sensitive (should pass through untouched). The loop logic updates `norm_text = _normalise(sanitised)` after each substitution; if the normalised replacement string accidentally matches the second fact's content, or if `span_len` double-counts, the telemetry `examined_facts` and `redactions` list could be incorrect. No test exercises both a positive and a negative fact in the same call.
- **Suggested test sketch:**
  ```
  test_multi_fact_only_sensitive_one_is_redacted:
      create fact_A(category="medical", importance=0.6,
                    content="user has chronic migraine condition")
      create fact_B(category="preference", importance=0.3,
                    content="user prefers morning coffee breaks")
      call sanitize(
          "You mentioned user has chronic migraine condition, and also "
          "that user prefers morning coffee breaks.",
          user_id=..., db=db
      )
      assert result.safe is False
      assert len(result.redactions) == 1
      assert result.redactions[0].fact_category == "medical"
      # Non-sensitive fact content still visible in output
      assert "morning coffee breaks" in result.text
      assert "migraine" not in result.text
  ```

---

**NEW-TEST-03**

- **Severity:** Tier C
- **File:line:** `src/backend/ai/output_safety.py:145-169` (`sanitize` function, `user_id` parameter with empty-session scenario)
- **Evidence:** The `fresh_user` fixture creates a User row first and then the test adds facts. There is no test for the case where the user row exists but has never had any MemoryFact rows at all (i.e. a brand-new session just after account creation). The `_load_user_sensitive_facts` query returns an empty list in this case; the `if not rows: return SanitiseResult(text=text)` short-circuit fires. This is covered conceptually by `test_user_with_no_facts_short_circuits_clean` but that test does not assert `examined_facts == 0`, and does not confirm the `SanitiseResult.safe` property is True when `redactions == []` (it checks `safe` but not the full shape of the result including the `examined_facts` counter being 0 to indicate "nothing was loaded, not just nothing matched").
- **Suggested test sketch:**
  ```
  test_empty_session_short_circuit_has_zero_examined_facts:
      user_id = create fresh user (no facts inserted)
      result = await sanitize(
          "Some assistant output that contains several words.",
          user_id=user_id, db=db
      )
      assert result.safe is True
      assert result.examined_facts == 0
      assert result.redactions == []
      # text unchanged
      assert "Several words" in result.text
  ```

---

**NEW-TEST-04**

- **Severity:** Tier C
- **File:line:** `src/backend/ai/output_safety.py:145-169` (`sanitize`, `text` parameter edge cases)
- **Evidence:** `sanitize` guards `if not isinstance(text, str) or not text` at line 159, returning `SanitiseResult(text=text or "")`. No test calls `sanitize` with `text=None` (non-string) to confirm the guard fires and returns a clean `SanitiseResult` rather than raising a `TypeError`. The production call site in the chat turn pipeline could pass `None` if an LLM returns an unexpected structure.
- **Suggested test sketch:**
  ```
  test_sanitize_with_none_text_does_not_raise:
      result = await sanitize(None, user_id="any", db=fake_db)
      assert result.text == ""
      assert result.safe is True

  test_sanitize_with_integer_text_does_not_raise:
      result = await sanitize(42, user_id="any", db=fake_db)
      assert result.text == ""  # 42 is not a str, falls into the guard
  ```
  The `fake_db` does not need to be real — the guard fires before the DB query.

---

### 2.2 `security/login_lockout.py`

**Existing coverage** (`test_phase_audit_2026_04_29_l1_l4_security_hardening.py`, class `TestL3LoginLockout`): below-threshold no-lock, threshold-hit lock, success-clear, lock-transition return-value, `login_pin` 429 via pre-seeded IP, end-to-end 5×401 then 429 via live requests.

---

**NEW-TEST-05**

- **Severity:** Tier A (false completion — the closed finding L-3 / F-15 has a gap that a future refactor would not catch)
- **File:line:** `src/backend/security/login_lockout.py:65-82` (`is_locked`), `src/backend/api/routes_auth.py:193-209` (`login_pin` dual-key check)
- **Evidence:** The `login_pin` route tracks two independent keys: `ip_key` and `user_key`. The lockout check iterates `for key in (ip_key, user_key)`. No test verifies cross-key independence — specifically: IP locked but `user_key` not locked (or vice versa). The test `test_login_pin_returns_429_when_ip_is_locked` pre-seeds the IP key via `register_failure("ip:testclient")` and relies on TestClient emitting `"ip:testclient"` as the client host. But it does not confirm that the same username sent from a different (not-locked) IP would still succeed, nor that a locked username with a clean IP still gets a 429. A future refactor that collapses the dual-key check to a single key would pass every existing test.
- **Suggested test sketch:**
  ```
  test_cross_key_independence_ip_locked_user_not:
      lock only the IP key: register_failure("ip:evil-ip") x THRESHOLD
      confirm is_locked("ip:evil-ip") == (True, >0)
      confirm is_locked("user:phantom") == (False, 0)
      # Requests from a DIFFERENT IP for the same username must pass
      # (assuming correct credentials). This requires a monkeypatched
      # _ip_key() returning "ip:clean-ip" to simulate a different client.

  test_cross_key_independence_user_locked_ip_not:
      lock only the user key: register_failure("user:phantom") x THRESHOLD
      confirm is_locked("ip:clean-ip") == (False, 0)
      confirm is_locked("user:phantom") == (True, >0)
      # Request from clean IP for locked username must still return 429.
  ```

---

**NEW-TEST-06**

- **Severity:** Tier B
- **File:line:** `src/backend/security/login_lockout.py:126-132` (`reset_for_tests`)
- **Evidence:** `reset_for_tests()` clears both `_failures` and `_locked_until`. No test verifies that after `reset_for_tests()` a key that was previously locked can again accumulate exactly `LOCKOUT_THRESHOLD` failures before re-locking (i.e. the reset is truly complete and not just shallow). Additionally, no test checks that calling `reset_for_tests()` while no state exists (empty dicts) is a safe no-op and does not raise.
- **Suggested test sketch:**
  ```
  test_reset_for_tests_full_state_wipe:
      register_failure("ip:x") x LOCKOUT_THRESHOLD  # now locked
      locked, _ = is_locked("ip:x")
      assert locked is True
      reset_for_tests()
      locked, remaining = is_locked("ip:x")
      assert locked is False
      assert remaining == 0
      # Re-accumulate; must need full threshold again
      for i in range(LOCKOUT_THRESHOLD - 1):
          register_failure("ip:x")
      locked, _ = is_locked("ip:x")
      assert locked is False  # still under threshold

  test_reset_for_tests_on_empty_state_is_noop:
      reset_for_tests()   # no state, must not raise
      reset_for_tests()   # idempotent
      locked, _ = is_locked("ip:fresh")
      assert locked is False
  ```

---

**NEW-TEST-07**

- **Severity:** Tier B
- **File:line:** `src/backend/security/login_lockout.py:94-96` (deque trim loop: `while deck and deck[0] < cutoff`)
- **Evidence:** The sliding-window trim removes entries older than `LOCKOUT_WINDOW_S` on every `register_failure` call. No test exercises the case where the deque contains timestamps that are older than `LOCKOUT_WINDOW_S` — i.e. simulating an attacker who made 4 attempts an hour ago, then makes the 5th now. The 5th attempt must NOT trigger a lock because the old 4 attempts fall outside the window. Currently `time.monotonic()` is not monkeypatched in any test, so old-timestamp trimming is never exercised. A bug in the `cutoff` arithmetic or the `while deck` early-exit would silently accept locking on stale data.
- **Suggested test sketch:**
  ```
  test_old_timestamps_outside_window_are_trimmed:
      import time
      from unittest.mock import patch

      # Inject 4 failures at "an hour ago" by directly manipulating
      # _failures — or by monkeypatching time.monotonic.
      key = "ip:stale"
      with patch("security.login_lockout.time") as mock_time:
          # Simulate clock at T=0
          mock_time.monotonic.return_value = 0.0
          for _ in range(LOCKOUT_THRESHOLD - 1):
              register_failure(key)
          # Advance clock by LOCKOUT_WINDOW_S + 1
          mock_time.monotonic.return_value = float(LOCKOUT_WINDOW_S + 1)
          # One more failure — old 4 should be trimmed, only 1 recent
          transitioned = register_failure(key)
      assert transitioned is False   # no lock — 1 failure in window
      locked, _ = is_locked(key)
      assert locked is False
  ```

---

**NEW-TEST-08**

- **Severity:** Tier C
- **File:line:** `src/backend/api/routes_auth.py:147-178` (`login_rfid` route, lockout integration)
- **Evidence:** The lockout 429 path is fully tested for `login_pin` but the `login_rfid` route has an identical lockout check (`is_locked(ip_key)` → 429) that is tested by zero integration tests. The RFID route only checks the IP key (no `user_key` for RFID since the UID is the "username"). A regression that removes the lockout check from `login_rfid` while keeping it on `login_pin` would not be caught.
- **Suggested test sketch:**
  ```
  test_login_rfid_returns_429_when_ip_is_locked:
      from security import login_lockout
      for _ in range(login_lockout.LOCKOUT_THRESHOLD):
          login_lockout.register_failure("ip:testclient")
      app = create_app()
      with TestClient(app) as client:
          r = client.post("/api/v1/auth/login/rfid",
                          json={"uid": "AB:CD:EF:01"})
      assert r.status_code == 429
      assert r.headers["X-Error-Code"] == "LOCKED_OUT"
      assert "Retry-After" in r.headers
  ```

---

### 2.3 `security/jwt_manager.py`

**Existing coverage** (`TestL2JwtAbsoluteCap`): fresh token anchors `orig_iat == iat`, refresh preserves `orig_iat`, verify rejects `orig_iat` 31 days old, refresh rejects chain past 30 days in grace window, legacy token (no `orig_iat`) decays naturally.

---

**NEW-TEST-09**

- **Severity:** Tier B
- **File:line:** `src/backend/security/jwt_manager.py:108` (`orig_iat_ts = int(payload.get("orig_iat", iat_ts))`)
- **Evidence:** The `verify_token` comment says legacy tokens issued before F-14 shipped lack `orig_iat` and are "treated as if `orig_iat == iat`". The test `test_legacy_token_without_orig_iat_decays_naturally` covers this for the **verify** path only. The **refresh** path (`refresh_token`) has a parallel `payload.get("orig_iat", iat_ts)` at line 152. No test calls `refresh_token` on a structurally valid legacy token (no `orig_iat`, not expired, still within 30 days) to confirm the refresh succeeds and the returned token now carries `orig_iat == iat` of the legacy token. A regression could either (a) crash with a `KeyError` if the `.get` default is dropped, or (b) silently anchor `orig_iat` to the refresh moment rather than the original issuance.
- **Suggested test sketch:**
  ```
  test_refresh_of_legacy_token_without_orig_iat_succeeds_and_anchors_iat:
      from jose import jwt
      now = datetime.now(tz=timezone.utc)
      legacy_iat = int(now.timestamp())
      payload = {
          "sub": "u1", "username": "phantom", "role": "ROOT",
          "iat": legacy_iat,
          "exp": int((now + timedelta(minutes=30)).timestamp()),
          # NO orig_iat field
      }
      legacy_token = jwt.encode(payload, _secret(), algorithm=_ALGORITHM)
      new_token, _ = refresh_token(legacy_token)   # must not raise
      result = verify_token(new_token)
      # The refreshed token must anchor orig_iat to the legacy iat,
      # NOT to the refresh moment.
      assert result.orig_iat == legacy_iat
  ```

---

**NEW-TEST-10**

- **Severity:** Tier C
- **File:line:** `src/backend/security/jwt_manager.py:125-172` (`refresh_token`, grace-path `orig_iat` enforcement)
- **Evidence:** The grace path (token expired within 1h, `verify_exp=False` decode) re-checks the absolute cap at line 153. The existing test `test_refresh_token_rejects_chain_past_30_days` does exercise this path for the rejection case (expired token with ancient `orig_iat`). However, there is no test for the **acceptance** case in the grace path: a token that is expired within the 1h grace window AND has a fresh `orig_iat` (not yet 30 days old). This matters because the grace path skips `verify_token` and reconstructs `TokenPayload` manually — if a field is accidentally omitted (e.g. `orig_iat` not propagated to the new token), the downstream refresh would silently reset the lifetime cap.
- **Suggested test sketch:**
  ```
  test_refresh_accepts_grace_window_token_with_fresh_orig_iat:
      now = datetime.now(tz=timezone.utc)
      orig_iat_ts = int((now - timedelta(days=1)).timestamp())  # fresh
      payload = {
          "sub": "u1", "username": "phantom", "role": "ROOT",
          "iat": int((now - timedelta(minutes=40)).timestamp()),
          "exp": int((now - timedelta(minutes=10)).timestamp()),  # expired 10min ago
          "orig_iat": orig_iat_ts,
      }
      token = jwt.encode(payload, _secret(), algorithm=_ALGORITHM)
      new_token, expires_at = refresh_token(token)   # must succeed
      result = verify_token(new_token)
      assert result.orig_iat == orig_iat_ts   # preserved, not reset
  ```

---

### 2.4 `system_metrics_sampler.py`

**Existing coverage** (`TestI5SamplerLifecycle`): start+stop clean, idempotent start, `get_cpu_percent` returns 0 before start, sampler eventually caches a real value. `TestI5ToolExecutorReadsCache` confirms tool_executor reads the cache.

---

**NEW-TEST-11**

- **Severity:** Tier B
- **File:line:** `src/backend/system_metrics_sampler.py:88-115` (`start`, `stop`, restart sequence)
- **Evidence:** No test calls `stop()` followed by `start()` again to confirm the restart cycle works correctly. After `stop()`, `_sampler_task = None` and `_stop_event = None`. A subsequent `start()` must create a fresh `asyncio.Event()` and a new task. A bug where `stop()` fails to clear `_stop_event` would make `start()` see a set event and cause the new `_sample_loop` to exit immediately on the `while not _stop_event.is_set()` check. This is a real risk on lifespan hot-reload scenarios.
- **Suggested test sketch:**
  ```
  test_stop_then_start_restart_works_correctly:
      import system_metrics_sampler as s
      await s.start()
      assert s.is_running() is True
      await s.stop()
      assert s.is_running() is False
      assert s._stop_event is None
      assert s._sampler_task is None
      # Restart
      await s.start()
      assert s.is_running() is True
      await asyncio.sleep(0.05)   # give one tick
      # Sampler must still be alive (not exited due to stale stop_event)
      assert s.is_running() is True
      await s.stop()
      assert s.is_running() is False
  ```

---

**NEW-TEST-12**

- **Severity:** Tier B
- **File:line:** `src/backend/system_metrics_sampler.py:66-72` (`_sample_loop`, exception swallowing in the read path)
- **Evidence:** Inside `_sample_loop`, a `psutil.cpu_percent` read failure is caught at line 69: `logger.debug(...)` then `value = _cached_cpu_pct`. This means the sampler silently retains the last cached value on psutil errors rather than resetting to 0.0 or signalling degradation. No test verifies this behaviour. If the sampler should propagate a degraded-state sentinel (e.g. a NaN or -1.0) when psutil repeatedly fails, the current silent-retain would be a bug; if retain is intentional, it should be tested to prevent a future "improve error handling" refactor from accidentally crashing the loop.
- **Suggested test sketch:**
  ```
  test_sample_loop_retains_last_cached_value_on_psutil_exception:
      import system_metrics_sampler as s
      import psutil
      s._set_cached(55.0)   # prime with known value

      original = psutil.cpu_percent
      call_count = 0
      def _flaky(*a, **kw):
          nonlocal call_count
          call_count += 1
          if call_count <= 2:
              raise OSError("psutil synthetic failure")
          return original(*a, **kw)

      with monkeypatch.context() as mp:
          mp.setattr(psutil, "cpu_percent", _flaky)
          await s.start()
          await asyncio.sleep(0.1)
          # Value must be 55.0 (retained) — not 0.0 and not an exception
          v = s.get_cpu_percent()
          assert v == 55.0
          await s.stop()
  ```

---

**NEW-TEST-13**

- **Severity:** Tier C
- **File:line:** `src/backend/system_metrics_sampler.py:118-124` (`_reset_for_tests`)
- **Evidence:** `_reset_for_tests()` is called by the `_reset_sampler` autouse fixture in `test_phase_audit_2026_04_29_i5_cpu_sampler.py`. However, no test verifies that `_reset_for_tests()` called on a **running** sampler (task still alive) does not leave an orphaned asyncio task dangling. The function clears `_sampler_task = None` without cancelling the task — if called mid-run, the task continues looping in the background but `is_running()` returns `False` (since `_sampler_task is None`). This is a latent flake source: the orphaned task mutates `_cached_cpu_pct` while the next test believes the sampler is stopped.
- **Suggested test sketch:**
  ```
  test_reset_for_tests_while_running_leaves_no_orphan_task:
      import asyncio
      import system_metrics_sampler as s
      await s.start()
      task_ref = s._sampler_task
      assert task_ref is not None
      s._reset_for_tests()
      assert s.is_running() is False
      # The original task must be cancelled/done to not be an orphan.
      # Give the event loop a tick for cancellation to propagate.
      await asyncio.sleep(0.01)
      # If _reset_for_tests doesn't cancel, task_ref.done() is False
      # and the task is a zombie. This test surfaces that.
      # (Current implementation does NOT cancel — this test is expected
      # to FAIL until the implementation is fixed.)
      assert task_ref.done(), (
          "reset_for_tests: left a running asyncio Task — zombie task "
          "will mutate _cached_cpu_pct during subsequent tests."
      )
  ```

---

### 2.5 `observability.py` — `JsonFormatter`

**Existing coverage** (`TestL6JsonFormatter`): canonical fields present, correlation_id surfaced when filter set it, correlation_id omitted outside request (`"-"` placeholder), extra fields merged, non-serialisable extra coerced via `str()`, exception traceback in `exc` field. `TestL6InstallJsonLogging`: handler swap, idempotent (no double filter). `TestL6ConfigKnob`: default off.

---

**NEW-TEST-14**

- **Severity:** Tier B
- **File:line:** `src/backend/observability.py:135-142` (`_STD_ATTRS` frozenset), `src/backend/observability.py:161-174` (extra-field merge loop)
- **Evidence:** The `_STD_ATTRS` frozenset defines which attributes of `LogRecord` are standard (and thus not surfaced as extra JSON fields). If a caller passes `extra={"message": "override"}` or `extra={"level": "INJECTED"}`, those collide with the canonical payload fields already set at lines 147-154. The guard `if key in payload: continue` at line 164 correctly skips them — but no test verifies this. A future refactor that reorders the payload construction or removes the guard would allow a caller to silently overwrite `"message"`, `"level"`, or `"ts"` in the JSON output, which could mislead operators or break log-parsing pipelines. Additionally, `"taskName"` is in `_STD_ATTRS` (Python 3.12+) but the project uses Python 3.11; on 3.11 `LogRecord` has no `taskName` attribute by default — the `key.startswith("_")` guard does not apply, so if a caller injects `extra={"taskName": "x"}`, it would be treated as a custom field on 3.11 and surface in the JSON. This is a version-conditional behaviour gap.
- **Suggested test sketch:**
  ```
  test_extra_field_cannot_overwrite_canonical_message:
      formatter = JsonFormatter()
      record = logging.LogRecord(
          name="phantom.test", level=logging.INFO,
          pathname=__file__, lineno=1,
          msg="the real message", args=(), exc_info=None,
      )
      record.message = "attacker override"   # collides with canonical
      payload = json.loads(formatter.format(record))
      # Canonical "message" must win; extra override must be silently
      # dropped (not raise, not overwrite).
      assert payload["message"] == "the real message"

  test_extra_field_cannot_overwrite_canonical_level:
      formatter = JsonFormatter()
      record = logging.LogRecord(
          name="phantom.test", level=logging.WARNING,
          pathname=__file__, lineno=1,
          msg="warn", args=(), exc_info=None,
      )
      record.level = "INJECTED"
      payload = json.loads(formatter.format(record))
      assert payload["level"] == "WARNING"
  ```

---

**NEW-TEST-15**

- **Severity:** Tier C
- **File:line:** `src/backend/observability.py:143-176` (`JsonFormatter.format`), `src/backend/observability.py:148-150` (UTC timestamp with `ensure_ascii=False`)
- **Evidence:** The formatter uses `ensure_ascii=False` to keep Cyrillic/Ukrainian content intact. No test passes a log message containing Cyrillic or Ukrainian text and asserts that the JSON output is valid UTF-8 and that the characters survive round-trip through `json.loads`. If `ensure_ascii` is accidentally flipped to `True` (e.g. by a "fix encoding" refactor), Ukrainian operator log messages would become `\uXXXX` escape sequences, breaking Loki regex filters and on-call grep workflows.
- **Suggested test sketch:**
  ```
  test_unicode_message_survives_json_round_trip:
      formatter = JsonFormatter()
      ukrainian_msg = "Оператор увійшов до системи"
      record = logging.LogRecord(
          name="phantom.auth", level=logging.INFO,
          pathname=__file__, lineno=1,
          msg=ukrainian_msg, args=(), exc_info=None,
      )
      raw = formatter.format(record)
      # Must be valid JSON
      payload = json.loads(raw)
      # Ukrainian characters must be literal, not escaped
      assert payload["message"] == ukrainian_msg
      assert "\\u" not in raw  # no Unicode escape sequences
  ```

---

**NEW-TEST-16**

- **Severity:** Tier C
- **File:line:** `src/backend/observability.py:179-195` (`install_json_logging`)
- **Evidence:** `install_json_logging` installs `CorrelationFilter` on the **root logger** and swaps formatters on root logger's handlers. A child logger (e.g. `logging.getLogger("phantom.voice")`) that has its own handler (not inherited from root) would not get the `JsonFormatter` applied to that handler. No test creates a child logger with an independent handler and confirms that `install_json_logging` either (a) also patches child-logger handlers or (b) documents that it intentionally does not. On the current Radxa deployment the logging config is simple enough that this may not matter, but if a future phase adds a file handler on `phantom.security`, its records would not be JSON-formatted even after `install_json_logging()` runs.
- **Suggested test sketch:**
  ```
  test_install_json_logging_does_not_patch_child_logger_handlers:
      # This is a documentation test: confirms the KNOWN limitation
      # rather than asserting something that doesn't hold.
      import io
      child_handler = logging.StreamHandler(io.StringIO())
      child_logger = logging.getLogger("phantom.test.child_handler_test")
      child_logger.addHandler(child_handler)
      child_logger.propagate = False   # isolate from root
      try:
          install_json_logging()
          # Child handler's formatter was NOT touched by install_json_logging.
          # Document this as a known gap — not a bug, but a limitation.
          assert not isinstance(child_handler.formatter, JsonFormatter), (
              "install_json_logging now patches child-logger handlers. "
              "Update this test to confirm the behaviour is intentional."
          )
      finally:
          child_logger.removeHandler(child_handler)
  ```

---

## 3. Flake Harvest

### FLAKE-01: `system_metrics_sampler` — no conftest isolation, leaks across async tests

- **Severity:** Tier A (active flake risk)
- **File:line:** `src/backend/tests/conftest.py` (absent), `src/backend/system_metrics_sampler.py:34-36` (module-level globals `_cached_cpu_pct`, `_sampler_task`, `_stop_event`)
- **Evidence:** `conftest.py` has an `autouse` fixture `_reset_login_lockout_per_test` that resets the lockout module between every test. There is **no equivalent autouse fixture for `system_metrics_sampler`**. The sampler is started during the FastAPI lifespan in `main.py` at line 268, which fires when `TestClient(create_app())` is used as a context manager. Any test in the suite that uses `TestClient(create_app())` — for example the lockout 429 integration tests in `TestL3LoginLockout` (`test_login_pin_returns_429_when_ip_is_locked`, `test_failed_pin_attempts_eventually_lock_out_real_request`) — will start the sampler task via lifespan. Since there is no teardown of the sampler after those tests, `_sampler_task` may still be running when the next test starts. If that next test is an async test (pytest-asyncio), it gets a **new** event loop, and the old sampler task is now associated with the **dead** prior loop. On Python 3.11 this generates `RuntimeError: Task attached to a different loop` on the next `await asyncio.sleep()` call or surfaces as a `DeprecationWarning` (task destroyed but pending). The `_reset_sampler` autouse fixture in `test_phase_audit_2026_04_29_i5_cpu_sampler.py` only applies within that file — it does not protect other test files.
- **Recommended fix (conftest addition):**
  ```python
  @pytest.fixture(autouse=True)
  def _reset_cpu_sampler_per_test():
      import system_metrics_sampler
      system_metrics_sampler._reset_for_tests()
      yield
      system_metrics_sampler._reset_for_tests()
  ```
  Note: as identified in NEW-TEST-13, `_reset_for_tests` does not cancel the running task. The conftest fixture ideally needs an async teardown path:
  ```python
  @pytest.fixture(autouse=True)
  async def _reset_cpu_sampler_per_test():
      import system_metrics_sampler as s
      yield
      if s.is_running():
          await s.stop()
      s._reset_for_tests()
  ```
  This requires the fixture to be `async` (which conftest supports under pytest-asyncio in `auto` mode).

---

### FLAKE-02: `conftest._ensure_seed_phantom_user` — asyncio.run() clash under pytest-asyncio

- **Severity:** Tier B
- **File:line:** `src/backend/tests/conftest.py:113-121`
- **Evidence:** The `_ensure_seed_phantom_user` session-scoped fixture calls `asyncio.run(_run())` at lines 113-115, wrapped in a `try/except RuntimeError`. The comment says "Another loop is already running (rare under pytest-asyncio). Best-effort". Under pytest-asyncio `asyncio_mode = "auto"` (which this project uses), pytest-asyncio installs a session-scoped event loop at collection time before any session-scoped fixtures run. By the time `_ensure_seed_phantom_user` fires, a loop may already be running, causing `asyncio.run()` to raise `RuntimeError("This event loop is already running")`. The `except RuntimeError: pass` silently swallows this, meaning the `phantom` seed row may not be created. Downstream test files (`test_phase07_voice.py`, `test_phase08_face.py`) that call `login/pin` with `phantom`/`000000` then get a 401 instead of the expected 200, manifesting as a non-deterministic "auth failed" flake that is loop-order dependent.
- **Recommended fix:** Replace `asyncio.run()` with `anyio.from_thread.run_sync()` or use a `pytest_configure` hook, or restructure to use pytest-asyncio's `@pytest.fixture(scope="session") async def` pattern directly:
  ```python
  @pytest.fixture(scope="session")
  async def _ensure_seed_phantom_user():
      # pytest-asyncio runs this in the session event loop — no asyncio.run() needed
      from db.database import init_db, get_session
      from db.models import User
      from security.auth import hash_secret
      from sqlalchemy import select
      await init_db()
      async with get_session() as db:
          existing = (await db.execute(
              select(User).where(User.username == "phantom")
          )).scalar_one_or_none()
          if existing is None:
              db.add(User(id=str(uuid.uuid4()), username="phantom",
                          role="ROOT", pin_hash=hash_secret("000000"),
                          rfid_uid_hash=None, preferences_json="{}"))
              await db.commit()
      yield
  ```

---

### FLAKE-03: Chroma client state — no per-test reset, session-scoped singleton leaks between parallel test workers

- **Severity:** Tier B
- **File:line:** `src/backend/tests/conftest.py:24-25` (comment only, no fixture), `src/backend/memory/strategic_memory.py` (`_get_client()` singleton)
- **Evidence:** The conftest comment at line 24 says "chroma state already lives behind a session-scoped `_get_client` so we don't fight over it." This is correct for single-worker runs. However, `test_phase_audit_2026_04_29_h6_chroma.py` tests the orphan-janitor logic by creating and dropping chroma collections. These operations mutate the chroma SQLite file on disk. If tests in `test_phase09_2_memory.py` or `test_phase09_4c_geo_tagged_facts.py` run concurrently (via `pytest-xdist -n auto`), the janitor deleting collections while a memory test is reading them produces `chromadb.errors.NotFoundError`. There is no per-test chroma isolation — no fixture that creates a unique chroma collection prefix per test and drops it on teardown. The `_get_client()` singleton is shared globally, so collection-level mutations bleed between concurrent tests. This is a latent flake that only surfaces under parallel execution but becomes critical if CI is ever configured with `-n auto`.
- **Recommended guard (not a full fix, but a flake-reduction measure):**
  ```python
  # In conftest.py, document the known parallel-safety limitation:
  # chroma tests that create/delete collections MUST be marked
  # @pytest.mark.chroma_mutating and run single-threaded:
  # pytest -m "not chroma_mutating" -n auto
  # pytest -m "chroma_mutating" -n 0
  ```

---

### FLAKE-04: `TestL3LoginLockout.test_failed_pin_attempts_eventually_lock_out_real_request` — TestClient IP key assumption

- **Severity:** Tier B
- **File:line:** `src/backend/tests/test_phase_audit_2026_04_29_l1_l4_security_hardening.py:311-335`
- **Evidence:** The test uses `TestClient(create_app())` and relies on the requests arriving with `client.host == "testclient"` (the default `starlette.testclient` ASGI transport client address), producing an IP key of `"ip:testclient"`. The `_reset_login_lockout_per_test` autouse fixture clears module state before/after every test, so the lockout counter starts clean. However, the test then fires 5 requests with `json={"username": "phantom_nope", "pin": "999999"}` and expects 5×401, then 1×429. The `user_key` for `"phantom_nope"` is `"user:phantom_nope"`. On the 5th failure, **both** `ip_key` and `user_key` get locked via `register_failure`. The 6th request checks both keys and returns 429 — this is correct. But the assertion on lines 322-326 checks only `r.status_code == 401` for attempts 1-5; it does not assert that no `Retry-After` header is present on those 401s. If the `_lockout_response` helper is accidentally called on a 401-path, the test would still pass (wrong status would break it), but the missing header assertion means a 429 that slips in before iteration 5 would be missed for loops where the `autouse` reset fired late (e.g. fixture ordering issue).
- **Risk:** Low under current single-worker runs, but the autouse reset relies on conftest module import order. If a future change moves `test_phase_audit_2026_04_29_l1_l4_security_hardening.py` earlier in collection order and a prior file's `TestClient` context already triggered `register_failure("ip:testclient")` via a bad-credential test, the lockout would arrive before iteration 5 and the assertion at line 322 would spuriously fail.
- **Recommended hardening:** Assert `r.status_code != 429` in addition to `== 401` for the pre-lockout iterations, and use a unique username that no other test in the suite targets.

---

## 4. Frontend Test Coverage Gaps

**Vitest test files found:** 30 files in `src/frontend/src/__tests__/`. E2E Playwright specs in `src/frontend/e2e/`.

Day-2 backend changes that have frontend-visible contract implications:

| Backend change | Frontend impact | Frontend test exists? |
|---------------|----------------|----------------------|
| L-3: 429 LOCKED_OUT on `login/pin` | Login screen must handle 429 and show countdown | No |
| L-3: `Retry-After` header on 429 | `chatStore.sendMessage` / login service must parse this header | No |
| L-2: `orig_iat` in JWT payload | `chatStore` / token refresh logic | No |
| I-7: `[REDACTED]` placeholder in chat response | `MessageBubble` render of `[REDACTED]` text | No |
| L-6: `X-Correlation-Id` response header | API client could expose it for debugging | No |

---

**NEW-TEST-17**

- **Severity:** Tier B (D2-FALSE: the L-3 finding is closed on the backend but the frontend contract is untested — a future frontend refactor could silently swallow 429s)
- **File:line:** `src/frontend/src/__tests__/chat.test.tsx` (absent 429 scenario), `src/frontend/src/stores/chatStore.ts` (sendMessage error path)
- **Evidence:** The `chat.test.tsx` file tests `error: "Network failed"` banner display but only via direct Zustand state mutation (`useChatStore.setState({ error: 'Network failed' })`). There is no vitest spec that mocks `fetch` (or the API service) to return `HTTP 429` from `login/pin` and asserts that (a) the `chatStore.error` is set to a user-visible lockout message, and (b) the `Retry-After` header value is surfaced in the error (e.g. "Try again in 900 s"). The `face.test.tsx` file does reference an `unknown_lockout_s: 10` field in test data (line 109), suggesting a lockout concept exists in face recognition settings, but this is not the auth lockout response. Zero frontend tests exercise the 429 auth lockout path end-to-end.
- **Suggested test sketch (vitest):**
  ```typescript
  describe('login 429 lockout handling', () => {
    it('sets a lockout error message when server returns 429', async () => {
      // Mock the auth API to return 429 with Retry-After
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({ detail: 'Too many failed login attempts. Try again in 900 s.' }),
          {
            status: 429,
            headers: {
              'X-Error-Code': 'LOCKED_OUT',
              'Retry-After': '900',
            },
          }
        )
      );
      // Invoke the login action (or the chatStore sendMessage with auth failure)
      // Assert the store error reflects the lockout, not a generic "Network failed"
      await useChatStore.getState().sendMessage('test', 'text', SystemState.DIALOGUE);
      expect(useChatStore.getState().error).toMatch(/locked|429|Too many/i);
    });
  });
  ```

---

**NEW-TEST-18**

- **Severity:** Tier C
- **File:line:** `src/frontend/src/__tests__/chat.test.tsx` (absent redaction scenario)
- **Evidence:** After I-7, backend chat responses can contain `[REDACTED]` placeholders instead of verbatim fact content. The `MessageBubble` and `ResponseRenderer` components render assistant text. No vitest test checks that `[REDACTED]` in the `content` field is rendered as-is (plain text) rather than being filtered, collapsed, or visually suppressed by a Markdown renderer. A future "improve chat UX" PR that adds a special renderer for brackets could accidentally hide `[REDACTED]` from the operator's view.
- **Suggested test sketch:**
  ```typescript
  it('renders [REDACTED] placeholder verbatim without filtering', async () => {
    const { MessageBubble } = await import('../components/chat/MessageBubble');
    render(
      <MessageBubble
        message={baseMessage({
          content: 'Your medical detail is [REDACTED] for privacy.',
          response_form: 'text',
        })}
      />
    );
    expect(screen.getByText(/\[REDACTED\]/)).toBeDefined();
  });
  ```

---

**NEW-TEST-19**

- **Severity:** Tier C
- **File:line:** `src/frontend/e2e/smoke.spec.ts` (no lockout E2E scenario)
- **Evidence:** The E2E smoke spec (`src/frontend/e2e/smoke.spec.ts`) tests the basic happy path. There is no E2E test that navigates to the login screen, submits wrong credentials 5 times, and asserts the 6th attempt shows a lockout countdown UI. Without this, a UI regression that drops the lockout countdown display (e.g. by treating all non-200 responses as generic errors) would not be caught in CI.
- **Suggested test sketch (Playwright):**
  ```typescript
  test('login lockout shows countdown after threshold failures', async ({ page }) => {
    await page.goto('/');
    for (let i = 0; i < 5; i++) {
      await page.fill('[data-testid="pin-input"]', '999999');
      await page.click('[data-testid="login-btn"]');
      await page.waitForResponse(r => r.status() === 401);
    }
    // 6th attempt should trigger 429
    await page.fill('[data-testid="pin-input"]', '999999');
    await page.click('[data-testid="login-btn"]');
    await page.waitForResponse(r => r.status() === 429);
    // UI must show a lockout message with a countdown
    await expect(page.locator('[data-testid="lockout-countdown"]')).toBeVisible();
  });
  ```

---

## 5. D2-FALSE Findings (Closed Without Adequate Regression Test)

The following Day-2 findings are marked as **D2-FALSE** because the closing commit ships a test, but the test does not specifically catch the described regression vector and would not fail if the fix were reverted in a targeted way.

---

**D2-FALSE-1**

- **Severity:** Tier A (false completion)
- **Closed finding:** H-2 (F-08/F-09 — unauthenticated route access)
- **File:line:** `src/backend/tests/test_phase_audit_2026_04_29_h2_auth_gates.py`
- **Evidence:** The `h2_auth_gates` test file spot-checks a subset of routes for 401-without-token behaviour. However, the original F-08/F-09 finding enumerated specific route paths that were missing auth. The test does not have a mechanism to detect **new** routes added without auth — it only asserts that the specific set of routes tested in the file return 401. A developer who adds a new `/api/v1/something` route without `Depends(require_auth)` would not be caught by any existing test. The correct regression test would enumerate all FastAPI routes programmatically and assert each requires auth (excluding the known public whitelist: `/healthz`, `/readyz`, `/metrics`, `/auth/login/*`, `/auth/config`).
- **Suggested test sketch:**
  ```python
  def test_all_api_routes_require_auth_except_whitelist(unauth_client):
      PUBLIC_WHITELIST = {
          "/healthz", "/readyz", "/metrics",
          "/api/v1/auth/login/pin", "/api/v1/auth/login/rfid",
          "/api/v1/auth/config",
      }
      from main import create_app
      app = create_app()
      for route in app.routes:
          if not hasattr(route, "path") or route.path in PUBLIC_WHITELIST:
              continue
          if not route.path.startswith("/api/"):
              continue
          method = list(getattr(route, "methods", ["GET"]))[0]
          r = unauth_client.request(method, route.path.replace("{user_id}", "x"))
          assert r.status_code in (401, 403, 404, 405, 422), (
              f"Route {method} {route.path} returned {r.status_code} without auth "
              f"— missing Depends(require_auth)?"
          )
  ```

---

**D2-FALSE-2**

- **Severity:** Tier B (false completion)
- **Closed finding:** I-5 / D2-D-cpu (CPU sampler start/stop lifecycle)
- **File:line:** `src/backend/tests/test_phase_audit_2026_04_29_i5_cpu_sampler.py:37-45`
- **Evidence:** `test_start_then_stop_runs_cleanly` confirms start → stop works. But the sampler is started in the FastAPI lifespan (`main.py:268`) and stopped in the lifespan teardown (`main.py:426`). No integration test confirms that the sampler starts correctly when the FastAPI `lifespan` context manager runs via `TestClient(create_app())` and that the sampler is stopped cleanly on context manager exit. The unit test bypasses lifespan entirely; a breakage in the lifespan wiring (e.g. a misplaced `await`, an exception before `start()` is called) would not be caught by the existing unit tests.
- **Suggested test sketch:**
  ```python
  @pytest.mark.asyncio
  async def test_lifespan_starts_and_stops_cpu_sampler():
      import system_metrics_sampler as s
      from main import create_app
      from fastapi.testclient import TestClient
      s._reset_for_tests()
      assert s.is_running() is False
      app = create_app()
      with TestClient(app):
          # Inside the lifespan context, sampler must be running.
          # TestClient enters the lifespan on __enter__.
          assert s.is_running() is True, (
              "CPU sampler not started by lifespan"
          )
      # After TestClient exits, lifespan teardown must have stopped it.
      assert s.is_running() is False, (
          "CPU sampler not stopped by lifespan teardown"
      )
  ```

---

## 6. Summary Table

| ID | Severity | Module | What's missing |
|----|----------|--------|---------------|
| NEW-TEST-01 | Tier B | `ai/output_safety.py:98` | Boundary value at importance=0.85 (exact floor) and 0.849 (just below) |
| NEW-TEST-02 | Tier B | `ai/output_safety.py:178` | Multi-fact mixed redaction: one sensitive + one non-sensitive in same call |
| NEW-TEST-03 | Tier C | `ai/output_safety.py:145` | Empty session: `examined_facts == 0` assertion in result |
| NEW-TEST-04 | Tier C | `ai/output_safety.py:159` | `sanitize(None)` non-string guard — no raise, returns empty SanitiseResult |
| NEW-TEST-05 | Tier A | `security/login_lockout.py:65`, `api/routes_auth.py:193` | Cross-key independence: IP-locked but user not (and vice versa) |
| NEW-TEST-06 | Tier B | `security/login_lockout.py:126` | `reset_for_tests` full-wipe verification; idempotent-on-empty check |
| NEW-TEST-07 | Tier B | `security/login_lockout.py:94` | Old-timestamp sliding-window trim: stale failures outside window don't lock |
| NEW-TEST-08 | Tier C | `api/routes_auth.py:147` | RFID route lockout 429 integration test (PIN-only coverage currently) |
| NEW-TEST-09 | Tier B | `security/jwt_manager.py:108` | Refresh of legacy token (no `orig_iat`) succeeds and anchors iat correctly |
| NEW-TEST-10 | Tier C | `security/jwt_manager.py:125` | Refresh accepts grace-window token with fresh `orig_iat`, preserves it |
| NEW-TEST-11 | Tier B | `system_metrics_sampler.py:88` | Stop-then-start restart cycle: new event not stale from prior stop |
| NEW-TEST-12 | Tier B | `system_metrics_sampler.py:66` | psutil exception in sample loop: retains last cached value, does not crash |
| NEW-TEST-13 | Tier C | `system_metrics_sampler.py:118` | `_reset_for_tests` while running: orphaned task risk |
| NEW-TEST-14 | Tier B | `observability.py:135` | Extra field with reserved name cannot overwrite canonical `message`/`level` |
| NEW-TEST-15 | Tier C | `observability.py:176` | Unicode/Cyrillic message survives JSON round-trip without `\uXXXX` escape |
| NEW-TEST-16 | Tier C | `observability.py:179` | `install_json_logging` does not patch child-logger handlers (document limit) |
| NEW-TEST-17 | Tier B | Frontend `chatStore` | 429 LOCKED_OUT sets lockout-specific error, surfaces `Retry-After` |
| NEW-TEST-18 | Tier C | Frontend `MessageBubble` | `[REDACTED]` placeholder rendered verbatim, not filtered |
| NEW-TEST-19 | Tier C | Frontend E2E `smoke.spec.ts` | Login lockout countdown UI visible after 6th failed attempt |
| FLAKE-01 | Tier A | `conftest.py` | No autouse sampler reset: zombie asyncio tasks between test files |
| FLAKE-02 | Tier B | `conftest.py:113` | `asyncio.run()` in session fixture: RuntimeError swallowed, seed row may not exist |
| FLAKE-03 | Tier B | Chroma singleton | Parallel xdist workers: janitor test deletes collections read by memory tests |
| FLAKE-04 | Tier B | `test_l1_l4_security_hardening.py:322` | No assertion that pre-lockout 401s have no `Retry-After` header |
| D2-FALSE-1 | Tier A | `test_h2_auth_gates.py` | No programmatic route scan — new unauthed route silently escapes |
| D2-FALSE-2 | Tier B | `test_i5_cpu_sampler.py` | No lifespan-integrated sampler start/stop test — wiring break undetected |

**Prioritised remediation order:** FLAKE-01 (conftest autouse) → D2-FALSE-1 (route scan) → NEW-TEST-05 (cross-key lockout) → NEW-TEST-01 (importance boundary) → NEW-TEST-02 (multi-fact) → NEW-TEST-07 (sliding-window trim) → NEW-TEST-09 (legacy JWT refresh) → NEW-TEST-11 (sampler restart) → NEW-TEST-12 (sampler exception) → NEW-TEST-14 (JsonFormatter canonical field guard) → NEW-TEST-17 (frontend 429) → remaining Tier C items.
