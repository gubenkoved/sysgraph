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

from procmap.discovery import build_graph

LOGGER = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app):
    coloredlogs.install()
    logging.info(f"init for process with PID {os.getpid()}")
    yield
    logging.info(f"shutdown for process with PID {os.getpid()}")


app = FastAPI(title="procmap API", version="0.1.0", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=500)

# serve static assets from `src/procmap/static` under /static
static_dir = str(Path(__file__).parent / "static")
app.mount("/static", StaticFiles(directory=static_dir), name="static")


# Root route serves the SPA index
@app.get("/", include_in_schema=False)
def index():
    index_path = Path(__file__).parent / "static" / "index.html"
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
def get_graph() -> GraphSchema:
    graph = build_graph()
    graph_dict = graph.as_dict()

    LOGGER.debug(graph_dict)

    return GraphSchema(
        nodes=[
            GraphNodeSchema(
                id=node["id"], type=node["type"], properties=node["properties"]
            )
            for node in graph_dict["nodes"]
        ],
        edges=[
            GraphEdgeSchema(
                id=edge["id"],
                source_id=edge["source_id"],
                target_id=edge["target_id"],
                type=edge["type"],
                properties=edge["properties"],
            )
            for edge in graph_dict["edges"]
        ],
    )


# Run the app with: python -m procmap.api or `uvicorn procmap.api:app --reload`
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "procmap.app:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )
