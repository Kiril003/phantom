# PHANTOM OS — Operations Guide

Audience: operators standing up an instance — single-tenant on a Radxa
device today, single-tenant cloud or multi-tenant later. The guide is
the answer to *"someone hands me a fresh box, what do I do?"*.

---

## Quickstart (Docker Compose, single-tenant)

```bash
git clone <repo>
cd phantom-os

cp .env.example .env
# Edit .env:
#   JWT_SECRET_KEY  =  $(python -c 'import secrets; print(secrets.token_urlsafe(48))')
#   AI_GEMINI_API_KEY = <key from https://aistudio.google.com/apikey>

docker compose up -d --build
curl http://localhost:8000/healthz                # liveness
curl http://localhost:8000/readyz                 # readiness (db + chroma + ai)
curl http://localhost:8000/metrics | head         # Prometheus exposition
```

The container exposes the FastAPI backend AND the built React bundle on
port 8000. Reverse-proxy with Caddy / Traefik for TLS.

### Volumes the operator must persist

| Volume                  | Mount inside container                         | What it carries |
|-------------------------|------------------------------------------------|-----------------|
| `phantom_chroma`        | `/app/src/backend/chroma_data`                 | embeddings + collection metadata (lossy if dropped) |
| `phantom_db`            | `/app/src/backend/db`                          | SQLite — users, sessions, location history, audit |
| `phantom_voice_models`  | `/app/src/backend/voice/models`                | Vosk / Whisper / Piper / NPU bundles dropped in by the operator |

`docker compose down` keeps these. `docker compose down -v` deletes them.

---

## First-boot hardening

The default deploy keeps audit-2026-04-28 F-07 (default `phantom`/`000000`
ROOT user) and F-08/F-09 (voice & settings GET routes unauthenticated)
in place. Productisation gates close those:

1. **Rotate the ROOT PIN immediately.** Open the device UI → Settings →
   Auth → change PIN. The auto-login bypass refuses to fire after the
   PIN has been changed away from `000000` (B-2 commit, `f488298`).
2. **Set `JWT_SECRET_KEY`** to a fresh value before first boot. A
   compromised default key invalidates every issued session.
3. **Bind the daemon to a non-public interface** until you've put a
   reverse proxy in front; the in-container `0.0.0.0` is fine because
   the container's network is bridged through compose.
4. **Lower `agent_risk_tolerance`** to `1` (SAFE only) when the LLM
   has any path to the internet. The B-2 default is `3` (LOW); MEDIUM
   actions like `bash.run` already require an opt-in.
5. **Set `chat_prompt_logging_enabled = true` only when you've decided
   on retention.** Phase 16 makes the column nullable; the row is
   written into `ai_tool_use_log` indefinitely until you prune.

---

## Endpoints

### Liveness / Readiness

| Path        | Purpose      | Behaviour |
|-------------|--------------|-----------|
| `/healthz`  | Liveness     | Always 200 if process up. No deps. K8s `livenessProbe`. |
| `/readyz`   | Readiness    | 200 only if DB ping + chroma list + AI provider reachable. 503 otherwise. K8s `readinessProbe`. |
| `/health`   | Legacy combined check (kept for compatibility with `start-phantom.sh`). |
| `/metrics`  | Prometheus exposition (text/plain). |

The router emits `X-Correlation-Id` on every response. Pass an
`X-Correlation-Id` header (≤ 64 chars) to bind a request to your own
trace; otherwise the middleware generates one.

### Metrics

The hand-rolled exposition (no `prometheus_client` dep — see
`src/backend/observability.py`) carries:

```
phantom_build_info{version="..."} 1
phantom_uptime_seconds                       gauge, process uptime
phantom_ws_clients                           gauge, current WS count
phantom_chat_messages_total{role=...}        counter
phantom_voice_stt_total{engine=...}          counter
phantom_voice_tts_total                      counter
phantom_ai_provider_used_total{name=...}     counter
phantom_ai_router_fallthrough_total          counter
phantom_http_requests_total{method=...}      counter
```

Counters are wired into the hot paths as of `v0.18.1-saas-base`:
`phantom_chat_messages_total`, `phantom_voice_stt_total`,
`phantom_voice_tts_total`, and `phantom_ai_provider_used_total` all
increment from `routes_chat`, `routes_voice`, and `ai/provider.py`.
`phantom_ai_router_fallthrough_total` is registered but is wired in
the Day-3 O-6 commit (Tier-E follow-up). The endpoint is
scraping-safe at all times.

### Prometheus scrape config snippet

```yaml
scrape_configs:
  - job_name: phantom
    metrics_path: /metrics
    scheme: http
    static_configs:
      - targets: ['phantom:8000']
```

---

## Logs

Every log record carries `correlation_id` (via `observability.CorrelationFilter`).
Outside an HTTP request the value is `-`. To use a structured renderer,
attach the filter to the root handler in your config:

```python
import logging
from observability import CorrelationFilter

handler = logging.StreamHandler()
handler.addFilter(CorrelationFilter())
handler.setFormatter(logging.Formatter(
    '{"ts":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s",'
    '"cid":"%(correlation_id)s","msg":"%(message)s"}'
))
logging.getLogger().addHandler(handler)
```

A first-class `structlog` wiring lands in a follow-up commit; the filter
makes that swap a one-liner.

---

## Scaling notes

* **Single-tenant on Radxa Q6A** is the canonical target. Voice / NPU
  / serial bridge live on-device; `docker compose up` is for laptop
  / homelab demos.
* **Cloud (single tenant per VM)** — drop the `voice` and `serial`
  layers, keep AI router + chat tools. Use the `Dockerfile` as-is;
  `docker compose down phantom_voice_models` is harmless.
* **Multi-tenant** — needs work the audit flagged but didn't land:
  per-user rate limit (F-15 — coming in Block E-4), JWT revocation
  table (F-14), `chroma_data` per-tenant sharding (F-17 perf finding).
  Don't ship multi-tenant against this Dockerfile until those land.

### Trim-down recipe (cloud-only, no voice)

For deployments that don't need on-device voice, replace
`requirements.txt` line by line dropping these heavy deps:

```
faster-whisper, vosk, piper-tts, opencv-python-headless, playwright
```

Image drops from ~5 GB to ~1.2 GB. Tests in `test_phase07_voice.py`
fail without these — gate them with `@pytest.mark.skipif(not _voice_deps)`
in your fork.

---

## Common ops scenarios

### Rotate the Gemini key

```bash
docker compose exec phantom \
    curl -X PUT http://localhost:8000/api/v1/settings/ai_gemini_api_key \
         -H 'authorization: Bearer <ROOT-jwt>' \
         -H 'content-type: application/json' \
         -d '{"value": "<new-key>"}'
```

The router re-reads the live config on the next outbound call (no
restart needed; B-3 telemetry catches the swap in
`ai_tool_use_log.provider`).

### Drain an instance for maintenance

`/readyz` returns 503 when any check fails — including a synthetic
"AI unavailable". To drain without a restart:

```bash
docker compose exec phantom \
    curl -X PUT http://localhost:8000/api/v1/settings/ai_primary_provider \
         -d '{"value": "none"}'
```

Wait for the LB to remove the instance from rotation, then proceed.
Unset to re-enable.

### Disable the proactive loop

```bash
docker compose exec phantom \
    curl -X PUT http://localhost:8000/api/v1/settings/agent_proactive_enabled \
         -d '{"value": false}'
```

Useful when debugging chat behaviour — the proactive loop runs every
30-300 s and shares the AI quota.

---

## Backups

`phantom_db` is the durable store. Snapshot via:

```bash
docker compose exec phantom \
    sqlite3 /app/src/backend/db/phantom.db ".backup '/tmp/phantom-$(date +%F).db'"
docker compose cp phantom:/tmp/phantom-$(date +%F).db ./backups/
```

Daily cron does the right thing. Keep ≥ 7 days; LocationHistory rotates
automatically at 90 days, audit log retention is in your hands.

---

## CI / CD

`.github/workflows/ci.yml` (E-3 commit) gates every push:

* backend pytest (1091+ tests, ~3 min on GitHub-hosted ubuntu-22.04)
* frontend typecheck + vite build
* docker buildx (linux/amd64 smoke build with GHA cache)

PR merge requires all three. To run the same gates locally:

```bash
# Backend
cd src/backend && .venv/bin/python -m pytest -q

# Frontend
cd src/frontend && npm run typecheck && npm run build

# Docker (heavy, ~5 min cold)
docker buildx build --platform linux/amd64 .
```

---

## Day-2 audit closures (2026-04-29)

The Day-2 multi-perspective audit (`docs/audit-2026-04-29-day2/FINDINGS.md`)
flagged 5 false-completions in `v0.18.0-saas-base` plus 13 Tier C
chat-tool security items and 6 Tier E auth/ops items. All shipped in
`v0.18.1-saas-base`.

New config keys (set via env or Settings UI):

| Key | Default | Purpose |
|---|---|---|
| `chat_tool_call_timeout_s` | `10.0` | Per-call wall-clock cap on the chat-tool dispatcher. |
| `chat_tool_max_total_ms` | `12000` | Per-turn ceiling for the entire `call_with_tools` loop (Phase 17b reads this). |
| `log_json_enabled` | `false` | Flip on for production: stdlib JSON formatter on every root-logger handler, with `correlation_id` as a top-level field. |

Auth-boundary invariants (enforced in code):

* **Default-PIN auto-login refused** — daemon will not surface a
  single-ROOT user whose PIN is still bootstrap `'000000'`. Operator
  must explicitly log in once before auto-login resumes.
* **JWT 30-day absolute cap** — tokens carry `orig_iat`; refresh
  preserves it. Refresh chains die at 30 days regardless of per-token
  TTL — re-auth required.
* **Login lockout** — 5 failures inside 60 s on either the IP or the
  username locks for 15 min. Client gets HTTP 429 + `Retry-After` +
  `X-Error-Code: LOCKED_OUT`.
* **CI placeholder secret refused at startup** — daemon won't boot
  with `JWT_SECRET_KEY=ci-fixed-secret-do-not-reuse`. Set
  `PHANTOM_ALLOW_CI_SECRET=1` to override (CI runs only).
* **Multi-tenant deploys forbidden** — `chat_tool_dispatcher.get_sensor_status`
  reads a process-global `ContextEngine`. Single-tenant only until
  per-tenant `ContextEngine` lands. See `docs/phases/PHASE_17_CHAT_TOOLS.md`.

Operator-facing utilities:

* `python scripts/chroma_janitor.py [--dry-run]` — removes leaked
  per-user collections AND orphan UUID-named filesystem dirs from
  `chroma_data/`. Reports freed-bytes. Audit F-17 backlog (110 MiB on
  the dev box) cleared with one run.
* `python -m memory.strategic_memory.init_chroma_eager` warm-up runs
  automatically at FastAPI lifespan startup so `/readyz` cold first
  hit no longer pays the 2-3 s `list_collections` scan.

## What this guide doesn't cover yet

Tracked under future phases:

* **Phase 17b chat `call_with_tools` loop** — Tier D from the Day-2
  audit. The dispatcher is consolidated and the 5 read-only handlers
  ready; `routes_chat._build_ai_response` swap pending. Tag
  `v0.19.0-jarvis-online` lands here.
* **F-58 subprocess sandbox** — `agent/actions/{net,bash,notify}` and
  `agent/mcp/adapter` to route through a future `safety/sandbox.py`.
  Tier E follow-up.
* **F-40 `realpath`-based workspace check** — `fs.write` should reject
  symlink path components via `realpath` rather than `abspath`. Tier E
  follow-up.
* **Frontend Settings UI auto-render** — D2-FE1..FE5; the new Day-2
  config keys (`chat_tool_call_timeout_s`, `chat_tool_max_total_ms`,
  `log_json_enabled`) need to surface in the SettingsPanel via the
  `CATEGORY_SPEC` metadata path.
* **Per-tenant `ContextEngine`** — required before any multi-tenant
  cloud deploy (Day-2 D2-I2 invariant).
