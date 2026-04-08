# --- Stage 1: build frontend with Node.js ---
FROM node:22-slim AS ui-build

WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY vite.config.js ./
COPY src/procmap-ui/ ./src/procmap-ui/
RUN npm run build

# --- Stage 2: Python runtime ---
FROM python:3.12

ENV PYTHONUNBUFFERED=1
WORKDIR /app

# Install small set of system deps needed for building psutil and for `ss`
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       build-essential gcc libffi-dev iproute2 lsof \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip and install build tools
RUN pip install --no-cache-dir --upgrade pip setuptools wheel

# Copy project metadata first to leverage Docker cache
COPY pyproject.toml setup.py /app/

# Install the package in the image
COPY . /app

# Copy the Vite build output from stage 1
COPY --from=ui-build /build/src/procmap/dist/ /app/src/procmap/dist/

RUN pip install --no-cache-dir .

# Copy entrypoint that will read $PORT and exec uvicorn (validated)
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV PORT=8000
EXPOSE 8000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
