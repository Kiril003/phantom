# PHANTOM OS — multi-stage container build.
#
# Stage 1  frontend-builder   build Vite React bundle  →  /dist
# Stage 2  backend-runtime    Python 3.11-slim runtime that serves the API
#                              and exposes the dist as static assets.
#
# Build:
#   docker buildx build --platform linux/amd64,linux/arm64 -t phantom-os .
#
# The image is heavy by design (~4-5 GB) because the backend brings the full
# voice / chroma / STT stack. Lighter "cloud-only" variants drop the
# faster-whisper / vosk / piper / onnxruntime layers — see docs/OPERATIONS.md
# for the trim-down recipe.

# ─── Stage 1 — frontend bundle ────────────────────────────────────────────────

FROM node:20-alpine AS frontend-builder

WORKDIR /app

# Copy manifest first so dep install caches independently of source.
COPY src/frontend/package.json src/frontend/package-lock.json* ./
RUN npm ci --omit=optional || npm install --omit=optional

COPY src/frontend/ ./
COPY src/shared/ /app/shared/
RUN npm run build


# ─── Stage 2 — backend runtime ────────────────────────────────────────────────

FROM python:3.11-slim AS backend-runtime

# System deps:
#   ffmpeg    — STT WebM/Opus fallback (audit-2026-04-28 F-37)
#   curl      — HEALTHCHECK below; also useful for debugging
#   ca-certs  — outbound HTTPS to Gemini / OSM
#   tini      — proper PID 1 so SIGTERM propagates cleanly
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        ffmpeg \
        curl \
        ca-certificates \
        tini \
 && rm -rf /var/lib/apt/lists/*

# Non-root user — production deployments must not run uvicorn as root.
RUN useradd --uid 10001 --create-home --shell /bin/bash phantom

WORKDIR /app

# Install Python deps first so source-only changes don't bust the layer.
COPY src/backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir -r requirements.txt

# Copy backend + shared types.
COPY --chown=phantom:phantom src/backend /app/src/backend
COPY --chown=phantom:phantom src/shared /app/src/shared

# Frontend bundle — served as static assets by the backend.
COPY --from=frontend-builder --chown=phantom:phantom /app/dist /app/dist

# Workspace dir for the agent's bash.run sandbox (audit F-10c).
RUN mkdir -p /home/phantom/workspace \
 && chown -R phantom:phantom /home/phantom

USER phantom
WORKDIR /app/src/backend

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app/src/backend \
    PHANTOM_HOST=0.0.0.0 \
    PHANTOM_PORT=8000

EXPOSE 8000

# Liveness — backed by /healthz from observability.py.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/healthz || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
