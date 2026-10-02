# sysgraph

An interactive force-directed **network graph visualizer** for the browser — with two modes:

- **Import any graph** — load any JSON graph (nodes + edges) to explore and visualize it interactively
- **Live process graph** — discover running OS processes and their inter-process communication channels in real time (cross-platform; richest on Linux)

[![PyPI](https://img.shields.io/pypi/v/sysgraph)](https://pypi.org/project/sysgraph/)
![Python](https://img.shields.io/badge/python-%3E%3D3.12-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Import any graph** — load a JSON file with nodes and edges to visualize any network, social graph, dependency tree, or dataset
- **Export/Import** — save and reload graph snapshots as JSON; use the sample at [`data/simple-graph.json`](data/simple-graph.json) as a format reference
- **Interactive graph** — WebGPU rendering and GPU force layout with zoom, pan, drag, pinning, search, and 3D perspective or orthographic views
- **Dockable workspace** — settings, analytics, and selection-details open as dockable panels around the graph; drag tabs to rearrange, and your layout (sizes and placement) persists across reloads
- **JSON-string inspection** — properties containing JSON objects or arrays automatically appear as collapsible trees, with a compact Raw/JSON button to view the original string; works in regular and pinned node/edge inspectors without changing the graph data
- **Fuzzy search** — find nodes by any property
- **Adjacency filtering** — right-click a node to show only its neighbors
- **Configurable** — choose GPU force, layered, radial, circular, degree-ring, or grid layouts; tune spacing, direction, root, physics, edge style, node outline, colors, and type filters via the settings panel
- **Process discovery** — enumerates running OS processes and their parent-child relationships (cross-platform via psutil)
- **IPC visualization** — discovers TCP/UDP connections (all platforms), Unix domain sockets and pipes (Linux only)
- **Real-time** — fetch the latest process graph on demand via the web UI

## Demo

[Demo](https://github.com/user-attachments/assets/7d19daca-042c-43f1-bedd-4d74344e1e89)

## Requirements

- **Python ≥ 3.12**
- **Linux, macOS, or Windows** — process and network discovery works on all platforms via psutil; Unix domain sockets and pipe discovery require Linux
- Root/sudo recommended for full process visibility on Linux/macOS
- A browser with WebGPU enabled for the graph explorer; use HTTPS or localhost

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

See [`data/simple-graph.json`](data/simple-graph.json) for a minimal example.

For larger networks, the bundled [large examples](docs/large-examples.md)
include global airline routes, a searchable New York street map, a spiral
network with authored 3D depth, and a nearly 500,000-edge package graph.

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

1. The **browser frontend** renders nodes, edges, and labels through WebGPU. Its optional GPU force layout uses a Barnes–Hut quadtree and adjacency-based springs. The 3D toggle lets the solver move nodes in XYZ and displays them with a perspective camera.
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
./scripts/dev-backend.sh     # → http://localhost:8000
```

### Frontend (TypeScript + Vite)
```bash
./scripts/build-ui.sh         # production build → src/sysgraph/dist/
./scripts/dev-ui.sh           # in a second terminal; Vite with HMR on :5173
./scripts/typecheck-ui.sh     # TypeScript type checking
./scripts/lint-ui.sh          # Biome linter (pass --fix to auto-fix)
```

The Vite dev server proxies `/api` to the backend on port 8000. To use another
backend port, run `./scripts/dev-backend.sh --port 9000` and
`./scripts/dev-ui.sh --server http://localhost:9000`.

### WebGPU graph explorer engine

The graph explorer uses a custom WebGPU renderer and GPU force layout. Import, examples, live API graphs, search, editing, selection, filters, analytics, type colors, edge widths, pinning, and settings presets are supported in the main UI. **Settings → Engine** separates Simulation, Forces, Links, and Rendering controls. A bounded warmup runs before newly loaded graphs appear; its time budget is adjustable under **Engine → Simulation**. Current display settings persist in local storage, and authored settings embedded in graphs can override the viewer's defaults.

The **3D view** switch in the menu enables XYZ force movement and depth-tested nodes. Its separate camera button switches between perspective and orthographic projection; the orthographic view starts at an isometric angle. **Settings → Display → General** also offers Simple and Solid node rendering. Solid is the default and lights the sphere surfaces; Simple uses flat color. **Settings → Display → Labels** offers plain text, outlined text (the default), text with a soft background, and text on a bordered background plate. Plain and outlined text remain transparent around the letters; all four styles follow the active light or dark theme. Drag empty space to rotate freely through any angle, or Shift-drag over nodes to rotate in a dense area. In 3D, focus the graph and use ↑/↓ to fly forward/back and ←/→ to strafe. Hold Shift with any arrow key to orbit around the current view center in that direction; movement accelerates and brakes smoothly. Middle- or right-drag pans; scrolling zooms around the pointer, and the +/- controls zoom in both modes. On touchscreens, one finger rotates in 3D or pans in 2D, while two fingers pinch to zoom and move together to pan; a tap selects a node. Desktop node dragging, labels, hover, and pinning remain available. World Cities uses its latitude/longitude and great-circle edge lengths to start on a globe, converting arc lengths to chord lengths for 3D springs.

WebGPU requires a secure browser context. An internal hostname served over HTTP is still an insecure origin; serve it through an HTTPS reverse proxy with a certificate trusted by the browser. For local development, `http://localhost` works on the computer running the browser. If the server is remote, forward its port to the Mac (for example, `ssh -N -L 8000:127.0.0.1:8000 user@server`) and open `http://localhost:8000/`. Check `location.origin`, `isSecureContext`, and `navigator.gpu` in DevTools on the graph tab itself. Startup errors distinguish blocked WebGPU access from missing adapters, device creation failures, and renderer failures.

Open **Settings → automatic layout** to choose the layout. **GPU force** keeps the graph moving under physics. **Layered flow** ranks directed nodes and reduces crossings; choose top-to-bottom, bottom-to-top, left-to-right, or right-to-left. **Radial distance** places nodes in rings by hop distance from a chosen root. **Circular** places each connected component around a circle. **Degree rings** puts highly connected nodes toward the center. **Grid** uses `row` and `col` node properties when available, otherwise packs nodes into regular rows. The spacing, level spacing, and root controls appear when relevant. Select a node and use **use selected node as root**, or enter its ID. **Reapply layout** recalculates positions; pinned nodes stay fixed. Static layouts are calculated once on the CPU and rendered by WebGPU, with force physics paused. Layout choices are saved with display settings and presets. The lightweight layered, radial, and circular algorithms draw on ideas from [ELK Layered](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html), [Graphviz twopi](https://graphviz.org/docs/layouts/twopi/), and [Graphviz circo](https://graphviz.org/docs/layouts/circo/); they are custom approximations, not bundled copies of those engines.

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
