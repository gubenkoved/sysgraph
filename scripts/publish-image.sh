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
VERSION=$(grep -oP '__version__\s*=\s*"\K[^"]+' "$REPO_DIR/src/procmap/__init__.py")

if [ -z "$VERSION" ]; then
  echo "ERROR: Could not read __version__ from src/procmap/__init__.py"
  exit 1
fi

echo "Publishing procmap version: $VERSION"

"$CUR_DIR/build-image.sh" "$VERSION"

docker tag "procmap:$VERSION" "gubenkoved/procmap:$VERSION"
docker push "gubenkoved/procmap:$VERSION"

if [ "$UPDATE_LATEST" = true ]; then
  docker tag "procmap:$VERSION" "gubenkoved/procmap:latest"
  docker push "gubenkoved/procmap:latest"
  echo "Pushed gubenkoved/procmap:$VERSION and gubenkoved/procmap:latest"
else
  echo "Pushed gubenkoved/procmap:$VERSION (use --update-latest to also push :latest)"
fi
