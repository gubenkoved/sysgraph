#!/usr/bin/env bash
set -euo pipefail

# Build the frontend UI using Node.js inside Docker — no host Node.js required.
# Outputs to src/procmap/dist/

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

NODE_IMAGE="node:22-slim"

echo "Building frontend with $NODE_IMAGE ..."

docker run --rm \
  -v "$PROJECT_DIR:/app" \
  -w /app \
  -u "$(id -u):$(id -g)" \
  -e npm_config_cache=/tmp/.npm \
  "$NODE_IMAGE" \
  sh -c "npm ci && npm run build"

echo "Frontend built → src/procmap/dist/"
