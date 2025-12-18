from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from procmap.discovery import discover_processes, discover_unix_sockets
from procmap.model import Process, UnixDomainSocket, UnixDomainSocketProcRef

app = FastAPI(title="procmap API", version="0.1.0")

# serve static assets from `src/procmap/static` under /static
static_dir = str(Path(__file__).parent / "static")
app.mount("/static", StaticFiles(directory=static_dir), name="static")


# Root route serves the SPA index
@app.get("/", include_in_schema=False)
def index():
    index_path = Path(__file__).parent / "static" / "index.html"
    return FileResponse(index_path)


# Pydantic schemas for JSON serialization/deserialization
class ProcessSchema(BaseModel):
    pid: int
    user: Optional[str] = None
    command: Optional[str] = None


class UnixDomainSocketProcRefSchema(BaseModel):
    pid: int
    name: Optional[str] = None
    fd: Optional[int] = None


class UnixDomainSocketSchema(BaseModel):
    local_inode: int
    peer_inode: int
    local_path: Optional[str] = None
    peer_path: Optional[str] = None
    processes: List[UnixDomainSocketProcRefSchema] = []
    state: Optional[str] = None
    type: Optional[str] = None


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/discovery/processes", response_model=List[ProcessSchema])
def list_processes():
    processes = discover_processes()

    return [ProcessSchema(pid=p.pid, user=p.user, command=p.command) for p in processes]


@app.get("/api/discovery/uds", response_model=List[UnixDomainSocketSchema])
def list_sockets():
    def convert(s: UnixDomainSocket) -> UnixDomainSocketSchema:
        return UnixDomainSocketSchema(
            local_inode=s.local_inode,
            peer_inode=s.peer_inode,
            local_path=s.local_path,
            peer_path=s.peer_path,
            state=s.state,
            type=s.type,
            processes=[UnixDomainSocketProcRefSchema(pid=r.pid, name=r.name, fd=r.fd) for r in s.processes],
        )

    uds_sockets = discover_unix_sockets()

    return [convert(s) for s in uds_sockets]


# Run the app with: python -m procmap.api or `uvicorn procmap.api:app --reload`
if __name__ == "__main__":
    import uvicorn

    uvicorn.run("procmap.app:app", host="127.0.0.1", port=8000, reload=True)
