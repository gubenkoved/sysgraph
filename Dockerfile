# --- Stage 1: build frontend with Node.js ---
FROM node:22-slim AS ui-build

WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY vite.config.ts tsconfig.json tsconfig.node.json ./
COPY src/sysgraph-ui/ ./src/sysgraph-ui/
COPY src/sysgraph/__init__.py ./src/sysgraph/__init__.py
# Bundled example graphs read by vite.config.ts (readExamples) at build time;
# without these the "load example" toolbar button would never appear.
COPY data/ ./data/
RUN npm run build

# --- Stage 2: build the Python wheel ---
FROM python:3.12 AS py-build

WORKDIR /build
RUN pip install --no-cache-dir build

# project sources/metadata required to build the wheel
COPY pyproject.toml MANIFEST.in README.md LICENSE ./
COPY src/ ./src/
# the wheel bundles the Vite output as package data, so it must be present
# before building (see [tool.setuptools.package-data] in pyproject.toml)
COPY --from=ui-build /build/src/sysgraph/dist/ ./src/sysgraph/dist/

RUN python -m build --wheel --outdir /dist

# --- Stage 3: runtime ---
FROM python:3.12

ENV PYTHONUNBUFFERED=1
WORKDIR /app

# iproute2 provides `ss`, used for Unix-domain-socket discovery on Linux.
# no build toolchain is needed: deps resolve to prebuilt wheels
RUN apt-get update \
    && apt-get install -y --no-install-recommends iproute2 \
    && rm -rf /var/lib/apt/lists/*

# install pinned dependencies first for reproducible images, then the app
# wheel with --no-deps so only the locked versions are ever used. no project
# source lands in the final image — only the installed package. the wheel and
# requirements are bind-mounted (not COPY'd) so they never persist in a layer,
# and pip's cache is dropped so the image carries no build trash
RUN --mount=type=bind,source=requirements.txt,target=/tmp/requirements.txt \
    --mount=type=bind,from=py-build,source=/dist,target=/dist \
    pip install --no-cache-dir -r /tmp/requirements.txt \
    && pip install --no-cache-dir --no-deps /dist/*.whl \
    && rm -rf /root/.cache

# entrypoint reads $PORT and execs uvicorn via `python -m sysgraph`
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV PORT=8000
EXPOSE 8000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
