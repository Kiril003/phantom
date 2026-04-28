# Phase-2 Security Review (cross-cluster)

**Reviewer**: C-SECURITY (Phase-2 Day-4 cross-cutting reviewer 1 of 3).
**Baseline**: `53d16bc`. **Date**: 2026-04-28.
**ADRs reviewed (all 8 landed at second-pass T+~120s)**:

- `docs/architecture/agent-orchestration.md` (ADR-ORC-001..007 + ADR-IGD-001).
- `docs/architecture/sandbox-runtime.md` (ADR-SBX-001..006 + ADR-RAD-001).
- `docs/architecture/desktop-shell.md` (ADR-DSH-001..003 + ADR-RTP-001..002).
- `docs/architecture/chat-liveness.md` (ADR-CS-001..003 + ADR-CI-001 + ADR-CP-001..002).
- `docs/architecture/profile-cards.md` (ADR-CRP-001..003 + ADR-FCT-001..004 + ADR-DSP-001..003).
- `docs/architecture/identity-recognition.md` (ADR-ID-001..004 + ADR-IDB-001..004).
- `docs/architecture/time-events.md` (ADR-SOH-001..006 + ADR-TRR-001..002).
- `docs/architecture/ai-hub.md` (ADR-HUB-001..006 + ADR-NPU-001).

Findings cite `file:line` in the live tree (`53d16bc`) where applicable, and `<adr-id>` plus `<file>:<line>` in the ADR file when the issue lives in the design.

Findings cite `file:line` in the live tree (`53d16bc`) where applicable; ADR-only findings cite the ADR id and the relevant ADR section.

---

## Critical (must fix before Phase-3)

- **SEC-C1** — `chat-liveness.md` ADR-CS-002 — **`<DynamicPicker>` and scene panel rendering have no XSS contract.** The wire format admits panel `data` blobs whose `value` / `label` / `markdown` strings flow into React render (`ScenePanel` shapes at `chat-liveness.md:344-350`). For the `text`-kind panel the spec says `data: { markdown: string }`. Today's `MarkdownResponse` (`src/frontend/src/components/chat/ResponseRenderer.tsx`) renders via `react-markdown` with default sanitisation, but the ADR does **not** assert that `<ScenePanelText/>` MUST go through the same path — a future implementer wiring `dangerouslySetInnerHTML={{ __html: data.markdown }}` would pass type-checking and tests. **Mitigation**: ADR-CS-002 must add an explicit invariant: every panel renderer MUST sanitise via the canonical `MarkdownResponse` pipeline (`react-markdown` + `rehype-sanitize`) for `text` panels, and use plain `{value}` text-node interpolation for `list`, `plan-step`, `code-preview`, `identity-card` payloads — never `dangerouslySetInnerHTML`. Add a vitest XSS test (W-2 acceptance) that asserts `<script>` payloads in `data.markdown`, `data.label`, `data.value`, `data.note`, `data.title`, `data.facts[].value` are escaped to text. **Block**: Add to `chat-liveness.md` ADR-CS-002 §"Back-compat invariants" as invariant #11 ("XSS sanitiser invariant") AND a new test `test_scene_panels_xss_safe.tsx` listed in the W-2 test plan table.

- **SEC-C2** — `agent-orchestration.md` ADR-ORC-002 + ADR-ORC-003 — **Cross-leaf prompt-injection seam: leaf-side sanitiser is fail-open and silently re-emits the raw draft on crash, but the merge LLM still sees that draft verbatim.** ADR-ORC-003 §"Implementation contract" says: "sanitizer crash returns the original draft, never blocks the leaf" (`agent-orchestration.md:60`). Combined with ADR-ORC-003's "the merge LLM never *sees* a verbatim sensitive quote" claim, the fail-open path **breaks that claim** — a single sanitiser exception (e.g. SQLAlchemy reconnect glitch, or attacker-induced via a crafted `MemoryFact` row) lets a leaf inject arbitrary text into the merge history with no audit row. The merge sanitiser is *also* fail-open, so the leak compounds. **Mitigation**: leaf-side sanitiser crash MUST mark the leaf `LeafResult(ok=False, reason="sanitize_crash")` and the merge fold MUST drop those leaves entirely (replaces "fail-open" with "fail-shut at the leaf, fail-open at merge if-and-only-if all leaves ok=False" — the merge can still produce a degraded answer, but never one tainted by an unsanitised leaf). Add `test_leaf_sanitize_crash_excludes_leaf_from_merge_history` to X-2 test plan. **Block**: edit ADR-ORC-003 §"Consequences" — flip the leaf-side fail-open invariant to fail-shut, then keep merge-side fail-open as currently described.

- **SEC-C3** — `sandbox-runtime.md` ADR-SBX-004 — **`net.scan` "honest carve-out" still missing the per-call audit-trail visibility requirement.** ADR-SBX-004 §"Audit-truth invariant" says every `ActionResult.sandboxed=False`, but says nothing about the **operator-visible audit log row** carrying both the `sandboxed=False` flag AND the canonicalised IP that ran. Today the audit row is written by `_audit_dispatch` (`src/backend/ai/chat_tool_dispatcher.py:240-254`) but `agent.actions.net.scan` doesn't go through that dispatcher — it's a direct action invocation. The current `ActionResult` schema field at `schemas.py:166` is consumed by frontend but **not** indexed in any persistent audit table. **Mitigation**: ADR-SBX-004 must add: every `net.scan` invocation persists a row in `ai_tool_use_log` (or a peer audit table) with columns `(ts, user_id, action='net.scan', sandboxed=False, target_ip, mode, ok, error_kind)`. Without this row, an operator running periodic forensics has no way to enumerate "every time we *did* leak network access outside the sandbox". **Block**: add §"Audit row contract" to ADR-SBX-004 with the exact column shape, and reference it in Y-3 test plan as `test_net_scan_writes_audit_row`.

- **SEC-C4** — `desktop-shell.md` ADR-DSH-001 + ADR-DSH-003 — **Tauri capabilities allowlist is unspecified — Day-4 ships scaffold without an explicit `tauri.allowlist` contract.** ADR-DSH-001 §"Sidecar contract" defines the sidecar-spawn shape but says nothing about Tauri's per-API capability allowlist (`fs`, `shell`, `dialog`, `http`, `notification`, `path`, `process`, `protocol`, `clipboard`, `os`, `globalShortcut`, `window`). Tauri 2.x **default-allows** several of these unless an explicit allowlist is shipped with the scaffold. A scaffold that ships `"all": true` (the v1 default for `tauri.conf.json#tauri.allowlist.all`) gives every page in the WebView arbitrary-fs and arbitrary-shell access — every XSS in `<ChatScene>` (SEC-C1) becomes an RCE on the host. **Mitigation**: ADR-DSH-001 must commit V-1 to a *restrictive default* allowlist with explicit per-category opt-ins (see §"Tauri capabilities allowlist (recommendation)" below). Day-4 V-1 acceptance must include `test_tauri_allowlist_locked` that asserts `tauri.conf.json` resolves with `tauri.allowlist.all = false` AND every `*.all = false`, AND each category whitelists exactly the methods the desktop shell needs. **Block**: add §"Tauri capabilities allowlist" to ADR-DSH-001 — the recommended shape is in this review, ADR copies it verbatim.

- **SEC-C5** — `profile-cards.md` ADR-CRP-002 + ADR-CRP-003 — **HKDF static salt + single global Fernet key + hard-fail-on-rotation = full UserFact corpus is single-key-encrypted; one secret leak unwraps every user's PII.** ADR-CRP-002 (`profile-cards.md:53-87`) explicitly chooses `salt=b"phantom-pii-v1"` (static) and `info=b"phantom-os/pii-encryption"` (static) — a *single* 32-byte Fernet key derived from `JWT_SECRET_KEY`. The ADR justifies this with "If the `JWT_SECRET_KEY` leaks, the PII key is derivable — same blast radius as JWT forgery, which is already game-over. Acceptable." That blast-radius claim is wrong: JWT forgery lets an attacker impersonate users **going forward** — a perimeter event, detectable, recoverable by rotation. PII corpus decryption lets an attacker walk every row of `user_facts.value_encrypted` **historically**, including data the user has since "deleted" but that lives in DB backups / snapshots / replicas. Worse: ADR-CRP-003 (`profile-cards.md:88-115`) says rotating `JWT_SECRET_KEY` makes every row undecryptable until a Day-5 re-encrypt script runs — so the operator is **disincentivised** to rotate after a known leak. **Mitigation (must land before FACTS-1 acceptance)**: ADR-CRP-002 amendment — HKDF `salt` MUST be the per-row `UserFact.id` UUID bytes (already a primary key, free entropy, no schema change); HKDF `info` MUST be `b"phantom-pii-v1:" + user_id_utf8 + b":" + category_utf8` so a ciphertext lifted from row A and pasted into row B fails Fernet MAC. AAD-via-info is achievable Day-4 inside the existing `_fernet()` helper at `profile-cards.md:437-438` — it costs ~5 µs of HKDF per encrypt/decrypt (well inside the 100 µs budget at `profile-cards.md:602`). CRYPTO-1 test plan adds `test_two_identical_pii_values_distinct_ciphertexts`, `test_row_id_swap_fails_decrypt`, `test_user_id_swap_fails_decrypt`. ADR-CRP-003 amendment — rotation behaviour stays hard-fail at decrypt time, BUT the documented operator path adds: "before rotation, run `scripts/rotate_pii_key.py` which re-encrypts under a new `_HKDF_SALT_VERSION = 'phantom-pii-v2'` *while old data is still readable*". That migration is the gate that makes rotation safe; ADR-CRP-003's current path (rotate first, run script later) loses data on any error.

- **SEC-C6** — `identity-recognition.md` ADR-IDB-002 — **Shared-credential guard covers PIN only; RFID UID collision is an explicit bypass.** ADR-IDB-002 (`identity-recognition.md:194-228`) specifies `if req.pin is not None:` then scan + `verify_secret(req.pin, existing.pin_hash)` and 409 on collision. The ADR §"Invariants" reads "Guard MUST NOT raise when `req.pin is None` (RFID-only users)." That invariant **is the bug**: today `authenticate_rfid` (`src/backend/security/auth.py:44-57`) returns the **first matching user** found via `for user in users: if verify_secret(uid_hash, user.rfid_uid_hash): return user`. Two users created with the same RFID UID (allowed by the invariant above) means whichever DB-iteration-order user hits first wins — an attacker who enrols under role=GUEST with a copy of the operator's RFID UID then taps that card and gets back **whichever account the loop returns first**, which depends on insertion order and SQLite's row layout. The ADR also leaves the symmetrical hole open for `PUT /users/{id}` updates ("Guard MUST NOT call itself recursively / from `update_user` Day-4"). **Mitigation (must land before IDB-2 acceptance)**: ADR-IDB-002 amendment — guard scans BOTH `pin_hash` AND `rfid_uid_hash` in the same loop. Pseudo: `if req.pin: scan pin_hash; if req.rfid_uid: scan rfid_uid_hash; reject on either collision`. Same masked-username response shape. The "RFID-only users" invariant remains but now means "no PIN to guard" — the RFID guard always runs when an RFID UID is supplied. Same fix applied to `PUT /auth/users/{id}` for both PIN and RFID rotation paths — Day-4 scope, not Day-5, because shipping `update_user` without rotation guards lets an attacker insert a colliding RFID via PUT after IDB-2 closes the POST hole. IDB-2 test plan adds `test_create_user_rejects_duplicate_rfid_uid`, `test_update_user_rejects_pin_collision_with_other_user`, `test_update_user_rejects_rfid_collision_with_other_user`. Additionally: `authenticate_rfid` itself (`src/backend/security/auth.py:44-57`) must be hardened — if more than one user matches, raise / log alert / return None (defence-in-depth in case the guard ever fails closed-then-reopens).

---

## High (must fix during Phase-3)

- **SEC-H1** — `agent-orchestration.md` ADR-ORC-001 — **Provider-gate is `provider == "gemini"` (string equality), but `AIRouter._available_sequence` returns provider names that include version suffixes / model IDs in some configurations.** The Gemini-only gate at ADR-ORC-001 is correct intent (TM-17B-S2 inheritance) but the string-match is brittle. A future Gemini-2.5 / Gemini-Live provider registered as `"gemini-live"` would silently fall back to single-turn even when it has full FunctionResponse support. **Mitigation**: introduce a typed `Provider.kind` field (enum: `gemini` | `ollama` | `mock` | `claude` | ...) on the AIRouter side, and have `decide_mode` check `provider.kind == ProviderKind.gemini`. Until that lands, `decide_mode` should pattern-match `provider.startswith("gemini")` to forward-compat with versioned provider names — but this is a workaround, not the right fix. **Owner**: agent-orchestration cluster, X-1 closure.

- **SEC-H2** — `sandbox-runtime.md` ADR-SBX-005 — **D-Bus carve-out for `notify.desktop` is documented honestly but lacks rate-limit / size-cap on the user-controlled notification body.** ADR-SBX-005 §"Day-4 trade-off" notes the notify-send argv is "two static strings + two user-controlled strings that are already length-capped at `notify.py:19-21`". The length cap exists but no rate-limit does — an attacker who wires `proactive` or a tool result to spam `notify.desktop` can DoS the D-Bus session. The D-Bus session bus also accepts notification IDs that allow an attacker to *replace* prior notifications (silent overwrite of legitimate notifications). **Mitigation**: add per-user-second token-bucket (e.g. 5 notifications / 10 s) at the action layer, AND mandate `notify-send`'s `--replace-id` argument is NOT exposed to the LLM via `chat_tool_dispatcher`. **Owner**: sandbox-runtime cluster, Y-3 follow-on.

- **SEC-H3** — `desktop-shell.md` ADR-DSH-002 — **OS-aware data-path resolver doesn't specify file-mode (`umask`) for the created data dirs.** ADR-DSH-002 §"Resolver semantics" says `mkdir(parents=True, exist_ok=True)` is performed at G1, but doesn't pin the mode. On a multi-user Linux box, the default `0o777 & ~umask` resolves to `0o755` — world-readable. The chroma DB and sqlite DB contain UserFacts (post-FACTS-1, ciphertext but with metadata leakage), session cookies' equivalent rows, and chat history. **Mitigation**: `ensure_data_dirs()` must explicitly `os.chmod(data_dir, 0o700)` after `mkdir`, and same for any sub-dirs (`chroma`, `sqlite`, `voice_models`, `workspace`). On Windows, set the equivalent ACL via `pywin32` — or document that Windows packaging defers ACL hardening to V-2.5 (separate ADR). **Owner**: desktop-shell cluster, V-2 closure.

- **SEC-H4** — `desktop-shell.md` ADR-DSH-003 — **`_refuse_lan_bind_in_packaged_mode` is correct but doesn't refuse IPv6 LAN bind.** ADR-DSH-003 §"Decision" pins the check at `config.host != "127.0.0.1"`. But Tauri sidecar config could pass `host="::1"` (loopback v6, fine) or `host="::"` (unspecified v6 — binds to ALL v6 interfaces, including LAN). The check would *accept* `host="::"` because it doesn't equal `"127.0.0.1"`. **Mitigation**: refuse logic must allowlist exactly `{"127.0.0.1", "::1"}` and reject anything else. Pseudo: `if config.host not in ("127.0.0.1", "::1"): raise RuntimeError(...)`. Add `test_lan_bind_refused_for_v6_unspecified` to V-4 test plan. **Owner**: desktop-shell cluster, V-4 closure.

- **SEC-H5** — `chat-liveness.md` ADR-CS-002 — **`SceneKind` enum on the wire is *closed Day-4*, but the deserialiser hasn't been specified to reject unknown kinds.** ADR-CS-002 §"Persistence" promotes the scene attachment back up to `message.scene` on read. If the persistence layer round-trips a `kind: "unknown-future-kind"` (e.g. a Day-5 row that survives a Day-4 downgrade — operator rollback scenario), the frontend `<ChatScene>` switch must reject it cleanly. **Mitigation**: `_serialize_message` deserialiser MUST validate `scene.kind ∈ SceneKind` before promoting; on mismatch, drop `scene` field entirely (back-compat fallback to `<ResponseRenderer>`). Add backend test `test_scene_unknown_kind_drops_envelope`. Same on frontend `<ChatScene>`: a runtime guard must default to legacy renderer if `kind` not in the closed list. **Owner**: chat-liveness cluster, W-2 closure.

- **SEC-H6** — `time-events.md` ADR-SOH-003 + ADR-SOH-004 — **`WebhookAction.url` has no SSRF guard.** The discriminator schema at `time-events.md:145-150` declares `url: HttpUrl` (Pydantic) with no host-allowlist / loopback-reject / RFC1918-reject. ADR-SOH-004 dispatch (`time-events.md:194`) is `httpx.AsyncClient` POST/GET — by default httpx follows redirects and resolves hostnames at connect time. Attack vectors:
  1. Standing order whose `WebhookAction.url = "http://127.0.0.1:8000/api/v1/auth/users"` calls **the local backend itself** — but lacks the JWT cookie, so this happens to fail today. However `http://127.0.0.1:11434/api/generate` (Ollama) is *unauthenticated* on the Radxa loopback and a webhook can prompt-inject the local LLM with a calendar event title.
  2. `http://169.254.169.254/...` (cloud metadata service) is irrelevant on Radxa Day-4 but a packaged-cloud build (Day-5+) inherits this hole.
  3. DNS rebind: a webhook to `http://attacker.com/...` resolves at create time via Pydantic's `HttpUrl` URL parsing (no DNS), then at fire time httpx resolves *again* — attacker swaps the A record between create and fire, or even between two retries.
  4. `file://`, `gopher://`, `ftp://` — Pydantic `HttpUrl` does reject non-http(s), so this is closed by the type. But `Literal["GET", "POST"]` does **not** prevent following a 301 redirect from `https://attacker.com` to `http://127.0.0.1:11434/...`.
  **Mitigation (must land in T-2)**: ADR-SOH-003 amendment — `WebhookAction.url` validator runs `socket.getaddrinfo(host)` at create time AND rejects: any IP in `127.0.0.0/8`, `::1`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `fc00::/7`, `fe80::/10`. Add `config.standing_orders_webhook_allow_loopback: bool = False` (operator opt-in for advanced use). ADR-SOH-004 amendment — `httpx.AsyncClient(follow_redirects=False, timeout=5)` AND a custom `transport=httpx.HTTPTransport(...)` whose resolver pins the create-time IP (defeats DNS-rebind). T-3 test plan adds `test_webhook_create_rejects_loopback`, `test_webhook_create_rejects_rfc1918`, `test_webhook_dispatch_no_redirect_follow`, `test_webhook_dispatch_dns_rebind_pinned_ip`. **Owner**: time-events cluster, T-2 closure.

- **SEC-H7** — `time-events.md` ADR-SOH-003 — **`WebhookAction.body` and `SpeakAction.text` have no size caps.** Pydantic schema at `time-events.md:130-149` declares `text: str` and `body: Optional[dict]` with no length / depth / size constraints. A standing-order POST endpoint accepts these directly into the database (`schedule_json`, `action_json`). Attacker scenarios:
  1. `SpeakAction.text = "A" * 10**8` — once fired, StyleTTS2 begins synthesising a multi-hour audio file, blocking the TTS queue for legitimate users (DoS on the voice channel).
  2. `WebhookAction.body = {"x": "A" * 10**8}` — at fire time, `httpx.AsyncClient` serialises 100 MB JSON, sends it to the webhook target (potential DoS on operator's home-automation hub or third-party endpoint).
  3. Database side-effect: `action_json` is `Text` column on SQLite; 100 MB rows hit the SQLITE_MAX_LENGTH default (1 GB) but DOS the disk and spike the per-fire serialisation cost.
  **Mitigation (must land in T-2)**: ADR-SOH-003 amendment — `SpeakAction.text` capped at `max_length=4000` (≈ 5 minutes of TTS, plenty for any legitimate alarm message); `WebhookAction.body` capped via `@validator` that `json.dumps(body)` ≤ 64 KB, AND `NotifyAction.body` ≤ 4 KB (matches notify-send's argv length cap at `agent/actions/notify.py:19-21`). All caps validated at **create** time so a malicious POST `/standing-orders` rejects 422 immediately AND at fire time as defence-in-depth (so a database row hand-edited by an attacker still fails fast). T-2 test plan adds `test_speak_text_length_cap_at_create`, `test_speak_text_length_cap_at_dispatch`, `test_webhook_body_size_cap`, `test_notify_body_size_cap`. **Owner**: time-events cluster, T-2 closure.

- **SEC-H8** — `ai-hub.md` ADR-HUB-002 + ADR-NPU-001 — **Capability registry has no freeze invariant — any caller can register or overwrite a `(provider, task_class)` pair post-bootstrap.** ADR-HUB-002 (`ai-hub.md:30-50`) specifies `register()` as "Idempotent registration. Re-registering a `(provider, task_class)` pair overwrites — supports Day-5 'flip available=True' without a process restart." (`ai-hub.md:264-266`). The interface signature at `ai-hub.md:263` is public `register(self, capability)`. Combined with ADR-HUB-006 (`ai-hub.md:170-185`) "the only Day-4 caller of `hub.pick()` is the X-1 `chat_orchestrator`" — *only the picker is restricted; the registrar is open*. Concrete attack paths:
  1. A future MCP plugin loaded under `agent/mcp/adapter.py` calls `from ai.hub import ai_hub; ai_hub.register(ProviderCapability(provider="evil", task_class="chat", ..., available=True, latency_ms_p50=1))` and now wins every `prefer="auto"` pick (lowest latency).
  2. The Z-5 NPU "flip available=True" use case (`ai-hub.md:204`) is itself a runtime mutation — the same surface that lets a malicious caller flip a *malicious* row to available.
  3. `chat_orchestrator` calls `hub.pick(task_class="chat_subtask")` with no integrity check on the returned handle — the orchestrator trusts whatever the registry says.
  **Mitigation (must land in Z-1)**: ADR-HUB-002 amendment — split `register()` into (i) `_bootstrap_register(capability)` callable only from `_bootstrap_default_capabilities` (file-private; checked via inspect of caller frame at `id(caller_module) == id(this_module)`, OR via a simple `_BOOTSTRAP_DONE: bool` module flag set after lifespan), (ii) `update_availability(provider, task_class, *, available: bool)` for the Day-5 NPU flip use case — restricted to the same private surface. Public `register()` is removed. Z-2 test plan adds `test_hub_register_locked_after_bootstrap` (asserts `RuntimeError("registry frozen")` post-G1) and `test_hub_register_not_callable_from_mcp_adapter` (creates a fake `agent.mcp` import; calling `register()` raises). Day-5 metapath finder (per TM-17B-D4-S3) extends to ban `from ai.hub import register` from any non-bootstrap caller. **Owner**: ai-hub cluster, Z-1 + Z-2.

- **SEC-H9** — `ai-hub.md` ADR-HUB-005 — **`/hub/route_state` payload is bounded but `task_id` is leaked across users.** ADR-HUB-005 §"GET /api/v1/hub/route_state" (`ai-hub.md:139-160`) defines the response as `{at, task_class, prefer, picked, reason, fallback_chain, task_id, elapsed_ms}` — *with `task_id` visible*. The route is `Depends(get_current_user)` (any authenticated user, not require_root per `ai-hub.md:166`). The decision ring (`ai-hub.md:162`) is process-global — a GUEST hitting `/hub/route_state` sees `task_id` values that may include `chat-orch-<hex>` ids tied to OTHER users' chat turns AND sees `task_class="chat_subtask"` patterns that infer when ROOT is using parallel-K orchestration. The ADR says the route "expose registry info that, while not a secret, would let an unauthenticated probe enumerate the deployment's NPU posture" — but glosses over the cross-user leak inside an authenticated GUEST context. **Mitigation (must land in Z-2)**: ADR-HUB-005 amendment — (i) restrict `/hub/route_state` to `Depends(require_root)` (matches the existing `require_root` gate on `/auth/users` at `routes_auth.py:401`); (ii) strip `task_id` from the response shape (the ring stores it for telemetry — operators who need the task_id can SELECT FROM `ai_tool_use_log` per ADR-ORC-007, which is the proper audit trail); (iii) clarify that `/hub/providers` stays `Depends(get_current_user)` because it's static capability info. Z-2 test plan adds `test_route_state_requires_root`, `test_route_state_no_task_id_leak` (asserts `task_id` key NOT in response). **Owner**: ai-hub cluster, Z-2 closure.

---

## Medium (Day-5 hardening)

- **SEC-M1** — `agent-orchestration.md` ADR-ORC-007 — **Synthetic `task_id = chat-orch-<hex>` is unbounded — runtime budget rows accumulate.** Each parallel-K turn allocates a new `task_id`; `agent_runtime.note_llm_call` accepts unknown ids without raising (per ADR §"Consequences"). The runtime's per-task budget dict grows without bound across the chat session. **Mitigation**: add LRU eviction or per-`chat-orch-*` cleanup at orchestrator exit. Day-5 hardening — not blocking Day-4 ship.

- **SEC-M2** — `sandbox-runtime.md` ADR-SBX-006 — **F-40 realpath fix walks intermediate components individually but doesn't lock the filesystem during the walk.** The TOCTOU window between `realpath_inside()` returning `True` and `open(path, "w")` is non-zero — an attacker with workspace-write capability can swap a directory for a symlink between the two calls. **Mitigation**: use `os.open(path, os.O_NOFOLLOW | os.O_CLOEXEC | ...)` for the actual write, with a final `realpath` re-check on the resulting fd via `/proc/self/fd/<n>`. Day-5; ADR-SBX-006 already closes most of F-40 — this is the residual hardening.

- **SEC-M3** — `desktop-shell.md` ADR-RTP-001 — **G2 lifespan parallel warmups don't isolate failures from each other on shared resources.** ADR-RTP-001 §"G2" says lanes are independent ("no shared state writes, all module-level singletons with their own locks") — but Chroma eager init AND Chroma janitor BOTH touch the chroma SQLite file. A janitor lane that locks chroma DB while eager-init is reading triggers SQLite `database is locked` errors. **Mitigation**: serialise chroma-touching lanes (`Chroma eager` → `Chroma janitor`) within G2 via an inner `await`, even though they're inside the gather. Add `test_g2_chroma_lanes_serialise` to V-5 test plan. Day-5 if not caught in V-5 acceptance.

- **SEC-M4** — `chat-liveness.md` ADR-CI-001 — **`<AttachDrawer/>`'s `<ModelCard/>` writes `metadata.attached_model_card` into the chat row but Day-4 has no allowlist on the attached value.** A user could send `attached_model_card: "../../etc/passwd"`-style strings that later get rendered into the AI prompt by a Day-5 wiring (Z-1). **Mitigation**: validate the attached model card value against `config.ollama_models_default` ∪ `chat_models_allowlist` at submit time; reject anything else with 400. Add to ADR-CI-001 §"Touchpoints" as backend-side validation. Day-5 hardening before Z-1 wires it.

- **SEC-M5** — **[ADR-DEFERRED]** `profile-cards` — **`_user_to_dict` field-leak closure correctness.** Today `_user_to_dict` (`src/backend/api/routes_auth.py:39-61`) returns `{id, username, role, avatar_url, has_rfid, has_pin, created_at, last_seen_at, preferences, behavioral_model}` — already correctly elides `pin_hash` and `rfid_uid_hash`. The risk is that a future addition of a column to the `User` ORM model (e.g. `auth_secret`, `recovery_token`, `last_failed_login_ip`) will silently appear in `_user_to_dict` ONLY IF a future contributor refactors to `vars(user)` or `user.__dict__`. **Mitigation**: add a regression test `test_user_to_dict_returns_exact_keyset` asserting the dict's `set(keys()) == {known closed set}`. Any additive field forces a deliberate test edit, which forces the contributor to consider whether the new field is safe to expose. Cheap to add now even though the deferred ADR hasn't landed. **Owner**: profile-cards / FACTS-1 closure.

- **SEC-M6** — **[ADR-DEFERRED]** `identity-recognition` — **`UserPicker` route privacy: enumeration of usernames + role + has_pin/has_rfid is unauthenticated.** The cluster summary says `GET /api/auth/users/picker` route. If it's unauthenticated (per the LoginScreen-extends-when-`user_count > 1` flow), it leaks the full username list, role-per-user, and credential-shape (`has_pin`, `has_rfid`) to anyone reachable on `127.0.0.1` — and anyone reachable via XFF-trusted proxy. Even on a kiosk, this surface is reconnaissance for a physically-present attacker. **Mitigation**: `/picker` route MUST return only `{id, username, avatar_url}` for each user — NEVER `role`, `has_pin`, `has_rfid`, `last_seen_at`. Add this to identity-recognition ADR §"UserPicker contract". Day-5 hardening if not caught at IDB-2 acceptance.

- **SEC-M7** — **[ADR-DEFERRED]** `identity-recognition` — **`speaker_id` integrity at WS boundary unspecified.** The cluster summary adds `Transcript.speaker_id` to the voice WS event. If the WS event is broadcast to the frontend without a server-side authoritative tag, a frontend bug (or hostile patched frontend) could spoof `speaker_id` on its way back up to a chat-send action — flipping who an utterance is attributed to. **Mitigation**: speaker_id is **stamped server-side** on every voice WS event, NEVER read from a client message. Backend tests at ID-2 must assert: a client message sending `speaker_id: <other-user>` is ignored — server uses the server-resolved value or `null`. **Owner**: identity-recognition ADR (when authored).

- **SEC-M8** — `chat-liveness.md` ADR-CP-002 — **Hardware-tier flag's CSS-side `data-ui-tier="low"` opens a fingerprinting / state-leak vector if exposed in non-authenticated HTML.** The frontend reads it via `useSettingsStore`, which presumably hits `GET /api/settings`. Settings GET requires auth today. ADR-CP-002 doesn't specify what happens pre-auth — if `data-ui-tier` is rendered into the unauthenticated `LoginScreen`, the value (or its absence) tells an attacker the hardware tier of the device. Low-impact, but worth pinning. **Mitigation**: `data-ui-tier` attribute applied only after auth completes. Document in ADR-CP-002 §"Touchpoints". Day-5 hardening.

---

## TM-17B regression risks

Multi-agent orchestrator extends Day-3 threat model (TM-17B-S1 nonce envelope, TM-17B-S2 Gemini-only, TM-17B-E2 dispatcher-only, TM-17B-E4 chat-side import gate). New risks:

- **TM-17B-D4-S1** — **Per-sub-agent nonce leak via leaf draft text.** A sub-agent's leaf draft can contain its own `sub_nonce` value (e.g. the LLM hallucinates the envelope key text into its response). When that draft passes through the merge LLM history, the merge LLM sees a guess-able nonce *for its own envelope keying*. ADR-ORC-002 says merge envelope reuses `_PROCESS_NONCE` — which is per-process, so this is bounded. But if a future ADR makes the merge nonce *also* per-call, this leak becomes exploitable. **Owning ADR**: agent-orchestration ADR-ORC-002. **Mitigation**: ADR-ORC-002 must add §"Nonce hygiene at sanitiser": leaf-side sanitiser MUST scrub any 16-char hex sequence that matches the leaf's own `sub_nonce` from the draft text before that draft enters the merge history. Trivially implementable as a `re.sub(re.escape(sub_nonce), "[REDACTED-NONCE]", draft)` after sanitiser. Pin with `test_leaf_draft_strips_own_sub_nonce` in X-2.

- **TM-17B-D4-S2** — **Cross-leaf prompt-injection via `recall_memory_facts` tool result.** Per ADR-ORC-003 §"Rationale", "sensitive content from leaf-A's `recall_memory_facts` result can flow verbatim into leaf-B's prompt context via the merge concatenation". The leaf-side sanitiser closes the *sensitive-MemoryFact* leak, but **does not** close the more general prompt-injection seam: leaf-A's tool result can include attacker-controlled text (e.g. a Wardriving SSID that someone broadcasts in range, a calendar event title from a corrupted ICS). When merged, leaf-B's portion of the merge context now carries that attacker-controlled string. **Owning ADR**: agent-orchestration ADR-ORC-003. **Mitigation**: ADR-ORC-003 must extend leaf-side sanitiser to include a *prompt-injection scrubber* that strips `system:`, `</prompt>`, `<|im_start|>`, `assistant:`, `Human:` framing markers from leaf draft text. The scrubber is conservative — false positives become `[REDACTED-FRAMING]`. Already implementable using the existing `output_safety` extension point. Test: `test_leaf_strips_role_framing_markers` in X-2.

- **TM-17B-D4-S3** — **TM-17B-E4 import gate covers `ai/agents/**` (per ADR-IGD-001) but not the new orchestrator-spawned MCP path.** ADR-IGD-001 forbids `agent.mcp` imports under `ai/agents/**`. But the cluster summary at `PHASE1_CONTEXTS.md:122-128` says ai-hub's Z-4 wires sub-agents to MCP tools "via `ai.hub.pick(task_class)`" — which means `ai/agents/sub_agent.py` will (Day-5) call `ai.hub` which will route to `agent.mcp`. The transitive call is allowed by the import gate (gate is import-time AST, not runtime), but the runtime data-flow re-opens TM-17B-E2's tool-execution-path invariant. **Owning ADR**: agent-orchestration ADR-IGD-001 + ai-hub ADR (when authored). **Mitigation**: ADR-IGD-001 §"Day-4 enforcement" must add: Day-5 runtime metapath finder + an additional CI test that asserts `ai.hub.pick(...)` returns providers whose tool-dispatch goes through `chat_tool_dispatcher.dispatch` — never directly through `agent.mcp.adapter`. Without this, X-3's import gate is necessary-but-not-sufficient.

- **TM-17B-D4-S4** — **Synthetic `task_id = chat-orch-<hex>` not persisted means audit log queries can't reconstruct orchestrator turn boundaries on a server crash.** ADR-ORC-007 §"Consequences" notes the synthetic id is not persisted as `AgentTask`. If the server crashes mid-orchestrator turn, the dispatch audit rows survive but there's no `AgentTask` row to anchor "this turn's leaves". An operator post-mortem can SELECT WHERE task_id LIKE 'chat-orch-%' but loses the user_id / session_id correlation. **Owning ADR**: agent-orchestration ADR-ORC-007. **Mitigation**: ADR-ORC-007 should add: at orchestrator entry, write a single row to a new `chat_orchestrator_turns` table with `(task_id, user_id, session_id, started_at, K, deadline_ms)`. The row's existence is the post-crash anchor. Day-5 hardening — not blocking Day-4 ship, but should land before parallel-K is enabled in production.

---

## Tauri capabilities allowlist (recommendation)

Day-4 V-1 ships with the recommended baseline below. **`tauri.conf.json#tauri.allowlist.all = false`** is the guard rail. Every category below is explicitly enumerated; categories not listed are implicitly off.

```jsonc
{
  "tauri": {
    "allowlist": {
      "all": false,
      "fs": {
        "all": false,
        "scope": [
          "$APPDATA/PHANTOM/**",
          "$APPLOCALDATA/PHANTOM/**",
          "$RESOURCE/**"
        ],
        "readFile": false,
        "writeFile": false,
        "readDir": false,
        "copyFile": false,
        "createDir": false,
        "removeDir": false,
        "removeFile": false,
        "renameFile": false,
        "exists": false
      },
      "shell": {
        "all": false,
        "open": false,
        "execute": false,
        "sidecar": true,
        "scope": [
          { "name": "phantom-backend", "sidecar": true, "args": ["--no-server-binding"] }
        ]
      },
      "dialog": {
        "all": false,
        "open": false,
        "save": false,
        "message": false,
        "ask": false,
        "confirm": false
      },
      "http": {
        "all": false,
        "request": false,
        "scope": []
      },
      "notification": {
        "all": false
      },
      "globalShortcut": {
        "all": false
      },
      "os": {
        "all": false
      },
      "path": {
        "all": false
      },
      "process": {
        "all": false,
        "exit": true,
        "relaunch": false
      },
      "protocol": {
        "all": false,
        "asset": true,
        "assetScope": ["$RESOURCE/**"]
      },
      "window": {
        "all": false,
        "create": false,
        "close": true,
        "hide": true,
        "show": true,
        "maximize": true,
        "minimize": true,
        "unmaximize": true,
        "unminimize": true,
        "startDragging": true,
        "setSize": false,
        "setPosition": false,
        "setFullscreen": false
      },
      "clipboard": {
        "all": false,
        "writeText": false,
        "readText": false
      }
    }
  }
}
```

**Rationale per category** (Day-4 minimum):

- `fs` — fully off. Backend writes data via Python `pathlib`; the WebView frontend never needs raw fs access. If V-3's ModelCard or W-4's DynamicPicker need to surface a "pick a file" UX, that lands in V-2.5 with a *scoped* `dialog.open` re-enabled.
- `shell` — only sidecar spawning of `phantom-backend` with the fixed `--no-server-binding` arg. **No `shell.execute`** — chat-tool-dispatcher's `bash.run` runs server-side under bwrap per `sandbox-runtime` ADRs, never via Tauri.
- `dialog` — fully off Day-4. Day-5 may re-enable `dialog.message` for crash reporting.
- `http` — fully off. Backend issues HTTP via Python `aiohttp`, not via the WebView.
- `notification` — off. Notifications go through the backend's `notify.desktop` action (which reaches D-Bus per ADR-SBX-005), not Tauri's notification API.
- `path` — off. Path resolution is server-side via `paths.resolve_data_dir` (ADR-DSH-002).
- `process` — only `exit` (so Tauri can shut itself down on backend crash). No `relaunch` Day-4 — Tauri auto-restarter belongs to a Day-5 ADR.
- `protocol.asset` — on, scoped to `$RESOURCE/**`. This is how the WebView serves the bundled React `dist/` folder. Without it the React shell can't load.
- `window` — only the operator-facing controls (close/hide/show/min/max/drag). No `setSize`, `setPosition`, `setFullscreen` — frame layout is fixed for the 1024×600 kiosk; if the operator wants to change it, that's a settings-side change, not a runtime API.
- `clipboard` — off Day-4. The chat UI's "copy" button can use the W3C `navigator.clipboard` API which is gated by user activation — that's the right surface, not Tauri's privileged clipboard API.
- `globalShortcut`, `os` — off; not needed Day-4.

**Acceptance test (V-1)**: `test_tauri_allowlist_restrictive` parses `tauri.conf.json` and asserts: (i) `tauri.allowlist.all === false`, (ii) for every key under `allowlist`, either `*.all === false` OR (the category is explicitly off entirely), (iii) `shell.execute === false`, (iv) `fs.scope` is a closed array of `$APPDATA/PHANTOM/**`-style patterns (no `**` rooted at `/`), (v) `protocol.assetScope` is closed to `$RESOURCE/**`. Failing this test fails CI on the `autonomous-run` branch.

---

## Recommended Phase-3 readiness gate

Before Phase-3 Wave 1 starts:

- [ ] **All four deferred ADRs land** (`profile-cards.md`, `identity-recognition.md`, `time-events.md`, `ai-hub.md`) AND this review file is re-run with **[ADR-DEFERRED]** sections converted to concrete findings or marked closed.
- [ ] Every Critical above (SEC-C1 … SEC-C6) resolved via ADR amendment. Specifically:
  - SEC-C1: ADR-CS-002 invariant #11 added; W-2 XSS test in plan.
  - SEC-C2: ADR-ORC-003 leaf-side sanitiser flipped to fail-shut.
  - SEC-C3: ADR-SBX-004 audit-row contract added; Y-3 `test_net_scan_writes_audit_row`.
  - SEC-C4: ADR-DSH-001 §"Tauri capabilities allowlist" added with the shape above; V-1 `test_tauri_allowlist_restrictive`.
  - SEC-C5: profile-cards CRYPTO-1 ADR §"Fernet key derivation invariant" mandates per-row HKDF salt + info binding.
  - SEC-C6: identity-recognition ADR §"Shared-credential guard" covers PIN ∪ RFID UID; IDB-2 tests.
- [ ] **Tauri allowlist locked to Day-4 minimum** (recommendation above).
- [ ] **CI import-gate test (X-3) covers `ai/agents/**` AND any new orchestrator path** — when ai-hub ADR lands, X-3 must extend to `ai/hub/**` and the runtime metapath finder is committed for Day-5 (per TM-17B-D4-S3).
- [ ] **TM-17B-D4-S1, -S2, -S4 mitigations adopted in ADR-ORC-002 / ADR-ORC-003 / ADR-ORC-007** even if Day-5 actually implements them — the ADRs must say so.
- [ ] **Tauri `_refuse_lan_bind_in_packaged_mode` v6 fix (SEC-H4)** in ADR-DSH-003 before V-4 implementer touches the file.
- [ ] **`ensure_data_dirs` chmod 0o700 (SEC-H3)** committed to ADR-DSH-002 §"Resolver semantics".
- [ ] Every High finding above (SEC-H1 … SEC-H9) has an owner, a target Phase-3 block, and a follow-on test pinned in the corresponding cluster's test plan.
- [ ] Sign-off: this review file's "Critical" section reads "(none)" after amendments land. Two-reviewer rule — C-SECURITY plus one of {C-PERF, C-CONTRACTS} re-confirms the readiness checklist before Wave 1 dispatches.

---

## Re-read note

Per the brief: "Re-read after 60s if a referenced ADR was missing". Re-read at T+60s confirmed the four deferred ADRs (`profile-cards.md`, `identity-recognition.md`, `time-events.md`, `ai-hub.md`) are still absent from `docs/architecture/`. Findings against those four clusters are based on cluster summaries in `docs/PHASE1_CONTEXTS.md`. **A second pass over this review file is mandatory once those four ADRs land** — cluster summaries are necessarily lossier than the ADRs they preview, and findings tagged **[ADR-DEFERRED]** may need to be re-scoped (some may close, some may surface new issues).
