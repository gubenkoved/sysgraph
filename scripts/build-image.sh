#!/usr/bin/env bash
set -euo pipefail

# Build the Docker image for sysgraph
# Usage: ./scripts/build-image.sh [tag]
# Example: ./scripts/build-image.sh dev

TAG="${1:-dev}"
CONTEXT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ensure lock file exists
if [ ! -f "${CONTEXT_DIR}/requirements.txt" ]; then
  echo "Warning: requirements.txt not found. Consider running ./scripts/compile-requirements.sh to produce a locked file."
fi

echo "Building Docker image with tag: ${TAG}"

docker build -t "sysgraph:${TAG}" "${CONTEXT_DIR}"

echo "Built sysgraph:${TAG}"