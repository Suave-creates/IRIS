# syntax=docker/dockerfile:1
# ── IRIS server image: Fastify API + local Whisper (faster-whisper, CPU int8) ──
# Linux avoids the Windows ctranslate2/MSVCP140 crash, so server-side STT works.

# ── Stage 1: build the server bundle (tsup) + shared ─────────────────────────
FROM node:20-bookworm AS build
WORKDIR /app
# Manifests first so `npm ci` layers cache until dependencies change.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
# Sources needed to build shared → server.
COPY tsconfig.base.json ./
COPY shared/ shared/
COPY server/ server/
RUN npm run build:shared && npm run build:server

# ── Stage 2: production-only node_modules (hoisted at the workspace root) ─────
FROM node:20-bookworm AS proddeps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev

# ── Stage 3: runtime — Node + Python/faster-whisper with large-v3 baked in ───
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
# Python + ffmpeg for faster-whisper. ffmpeg decodes the webm/opus recorder uploads.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Isolated venv for faster-whisper (ctranslate2 ships manylinux x86_64 wheels).
ENV WHISPER_VENV=/opt/whisper-venv
RUN python3 -m venv "$WHISPER_VENV"
ENV PATH="$WHISPER_VENV/bin:$PATH"
RUN pip install --no-cache-dir faster-whisper==1.0.3

# Pre-download the model into a baked cache so the first transcription is
# offline and fast. Override the model with --build-arg WHISPER_MODEL=medium
# (etc.) to shrink the image; anything else falls back to a runtime download.
ENV HF_HOME=/opt/whisper-cache
ARG WHISPER_MODEL=large-v3
RUN python3 -c "from faster_whisper import WhisperModel; WhisperModel('${WHISPER_MODEL}', device='cpu', compute_type='int8')"

WORKDIR /app/server
# App runtime: hoisted prod node_modules + built server + the Whisper CLI.
COPY --from=proddeps /app/node_modules /app/node_modules
COPY --from=build /app/server/dist /app/server/dist
COPY server/package.json /app/server/package.json
COPY server/whisper/transcribe.py /app/server/whisper/transcribe.py

# Point the server at the container's Python + baked model (overrides the
# Windows-venv default in config/env.ts).
ENV WHISPER_PYTHON="$WHISPER_VENV/bin/python3"
ENV WHISPER_MODEL=large-v3
ENV PORT=8080
EXPOSE 8080
# cwd = /app/server so transcribe.py resolves and node_modules hoist-resolves.
CMD ["node", "dist/index.js"]
