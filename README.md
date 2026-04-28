# PHANTOM OS

A live AI assistant for custom hardware. Not a dashboard. Not a chat-bot. An autonomous system with a personality that observes, adapts, anticipates and acts.

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
.venv/bin/uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Frontend (in another shell)
cd src/frontend
npm ci
npm run dev      # vite at :5173

# Tests
.venv/bin/python -m pytest -q                          # backend (~3 min, 1090+ tests)
npm run typecheck && npm run build                      # frontend strict TS + vite production
```

The repo's `start-phantom.sh` is the operator's restart helper — it stops both processes, kicks them off again, and curls `/healthz` to confirm the backend is up.

## What ships in v0.18.0-saas-base

| Layer | Status | Notes |
|---|---|---|
| Backend (FastAPI · Pydantic 2 · SQLAlchemy 2 async · ChromaDB) | Production | 1092 / 1092 pytest green |
| Frontend (React 18 · Vite 5 · TypeScript strict · Zustand) | Production | strict tsc clean · vite build clean |
| Voice stack (Vosk → faster-whisper → NPU Whisper → MMS-1B + CTC) | Production | three latency tiers — instant 60-90 ms (NPU), refined 600-1000 ms (CPU) |
| Gemini → Ollama AI router | Production | quota-aware cooling, retry policy, audit log |
| Chat tool catalog | Phase 17a — read-only handlers shipped | search_locationhistory, query_temporal_anchors, recall_memory_facts, get_system_metrics, get_sensor_status. `call_with_tools` wiring lands in Phase 17b. |
| `/healthz` `/readyz` `/metrics` Prometheus exposition | Production | hand-rolled, no extra dep |
| `X-Correlation-Id` middleware + `CorrelationFilter` | Production | structured-log JSON renderer is a one-line swap (see OPERATIONS.md) |
| Multi-stage Dockerfile (amd64 + arm64) + docker-compose.yml | Production | non-root uid 10001, healthcheck-wired, persistent volumes |
| GitHub Actions CI | Production | backend pytest + frontend typecheck/build + Docker buildx smoke |

Roadmap (deferred to follow-up commits): per-user rate limiter (audit F-15), authenticated `/voice/*` and `/settings/*` (F-08, F-09 — needs an authenticated `TestClient` fixture), `structlog` JSON renderer wiring, Phase 17b `call_with_tools` chat loop.

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
- **`docs/audit-2026-04-28/FINDINGS.md`** — multi-perspective audit punch list (69 findings, 6 tiers).
- **`docs/OPERATIONS.md`** — operator runbook.
- **`docs/phases/`** — per-phase acceptance docs (Phase 16 chat context, Phase 17 chat tools, Phase 15+15b NPU STT, etc.).
- **`CLAUDE.md`** — engineering rules + project structure + dev commands.

## License

Closed for now. Operator owns the codebase and the device.
