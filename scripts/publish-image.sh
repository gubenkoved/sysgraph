#!/usr/bin/env bash
set -euo pipefail

CUR_DIR="$(cd "$(dirname "$0")" && pwd)"
TAG="${1:-latest}"

"$CUR_DIR/build-image.sh" $TAG

docker tag "procmap:$TAG" "gubenkoved/procmap:$TAG"
docker push "gubenkoved/procmap:$TAG"
