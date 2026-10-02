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
- **Interactive graph** — WebGPU rendering and GPU force layout with zoom, pan, drag, pinning, search, and a 3D perspective toggle
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
python src/sysgraph/app.py   # → http://localhost:8000
```

### Frontend (TypeScript + Vite)
```bash
./scripts/build-ui.sh         # production build → src/sysgraph/dist/
./scripts/dev-ui.sh           # Vite dev server with HMR on :5173
./scripts/typecheck-ui.sh     # TypeScript type checking
./scripts/lint-ui.sh          # Biome linter (pass --fix to auto-fix)
```

### WebGPU engine proof of concept

Run `npm run dev` and open [http://localhost:5173/engine-poc.html](http://localhost:5173/engine-poc.html) in a browser with WebGPU. The page also ships in the production UI build at `/engine-poc.html`. Choose a deterministic synthetic graph with 10,000 to 1,000,000 edges, or load any of the same bundled examples offered by the graph explorer. Example graphs retain their exact nodes and edges; paired strands such as DNA start in sequence, row/column meshes such as Fabric start on a lattice, and other small examples receive a one-time D3 layout. Turn **Run GPU force layout** on to compare live simulation with frozen rendering; choose 15, 30, or 60 ticks per second, pause at any point, or reset to the original positions. The GPU solver uses a dense Hilbert-indexed, parallel bottom-up Barnes–Hut quadtree with GPU-resident positions and adjacency-based springs. It follows the main idea of the 2025 research, but preallocates spatial cells instead of sorting nodes into a sparse tree each tick. Weighted example link distances and authored force settings are carried into the GPU simulation. Directional edges draw source-to-target arrowheads, including self-loops; arrows are omitted when an edge is too short to fit them clear of its nodes. Drag empty space to pan, drag a node to move and pin it, shift-click a pinned node to release it, or use **Unpin all nodes**. Pinned nodes show a center dot and remain fixed while the layout runs; resetting positions also clears pins. Scroll to zoom or enable the camera sweep to watch frame times while the view moves. Hover a node to keep it, its direct neighbors, and its links prominent while the rest of the graph fades. Enable collision-free labels to see example names or synthetic node IDs; more are admitted as you zoom in. Glyphs are drawn through WebGPU and follow live node positions; label selection and hover use periodic asynchronous CPU position snapshots. Switch between thin native lines and smooth screen-space strokes, and optionally outline nodes to separate them visually. Display and layout controls are saved in browser local storage. The page reports frame intervals, CPU submission time, and layout command encoding time; it does not yet report GPU timestamp measurements.

The **3D perspective view** toggle enables XYZ force movement, perspective projection, and depth-tested nodes. Drag empty space to orbit, middle-drag to pan, and scroll to dolly around the pointer; node dragging, labels, hover, and pinning still work. World Cities uses its latitude/longitude and great-circle edge lengths to start on a globe; its arc lengths are converted to chord lengths for 3D springs. Turning 3D off restores the original 2D render pipelines without a depth pass. The view toggle is saved with the other display settings.

### Main graph explorer engine

The main graph explorer now uses the same WebGPU renderer and force layout as the proof of concept. Import, examples, live API graphs, search, editing, selection, filters, analytics, type colors, edge widths, pinning, and settings presets remain in the main UI. The **WebGPU engine** settings replace the old D3 simulation controls. A bounded GPU warmup runs before newly loaded graphs appear; its time budget is adjustable in the engine settings. Current display settings persist in local storage; existing saved display blocks retain node and edge colors and filters, while authored D3 charge, link strength, collision, damping, centering, and link distance values map to GPU settings. The 3D view uses perspective and depth testing over a true XYZ force layout.

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
