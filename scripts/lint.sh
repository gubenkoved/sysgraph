#! /usr/bin/env bash

CUR_DIR=$(dirname "$0")

PROJ_DIR="${CUR_DIR}/../src/sysgraph"

# Ruff can both lint and format (`ruff format`) and also sort imports.
ruff check "$PROJ_DIR"
ruff format "$PROJ_DIR"
isort "$PROJ_DIR"
