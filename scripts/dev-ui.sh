#!/usr/bin/env bash
set -euo pipefail

# Start the Vite dev server inside Docker — no host Node.js required.
# Proxies /api requests to http://localhost:8000 (the FastAPI backend).
# Run the FastAPI backend separately: python src/procmap/app.py

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

NODE_IMAGE="node:22-slim"
VITE_PORT="${VITE_PORT:-5173}"

echo "Starting Vite dev server on http://localhost:${VITE_PORT} ..."
echo "(Proxies /api → http://localhost:8000 — run FastAPI backend separately)"

docker run --rm -it \
  -v "$PROJECT_DIR:/app" \
  -w /app \
  -u "$(id -u):$(id -g)" \
  -e npm_config_cache=/tmp/.npm \
  -p "${VITE_PORT}:${VITE_PORT}" \
  --network host \
  "$NODE_IMAGE" \
  sh -c "npm install && npx vite --host 0.0.0.0 --port ${VITE_PORT}"
