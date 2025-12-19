#!/usr/bin/env sh
set -euo pipefail

# Entrypoint that runs the app using the PORT env var (defaults to 8000)
PORT="${PORT:-8000}"

# basic validation: must be integer
case "$PORT" in
  ''|*[!0-9]*)
    echo "Invalid PORT specified: '$PORT'" >&2
    exit 1
    ;;
  *)
    ;;
esac

exec uvicorn procmap.app:app --host 0.0.0.0 --port "$PORT"
