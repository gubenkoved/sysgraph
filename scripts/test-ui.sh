#!/usr/bin/env bash
set -euo pipefail

# Run the frontend unit tests (Vitest) inside Docker — no host Node.js required.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

NODE_IMAGE="node:22-slim"

echo "Running frontend tests with $NODE_IMAGE ..."

docker run --rm \
  -v "$PROJECT_DIR:/app" \
  -w /app \
  -u "$(id -u):$(id -g)" \
  -e npm_config_cache=/tmp/.npm \
  "$NODE_IMAGE" \
  sh -c "npm ci && npm run test"
