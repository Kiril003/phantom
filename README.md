# PHANTOM OS

3PHANTOM OS is a **Sentient Familiar**: a local-first AI shell that observes context, remembers, anticipates, and acts as a professional autonomous companion. It is not just a dashboard or a chat surface; the chat, voice, memory, agent runtime, and Sunrise UI are one behavioural system.

Targets a [Radxa Dragon Q6A](https://radxa.com/products/dragon/q6a) (Snapdragon QCM6490, Hexagon V68 NPU) paired with an ESP32-S3 sensor hub, running a 7" 1024×600 touchscreen — but the backend deploys cleanly to any Linux box where Gemini or a local Ollama can reach the network.

```
┌──────────────────────────────────────────────────────────────────┐
│  Brain  ─  Radxa Q6A  ─  Linux ARM64                             │
│       FastAPI · ContextEngine · ChromaDB · NPU‑accelerated STT   │
│       React 18 + Vite UI mounted on the same FastAPI process     │
└────────────────────────────┬─────────────────────────────────────┘
                             │  Serial 921600 baud, JSON 500 ms batch
┌────────────────────────────┴─────────────────────────────────────┐
│  Nerves  ─  ESP32‑S3  ─  FreeRTOS                                │
│       LD2410 radar · GPS · BME280 · RFID · RGB · servos · OLED   │
└──────────────────────────────────────────────────────────────────┘
```

## Quick start

### Single-tenant (Docker Compose)

```bash
cp .env.example .env                                          # set JWT_SECRET_KEY + AI_GEMINI_API_KEY
docker compose up -d --build                                  # builds the multi-stage image
curl http://localhost:8000/healthz                            # liveness
curl http://localhost:8000/readyz                             # readiness (db + chroma + ai reachable)
```

The container exposes the FastAPI backend AND the built React bundle on port 8000. Reverse-proxy via Caddy / Traefik for TLS. See [`docs/OPERATIONS.md`](docs/OPERATIONS.md) for first-boot hardening, scaling notes, and the cloud-only trim-down recipe.

### Local dev

```bash
# Backend
cd src/backend
python3.11 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn main:app --reload --host 127.0.0.1 --port 8000

# Frontend (in another shell)
cd src/frontend
npm ci
npm run dev      # vite at :5173

# Tests
.venv/bin/python -m pytest -q                          # backend (~3 min, 1090+ tests)
npm run typecheck && npm run build                      # frontend strict TS + vite production
```

The repo's `start-phantom.sh` is the operator's restart helper — it stops both processes, kicks them off again, and curls `/healthz` to confirm the backend is up.

## What ships now

| Layer | Status | Notes |
|---|---|---|
| Backend (FastAPI · Pydantic 2 · SQLAlchemy 2 async · ChromaDB) | Production | ~1230 pytest green (Day-3 +35) |
| Frontend (React 18 · Vite 5 · TypeScript strict · Zustand) | Production | strict tsc clean · vite build clean |
| Voice stack (Vosk → faster-whisper → NPU Whisper → MMS-1B + CTC) | Production | STT has instant/refined tiers; TTS currently uses Piper voices. StyleTTS2 is future work, not the active runtime. |
| Gemini → Ollama AI router | Production | cloud-first when configured, offline-capable fallback through local Ollama, quota-aware cooling, retry policy, audit log |
| **Chat tool-use** (`ai/chat_pipeline.py`) | Opt-in, read-only bounded tools | Ordinary chat is text-first and uses prompt-hydrated memory/context. Operators can enable extra grounding in memory, system metrics, location history, and sensor status. Mutating/risky autonomy still goes through agent approval gates. |
| Rich chat widgets/artifacts | Opt-in labs surface | Charts, maps, metric cards, and HTML artifacts are disabled by default so unfinished UI surfaces do not interrupt normal conversation. |
| Chat tool catalog | Production read-only | search_locationhistory, query_temporal_anchors, recall_memory_facts, get_system_metrics, get_sensor_status |
| `dispatch/` package (state_broadcaster) | Production | Single subscriber owns WS state-transition broadcast + OLED side effect (closes Day-2 F-02 + F-03 dup) |
| Auth boundary | Hardened | Default-PIN remote refusal, XFF-aware lockout (`security_trust_xff`), strict JWT `orig_iat` cap, `/refresh` lockout, login-lockout on RFID/PIN |
| Multi-tenant runtime guard | Production | `deployment_mode='multi'` refused unless `PHANTOM_ALLOW_MULTI_TENANT_PREVIEW=1` (D2-I2 invariant enforced in code) |
| `/healthz` `/readyz` `/metrics` Prometheus exposition | Production | `_probe_chroma` heartbeats, ChromaDB janitor at lifespan startup |
| `X-Correlation-Id` middleware + JSON formatter | Production | `log_json_enabled=true` flips a stdlib JSON renderer with `correlation_id` as a top-level field |
| Multi-stage Dockerfile (amd64 + arm64) + docker-compose.yml | Production | non-root uid 10001, healthcheck-wired, persistent volumes |
| GitHub Actions CI | Production | backend pytest + frontend typecheck/build + Docker buildx smoke |

### Day-3 closures (2026-04-30)

* **12 / 12 Tier-A false-completions** flagged by the 8-reviewer audit
  swarm closed (`docs/audit-2026-04-30-day3/FINDINGS.md`). Notable:
  default-PIN no longer reachable from the LAN, F-15 lockout
  XFF-aware, F-17 chroma-janitor wired to lifespan, `_probe_chroma`
  pings the client.
* **Concept coherence pass** makes PHANTOM's canonical identity explicit:
  Sentient Familiar, local-first privacy posture, proactive but approval-aware
  autonomy, and Sunrise/Familiar state language.
* **Settings UI auto-render** — Day-2 + Day-3 config keys now
  surface in `routes_settings.CATEGORY_SPEC` so the operator can
  flip them without touching `.env`.

Roadmap (deferred to Day-4): F-58 subprocess sandbox, F-40 realpath
workspace check, frontend D2-FE2..FE5 touch-target rewrites, per-tenant
ContextEngine, Tier-F latents (F-29..F-41 + D3-F-1..F-3).

## Engineering principles (from `CLAUDE.md`)

The non-negotiables are documented in `CLAUDE.md`:

- No mocks, TODOs, or stubs in product code — every committed file ships a full implementation.
- 44×44 px minimum touch targets — the device is a physical screen.
- The UI is strictly 1024×600 — no overflow, no scroll on the main surfaces.
- Gemini always has an Ollama fallback; faster-whisper always has a Vosk fallback; NPU paths always have a CPU fallback.
- Every config is reachable from the Settings UI.
- Animations carry information; decorative ones are zero.
- Tests after every phase — `pytest` backend + `vitest` frontend; no red commits.

## Where to read next

- **`docs/AUTONOMOUS_DAY_PLAN.md`** — the canonical day-plan that produced v0.18.0-saas-base.
- **`docs/AUTONOMOUS_DAY_PLAN_DAY3.md`** — historical Day-3 multi-agent plan.
- **`docs/audit-2026-04-28/FINDINGS.md`** — Day-1 multi-perspective audit (69 findings).
- **`docs/audit-2026-04-29-day2/FINDINGS.md`** — Day-2 audit (24 closures).
- **`docs/audit-2026-04-30-day3/FINDINGS.md`** — Day-3 audit (12 Tier-A + 4 TM-17B Critical mitigations).
- **`docs/OPERATIONS.md`** — operator runbook.
- **`docs/phases/`** — per-phase acceptance docs (Phase 16 chat context, Phase 17 chat tools, Phase 15+15b NPU STT, etc.).
- **`CLAUDE.md`** — engineering rules + project structure + dev commands.

## License

Closed for now. Operator owns the codebase and the device.
