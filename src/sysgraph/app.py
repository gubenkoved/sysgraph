#!/usr/bin/env python3

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import coloredlogs
from fastapi import FastAPI
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from sysgraph.discovery import build_graph

LOGGER = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app):
    coloredlogs.install()
    logging.info(f"init for process with PID {os.getpid()}")
    yield
    logging.info(f"shutdown for process with PID {os.getpid()}")


app = FastAPI(title="sysgraph API", version="0.1.0", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=500)

# Vite build output — run scripts/build-ui.sh to produce it.
_dist_dir = Path(__file__).parent / "dist"

if not _dist_dir.is_dir():
    LOGGER.warning(
        "dist/ not found — frontend will not be served. "
        "Run scripts/build-ui.sh to produce a production build."
    )


# Root route serves the SPA index — defined before the catch-all mount.
@app.get("/", include_in_schema=False)
def index():
    index_path = _dist_dir / "index.html"
    return FileResponse(index_path)


class GraphNodeSchema(BaseModel):
    id: str
    type: str
    properties: dict[str, Any]


class GraphEdgeSchema(BaseModel):
    id: str
    source_id: str
    target_id: str
    type: str
    properties: dict[str, Any]


class GraphSchema(BaseModel):
    nodes: list[GraphNodeSchema]
    edges: list[GraphEdgeSchema]


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/graph", response_model=GraphSchema)
def get_graph() -> dict:
    graph = build_graph()
    return graph.as_dict()


# Serve built assets (JS/CSS bundles, Shoelace icons, etc.) from the same
# directory that provides index.html.  This catch-all mount MUST come after
# all explicit routes so that /api/* and / are matched first.
if _dist_dir.is_dir():
    app.mount("/", StaticFiles(directory=str(_dist_dir)), name="static")


def main():
    import argparse

    import uvicorn

    parser = argparse.ArgumentParser(description="sysgraph server")
    parser.add_argument(
        "-p",
        "--port",
        type=int,
        default=int(os.environ.get("PORT", 8000)),
        help="port to listen on (default: 8000, or PORT env var)",
    )
    args = parser.parse_args()

    uvicorn.run(
        "sysgraph.app:app",
        host="0.0.0.0",
        port=args.port,
        reload=True,
        log_level="info",
    )


if __name__ == "__main__":
    main()
