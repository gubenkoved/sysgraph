#!/usr/bin/env bash
set -euo pipefail

CUR_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$CUR_DIR/.." && pwd)"

UPDATE_LATEST=false
for arg in "$@"; do
  case "$arg" in
    --update-latest) UPDATE_LATEST=true ;;
  esac
done

# Read version from the single source of truth
VERSION=$(grep -oP '__version__\s*=\s*"\K[^"]+' "$REPO_DIR/src/sysgraph/__init__.py")

if [ -z "$VERSION" ]; then
  echo "ERROR: Could not read __version__ from src/sysgraph/__init__.py"
  exit 1
fi

echo "Publishing sysgraph version: $VERSION"

"$CUR_DIR/build-image.sh" "$VERSION"

docker tag "sysgraph:$VERSION" "gubenkoved/sysgraph:$VERSION"
docker push "gubenkoved/sysgraph:$VERSION"

if [ "$UPDATE_LATEST" = true ]; then
  docker tag "sysgraph:$VERSION" "gubenkoved/sysgraph:latest"
  docker push "gubenkoved/sysgraph:latest"
  echo "Pushed gubenkoved/sysgraph:$VERSION and gubenkoved/sysgraph:latest"
else
  echo "Pushed gubenkoved/sysgraph:$VERSION (use --update-latest to also push :latest)"
fi
