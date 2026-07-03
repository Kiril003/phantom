# PHANTOM OS — Day-3 Audit, 2026-04-30 — Code-Quality + Commit-Parity

Agent **N-cq**. Perspective: code quality + commit-msg-vs-code parity. Read-only research at HEAD `d3ca9a6`, baseline `c3602c8`, walking commits `fdb28f7..0e18f8c` plus the capstone `c3602c8`.

The Day-2 closure cleaned up almost all of the false-completion class that wrecked Day-1 — the F-08 / F-09 auth gate is now real, F-25 actually surfaces engine_error, the H-5 dispatcher consolidation removes the duplicate handler set, and the Tier C input-hardening helpers landed in `tool_executor` rather than just in the (now-thin) dispatcher.

That said, there are **two confirmed Tier-A false-completions** (a stale version string the commit ledger glosses over, and an L-3 lockout invariant the commit message claims but the route does not enforce) plus a tighter cluster of Tier-B/D/E findings around the I-7 output-safety stub, the H-5 db-parameter wart, the L-3 IP-spoofability via the missing XFF guard, and the H-1 conftest seed leakage.

Total: 14 findings.

---

## D2-FALSE-1 — `_VERSION` constant still says `0.18.0-saas-base` after the v0.18.1 re-tag

**Severity:** Tier A (false-completion)

**Cite:** `src/backend/observability.py:38` (`_VERSION: str = "0.18.0-saas-base"`); also surfaces at `src/backend/observability.py:325` (`phantom_build_info{version=...}`) and at `src/backend/observability.py:399` (`/healthz` JSON `version` field).

**Evidence:** The capstone commit message `c3602c8` (`phase-18.1-acceptance: Day-2 capstone`) and the Tier-A rollup in `docs/audit-2026-04-29-day2/FINDINGS.md:24` both say "**Re-tag v0.18.1-saas-base**" after Tier A lands. Eleven commits later, `_VERSION` is still `0.18.0-saas-base`. This is the one string that:

* renders into `phantom_build_info{version="..."} 1` (`observability.py:325`) — the canonical timeseries dashboards key on,
* is the body of `/healthz` (`observability.py:399`),
* is the only programmatic anchor between a deployed binary and the audit tier-rollup story.

`README.md:53` still reads "What ships in v0.18.0-saas-base" — same drift, same root cause: nothing in the Tier-A / Tier-C / Tier-E commits bumped the version string when the work that *justified* the re-tag landed.

**Why-it's-wrong:** A productisation push that announces a re-tag in the capstone message but doesn't bump the in-binary version constant means `/healthz` and Prometheus continue reporting `0.18.0` — i.e. the version with the LAN-takeover surface (F-08, F-09, F-25) the audit explicitly called "shipping a vulnerability". An operator looking at `phantom_build_info` cannot distinguish a daemon at the audited-bad commit from a daemon at the audited-good commit. The dashboards lie.

**Recommended fix sketch:** Bump `_VERSION` to `"0.18.1-saas-base"` in the same commit that creates the git tag. Add a CI check that `_VERSION` matches the tag at build time so future re-tags can't drift again. Update `README.md:53` and `README.md:83` in lockstep.

---

## D2-FALSE-2 — L-3 commit message says `/refresh` is in the lockout chain; the route does not call `register_failure`

**Severity:** Tier A (false-completion)

**Cite:** `src/backend/api/routes_auth.py:222-262` (`/refresh` route); compare to `routes_auth.py:147-219` (PIN/RFID routes that DO call `register_failure`).

**Evidence:** Commit `54fe727` ("tier-E L-1+L-2+L-3+L-4: auth boundary hardening") L-3 description: "*per-IP + per-username lockout … `routes_auth /login/pin and /login/rfid` consult both the IP key … and username key … so neither IP-rotation nor username-spray bypasses.*" The companion text in `docs/audit-2026-04-29-day2/FINDINGS.md:111` describes F-15 as "*per-IP + per-username lockout via in-memory `dict[str, deque]`*", scoped to *the unauthenticated login boundary*. So far so good for `/login/pin` and `/login/rfid`.

But `/api/v1/auth/refresh` is also unauthenticated (`routes_auth.py:228-232` says "*Does NOT require a valid (non-expired) token — this is intentional so the client can silently refresh shortly after expiry*"), and it accepts a token from header / query / cookie (`routes_auth.py:237-242`). The handler at `routes_auth.py:249-256` calls `jwt_refresh(raw)` — which on invalid input raises `JWTError` and the route returns 401 — but **nowhere does it consult or update `login_lockout`**. An attacker who holds nothing more than a leaked-once token can hammer `/refresh` with mutated copies (last-byte fuzz, signature swap) at the network's max RPS. Each invalid attempt returns 401 instantly with no lockout, no rate-limit, no Retry-After.

The `/refresh` route is **the third unauthenticated auth endpoint** and the L-3 fix forgot it.

**Why-it's-wrong:** F-15 was scoped as "the unauthenticated `/api/v1/auth/login` endpoints", but the productisation tag advertises lockout protection on the auth boundary as a whole. `/refresh` is in that boundary. The lockout is bypassable: the audit's success criterion ("*neither IP-rotation NOR username-spray bypass*") is silently false because the `/refresh` route is exempt.

**Recommended fix sketch:** Add `register_failure(ip_key)` on every `JWTError` path in `/refresh`, plus the `is_locked(ip_key) → 429` short-circuit at the top. Probably also `register_success` on a clean refresh so legitimate clients don't accumulate failure rows. Add a dedicated test asserting 6 bogus tokens to `/refresh` from one IP returns 429 on the 6th.

---

## NEW-CQ-01 — Output-safety classifier exists but has zero production callers

**Severity:** Tier B (architecture / coupling)

**Cite:** `src/backend/ai/output_safety.py:145-213` (`sanitize`); production import sites: zero outside `tests/`.

**Evidence:** `grep -rn "output_safety\|sanitize" src/backend` (run during this audit) returns 14 lines: 5 inside `output_safety.py` itself, 9 inside `tests/test_phase_audit_2026_04_29_i7_output_safety.py`. No call site in `routes_chat.py`, no call site in `chat_tool_dispatcher.py`, no call site in `_build_ai_response`. Commit `b385749` (I-7) docstring at `output_safety.py:22-27` correctly describes the wiring as future ("*Phase 17b's call_with_tools wiring will call `sanitize` exactly once per turn*"), but the Day-2 audit summary in `FINDINGS.md:68` and the capstone "Tier C closes 13 chat-tool security items" claim **`D2-I1` is closed**.

A library that no production path imports is not a closed finding. It is a stub on a shelf. The closure is *Phase 17b enables `chat_tools_enabled=True` AND `_build_ai_response` calls `sanitize` between LLM and `_broadcast_message_stream`*. Neither half exists yet.

**Why-it's-wrong:** The audit says "*Output classifier on the final assistant message before TTS / chat broadcast*" (FINDINGS.md:68). What shipped is "*Output classifier function that nobody calls*". When Phase 17b lands, whoever wires it has to remember to call `sanitize` — that's the kind of cross-phase invariant that gets lost. The fix as shipped does not actually defend against the F-11 chain; it ships the mitigation library.

**Recommended fix sketch:** Either (a) flip the closure status of `D2-I1` to "library landed; call site deferred to Phase 17b" in the day-3 ledger, (b) wire `sanitize` into `routes_chat._build_ai_response` *now* even before Phase 17b — the function is a no-op when no sensitive facts exist, so it costs ~one SQL query per chat turn against a SELECT-by-user-id index on a ≤200-row LIMIT, or (c) add a Phase 17b pre-flight test that asserts `sanitize` is on the call path.

---

## NEW-CQ-02 — `chat_tool_dispatcher.dispatch` accepts a `db: AsyncSession` parameter that the post-H-5 implementation never uses

**Severity:** Tier E (ops / maintainability)

**Cite:** `src/backend/ai/chat_tool_dispatcher.py:81-87` (`dispatch` signature with `db: AsyncSession`); `chat_tool_dispatcher.py:64-72` (`_make_delegate` accepts `db` then drops it via `# noqa: ARG001`).

**Evidence:** Pre-H-5 each handler ran the SQL itself against the request-scoped `db`. H-5 collapsed handlers onto `tool_executor.execute_tool` which opens its own session via `_session_factory()` (commented at `chat_tool_dispatcher.py:65-68`: "*passing the live request session would deadlock SQLite under concurrent writes*"). The `db` parameter is now structural dead weight in the public API.

The audit copy-paste tax this leaves:

* `chat_tool_dispatcher.py:64` requires the `db` keyword on the delegate, which only exists to satisfy the dispatcher's signature.
* `chat_tool_dispatcher.py:117` passes `db=db` into the handler that then ignores it.
* `# noqa: ARG001` (line 64) papers over the static-analysis hit.
* Future Phase 17b callers will have to plumb a request-scoped session through `chat_pipeline.run` → `dispatch` for no reason.

This is the kind of API parameter that exists "because it was there before" and confuses every reader who sees it. The H-5 commit message says "*the consolidation switched the consolidated tool_executor path to interval=None*" but does not mention the now-vestigial `db` arg.

**Why-it's-wrong:** Public API parameters ought to mean something. A required `db` parameter that the implementation explicitly disclaims and silences signals to a reader either "you must be missing something" or "this code is wrong". The right H-5 follow-up was to drop `db` from `dispatch`'s signature.

**Recommended fix sketch:** Drop `db: AsyncSession` from `dispatch(...)` and from `_make_delegate`'s `_h(...)`. Update the audit Phase 17b checklist (`docs/phases/PHASE_17_CHAT_TOOLS.md`) so the `chat_pipeline` doesn't carry the `db` through. Update tests if they pass `db=`. Five-line cleanup but it stops the next reader from spending five minutes wondering why.

---

## NEW-CQ-03 — `routes_auth._ip_key` ignores `X-Forwarded-For` even though `routes_auth.py:118` advertises trust-XFF support

**Severity:** Tier C (security)

**Cite:** `src/backend/api/routes_auth.py:122-126` (`_ip_key`); commit `54fe727` claims "*The IP key uses the X-Forwarded-For-aware `request.client.host` fallback chain; behind a trusted reverse proxy the operator sets `security_trust_xff` (existing config knob) so the right value lands here*" (commit message body).

**Evidence:** The `_ip_key` implementation:

```python
def _ip_key(request: Request) -> str:
    client = request.client
    if client and client.host:
        return f"ip:{client.host}"
    return "ip:unknown"
```

That is **not** XFF-aware. `request.client.host` is whatever Starlette resolved from the immediate TCP peer — i.e. the reverse proxy's IP, not the client's. The "(existing config knob) `security_trust_xff`" referenced in both the commit message and `routes_auth.py:118` does not exist anywhere in the backend: `grep -rn "security_trust_xff\|trust_xff" src/backend/ --include="*.py"` returns exactly one hit — the comment at `routes_auth.py:118` itself.

So in any reverse-proxy / cloud / docker-compose deployment (the audit's stated target — see `0e18f8c` re Docker hardening, and `docs/OPERATIONS.md`), every login attempt from every client lands under one IP key (the proxy's), and either:

* the lockout fires after 5 attacks across all users from any client and bricks the front door (DoS-on-self), or
* the operator raises the threshold and effectively disables the lockout.

**Why-it's-wrong:** The L-3 commit message describes a security control ("the right value lands here") that the code does not implement. The `_ip_key` function silently honours the proxy IP. If the operator believes the commit message they will deploy thinking F-15 is closed for a multi-tenant proxy edge — it is not. The deployment shape that triggers F-15 most strongly (cloud / Docker-compose with a reverse proxy) is the deployment shape the lockout doesn't cover.

**Recommended fix sketch:** Either (a) add `security_trust_xff: bool = False` to `config.py` and have `_ip_key` consult `request.headers.get("x-forwarded-for")`'s leftmost token when the flag is set, or (b) drop the misleading comment at `routes_auth.py:118` and the corresponding sentence in `54fe727`'s commit message. Today's code is the (b) reality but the message claims (a).

---

## NEW-CQ-04 — `output_safety.sanitize` runs an unbounded SELECT-200 per chat turn but the cap is comment-only

**Severity:** Tier D (correctness)

**Cite:** `src/backend/ai/output_safety.py:227-233` (`_load_user_sensitive_facts`); also `output_safety.py:178-203` (linear scan with regex compile per fact).

**Evidence:** The cap is:

```python
.order_by(MemoryFact.importance.desc(), MemoryFact.created_at.desc())
.limit(200)
```

For a heavy user with 200 sensitive facts and a single AI response of, say, 2 KB, the `for fact in rows` loop at `output_safety.py:178-203`:

1. compiles a fresh `re.Pattern` per fact (`_build_match_pattern` at `output_safety.py:237-254` — `re.compile` per call, no cache),
2. runs `pattern.subn` over the whole response per fact,
3. re-normalises the *whole* response on every redaction (`norm_text = _normalise(sanitised)`, `output_safety.py:196`).

The audit's docstring at `output_safety.py:222-226` waves at this cap as "*caps at 200 rows to bound the cost on heavy users*", but the limit is a magic literal embedded in a private helper, not exposed as `config.chat_output_safety_max_facts` or similar. The same magic-literal-disguised-as-policy applies to `_MIN_FACT_TOKENS = 3` (`output_safety.py:75`) and `_IMPORTANCE_FLOOR_FOR_SENSITIVE = 0.85` (`output_safety.py:69`).

**Why-it's-wrong:** A chat-output classifier that reads up to 200 rows + compiles up to 200 regexes + runs up to 200 substring sweeps per chat turn is not free. With Phase 17b's per-turn budget at 12 s (PERF-17b cap from `f92aaad`), the I-7 step is a non-trivial fraction of that. The thresholds are policy decisions that operators of multi-tenant deploys will want to tune, but they are buried as private module constants. There is no metric exported for "redactions per turn" or "facts examined" so the operator has no observable feedback on whether the classifier is firing.

**Recommended fix sketch:** Lift the three constants into `config.py` (`chat_output_safety_max_facts`, `chat_output_safety_min_tokens`, `chat_output_safety_importance_floor`). Cache the compiled regex in `MemoryFact.id`-keyed LRU at module scope. Add a `phantom_chat_output_redactions_total{user=…}` counter. Add a `phantom_chat_output_examined_facts` histogram or gauge.

---

## NEW-CQ-05 — `tool_executor._args_snippet` and `chat_tool_dispatcher._summarise_result` overlap; both stamp truncated args/results

**Severity:** Tier E (ops / maintainability)

**Cite:** `src/backend/ai/tool_executor.py:717-732` (`_args_snippet`, max_len=200); `src/backend/ai/chat_tool_dispatcher.py:184-203` (`_summarise_result`, capped at 160 chars); `chat_tool_dispatcher.py:226-227` re-encodes `args_json = json.dumps(args or {}, …)` and `tool_use_audit.py:66` truncates `tool_args_json` to 1000 chars.

**Evidence:** Three layers each stamp a truncated representation of the same arg payload:

1. `tool_executor` logs `_args_snippet(args)` (200-char), once on invoke,
2. `chat_tool_dispatcher` writes `tool_args_json` (1000-char truncated by `tool_use_audit.write_log` at line 66) and `tool_result_summary` (200-char truncated by line 67) to the DB,
3. The route logs are independent of both.

`tool_executor`'s log line at `tool_executor.py:758-760` and the dispatcher's audit row at `chat_tool_dispatcher.py:240-254` carry essentially the same information shaped differently. There is no single canonical "what did the LLM ask, what did it get" representation; an operator chasing a bug has to correlate the journal log line, the SQL audit row, and (when chat-prompt-logging is on) the prompt-excerpt log row. Three sources of partial truth.

**Why-it's-wrong:** When the I-1+I-2+I-3 commit (`4f5ee38`) added `_safe_int` / `_safe_query_str` to `tool_executor` it also implicitly orphaned the slightly different shape `chat_tool_dispatcher` had used in its own `_clamp_int` / `_trim_str`. H-5 deleted those — good. But the two truncation conventions (200 vs 1000) and the two logging styles still co-exist, and the audit does not name the canonical one. The next operator chasing "what did the model do" gets to choose between three sources.

**Recommended fix sketch:** Pick one truncation convention (1000 chars on the DB row makes sense; 200 on the log line is fine because operators grep). Have `tool_executor.execute_tool` populate the DB audit row directly via `tool_use_audit.write_log`, so `chat_tool_dispatcher` is no longer the only path that produces a row. Today the call_with_tools production path (used by `gemini_provider`) skips the audit row entirely on tool dispatch — only the `chat_tool_dispatcher` shim writes one. That is the inverse of what the commit ledger implies (D2-R3 says "chat-tool rows always carry user_id", which is true, but the agent / call_with_tools path writes no per-tool row at all).

---

## NEW-CQ-06 — `system_metrics_sampler` global state has no asyncio lock; `start()` race causes "task started twice" under reload

**Severity:** Tier D (correctness)

**Cite:** `src/backend/system_metrics_sampler.py:88-98` (`start`); module-level globals at `system_metrics_sampler.py:34-36`.

**Evidence:** `start()` does:

```python
if is_running():
    return
_stop_event = asyncio.Event()
_sampler_task = asyncio.create_task(...)
```

`is_running()` checks `_sampler_task is not None and not _sampler_task.done()`. Between the check and the assignment there is no lock. Under uvicorn's `--reload` flow the lifespan can exit and re-enter on the same event loop in tight succession, and `main.py:268` awaits `system_metrics_sampler.start()` from inside the lifespan body — a single task, but the *graceful shutdown path at lines 423-428* does:

```python
import system_metrics_sampler
await system_metrics_sampler.stop()
```

`stop()` does `await asyncio.wait_for(task, timeout=2.0)` (line 109). If the wait times out it falls into `task.cancel()` (line 111) but does *not* await the cancelled task before clearing `_sampler_task = None`. If the cancel happens to land on the wait-for of the stop_event (line 76-78), the next `start()` call after a fast reload will see `_sampler_task = None` and create a new task, but the previous one's stop-event might still flip an old reference held inside `_sample_loop`'s closure. There's no test for this — `test_phase_audit_2026_04_29_i5_cpu_sampler.py` only covers cold-start idempotency.

**Why-it's-wrong:** Process-global mutable singletons across asyncio lifespans without an explicit lock are a footgun under uvicorn reload, signal-driven shutdown, or testing harnesses that re-invoke lifespan. The post-cancel `task.cancel()` without `await` (line 111) leaves a possibly-still-running coroutine; if it does survive, subsequent `start()` succeeds (no error) and now there are two samplers writing to the same `_cached_cpu_pct` global.

**Recommended fix sketch:** Add an `asyncio.Lock()` for `start`/`stop`. After `task.cancel()` (line 111), `await asyncio.gather(task, return_exceptions=True)` so the stop is observable. Have `_sample_loop` capture `_stop_event` from the closure at construction time, not from the module global, so a new sampler can never accidentally be steered by an old event.

---

## NEW-CQ-07 — `routes_voice.STTResponse` model in commit message claims "engine_error: str | None" is added; the field IS added but it never carries through `transcribe_blob`

**Severity:** Tier D (correctness)

**Cite:** `src/backend/api/routes_voice.py:49-60` (Pydantic model); `routes_voice.py:101-133` (the route's flow); `src/backend/voice/whisper_npu_provider.py:381-387` (where it's set); `src/backend/voice/mms_npu_provider.py:288-296` (same).

**Evidence:** `STTResponse` declares `engine_error: str | None = None`. The route at `routes_voice.py:102` calls `result = await transcribe_blob(raw, config.voice_stt_language)`. Then at `routes_voice.py:125`, `if result.engine_error: ... raise HTTPException(503, ...)`.

For this to work, `transcribe_blob` (in `voice/pipeline.py`, not read here) must propagate the `engine_error` field from the inner `STTResult` (defined in `voice/stt_engine.py`, again not read here). The H-3 commit `b2d2d39` does NOT include `voice/pipeline.py` or `voice/stt_engine.py` in its `--stat` output — only `routes_voice.py`, `main.py`, `whisper_npu_provider.py`, `mms_npu_provider.py` and the new test. A grep on `engine_error` in this audit's tooling earlier showed the field is set in two providers and read in one route. The connecting middle layer (`stt_engine.STTResult`) was either pre-existing or the commit silently relies on a hot-path attribute access.

If `STTResult` does not have an `engine_error` field at all (a `dataclass` with `__slots__` for example), `result.engine_error` at `routes_voice.py:125` raises AttributeError instead of returning None, *and the test at `tests/test_phase_audit_2026_04_29_h3_h4.py` may pass* because it likely instantiates the response directly rather than walking the pipeline.

This is the same shape of bug as the original D2-A3 "F-25 half-wired" — the middle layer was not patched, the field lives at the endpoints.

**Why-it's-wrong:** Without reading `voice/stt_engine.py` and `voice/pipeline.py` end-to-end I cannot prove the chain is broken — the test passing is some evidence. But the H-3 stat does NOT show those files modified, which is suspicious for a fix that has to *bridge* provider → pipeline → route. Either the chain is unbroken because `STTResult` already had the field (commit message should have said so explicitly), or the provider's `engine_error` is silently dropped by `transcribe_blob` and the route's check is moot. A read of `voice/stt_engine.py` and `voice/pipeline.py` is required to disambiguate.

**Recommended fix sketch:** Day-3 work should explicitly trace the field through `voice/stt_engine.STTResult.__init__` and `voice/pipeline.transcribe_blob`. Add an integration test that monkeypatches the provider to return `engine_error="x"` and asserts the route returns 503. The unit tests in `test_phase_audit_2026_04_29_h3_h4.py` per the H-3 commit message construct an STT response with engine_error directly — they verify the route's behaviour but do NOT verify the provider→pipeline→route plumbing.

---

## NEW-CQ-08 — `_get_calendar_events` and `_tool_create_calendar_event` exposed via `tool_executor._HANDLERS` in production path but listed in commit `910ffbc` (I-8) as deferred

**Severity:** Tier B (architecture / coupling)

**Cite:** `src/backend/ai/tool_executor.py:705-714` (`_HANDLERS` registers all 8 tools including `get_calendar_events` and `create_calendar_event`); `src/backend/ai/chat_tool_dispatcher.py:46-52` (`_CHAT_SAFE_TOOL_NAMES` lists only 5); commit `910ffbc` claim: "*Names beyond chat_tool_dispatcher._CHAT_SAFE_TOOL_NAMES (search_web, create_calendar_event, get_calendar_events) are deferred behind per-tool security work*".

**Evidence:** The production path is **not** the chat dispatcher — it's `gemini_provider.call_with_tools` calling `tool_executor.execute_tool` directly (verified: `gemini_provider.py:14` imports `MAX_TOOL_CALLS_PER_TURN, execute_tool`). That import path bypasses the `_CHAT_SAFE_TOOL_NAMES` filter. Any agent task or proactive-loop turn that goes through `call_with_tools` can reach `create_calendar_event` (the mutating tool D2-E1 explicitly says must NOT ship until the per-tool consent flow, mutating-tool risk gate, and unconditional audit row are in place).

The commit `910ffbc` claims the deferral is documented. The doc says "Phase 17b ships only the 5 read-only tools" — true for chat. But `create_calendar_event` is already shippable through the agent path because tool_executor's `_HANDLERS` registers it. The audit's Tier-A "consolidation" (H-5) merged the chat dispatcher into the broader catalog, but the new shared catalog includes mutating tools the chat catalog rightly excluded.

**Why-it's-wrong:** D2-E1 says "create_calendar_event MUST NOT ship until per-tool consent flow + risk gate + always-write audit row". Those three guards do not exist in `tool_executor._tool_create_calendar_event` (`tool_executor.py:654-699`). The function commits the row, returns ok, no consent prompt, no risk-class assertion. It IS reachable from the agent path. The Day-2 closure says "deferred"; the code says "live, registered, no guards".

**Recommended fix sketch:** Either (a) split `_HANDLERS` into `READ_ONLY_HANDLERS` and `MUTATING_HANDLERS`, with `execute_tool` taking a `mode: Literal["read_only", "agent"]` so chat / read-only paths can't accidentally surface mutators, or (b) add the per-tool consent / risk / audit guards inline in `_tool_create_calendar_event` so it's safe to be in `_HANDLERS`. The doc-only deferral in `910ffbc` is the weakest of the three options because nothing in the code enforces it.

---

## NEW-CQ-09 — `output_safety._build_match_pattern` regex escape skips facts whose normalised content contains regex metacharacters at length 4-5

**Severity:** Tier F (minor latent)

**Cite:** `src/backend/ai/output_safety.py:237-254`.

**Evidence:** The function rejects content shorter than 4 chars (line 243), then `re.escape`s each whitespace-split token. For a fact whose content is `"AAAA"` (4 chars, no whitespace), the rebuilt pattern is `\A\A\A\A` (re.escape on each char), which is fine. For a fact whose content is `"A B"` (3 chars, with space), the function rejects at the 4-char gate. For a fact `"A  B"` (4 chars including whitespace), the split yields `["A", "B"]`, and the pattern is `A\s+B` — note `\s+` requires AT LEAST one whitespace, so `"A B"` (single space) matches. So far OK.

But for a fact whose content is `"AB"` (2 chars), the function returns None at line 244, never matching even when the response verbatim contains `"AB"`. For content `"ABC"` (3 chars) same. The threshold is conservative — but an attacker who knows the rule can pick **3-char sensitive substrings** (a 3-letter password fragment, "PIN", "CVV", a date prefix) and the classifier will not catch a verbatim quote. Combined with the `_MIN_FACT_TOKENS = 3` gate at line 180, any sensitive fact whose content is ≤ 2 tokens (`"PIN: 1234"`) is silently exempt.

**Why-it's-wrong:** The defence-in-depth layer has documented bypasses. This is fine for an audit's "v1 — richer ML in a later phase" framing as long as the bypasses are explicit. The `_build_match_pattern` rejection at `< 4` chars is a comment-only policy (line 240-241: "Returns None when the content is too short to risk a regex sweep") — but the consequence is "any 3-letter PIN fact is unredactable". That risk surface is not surfaced in the I-7 commit message or the `D2-I1` row.

**Recommended fix sketch:** Document the 4-char minimum in the I-7 commit / FINDINGS row as a known exemption. Or: replace the `< 4` gate with a `< _MIN_FACT_TOKENS` gate plus a stop-list of dangerous 3-char tokens (`"PIN"`, `"SSN"`, `"CVV"`). Add a test asserting that a fact with content `"PIN 1234"` is redacted from a response that contains `"PIN 1234"`.

---

## NEW-CQ-10 — `conftest._ensure_seed_phantom_user` recreates the bootstrap user mid-session, defeating the F-7 default-PIN refusal test

**Severity:** Tier D (correctness)

**Cite:** `src/backend/tests/conftest.py:85-121` (`_ensure_seed_phantom_user`); `src/backend/security/auth.py:96-120` (`get_auto_login_user` with F-7 refusal).

**Evidence:** The `_ensure_seed_phantom_user` fixture is `scope="session", autouse=True` and runs `init_db` + creates `phantom`/`hash_secret("000000")` if missing. It runs *once per session*. Per the F-7 logic, the next `get_auto_login_user` call against this DB (only one user, ROOT, default PIN) returns None — refusing auto-login.

That is the desired F-7 behaviour. **But** the conftest fixture creates the same row that triggers F-7's refusal as a precondition. If a test in the session calls something that invokes `ensure_default_user` and expects a clean `{users: 1, ROOT, default-PIN}` shape, the F-7 logic intentionally hides that user. Two side-effects fight:

1. `_ensure_seed_phantom_user` insists the row exists.
2. `get_auto_login_user` insists the row not be auto-promoted.

The L-1 test file (`test_phase_audit_2026_04_29_l1_l4_security_hardening.py`, mentioned in the L-1+L-4 commit body) presumably uses a `FakeDb` to side-step this. But any other test that exercises the auth boundary against the real DB now picks up a `phantom`/`000000` row whose presence the F-1 logic forbids being auto-logged-in. The conftest fixture leaks a shape the production code intentionally rejects.

Worse: a test that runs in a process whose `JWT_SECRET_KEY` was pinned via the conftest's `setdefault` (line 47-50) has a deterministic phantom row that is auto-login-refused but PIN-loginable. So tests that expect "log in with phantom/000000" pass; tests that expect "auto-login as phantom" fail because of F-7's refusal. No test in the L-1 set exercises the contradiction.

**Why-it's-wrong:** The L-1 fix is correct: refuse auto-login for `phantom`/`000000`. The conftest fixture is also correct in isolation: pre-existing tests rely on the row. But together they create a shared test-DB state where the auto-login path is permanently broken in tests, which means that any future regression that re-allows auto-login on default PIN passes the test suite trivially because no test exercises auto-login on the seeded user.

**Recommended fix sketch:** Add a `function`-scoped variant `auth_default_user_fixture` that creates the row, runs the F-1 assertion (auto-login refused), rotates the PIN, asserts auto-login now succeeds, then deletes the user. This pins the F-1 invariant against the realistic shape rather than against `FakeDb`.

---

## NEW-CQ-11 — `extract_and_store_facts` re-uses the SQL `db` parameter that the commit body says it cannot deadlock around — but the route at `routes_chat.py:330` passes `db` directly into the helper

**Severity:** Tier D (correctness)

**Cite:** `src/backend/api/routes_chat.py:329-337` (call site); `src/backend/memory/strategic_memory.py:467-503` (`extract_and_store_facts`); `src/backend/memory/tactical_memory.store_fact` (not read but called from line 493).

**Evidence:** The chat path's `_build_ai_response` (called from `routes_chat.py:471`) is run inside the request's session: `db: AsyncSession` is the live request session passed in. `extract_and_store_facts` at `memory/strategic_memory.py:467` accepts `db: Any` and passes it through to `tactical_store(db=db, …)` (line 493). The same chat handler at `routes_chat.py:402` says (commented at lines 398-402): "*commit the user-message write now so SQLite drops the write lock BEFORE we call ai_router.generate()*", and again at line 466: "*final commit before handing off to generate(). Any writes queued by the pre-generate steps … must settle before tool-executor handlers try to open their own sessions, or SQLite single-writer deadlocks*".

The H-5 commit explicitly says (chat_tool_dispatcher.py:65-68): "*passing the live request session would deadlock SQLite under concurrent writes*". Yet `extract_and_store_facts` runs through the live request `db` after the AI response has been received. If the AI dispatch path (now via `tool_executor`) opened its own session via `_session_factory()` and committed in there, then `extract_and_store_facts` runs immediately after on the original `db`, which still has open writes pending (the assistant message at line 511 has been added to the session but not committed — the final commit is implicit at `db.flush()` line 515 + the FastAPI dependency teardown).

This is a one-test-burst-away race. The current code happens to work because the tool dispatch goes through a separate session and `extract_and_store_facts` is awaited *before* the assistant_msg is added to `db`. But the call ordering at lines 329-337 (still inside `_build_ai_response`) and lines 511 (`db.add(assistant_msg)`) puts the fact-extraction in a fragile spot.

**Why-it's-wrong:** The chat handler treats SQLite deadlocks with explicit `db.commit()` lines (402, 466) and a long comment about why they are necessary. The `extract_and_store_facts` call inside `_build_ai_response` does NOT commit before or after — it relies on the session being unlocked because nothing has been added since the last commit at line 466. If a future patch adds a `db.add(...)` before the fact-extraction call, the deadlock that the H-5 commit warned about resurfaces. The contract is implicit; nothing enforces it.

**Recommended fix sketch:** Either (a) move `extract_and_store_facts` to its own session via `get_session() as db2` so the live request session is irrelevant, or (b) commit the live `db` immediately before the call and immediately after, so the lock-window invariant is enforced rather than relied-on.

---

## NEW-CQ-12 — `chat_tool_dispatcher._summarise_result` has different success contract than `tool_executor.execute_tool`'s contract

**Severity:** Tier F (minor latent)

**Cite:** `src/backend/ai/chat_tool_dispatcher.py:184-203` (success returns "ok rows=N" or "ok"); `src/backend/ai/tool_executor.py:735-781` (`execute_tool` returns `{ok, ...}` envelope OR `{error, error_kind}` envelope, never both).

**Evidence:** The dispatcher's `_summarise_result` reads `out.get("result")` (line 193), expecting the chat-side envelope `{"ok": True, "name": ..., "result": {...}, "elapsed_ms": ...}` shape. Then it walks `result["count"]` then `result["results"]`. For tools that return only `{"ok": True, "summary": ..., "sources": [...]}` (`tool_executor._tool_search_web` returns this — see lines 459: `_ok(summary=summary, sources=sources, grounded=grounded)`), neither `count` nor `results` exists — the summary lands as `"ok"` even though there's a 5-source result list right there.

For `_tool_get_system_metrics` (returns `cpu_pct, ram_used_mb, ...` — no count, no results), the summary is just `"ok"`. For `_tool_get_sensor_status` (returns `radar={...}, camera={...}, ...`), same: just `"ok"`.

So three of the five chat-safe tools produce uninformative `"ok"` audit rows. Only `search_locationhistory`, `query_temporal_anchors`, and `recall_memory_facts` populate the row count.

**Why-it's-wrong:** The D2-R1 commit message describes `tool_result_summary` as "*operator-readable verdict*". For three of five chat tools the verdict is the same string regardless of what came back. An operator dashboard scoped on `tool_result_summary` cannot distinguish a `get_sensor_status` that returned a full snapshot from one that returned `{}`. The audit row is structurally honest (`ok=True`, `tool_args_json` populated, `elapsed_ms` real), but the human-readable column is a degenerate constant.

**Recommended fix sketch:** Either (a) make `_summarise_result` look at more keys (`summary`, `radar`, `cpu_pct`, etc.) and produce a richer verdict, or (b) drop the column from the schema and lean entirely on `tool_args_json` + `error_message`. Option (a) is the smaller diff.

---

## NEW-CQ-13 — `init_chroma_eager` returns `{"ok": False, ...}` on failure but caller at `main.py:251` checks `chroma_init.get("ok") is False`, missing successful path's missing-`ok` shape

**Severity:** Tier F (minor latent)

**Cite:** `src/backend/main.py:248-260` (lifespan caller); `src/backend/memory/strategic_memory.py:55-68` (`init_chroma_eager`).

**Evidence:** Successful return shape:

```python
return {"collections": int, "elapsed_ms": int}
```

No `ok` key. Failure return shape:

```python
return {"ok": False, "error": "..."}
```

Caller at `main.py:251`: `if chroma_init.get("ok") is False:` — fires only on explicit `ok=False`, then the else branch at `main.py:253` runs the success log line. For a successful return, `chroma_init.get("ok")` is `None`, which is `not False`, so we fall through to the success path — that works. But the API contract is asymmetric: success doesn't carry an `ok` flag, failure does. Standard practice elsewhere in the codebase (see `tool_executor._ok` at line 56-58) is `{"ok": True, ...}` on success. The `init_chroma_eager` function ignores that convention.

The `main.py:251` check `is False` is correct given the asymmetric contract, but a future refactor that adds `if chroma_init.get("ok"):` would silently break (truthy on success because `collections` may be > 0, which doesn't matter — we'd be testing the wrong key).

**Why-it's-wrong:** Inconsistent envelope. The fix-side helper docstring at `strategic_memory.py:46-52` even says "*Returns `{"collections": int, "elapsed_ms": int}`*" without an `ok` key, then below documents the failure path as `{"ok": False, "error": …}`. Two different shapes from one function.

**Recommended fix sketch:** Make success also carry `"ok": True`. Caller checks `if not chroma_init["ok"]`. One-line fix.

---

## NEW-CQ-14 — `chroma_janitor.py` shells `safe_id = re.sub(...)[:32]` but `_collection_name` shells `safe_id = re.sub(r"[^a-zA-Z0-9_-]", "", user_id)[:32]` — same regex, two definitions, one drift hazard

**Severity:** Tier E (ops / maintainability)

**Cite:** `scripts/chroma_janitor.py:42-49` (`_safe_id` + `_SAFE_ID_RE`); `src/backend/memory/strategic_memory.py:244-247` (`_collection_name`).

**Evidence:** The janitor's `_safe_id`:

```python
_SAFE_ID_RE = re.compile(r"[^a-zA-Z0-9_-]")
def _safe_id(user_id: str) -> str:
    return _SAFE_ID_RE.sub("", user_id)[:32]
```

The strategic_memory's `_collection_name`:

```python
def _collection_name(user_id: str) -> str:
    safe_id = re.sub(r"[^a-zA-Z0-9_-]", "", user_id)[:32]
    return f"user_{safe_id}"
```

Same regex, same truncation, two implementations. The janitor's docstring at line 47-48 explicitly admits "*Mirror of `memory.strategic_memory._collection_name`'s suffix derivation. Kept identical so the suffix-vs-user comparison in the janitor is exact*."

The `H-6` commit body acknowledges this risk implicitly ("*Forward-compat: ignores non-UUID dirs*") but does not export `_safe_id` from `strategic_memory` for shared consumption. The next time `_collection_name` changes — e.g. to drop the 32-char limit, switch to base64, add a tenant prefix — the janitor will silently mismatch and either (a) delete real user collections (treats them as orphaned because the real prefix doesn't match its derived prefix), or (b) preserve genuine orphans (treats them as live).

**Why-it's-wrong:** The "kept identical" comment is exactly the kind of contract an audit treats as broken-on-arrival. The janitor is a write-side tool that runs periodically against the production chroma store; a regex drift between it and the read-side is precisely the bug class F-17 was about (orphan accumulation), now retro-fitted with a parallel definition that can drift.

**Recommended fix sketch:** Export `_safe_id` (or `_collection_name`) as public API from `memory.strategic_memory` and import it from `chroma_janitor`. Drop the duplicate regex.

---

## Summary

| Tier | Count | IDs |
|------|------|-----|
| A (false-completion) | 2 | D2-FALSE-1, D2-FALSE-2 |
| B (architecture/coupling) | 2 | NEW-CQ-01, NEW-CQ-08 |
| C (security) | 1 | NEW-CQ-03 |
| D (correctness/bugs) | 4 | NEW-CQ-04, NEW-CQ-06, NEW-CQ-07, NEW-CQ-10, NEW-CQ-11 |
| E (ops/maintainability) | 3 | NEW-CQ-02, NEW-CQ-05, NEW-CQ-14 |
| F (minor latent) | 3 | NEW-CQ-09, NEW-CQ-12, NEW-CQ-13 |

**Headline:** The Day-2 productisation push is a *real* improvement over Day-1 — H-1+H-2 closed F-08/F-09 with a real test fixture, H-3 actually wires `engine_error` to a 503 (modulo NEW-CQ-07's plumbing question), H-5 collapses the dispatcher correctly. But the version-string drift (D2-FALSE-1) and the `/refresh`-bypass on the lockout (D2-FALSE-2) are the same shape of bug as Day-1's "claimed-closed-but-not": a commit message that asserts a property the code does not enforce. The other heavy item is NEW-CQ-08 — `create_calendar_event` is registered in the production `_HANDLERS` map even though the audit explicitly defers its security work. That is a Tier-B ship-blocker for any path that uses `gemini_provider.call_with_tools`.

The Tier-A backlog from Day-2 is two items. Recommend the day-3 swarm closes both before any new feature work.
