#!/usr/bin/env bash
set -euo pipefail

python -m pip install --upgrade pip pip-tools

pip-compile
