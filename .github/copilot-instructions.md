# Copilot Instructions for proc-map

## IMPORTANT: Build System

**NEVER run node, npm, or npx commands directly on the host.**
All frontend build/dev tasks MUST use the dockerized scripts in `scripts/`:
- `./scripts/build-ui.sh` — production build (outputs to `src/procmap/dist/`)
- `./scripts/dev-ui.sh` — dev server with HMR (Vite on port 5173)

Only use local `npm` if the user explicitly confirms they have Node.js installed and want to use it.

## Project Overview

**proc-map** is a real-time process-graph visualizer that discovers running OS processes, their inter-process communication channels (pipes, Unix domain sockets, TCP/UDP network connections), and renders them as an interactive force-directed graph in the browser.

- **Author:** Eugene Gubenkov (`gubenkoved@gmail.com`)
- **License:** MIT
- **Python:** ≥ 3.12 (strict)
- **Node.js:** 22 (used for frontend build via Vite)
- **Package name:** `proc-map` (importable as `procmap`)

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Browser (SPA)                                           │
│  Built by Vite from src/procmap-ui/ → src/procmap/dist/  │
│  Libraries (npm): force-graph, d3@6, tweakpane,          │
│    fuse.js, @material/web, json-formatter-js, winbox     │
│  Icons: Material Symbols Outlined (Google Fonts CDN)     │
└──────────────┬───────────────────────────────────────────┘
               │  HTTP (fetch)
               ▼
┌──────────────────────────────────────────────────────────┐
│  FastAPI backend (app.py)                                │
│  Endpoints:                                              │
│    GET /            → serves index.html from dist/       │
│    GET /*           → static files from dist/ (catch-all)│
│    GET /api/health  → health check                       │
│    GET /api/graph   → builds & returns process graph     │
└──────────────┬───────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────┐
│  discovery.py — OS introspection layer                   │
│  Uses: psutil, /proc filesystem, `ss` command            │
│  Discovers: processes, pipes, UDS, TCP/UDP connections   │
└──────────────────────────────────────────────────────────┘
```

## Directory Layout

```
proc-map/
├── pyproject.toml          # Ruff + isort config
├── setup.py                # Package metadata, dependencies
├── requirements.txt        # Locked deps (pip-compile output)
├── requirements-dev.in     # Dev dependencies (pytest, ruff, httpx, etc.)
├── package.json            # Node.js deps & scripts (Vite build)
├── package-lock.json       # Locked npm deps
├── vite.config.js          # Vite build config (root: src/procmap-ui)
├── Dockerfile              # Multi-stage: Node.js build + Python runtime
├── MANIFEST.in             # Includes dist/ in Python package
├── jsconfig.json           # JS/TS IDE config (checkJs enabled)
├── data/
│   └── simplest-graph.json # Sample graph for import/testing
├── scripts/
│   ├── build-image.sh      # Build Docker image
│   ├── build-ui.sh         # Build frontend via Docker (no host Node.js needed)
│   ├── dev-ui.sh           # Start Vite dev server via Docker
│   ├── publish-image.sh    # Tag & push to Docker Hub (gubenkoved/procmap)
│   ├── compile-requirements.sh  # pip-compile to lock deps
│   ├── docker-entrypoint.sh     # Container entrypoint (uvicorn)
│   └── lint.sh             # Run ruff + isort
├── src/
│   └── procmap/                 # Python backend package
│       ├── __init__.py          # Exports __version__ (single source of truth)
│       ├── __main__.py          # Allows `python -m procmap`
│       ├── app.py               # FastAPI application & API schemas
│       ├── discovery.py         # OS process/connection discovery + graph building
│       ├── graph.py             # Graph data structure (Node, Relationship, Graph)
│       ├── model.py             # Domain models (Process, NetConnection, UDS, etc.)
│       ├── main.py              # CLI entry point for debug/exploration
│       ├── dist/                # Vite build output (generated, gitignored)
│       └── tests/
│           └── test_discovery.py
│   └── procmap-ui/             # Frontend source (Vite project root)
│       ├── index.html           # SPA shell (toolbar, detail panel, settings pane)
│       ├── app.js               # Frontend entry point
│       └── modules/
│           ├── state.js          # Centralized app state
│           ├── event-bus.js      # Pub-sub event system
│           ├── graph.js          # Frontend Graph class (adjacency index)
│           ├── graph-ui.js       # force-graph rendering (largest module)
│           ├── graph-algs.js     # BFS algorithm for highlights
│           ├── data-io.js        # API fetch, JSON serialization/parsing
│           ├── search.js         # Fuzzy search via Fuse.js
│           ├── selection.js      # Rectangle selection overlay
│           ├── toolbar.js        # Toolbar buttons & keyboard shortcuts
│           ├── settings-pane.js  # Tweakpane settings UI (filters, colors, forces)
│           ├── settings.js       # Default settings, color palettes
│           ├── context-menu.js   # Right-click context menu
│           ├── color-scale.js    # Color interpolation for search heatmap
│           └── util.js           # FNV-1a hash helper
```

## Development Setup

### Prerequisites
- Python ≥ 3.12
- Linux (the discovery layer reads `/proc` and runs `ss`)
- Docker (for frontend builds — no host Node.js installation required)
- Virtual environment recommended

### Install & Run (Backend)

```bash
# Create and activate virtualenv
python3 -m venv .venv
source .venv/bin/activate

# Install in editable mode with dev deps
pip install -e .
pip install -r requirements-dev.in

# Run the backend (auto-reload enabled)
python src/procmap/app.py
# → serves at http://localhost:8000
# Alternative: python -m procmap

# Or via uvicorn directly
uvicorn procmap.app:app --reload --host 0.0.0.0 --port 8000
```

### Frontend Build

The frontend is built with **Vite** and outputs to `src/procmap/dist/`. Build scripts use Docker so no host Node.js is needed:

```bash
# Production build (via Docker)
./scripts/build-ui.sh
# → outputs to src/procmap/dist/

# Development server with HMR (via Docker)
./scripts/dev-ui.sh
# → Vite dev server on http://localhost:5173
# → Proxies /api requests to http://localhost:8000
# → Run the FastAPI backend separately
```

If you have Node.js installed locally, you can also run directly:
```bash
npm ci
npm run dev      # Vite dev server
npm run build    # Production build
```

### Running Tests

```bash
pytest src/procmap/tests/
```

Tests require running on Linux with access to `/proc` and `ss`.

### Linting

```bash
./scripts/lint.sh
# Runs: ruff check, ruff format, isort
```

Ruff is configured in `pyproject.toml` with line-length=79, target Python 3.12.

### Docker

```bash
./scripts/build-image.sh [tag]    # default tag: dev
./scripts/publish-image.sh [tag]  # builds, tags as gubenkoved/procmap, pushes
```

The Dockerfile is a **multi-stage build**: stage 1 builds the frontend with Node.js 22, stage 2 copies the Vite output into the Python runtime image. The container runs uvicorn on `$PORT` (default 8000).

## Backend Details

### Python Modules

| Module | Purpose |
|--------|---------|
| `app.py` | FastAPI app, Pydantic schemas (`GraphSchema`, `GraphNodeSchema`, `GraphEdgeSchema`), serves Vite build output from `dist/`, `/api/graph` endpoint |
| `discovery.py` | OS introspection: `discover_processes()`, `discover_unix_sockets()`, `get_processes_open_files()`, `get_all_net_connections()`, `build_graph()` |
| `graph.py` | Backend graph data structure: `Node`, `Relationship`, `Graph` with `add_node()`, `add_edge()`, `as_dict()` |
| `model.py` | Domain models: `Process`, `ProcessOpenFile`, `UnixDomainSocket`, `UnixDomainSocketConnection`, `NetConnection`, `SocketAddress`, etc. |
| `main.py` | CLI debug script — runs discovery and logs results |
| `__main__.py` | Allows running as `python -m procmap` (calls `app.main()`) |

### Static File Serving

The backend serves the Vite-built frontend from `src/procmap/dist/`:
- `GET /` → `dist/index.html`
- `GET /*` → catch-all `StaticFiles` mount on `dist/` (after all `/api/*` routes)
- If `dist/` is missing, a warning is logged and the frontend is not served

The `dist/` directory is included in the Python package via `MANIFEST.in` and `setup.py` `package_data`.

### Graph Node Types (generated by backend)
- `process` — OS process (properties: pid, command, user, name, cpu_user, cpu_system, environment)
- `pipe` — Named pipe (FIFO) inode (properties: label)
- `socket` — TCP/UDP socket endpoint (properties: label, state, socket_type)
- `external_ip` — Remote IP not owned by a local process (properties: label)

### Graph Edge Types (generated by backend)
- `child_process` — Parent→child process relationship
- `unix_domain_socket` — UDS connection between two processes
- `pipe` — Read/write pipe connection (directional; properties: fd, mode)
- `socket` — Process→local socket binding
- `socket_connection` — Connection between local↔remote socket endpoints
- `external_socket` — External IP→socket connection

### Key Discovery Functions
- `discover_processes()` — Uses `psutil.process_iter()` to enumerate all processes
- `discover_unix_sockets()` — Parses `ss -xp` output to find UDS sockets
- `discover_connected_uds()` — Pairs UDS by matching local/peer inodes
- `get_processes_open_files()` — Reads `/proc/[pid]/fd` and `/proc/[pid]/fdinfo` for pipe FDs
- `get_all_net_connections()` — Uses `psutil.net_connections(kind="inet")` for TCP/UDP
- `build_graph()` — Orchestrates all discovery in parallel via `ThreadPoolExecutor`, builds complete graph

### API Response Format

`GET /api/graph` returns:
```json
{
  "nodes": [
    {"id": "process::1234", "type": "process", "properties": {"pid": 1234, "name": "bash", ...}}
  ],
  "edges": [
    {"id": "uuid", "source_id": "process::1234", "target_id": "process::5678", "type": "child_process", "properties": {}}
  ]
}
```

## Frontend Details

### Build Tooling

The frontend uses **Vite** as the build tool. Source lives in `src/procmap-ui/` and builds to `src/procmap/dist/`.

**Vite config highlights** (`vite.config.js`):
- `root`: `src/procmap-ui`
- `build.outDir`: `src/procmap/dist` (inside the Python package)
- Injects `__APP_VERSION__` into `index.html` from `__init__.py` `__version__`
- Dev server proxies `/api` to `http://localhost:8000` (the FastAPI backend)

**npm dependencies** (`package.json`):
- `force-graph` — Canvas-based force-directed graph
- `d3@6` — Physics simulation, color utilities
- `@material/web` — Material Design 3 web components (buttons, icons, text fields)
- `tweakpane@4` — Settings panel UI
- `fuse.js@7` — Fuzzy search engine
- `json-formatter-js` — Collapsible JSON display in details panel
- `winbox` — Draggable/resizable detail window

**Dev dependencies**: `vite@6`, `@types/d3`

### Module Architecture

**State Management:** `state.js` holds centralized mutable state:
- `state.graph` — Current `Graph` instance
- `state.currentTool` — Active tool: `"pointer"` | `"rect-select"` | `"search"`
- `state.selection` — Rectangle selection coordinates, selected node IDs
- `state.highlight` — BFS distance maps for hover highlighting
- `state.adjacencyFilter` — Visible node/hidden count maps for adjacency filter
- `state.search` — Match map and color map from fuzzy search

**Event Bus:** `event-bus.js` provides `on(event, handler)` / `emit(event, data)` for decoupled communication.

Key events:
- `"node-clicked"`, `"link-clicked"`, `"background-click"` — UI interactions
- `"search-expression-changed"` — Search input updates
- `"d3-simulation-parameters-changed"` — Force simulation parameter updates
- `"clear-button-clicked"` — Reset state
- `"graph-updated"` — Emitted after loading a new graph (e.g., from API or file import)
- `"graph-filters-updated"` — Emitted after changing type filters in settings

**Rendering (`graph-ui.js`):** Uses the `force-graph` library (canvas-based) with d3 physics simulation. This is the largest module. Key features:
- Custom canvas drawing for nodes (circles with labels, selection indicators, search highlights)
- BFS-based hover highlighting with distance-based opacity
- Adjacency filtering (right-click → show only neighbors)
- Auto-curvature for parallel edges
- Configurable d3 forces (charge, link distance/strength, collision, center, velocity decay)

**Details Panel:** Uses WinBox for a draggable/resizable window with JSONFormatter for collapsible JSON display of node/link properties.

**Settings (`settings.js` + `settings-pane.js`):** Tweakpane-based UI panel with:
- D3 force parameters (tunable in real-time)
- Node/edge type filters (toggle visibility per type)
- Node/edge color pickers (per type, with sensible defaults)
- Show/hide isolated nodes toggle
- Export/import graph JSON
- Pin/unpin all nodes

**Search (`search.js`):** Fuzzy search via Fuse.js across all node properties. Space-separated terms are AND-ed. Results are color-coded on the graph using `ColorScale`.

**Data I/O (`data-io.js`):** Handles API fetching and flexible JSON parsing. Supports:
- Nodes/edges as arrays or id-keyed maps
- Alternate edge keys: `"relationships"`, `"links"`
- Auto-generates missing edge IDs

### UI Components

The toolbar and form elements use **Material Web** (`@material/web`) components:
- `<md-outlined-button>`, `<md-filled-tonal-button>`, `<md-text-button>` — Toolbar buttons
- `<md-icon>` — Material Symbols icons
- `<md-icon-button>` — Icon-only buttons
- `<md-outlined-text-field>` — Search input

Icons are from **Material Symbols Outlined**, loaded via Google Fonts CDN.

## Coding Conventions

### Python
- Line length: 79 (ruff)
- Formatter: ruff format
- Import sorting: isort (profile=black)
- Type hints used (Python 3.12 syntax: `dict[str, Any]`, `list[int]`, `X | None`)
- Models are plain classes (not dataclasses/Pydantic for domain models; Pydantic used only for API schemas in `app.py`)
- Logging via `logging` + `coloredlogs`
- No `__all__` exports convention

### JavaScript
- ES modules bundled by Vite (no framework)
- JSDoc type annotations with `@typedef` and `@param` (checkJs enabled in jsconfig.json)
- DOM elements cached at module level
- Arrow functions preferred for short callbacks
- `const` by default, `let` when mutation needed
- npm packages imported by bare specifier (e.g., `import ForceGraph from 'force-graph'`)

## Common Development Tasks

### Adding a new API endpoint
1. Add route in `src/procmap/app.py` with appropriate Pydantic request/response models
2. Implement business logic in `discovery.py` or a new module
3. Update frontend `data-io.js` if the frontend needs to call it

### Adding a new node/edge type to the graph
1. Create the discovery logic in `discovery.py` inside `build_graph()`
2. Add model classes in `model.py` if needed
3. The frontend auto-discovers new types and creates filter toggles and color pickers
4. Optionally add hardcoded color overrides in `settings.js` (`overrideNodeColors`/`overrideEdgeColors`)

### Adding a new frontend module
1. Create `src/procmap-ui/modules/your-module.js`
2. Use ES module exports; import from other modules as needed
3. Wire into the app via `event-bus.js` events or direct imports in `app.js`
4. Install new npm packages with `npm install <package>` if needed

### Adding a new npm dependency
1. `npm install <package>` (or add to `package.json` and `npm ci`)
2. Import in your JS module with a bare specifier: `import X from 'package'`
3. Vite will bundle it automatically

### Modifying the graph visualization
- Node rendering: `graph-ui.js` → `nodeCanvasObject` callback
- Link rendering: `graph-ui.js` → `linkCanvasObject` callback
- Physics: Adjust defaults in `settings.js` or tune via settings pane at runtime
- Colors: `settings.js` → `overrideNodeColors` / `overrideEdgeColors` / `palette`

### Modifying the settings panel
- Static settings: Edit `settings-pane.js` setup code
- Dynamic per-type settings: Modify `updateDynamicGraphPanes()` in `settings-pane.js`

### Testing
- Backend tests are in `src/procmap/tests/` using `unittest`
- Run with `pytest src/procmap/tests/`
- Tests require Linux `/proc` filesystem access
- Frontend has no automated tests; test manually in browser

## Important Caveats

- **Linux only:** The discovery layer depends on `/proc` filesystem and the `ss` command. It will not work on macOS or Windows.
- **Privileges:** Some process info (e.g., other users' `/proc/[pid]/fd`) requires root or appropriate capabilities. Run with `sudo` for full visibility.
- **Frontend build required:** The backend serves pre-built Vite output from `src/procmap/dist/`. You must run `./scripts/build-ui.sh` (or `npm run build`) before the backend can serve the frontend. During development, use the Vite dev server (`./scripts/dev-ui.sh` or `npm run dev`) for HMR.
- **No host Node.js needed:** The `build-ui.sh` and `dev-ui.sh` scripts run Node.js inside Docker, so no local Node.js installation is required.
- **Version single source of truth:** The app version is defined in `src/procmap/__init__.py` (`__version__`). Vite reads it at build time and injects it into `index.html`.
- **Graph size:** On busy systems the graph can have thousands of nodes. The force simulation may be slow; tune d3 parameters via the settings pane.
- **Graph ID conventions:** Backend generates node IDs as `"process::{pid}"`, `"pipe::{inode}"`, `"socket::{addr}::{type}"`, `"external_ip::{ip}"`. Edge IDs are UUIDs.
