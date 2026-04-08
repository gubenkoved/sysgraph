#!/usr/bin/env bash
set -euo pipefail

CUR_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$CUR_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

# Ensure build tools are available
python -m pip install --quiet --upgrade build twine

# Build the frontend first (must be present in dist/ for the package)
if [ ! -d "src/procmap/dist" ]; then
    echo "Frontend dist/ not found, building..."
    "$CUR_DIR/build-ui.sh"
fi

# Clean previous build artifacts
rm -rf dist/ build/ src/*.egg-info

# Build sdist and wheel
echo "Building package..."
python -m build

# Upload to PyPI (uses ~/.pypirc or TWINE_USERNAME/TWINE_PASSWORD env vars)
echo "Uploading to PyPI..."
python -m twine upload dist/*

echo "Done!"
