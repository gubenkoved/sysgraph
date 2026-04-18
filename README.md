# sysgraph

An interactive force-directed **network graph visualizer** for the browser — with two modes:

- **Import any graph** — load any JSON graph (nodes + edges) to explore and visualize it interactively
- **Live process graph** — discover running OS processes and their inter-process communication channels in real time (cross-platform; richest on Linux)

[![PyPI](https://img.shields.io/pypi/v/sysgraph)](https://pypi.org/project/sysgraph/)
![Python](https://img.shields.io/badge/python-%3E%3D3.12-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Import any graph** — load a JSON file with nodes and edges to visualize any network, social graph, dependency tree, or dataset
- **Export/Import** — save and reload graph snapshots as JSON; use the sample at [`data/simplest-graph.json`](data/simplest-graph.json) as a format reference
- **Interactive graph** — force-directed graph rendered in the browser with zoom, pan, drag, and search
- **Fuzzy search** — find nodes by any property
- **Adjacency filtering** — right-click a node to show only its neighbors
- **Configurable** — tune d3 force parameters, colors, and type filters via the settings panel
- **Process discovery** — enumerates running OS processes and their parent-child relationships (cross-platform via psutil)
- **IPC visualization** — discovers TCP/UDP connections (all platforms), Unix domain sockets and pipes (Linux only)
- **Real-time** — fetch the latest process graph on demand via the web UI

## Demo

[Demo](https://github.com/user-attachments/assets/7d19daca-042c-43f1-bedd-4d74344e1e89)

## Requirements

- **Python ≥ 3.12**
- **Linux, macOS, or Windows** — process and network discovery works on all platforms via psutil; Unix domain sockets and pipe discovery require Linux
- Root/sudo recommended for full process visibility on Linux/macOS

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

Open your browser to the displayed URL.

### Visualize your own graph

Use the **Import** button in the UI to load any JSON file in the following format:

```json
{
  "nodes": [
    {"id": "1", "type": "person", "properties": {"name": "Alice"}},
    {"id": "2", "type": "person", "properties": {"name": "Bob"}}
  ],
  "edges": [
    {"source_id": "1", "target_id": "2", "type": "knows", "properties": {}}
  ]
}
```

See [`data/simplest-graph.json`](data/simplest-graph.json) for a minimal example.

### Live process graph

For full visibility into all processes and their connections, run with elevated privileges (Linux/macOS):

```bash
sudo sysgraph
```

## Docker

```bash
docker run --rm -it --pid=host --net=host gubenkoved/sysgraph
```

The `--pid=host` and `--net=host` flags allow the container to see host processes and network connections.

## How It Works

1. The **browser frontend** renders interactive force-directed graphs using [force-graph](https://github.com/vasturiano/force-graph) with d3 physics simulation.
2. Graphs can be **imported from JSON** directly in the browser, or fetched live from the backend.
3. The **FastAPI backend** uses `psutil` to discover processes and network connections (cross-platform), plus Linux-specific APIs (`/proc`, `ss`) for pipe and Unix domain socket discovery, building a graph served via `GET /api/graph`.

## Development

### Prerequisites
- Python ≥ 3.12, Docker (for frontend builds)
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
pytest src/sysgraph/tests/
```

### Python linting
```bash
./scripts/lint.sh             # ruff check + ruff format + isort
```

## License

[MIT](LICENSE)
