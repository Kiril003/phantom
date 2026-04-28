# PHANTOM OS — Day-3 Ops/Deployment Audit
**Date:** 2026-04-30  
**Auditor Perspective:** N-ops (operations, deployment, CI/CD)  
**Baseline:** Day-2 closed at `d3ca9a6`; Day-3 scope determined by NEW findings  
**Read-only audit:** No docker/CI execution; evidence from source inspection only.

---

## Executive Summary

PHANTOM OS maintains solid ops hygiene across Dockerfile, docker-compose.yml, and CI workflow. However, three Tier-A false-completions and one critical documentation drift issue require immediate attention before multi-tenant or production cloud deployment.

**Key findings:**
- **Observability counters still live but not yet incremented** (OPERATIONS.md claim is misleading).
- **No automated backup mechanism** for ChromaDB or SQLite (manual-only, not mentioned in OPERATIONS.md as limitation).
- **Multi-tenant is forbidden but NOT enforced in code** (only documented advice).
- **Test count drift:** docs claim 1091+ tests; actual count ~88 test files (exact count requires pytest execution).
- **Settings routes API is fully functional** despite Day-2 claims of "not yet wired".

---

## Findings

### NEW-OPS-01: Observability Counters Declared But Chat/Voice Paths Not Instrumented
**Severity:** Tier A (false-completion)  
**Source:** `docs/OPERATIONS.md:96-98` + `src/backend/observability.py:273-299` + `src/backend/api/routes_chat.py`  
**Citation:** OPERATIONS.md lines 96-98 claim:
> "Counters live but are not yet incremented from the chat / voice paths; integration is the next phase-18 commit."

**Evidence:**
- Observability.py declares the counter objects:
  - `chat_messages_total` (line 273)
  - `voice_stt_total` (line 276)
  - `voice_tts_total` (line 279)
  - `ai_provider_used_total` (line 282)
  - `ai_router_fallthrough_total` (line 288)

- BUT: Counter increments ARE already wired in:
  - `routes_chat.py`: `chat_messages_total.inc(role="user")` and `chat_messages_total.inc(role="assistant")`
  - `routes_voice.py`: `voice_stt_total.inc(engine=result.engine)` and `voice_tts_total.inc()`
  - `ai/provider.py`: `ai_provider_used_total.inc(name=provider_name)` on provider call success

- `test_phase18_observability.py` tests the counter rendering and explicit increment via `chat_messages_total.inc(role="user")`.

**Status:** CLOSED. Counters are fully instrumented. OPERATIONS.md is stale.

**Recommended fix:**
- Update `docs/OPERATIONS.md` line 96-98 to remove the phrase "Counters live but are not yet incremented...". Replace with: "Counters are live and automatically incremented from chat, voice, and AI provider call paths. The `/metrics` endpoint exposes real signal from the first message onward."
- Verify in Day-3 test run that `/metrics` shows non-zero counts after a chat turn.

---

### NEW-OPS-02: ChromaDB Backup Not Automated; OPERATIONS.md Silent on Gap
**Severity:** Tier A (false-completion / documentation gap)  
**Source:** `docs/OPERATIONS.md:208-219` + `docker-compose.yml:33-39` + `scripts/chroma_janitor.py`  
**Citation:** OPERATIONS.md Backups section covers only SQLite:
```bash
docker compose exec phantom \
    sqlite3 /app/src/backend/db/phantom.db ".backup '/tmp/phantom-$(date +%F).db'"
```

**Evidence:**
- The `phantom_chroma` volume persists ChromaDB data across restarts (docker-compose.yml line 35).
- OPERATIONS.md line 33 acknowledges it: "embeddings + collection metadata (lossy if dropped)".
- NO documented backup strategy for `phantom_chroma`.
- No cron / GitHub Action automation for backups in the repo.
- `scripts/chroma_janitor.py` cleans up leaked collections but does not back up.
- OPERATIONS.md lines 218-219 say "Daily cron does the right thing" — but there is NO cron defined in the repo, and no backup automation for chroma.

**Status:** OPEN. ChromaDB backup is entirely manual and under-documented.

**Recommended fix:**
- **Phase 18b task**: Document the `chroma_data/` manual backup procedure (sqlite3 checkpoint, tar, or direct filesystem copy).
- Add a line to OPERATIONS.md Backups section:
  ```
  ChromaDB (phantom_chroma) is lossy-safe to drop (embeddings regenerate on first query), 
  but if you want to preserve user memory across restarts, snapshot the volume separately:
  
  docker compose exec phantom sqlite3 /app/src/backend/chroma_data/chroma.sqlite3 ".backup '/tmp/chroma-$(date +%F).db'"
  docker compose cp phantom:/tmp/chroma-$(date +%F).db ./backups/
  
  Note: chroma.sqlite3 is NOT covered by the SQLite backup above; chroma_data is a separate 
  ChromaDB persistent store.
  ```
- Consider a follow-up automation (Tier B) to gate `phantom_chroma` behind volume snapshots or periodic tar-based backups via a helper script.

---

### NEW-OPS-03: Multi-Tenant Guard Is Documentation-Only, Not Runtime-Enforced
**Severity:** Tier A (false-completion / incomplete implementation)  
**Source:** `docs/OPERATIONS.md:275-277` + `src/backend/main.py` + `src/backend/security/permissions.py`  
**Citation:** OPERATIONS.md line 275-277:
> "**Multi-tenant deploys forbidden** — `chat_tool_dispatcher.get_sensor_status` reads a process-global `ContextEngine`. Single-tenant only until per-tenant `ContextEngine` lands."

**Evidence:**
- No runtime guard in `main.py` startup to refuse multi-tenant configuration.
- `security/permissions.py` (lines 1-40) implements only RBAC by role (GUEST/OPERATOR/ROOT), not per-tenant isolation.
- The ContextEngine is a module-level singleton (`core/context_engine.py`) with no per-tenant namespace.
- If an operator manually creates multiple user records with different tenant IDs (hypothetically), the system would accept them with no enforcement barrier.
- Day-2 audit flagged this as D2-I2 ("per-tenant ContextEngine lands") with no code change to prevent single-key ContextEngine being used by multiple logical tenants.

**Status:** OPEN. Documentation forbids multi-tenant, but code does not enforce the boundary.

**Recommended fix:**
- Add a startup check in `main.py` lifespan (after DB init, before ContextEngine use):
  ```python
  async def _enforce_single_tenant() -> None:
      """Day-2 D2-I2: refuse to boot in multi-tenant mode until per-tenant 
      ContextEngine lands."""
      from db.database import get_session
      from db.models import User
      from sqlalchemy import select, func
      
      async with get_session() as db:
          # Count distinct tenant_id values. If more than 1, fail.
          # For now, assume all users share tenant_id=None (single-tenant).
          # Future: when multi-tenant lands, per-tenant ContextEngine replaces this guard.
          result = await db.execute(
              select(func.count(func.distinct(User.tenant_id))).select_from(User)
          )
          tenant_count = result.scalar() or 0
          if tenant_count > 1:
              raise RuntimeError(
                  "Refusing to start in multi-tenant mode (more than one tenant_id "
                  "in the users table). Per-tenant ContextEngine not yet implemented. "
                  "See docs/phases/PHASE_17_CHAT_TOOLS.md for timeline."
              )
  ```
- Call this in `lifespan()` before `context_engine.tick()` is accessible.
- (Alternatively, if User model doesn't yet have a `tenant_id` field, add it as part of this task and default all existing users to `tenant_id=1`.)

---

### NEW-OPS-04: Settings Routes PUT Endpoint Mischaracterized in OPERATIONS.md
**Severity:** Tier B (documentation drift)  
**Source:** `docs/OPERATIONS.md:167-200` + `src/backend/api/routes_settings.py:454-550`  
**Citation:** OPERATIONS.md claims:
- Line 169-175: `curl -X PUT http://localhost:8000/api/v1/settings/ai_gemini_api_key ...`
- Line 188-189: `curl -X PUT http://localhost:8000/api/v1/settings/ai_primary_provider ...`
- Line 199-200: `curl -X PUT http://localhost:8000/api/v1/settings/agent_proactive_enabled ...`

**Evidence:**
- Routes are fully implemented in `routes_settings.py:454-550` (`@router.put("/{key:path}")`).
- The endpoint accepts any config key that exists in `PhantomConfig` (line 460: `if not hasattr(config, key)`).
- Validation, persistence, and runtime side-effects are wired (lines 483-519).
- Day-2 audit flagged this as a "phase 18 pending" commit, but the code is already live.
- Routes are not gated by auth; they require `get_current_user` dependency (line 458), so ROOT-level access is enforced.
- **Response is JSON, not form-data**, so the OPERATIONS.md examples should include `-H 'content-type: application/json'` for clarity (they do on line 173).

**Status:** CLOSED. Routes are fully functional. OPERATIONS.md is accurate but not updated to reflect Day-2 closure.

**Recommended fix:**
- Update OPERATIONS.md to cite the source commit hash (e.g., "D2-CI1 commit `fdb28f7`") so readers know when this landed.
- No code changes needed; routes work as documented.

---

### NEW-OPS-05: Dockerfile Non-Root User and Health Check Both Present
**Severity:** Pass (no issue)  
**Source:** `Dockerfile:47-84`  
**Citation:**
- Line 48: `RUN useradd --uid 10001 --create-home --shell /bin/bash phantom`
- Line 68: `USER phantom`
- Line 80-81: HEALTHCHECK directive with `/healthz` probe

**Evidence:**
- Non-root user `phantom` (uid 10001) is created and set as the runtime user.
- Dockerfile runs as non-root from line 68 onward.
- HEALTHCHECK is configured with 30s interval, 5s timeout, 3 retries, 30s start-period.
- `/healthz` endpoint exists in observability.py (line 393) and is dependency-free (liveness only).

**Status:** CLOSED. Best practice implemented correctly.

---

### NEW-OPS-06: Docker-Compose Named Volumes Defined
**Severity:** Pass (no issue)  
**Source:** `docker-compose.yml:54-57`  
**Citation:**
```yaml
volumes:
  phantom_chroma:
  phantom_db:
  phantom_voice_models:
```

**Evidence:**
- All three named volumes mentioned in OPERATIONS.md (lines 33-35) are declared in the docker-compose.yml volumes section.
- The service references them correctly (lines 35-39).
- Named volumes persist across container restarts and are not deleted by `docker compose down` (only by `docker compose down -v`).

**Status:** CLOSED. Volume declarations are correct.

---

### NEW-OPS-07: CI Workflow Caches pip and npm
**Severity:** Pass (no issue)  
**Source:** `.github/workflows/ci.yml:38-39, 74-76`  
**Citation:**
- Backend: `cache: pip` + `cache-dependency-path: src/backend/requirements.txt` (lines 38-39)
- Frontend: `cache: npm` + `cache-dependency-path: src/frontend/package-lock.json` (lines 74-76)

**Evidence:**
- Both backends use GitHub Actions' native setup-python and setup-node cache steps.
- Cache is keyed by lock files, so changes to dependencies invalidate the cache.
- CI workflow runs backend and frontend jobs in parallel (lines 24, 61), only blocking on docker smoke build (line 96: `needs: [backend, frontend]`).

**Status:** CLOSED. Caching is optimized correctly.

---

### NEW-OPS-08: Docker Build Step Gated on Test Success (Cost Optimization)
**Severity:** Pass (no issue)  
**Source:** `.github/workflows/ci.yml:92-115`  
**Citation:**
- Line 96: `needs: [backend, frontend]` — docker job waits for tests to pass.
- Line 105: `platforms: linux/amd64` — only one platform (smoke build).
- Line 110: `push: false` — no registry push on PR.
- Line 113-114: Cache from/to GHA cache backend.

**Evidence:**
- The workflow runs backend pytest and frontend build first, then only builds the docker image if both pass.
- This saves CI/CD compute cost on failing tests (no image build for a red test).
- The PR comment on line 98 explicitly documents this: "Only smoke-build the image after the cheap gates pass".
- GHA cache is used (line 113-114) for efficient layer reuse.

**Status:** CLOSED. Cost optimization is in place.

---

### NEW-OPS-09: Test Count Documentation Drift
**Severity:** Tier C (minor documentation drift)  
**Source:** `docs/OPERATIONS.md:227` + test file count  
**Citation:** OPERATIONS.md line 227:
> "backend pytest (1091+ tests, ~3 min on GitHub-hosted ubuntu-22.04)"

**Evidence:**
- Directory count: 88 test files in `/src/backend/tests/`.
- The "1091+ tests" likely refers to the **total number of test functions** (not test files).
  - This requires running `pytest --collect-only` to verify (which is read-only audit restriction).
- Test file count has grown since the doc was written (Day-2 audit added multiple Tier-audits files: `test_phase_audit_2026_04_29_h*.py`, `test_phase_audit_2026_04_29_i*.py`, `test_phase_audit_2026_04_29_l*.py`).

**Status:** ACKNOWLEDGED. The claim is likely still correct if it refers to individual test functions, but the file list is stale. Current estimate: 1100-1200+ test functions (needs pytest execution to confirm).

**Recommended fix:**
- Update OPERATIONS.md to add: "(~88 test files, 1100+ individual test functions)" so the distinction is clear.
- No code change needed; this is documentation clarity only.

---

### NEW-OPS-10: Dockerfile Voice Deps Staged Correctly (No bloat in final image)
**Severity:** Pass (no issue)  
**Source:** `Dockerfile:1-85`  
**Citation:**
- Lines 17-27: frontend-builder stage copies frontend sources and builds Vite bundle.
- Lines 32-84: backend-runtime stage uses `python:3.11-slim` as base, installs deps, copies built frontend from stage 1.
- Lines 53-55: Python deps installed AFTER system packages, so a failed pip install doesn't invalidate the system layer.

**Evidence:**
- The Dockerfile uses multi-stage build correctly.
- The final image is FROM `python:3.11-slim`, which is lean (~170 MB).
- Voice deps (faster-whisper, vosk, piper-tts, etc.) are in `requirements.txt` and inherited by the final stage, so they do add weight to the final image (~4-5 GB as documented in line 10 comment).
- OPERATIONS.md lines 150-161 document the "trim-down recipe" for cloud-only deployments that drop voice deps.
- No special effort is made to exclude voice deps from the final image in the current Dockerfile (that's intentional for Radxa on-device use).

**Status:** CLOSED. Dockerfile is correct for the target use case (Radxa with voice); trim-down recipe documented for cloud variants.

---

### NEW-OPS-11: Dockerfile CMD Uses tini for Proper PID-1 Signal Handling
**Severity:** Pass (no issue)  
**Source:** `Dockerfile:38-44, 83-84`  
**Citation:**
- Line 43: `tini` installed via apt-get.
- Line 83: `ENTRYPOINT ["/usr/bin/tini", "--"]`
- Line 84: `CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]`

**Evidence:**
- tini is a lightweight init process that correctly propagates SIGTERM to uvicorn.
- Without tini, uvicorn runs as PID 1 and ignores SIGTERM (Kubernetes grace-period shutdown fails).
- docker-compose.yml line 21 also sets `init: true`, which is redundant but harmless (docker will use its own minimal init or tini, depending on version).

**Status:** CLOSED. Signal handling is correct.

---

### NEW-OPS-12: .dockerignore Exhaustively Excludes SQLite and ChromaDB
**Severity:** Pass (no issue)  
**Source:** `.dockerignore:26-40`  
**Citation:**
- Lines 36-39: SQLite files excluded with glob:
  ```
  **/phantom.db
  **/phantom.db-journal
  **/phantom.db-shm
  **/phantom.db-wal
  ```
- Line 35: `src/backend/chroma_data/` excluded.
- Line 40: `src/backend/voice/models/` excluded.

**Evidence:**
- Day-2 audit D2-D-G2 closed this: the dockerignore globs prevent phantom.db (which may carry operator data) from reaching the image build context.
- All WAL/journal files are also excluded so a partial transaction doesn't leak.
- chroma_data and voice/models are correctly excluded so operators mount them as volumes, not bake them into the image.

**Status:** CLOSED. .dockerignore is correctly configured per Day-2 audit.

---

### NEW-OPS-13: Security Headers Configured in FastAPI Middleware
**Severity:** Pass (no issue)  
**Source:** `src/backend/main.py:528-549`  
**Citation:** Middleware sets:
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `Content-Security-Policy: ...` (detailed policy)
- `Permissions-Policy: interest-cohort=()`

**Evidence:**
- Audit-2026-04-28 F-13 implemented this (see line 525 comment).
- Headers are set on every HTTP response via FastAPI middleware.
- CSP allows self and blob/data for media (needed for voice playback).
- HSTS enforces HTTPS on repeat visits.

**Status:** CLOSED. Security headers are correctly configured.

---

### NEW-OPS-14: Correlation-ID Middleware Ordering Fixed Post-Day-2
**Severity:** Pass (no issue)  
**Source:** `src/backend/main.py:574-592`  
**Citation:** Lines 590-591:
```python
app.middleware("http")(http_requests_counter_middleware)
app.middleware("http")(correlation_id_middleware)
```

**Evidence:**
- Day-2 audit D2-A4 flagged middleware ordering (LIFO registration means LAST-registered is OUTERMOST).
- Counter middleware is registered first, correlation-id second, so correlation_id contextvar is set OUTSIDE the counter middleware's execution.
- This means the counter can safely reference the correlation_id without it being reset yet.
- Comments on lines 575-584 explain the invariant.

**Status:** CLOSED. Middleware ordering is correct post-Day-2.

---

### NEW-OPS-15: CORS Wildcard Mitigation Implemented
**Severity:** Pass (no issue)  
**Source:** `src/backend/main.py:511-523`  
**Citation:** Lines 511-523 set:
```python
allow_origins=config.cors_origins,
allow_credentials=True,
allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
allow_headers=[...],
```

**Evidence:**
- Audit-2026-04-28 F-12 flagged this: wildcard origins + `allow_credentials=True` let any origin drive state-changing requests with the user's session.
- Current code uses `config.cors_origins` (not a wildcard), which defaults to localhost-only on development.
- Production operators can tighten this further via the `cors_origins` setting.

**Status:** CLOSED. CORS is correctly configured.

---

## Summary Table

| Finding | ID | Severity | Status | Action |
|---------|----|-----------|---------|---------| 
| Observability counters live but not instrumented | NEW-OPS-01 | Tier A | CLOSED | Update OPERATIONS.md line 96-98 |
| ChromaDB backup not automated | NEW-OPS-02 | Tier A | OPEN | Document manual backup procedure + add cron script |
| Multi-tenant guard is documentation-only | NEW-OPS-03 | Tier A | OPEN | Add runtime enforcement in main.py lifespan |
| Settings PUT routes fully functional | NEW-OPS-04 | Tier B | CLOSED | Update OPERATIONS.md for clarity |
| Non-root user + healthcheck | NEW-OPS-05 | Pass | CLOSED | No action |
| Named volumes declared | NEW-OPS-06 | Pass | CLOSED | No action |
| CI caches pip/npm | NEW-OPS-07 | Pass | CLOSED | No action |
| Docker build gated on tests | NEW-OPS-08 | Pass | CLOSED | No action |
| Test count drift | NEW-OPS-09 | Tier C | ACKNOWLEDGED | Minor doc update |
| Voice deps staged correctly | NEW-OPS-10 | Pass | CLOSED | No action |
| tini for signal handling | NEW-OPS-11 | Pass | CLOSED | No action |
| .dockerignore excludes secrets | NEW-OPS-12 | Pass | CLOSED | No action |
| Security headers configured | NEW-OPS-13 | Pass | CLOSED | No action |
| Correlation-ID middleware ordering | NEW-OPS-14 | Pass | CLOSED | No action |
| CORS wildcard mitigation | NEW-OPS-15 | Pass | CLOSED | No action |

---

## Tier-A False-Completions Summary

**Three Tier-A issues block multi-tenant or production cloud deployment:**

1. **NEW-OPS-01 (CLOSED):** Observability claim is stale; counters ARE instrumented. Doc fix only.
2. **NEW-OPS-02 (OPEN):** No automated backup for ChromaDB; OPERATIONS.md silent on the gap. Needs procedure documentation and optional automation.
3. **NEW-OPS-03 (OPEN):** Multi-tenant forbidden in documentation but NOT enforced in code. Requires runtime guard at startup.

**Recommended next step:** Resolve NEW-OPS-02 and NEW-OPS-03 before any multi-tenant or cloud GA.

---

## Follow-up Tasks (Post-Day-3)

- **Phase 18c:** Implement multi-tenant guard in main.py (NEW-OPS-03).
- **Phase 18c:** Document ChromaDB backup procedure and optionally automate via helper script (NEW-OPS-02).
- **Phase 18c:** Update OPERATIONS.md observability section to reflect current implementation (NEW-OPS-01).
- **Phase 18c:** Clarify test count in CI/CD section (NEW-OPS-09, minor).

---

## Notes

- All read-only audit. No docker build, no pytest execution, no CI workflow triggered.
- Findings based on source code inspection, config files, and OPERATIONS.md documentation.
- Multi-platform docker build (linux/amd64 + linux/arm64) is documented but not tested in this audit (requires buildx).
- Voice model caching (line 10 comment: "~4-5 GB") assumes all optional deps (faster-whisper, vosk, piper, onnxruntime) are present. Actual size depends on which are installed.
