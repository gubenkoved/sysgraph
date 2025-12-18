#! /usr/bin/env bash

CUR_DIR=$(dirname "$0")

PROJ_DIR="${CUR_DIR}/../src/procmap"

black "$PROJ_DIR"
isort "$PROJ_DIR"
