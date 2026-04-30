# PHASE SAAS PIVOT — Readiness Assessment + Roadmap

**Author:** session 2026-04-30 (Opus 4.7)
**Status:** scoping document — no code changes here; production decision required.

---

## Why this doc exists

Operator asked: "доробиш повноцінно? саму программу з усим" — meaning a full SaaS product, not just embedded redesign. This file is the honest answer: **PHANTOM as it stands today is an embedded kiosk OS, not a SaaS.** Pivoting it to SaaS is a 4-8 week dedicated track, not a one-night job. This doc lists exactly what's missing, what survives, and how to phase it.

## Current architecture (what survives a SaaS pivot)

These are *transferable* — they don't change with the SaaS pivot:

- ✅ Domain model: ContextEngine + DecisionTree + StateMachine + EventBus
- ✅ AI provider abstraction (Gemini → Ollama fallback) — already provider-agnostic
- ✅ STT/TTS hybrid pipeline — gracefully runs on cloud GPUs or local CPU
- ✅ ChromaDB + SQLite memory layer — needs schema-level tenant_id, but topology survives
- ✅ FastAPI + WebSocket multiplexer — production-grade web server already
- ✅ React 18 + Vite + Tailwind + Framer Motion — works as web app today (`npm run dev` serves it on a public URL)
- ✅ Sunrise design system + Familiar character + 8 inline scene types
- ✅ Sandbox executor — keeps the same shape but the per-tenant resource caps need to be tighter

## What's MISSING for SaaS (the actual work)

### M1 — Multi-tenancy (1-2 weeks, hard)
- Add `tenant_id` to every SQLAlchemy model + every query (auto-filter via SQLAlchemy event hooks)
- ChromaDB: per-tenant collection (already per-user from BE-IDENTITY commit `eb2a10c` — extend pattern to tenant)
- Row-Level Security audit: every read/write must filter by tenant
- Migrate existing `User.id` to `(TenantOrg.id, User.id)` pair — backfill script needed
- Test surface: write `tests/saas/test_tenant_isolation.py` exhaustive cross-tenant probe

### M2 — Auth + Identity for the web (1 week)
- Replace RFID+PIN kiosk auth with OAuth2 (Google + GitHub minimum) + email magic links
- JWT lifecycle: access (15 min) + refresh (7d) + revocation list (Redis-backed)
- Org/team model: TenantOrg has many Users, Users have role (owner/admin/member/guest)
- SSO/SAML for enterprise tier — defer to phase 2

### M3 — Billing (1 week)
- Stripe subscriptions: 3 tiers (Free / Pro / Enterprise)
- Webhooks for invoice paid/failed/disputed → tenant flag flips
- Usage metering: AI tokens consumed, sandbox seconds used, ChromaDB rows stored — billed monthly
- Customer portal embed (Stripe-hosted) for self-service

### M4 — Public landing + onboarding (1 week)
- Marketing site: hero + features + pricing + testimonials + footer (separate Astro/Next project)
- Onboarding wizard: signup → org setup → first agent → first chat → "aha moment" within 5 min
- Email transactional: SendGrid or Postmark (welcome + invoice + alerts)

### M5 — Cloud deployment (3-5 days)
- Container the backend (uvicorn) — already mostly there, write Dockerfile + multi-stage build
- Container the frontend (Vite production build → nginx static)
- Compose: Postgres (replace SQLite), ChromaDB (server-mode, not embedded), Redis (sessions + queue)
- Deploy target: Fly.io or Railway for MVP (cheap, fast); Hetzner Cloud or AWS for scale
- Domain + SSL: Cloudflare DNS + free certs (Let's Encrypt or CF SSL)
- CI/CD: GitHub Actions on push to `main` → build/test/deploy

### M6 — Observability + Reliability (3-5 days)
- Structured logging (already in place, audit it): every log line has `tenant_id`, `user_id`, `request_id`
- Sentry for errors (free tier 5k/month is enough for MVP)
- Healthcheck endpoint `/healthz` deep (DB ping + ChromaDB ping + AI provider ping) — partially exists
- Metrics: Prometheus-compatible `/metrics` endpoint or Grafana Cloud
- Status page: BetterStack or Statuspage.io
- Backup: daily Postgres dump → S3-compatible (Backblaze B2 cheap)

### M7 — Legal + Compliance (1 week)
- Terms of Service + Privacy Policy + DPA (use Termly.io or hire a lawyer 1h consult)
- GDPR: right-to-export, right-to-delete endpoints — auto-generated from per-tenant data
- Cookie consent banner (CookieYes)
- Security disclosure policy + responsible disclosure inbox

### M8 — API + integrations (1 week, optional MVP)
- Public REST API: `/api/v1/agents/...` with API-key auth (separate from JWT)
- Rate limiting: nginx + slowapi or Cloudflare
- Webhooks out: customer registers a URL, PHANTOM POSTs `agent.completed`, `state.changed`, etc.
- API docs: auto-gen from FastAPI OpenAPI → Mintlify or Redoc

## Suggested phasing

| Phase | Weeks | Scope | Outcome |
|---|---|---|---|
| **A — MVP** | 3 weeks | M1 + M2 + M3 + M5 (minimal) + M7 (minimal) | Paying customers, single tier, manual onboarding |
| **B — Growth** | 3 weeks | M4 + M6 + M3 (full tiers) + M2 (SSO) | Self-serve signup, automated onboarding, status page |
| **C — Scale** | 2 weeks | M8 + multi-region + RBAC fine-grained | Public API, partners, enterprise pilots |

**Total: ~8 weeks for a credible SaaS launch from where we are today.**

## What this session shipped INSTEAD

For the avoidance of doubt — this session (overnight 2026-04-29 → 2026-04-30) shipped the **Phase-5 sunrise redesign** of the embedded kiosk product. Full list in `docs/morning-2026-04-30-report.md`. It is:

- 28+ atomic commits, all tested (vitest 323/323 · pytest 1662/1663 — single cross-test pollution flake).
- A **production-grade embedded kiosk OS**: 3 themes, voice-first chat, sandbox, identity fusion, character, full inline scene rendering, single-screen accordion settings.
- **Not** a SaaS. It runs on Radxa Dragon Q6A behind RFID+PIN auth, talks to ESP32-S3 over UART, has no tenant model, no billing, no public landing.

The embedded redesign is **the right thing** to ship first regardless of SaaS pivot — every piece of it (visual system, voice loop, memory architecture, scene composer, identity fusion, character) is reusable in the SaaS form. If you decide to pivot, none of this work is wasted.

## Decision needed from operator

1. **Stay embedded** — keep PHANTOM as a kiosk product, polish it to perfection, sell as appliance/franchise. → continue with phase-5 + carry-forward audit items.
2. **Pivot to SaaS** — accept the 8-week roadmap above. Pick a launch target. Hire/budget for legal + design + marketing. Start with phase A.
3. **Hybrid** — embedded is the high-end "PHANTOM Pro" appliance; SaaS is the low-end "PHANTOM Cloud" subscription. Two products, shared codebase. **Most realistic** but most expensive long-term (two release tracks).

The session-author's recommendation: **start with #3 hybrid**, but in *order* — finish the embedded P0/P1 carry-forward (1 week), then begin SaaS phase-A with the embedded as the proof point ("this exact UX, but in your browser").

## Carry-forward from phase-5 (must close before any pivot)

These are **embedded P0/P1** that block a clean baseline regardless of pivot path. See `docs/audit-2026-04-30-tests.md` and `docs/audit-2026-04-30-verifier.md`:

- ✅ P0 SANDBOX-KILL-PATH — closed (commit `d3e9677`)
- ✅ P0 CHECKPOINT-SCHEMA-DRIFT — closed (commit `d3e9677`)
- ✅ P1 CHATFIX-DEFAULT-SCENE-ATTACHMENT — closed (commit `26bebb7`)
- ✅ P1 STRATEGIC-MEMORY-FILTER — closed (commit `26bebb7`)
- ✅ P1 FE-FLOATING-TOOLBAR-VOICE — closed (commit `4d665d9`)
- ✅ P1 FE-SENTINEL-LABELS — closed (commit `4d665d9`)
- ❌ P1 QA-VISUAL Playwright sweep — NOT DONE (agent OOM'd; re-run when system is idle)
- ❌ P2 DB cleanup residual 35 fixture users (`phantom_i1_*`, `phantom_i3_*`, `phantom_rotated`) — pattern fix in `scripts/cleanup_test_users.py:31`
- ❌ P2 B-2 background_events FE consumer
- ❌ P2 B-9 checkpoint/resume scene
- ❌ P2 B-22 audit log panel
- ❌ P2 B-24 RFID rising-edge event
- ❌ P3 Whisper warm-up bug
- ❌ P3 respond_terminal doesn't execute
- ❌ P3 H-WK-6 voice always-on permission gate
- ❌ P3 H-WK-4 map → FOCUS state collision

**Estimate to close all carry-forwards: 2-3 dedicated days, single-coder, no agent swarm.**
