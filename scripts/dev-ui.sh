#!/usr/bin/env bash
set -euo pipefail

# Start the Vite dev server inside Docker — no host Node.js required.
# Proxies /api requests to the FastAPI backend (default: http://localhost:8000).
# Run the FastAPI backend separately: python src/sysgraph/app.py
# Usage: dev-ui.sh [--server <backend-url>] [--standalone]
#   --server      Override the backend URL for /api proxy (default: http://localhost:8000)
#   --standalone  Run the UI in standalone mode (no backend; import data manually)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

NODE_IMAGE="node:22-slim"
VITE_PORT="${VITE_PORT:-5173}"
BACKEND_URL="http://localhost:8000"
STANDALONE="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server) BACKEND_URL="$2"; shift 2 ;;
    --standalone) STANDALONE="true"; shift ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

echo "Starting Vite dev server on http://localhost:${VITE_PORT} ..."
if [[ "$STANDALONE" == "true" ]]; then
  echo "(Standalone mode — UI will not contact the backend; import data manually)"
else
  echo "(Proxies /api → ${BACKEND_URL} — run FastAPI backend separately)"
fi

docker run --rm -it \
  -v "$PROJECT_DIR:/app" \
  -w /app \
  -u "$(id -u):$(id -g)" \
  -e npm_config_cache=/tmp/.npm \
  -e VITE_BACKEND_URL="${BACKEND_URL}" \
  -e VITE_STANDALONE="${STANDALONE}" \
  -p "${VITE_PORT}:${VITE_PORT}" \
  --network host \
  "$NODE_IMAGE" \
  sh -c "npm install && npx vite --host 0.0.0.0 --port ${VITE_PORT}"
