from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from procmap.discovery import discover_processes, discover_unix_sockets, discover_connected_uds
from procmap.model import UnixDomainSocket

app = FastAPI(title="procmap API", version="0.1.0")

# serve static assets from `src/procmap/static` under /static
static_dir = str(Path(__file__).parent / "static")
app.mount("/static", StaticFiles(directory=static_dir), name="static")


# Root route serves the SPA index
@app.get("/", include_in_schema=False)
def index():
    index_path = Path(__file__).parent / "static" / "index.html"
    return FileResponse(index_path)


class BaseObjectSchema(BaseModel):
    identity: str
    type: str


# Pydantic schemas for JSON serialization/deserialization
class ProcessSchema(BaseObjectSchema):
    pid: int
    user: Optional[str] = None
    command: Optional[str] = None
    executable: Optional[str] = None


class UnixDomainSocketProcRefSchema(BaseModel):
    pid: int
    name: Optional[str] = None
    fd: Optional[int] = None


class UnixDomainSocketSchema(BaseObjectSchema):
    local_inode: int
    peer_inode: int
    local_path: Optional[str] = None
    peer_path: Optional[str] = None
    processes: List[UnixDomainSocketProcRefSchema] = []
    state: Optional[str] = None
    uds_type: Optional[str] = None


class UnixDomainSocketConnectionSchema(BaseObjectSchema):
    socket1: UnixDomainSocketSchema
    socket2: UnixDomainSocketSchema


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/discovery/processes", response_model=List[ProcessSchema])
def list_processes():
    processes = discover_processes()

    return [
        ProcessSchema(
            identity=p.identity(),
            type=p.object_type(),
            pid=p.pid,
            user=p.user,
            command=p.command,
            executable=p.executable,
        )
        for p in processes
    ]


def unix_socket_to_schema(s: UnixDomainSocket) -> UnixDomainSocketSchema:
    return UnixDomainSocketSchema(
        identity=s.identity(),
        type=s.object_type(),
        local_inode=s.local_inode,
        peer_inode=s.peer_inode,
        local_path=s.local_path,
        peer_path=s.peer_path,
        state=s.state,
        uds_type=s.uds_type,
        processes=[
            UnixDomainSocketProcRefSchema(pid=r.pid, name=r.name, fd=r.fd)
            for r in s.processes
        ],
    )


@app.get("/api/discovery/uds", response_model=List[UnixDomainSocketSchema])
def list_sockets():
    uds_sockets = discover_unix_sockets()

    return [unix_socket_to_schema(s) for s in uds_sockets]


@app.get("/api/discovery/uds/connected", response_model=List[UnixDomainSocketConnectionSchema])
def list_connected_sockets():
    sockets = discover_unix_sockets()
    connections = discover_connected_uds(sockets)

    return [
        UnixDomainSocketConnectionSchema(
            identity=c.identity(),
            type=c.object_type(),
            socket1=unix_socket_to_schema(c.socket1),
            socket2=unix_socket_to_schema(c.socket2),
        )
        for c in connections
    ]


# Run the app with: python -m procmap.api or `uvicorn procmap.api:app --reload`
if __name__ == "__main__":
    import uvicorn

    uvicorn.run("procmap.app:app", host="127.0.0.1", port=8000, reload=True)
