#!/usr/bin/env bash
set -euo pipefail

# Start the FastAPI backend with the project's virtual environment.
# Usage: ./scripts/dev-backend.sh [--port 8000]

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="$PROJECT_DIR/.venv/bin/python"

if [[ ! -x "$PYTHON" ]]; then
  echo "Missing $PYTHON" >&2
  echo "Set up the backend first: python3 -m venv .venv && .venv/bin/python -m pip install -e ." >&2
  exit 1
fi

cd "$PROJECT_DIR"
exec "$PYTHON" -m sysgraph "$@"
