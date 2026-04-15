# sysgraph

Real-time process-graph visualizer that discovers running OS processes, their inter-process communication channels (pipes, Unix domain sockets, TCP/UDP network connections), and renders them as an interactive force-directed graph in the browser.

![Python](https://img.shields.io/badge/python-%3E%3D3.12-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Process discovery** — enumerates all running OS processes and their parent-child relationships
- **IPC visualization** — discovers pipes, Unix domain sockets, and TCP/UDP connections between processes
- **Interactive graph** — force-directed graph rendered in the browser with zoom, pan, drag, and search
- **Real-time** — fetch the latest process graph on demand via the web UI
- **Fuzzy search** — find processes by name, PID, command line, or any property
- **Adjacency filtering** — right-click a node to show only its neighbors
- **Configurable** — tune d3 force parameters, colors, and filters via the settings panel
- **Export/Import** — save and load graph snapshots as JSON

## Requirements

- **Linux** (relies on `/proc` filesystem and the `ss` command)
- **Python ≥ 3.12**
- Root/sudo recommended for full visibility into all processes

## Installation

```bash
pip install sysgraph
```

## Usage

```bash
# Start the web server (default: http://localhost:8000)
sysgraph

# Specify a custom port
sysgraph --port 9000

# Or run as a module
python -m sysgraph
```

Open your browser to the displayed URL to see the interactive process graph.

For full visibility into all processes and their connections, run with elevated privileges:

```bash
sudo sysgraph
```

## Docker

```bash
docker run --rm -it --pid=host --net=host gubenkoved/sysgraph
```

The `--pid=host` and `--net=host` flags allow the container to see host processes and network connections.

## How It Works

1. The **FastAPI backend** uses `psutil` and Linux-specific APIs (`/proc`, `ss`) to discover processes, pipes, Unix domain sockets, and network connections.
2. It builds a graph of processes (nodes) and their IPC channels (edges).
3. The **browser frontend** fetches the graph via `GET /api/graph` and renders it using [force-graph](https://github.com/vasturiano/force-graph) with d3 physics simulation.

## Development

### Prerequisites
- Python ≥ 3.12, Linux, Docker
- Node.js 22 runs inside Docker; no host installation required

### Backend
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -e . && pip install -r requirements-dev.in
python src/sysgraph/app.py   # → http://localhost:8000
```

### Frontend (TypeScript + Vite)
```bash
./scripts/build-ui.sh         # production build → src/sysgraph/dist/
./scripts/dev-ui.sh           # Vite dev server with HMR on :5173
./scripts/typecheck-ui.sh     # TypeScript type checking
./scripts/lint-ui.sh          # Biome linter (pass --fix to auto-fix)
```

### Tests
```bash
pytest src/sysgraph/tests/    # requires Linux /proc
```

### Python linting
```bash
./scripts/lint.sh             # ruff check + ruff format + isort
```

## License

[MIT](LICENSE)
