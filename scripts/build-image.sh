#!/usr/bin/env bash
set -euo pipefail

# Build the Docker image for sysgraph
# Usage: ./scripts/build-image.sh [tag] [--no-cache]
# Example: ./scripts/build-image.sh dev
#          ./scripts/build-image.sh dev --no-cache

NO_CACHE=false
TAG=""
for arg in "$@"; do
  case "$arg" in
    --no-cache) NO_CACHE=true ;;
    *) TAG="$arg" ;;
  esac
done
TAG="${TAG:-dev}"
CONTEXT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ensure lock file exists
if [ ! -f "${CONTEXT_DIR}/requirements.txt" ]; then
  echo "Warning: requirements.txt not found. Consider running ./scripts/compile-requirements.sh to produce a locked file."
fi

BUILD_ARGS=()
if [ "$NO_CACHE" = true ]; then
  BUILD_ARGS+=(--no-cache)
fi

echo "Building Docker image with tag: ${TAG}"

docker build "${BUILD_ARGS[@]}" -t "sysgraph:${TAG}" "${CONTEXT_DIR}"

echo "Built sysgraph:${TAG}"