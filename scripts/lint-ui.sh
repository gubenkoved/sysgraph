#!/usr/bin/env bash
set -euo pipefail

# Lint the frontend UI using Biome inside Docker — no host Node.js required.
# Pass --fix to apply auto-fixes: ./scripts/lint-ui.sh --fix

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

NODE_IMAGE="node:22-slim"

FIX=""
if [[ "${1:-}" == "--fix" ]]; then
    FIX=":fix"
fi

echo "Linting frontend with $NODE_IMAGE ..."

docker run --rm \
  -v "$PROJECT_DIR:/app" \
  -w /app \
  -u "$(id -u):$(id -g)" \
  -e npm_config_cache=/tmp/.npm \
  "$NODE_IMAGE" \
  sh -c "npm ci && npm run lint${FIX}"
