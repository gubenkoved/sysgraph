# Copilot Instructions for sysgraph

## IMPORTANT: Build System

Prefer the dockerized scripts in `scripts/` for ALL frontend work. They run
Node.js inside Docker, so no host Node.js installation is required and everyone
(and CI) uses the same Node 22 image:
- `./scripts/build-ui.sh` — production build (outputs to `src/sysgraph/dist/`)
- `./scripts/dev-ui.sh` — dev server with HMR (Vite on port 5173)
- `./scripts/typecheck-ui.sh` — TypeScript type checking
- `./scripts/lint-ui.sh` — Biome linter (pass `--fix` to auto-fix)
- `./scripts/test-ui.sh` — Vitest unit tests

If Node.js 22 is installed locally you MAY run the underlying npm scripts
directly for faster iteration — `npm ci`, `npm run build`, `npm run typecheck`,
`npm run lint`, `npm run test`. This only creates a project-local `node_modules/`
(gitignored) and the npm cache; it does not pollute the host globally. Use
whichever Node you run with care to match version 22. For any one-off Node
command not covered by a script, either add a `scripts/*-ui.sh` wrapper or run
it through Docker with the same pattern the `*-ui.sh` scripts use
(`docker run --rm -v "$PWD:/app" -w /app -u "$(id -u):$(id -g)" -e
npm_config_cache=/tmp/.npm node:22-slim sh -c "..."`). Updating
`package-lock.json` should be done with `npm install --package-lock-only`
(locally with Node 22, or via the same Docker invocation).

**After any frontend/UI changes** (HTML, CSS, JS in `src/sysgraph-ui/`), always rebuild with `./scripts/build-ui.sh` so the changes are reflected in the served app. The backend serves pre-built files from `src/sysgraph/dist/`.

**After any frontend/UI changes**, run `./scripts/lint-ui.sh` and fix any lint errors or warnings introduced by the changes. Use `./scripts/lint-ui.sh --fix` to auto-fix when possible, then address any remaining issues manually. The codebase must stay lint-clean (0 errors, 0 warnings).

**After any changes to Python dependencies** (adding, removing, or changing versions in `pyproject.toml`), always relock `requirements.txt` by running `./scripts/compile-requirements.sh` (wraps `pip-compile` from `pip-tools`). The locked file must stay in sync with `pyproject.toml`.

## Project Overview

**sysgraph** is a real-time process-graph visualizer that discovers running OS processes, their inter-process communication channels (pipes, Unix domain sockets, TCP/UDP network connections), and renders them as an interactive force-directed graph in the browser.

- **Author:** Eugene Gubenkov (`gubenkoved@gmail.com`)
- **License:** MIT
- **Python:** ≥ 3.12 (supports 3.12 and 3.13)
- **Node.js:** 22 (used for frontend build via Vite)
- **Package name:** `sysgraph` (importable as `sysgraph`)
- **Packaging:** setuptools via `pyproject.toml` (no `setup.py`); version is dynamic from `sysgraph.__version__`

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Browser (SPA)                                           │
│  Built by Vite from src/sysgraph-ui/ → src/sysgraph/dist/  │
│  Libraries (npm): force-graph, d3@7, tweakpane (+core,    │
│    plugin-essentials), fuse.js, @material/web,           │
│    json-formatter-js                                     │
│  Icons & fonts: Material Symbols, Roboto, Ubuntu (CDN)   │
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
│  Uses: psutil (cross-platform), /proc & ss (Linux only) │
│  Discovers: processes, pipes, UDS, TCP/UDP connections   │
└──────────────────────────────────────────────────────────┘
```

## Directory Layout

```
sysgraph/
├── pyproject.toml          # Packaging (setuptools), Ruff + isort config, dynamic version
├── requirements.txt        # Locked deps (pip-compile output)
├── requirements-dev.in     # Dev dependencies (pytest, httpx, ruff, pip-tools, etc.)
├── package.json            # Node.js deps & scripts (Vite build)
├── package-lock.json       # Locked npm deps
├── vite.config.ts          # Vite build config (root: src/sysgraph-ui; bundles data/ examples)
├── tsconfig.json           # TypeScript config (browser, strict, noEmit)
├── tsconfig.node.json      # TypeScript config for vite.config.ts (Node types)
├── biome.json              # Biome linter config
├── Dockerfile              # Multi-stage: Node.js build + Python runtime
├── MANIFEST.in             # Includes dist/ in Python package
├── .pre-commit-config.yaml # pre-commit hooks
├── data/                   # Built-in example graphs (bundled into dist/examples/)
│   ├── simple-graph.json
│   └── greek-mythology.json
├── scripts/
│   ├── build-image.sh      # Build Docker image
│   ├── build-ui.sh         # Build frontend via Docker (no host Node.js needed)
│   ├── dev-ui.sh           # Start Vite dev server via Docker
│   ├── typecheck-ui.sh     # TypeScript type checking via Docker
│   ├── lint-ui.sh          # Biome linter via Docker (--fix to auto-fix)
│   ├── publish-image.sh    # Tag & push to Docker Hub (gubenkoved/sysgraph)
│   ├── publish-pypi.sh     # Build & publish the Python package to PyPI
│   ├── compile-requirements.sh  # pip-compile to lock deps
│   ├── docker-entrypoint.sh     # Container entrypoint (uvicorn)
│   └── lint.sh             # Run ruff + isort (Python)
├── src/
│   └── sysgraph/                 # Python backend package
│       ├── __init__.py          # Exports __version__ (single source of truth)
│       ├── __main__.py          # Allows `python -m sysgraph` (calls app.main())
│       ├── app.py               # FastAPI application & API schemas
│       ├── discovery.py         # OS process/connection discovery + graph building
│       ├── graph.py             # Graph data structure (Node, Relationship, Graph)
│       ├── model.py             # Domain models (Process, NetConnection, UDS, etc.)
│       ├── constants.py         # Node/edge type names + node-ID helper functions
│       ├── main.py              # CLI entry point for debug/exploration
│       ├── dist/                # Vite build output (generated, gitignored)
│       └── tests/
│           ├── test_discovery.py
│           └── test_graph.py
│   └── sysgraph-ui/             # Frontend source (Vite project root)
│       ├── index.html           # SPA shell (toolbar, detail panel, settings pane)
│       ├── styles.css           # All styling + design tokens (CSS custom properties)
│       ├── globals.d.ts         # Ambient declarations (e.g. __STANDALONE__)
│       ├── app.ts               # Frontend entry point
│       └── modules/
│           ├── state.ts          # Centralized app state (incl. unsaved-changes flag)
│           ├── event-bus.ts      # Pub-sub event system + 1:1 command handlers
│           ├── constants.ts      # Event/command names, render constants, STANDALONE flag
│           ├── graph.ts          # Frontend Graph class (adjacency index)
│           ├── graph-ui.ts       # force-graph rendering (largest module)
│           ├── graph-ui-helpers.ts # Label-expression helpers (e.g. bytes_to_human)
│           ├── graph-algs.ts     # BFS algorithm for highlights
│           ├── render-hooks.ts   # Pre/post per-frame render hooks
│           ├── data-io.ts        # API fetch, JSON serialization/parsing, examples manifest
│           ├── search.ts         # Search via Fuse.js (uses search-parser)
│           ├── search-parser.ts  # Search grammar (field:value, AND/OR, grouping, quotes)
│           ├── selection.ts      # Rectangle selection overlay
│           ├── edit-mode.ts      # Graph editing (add/delete nodes & edges)
│           ├── details-panel.ts  # Node/edge details panel + editable form
│           ├── toolbar.ts        # Toolbar buttons & keyboard shortcuts
│           ├── settings-pane.ts  # Tweakpane settings UI (filters, colors, forces)
│           ├── settings.ts       # Default settings, color palettes
│           ├── settings-presets.ts # Predefined + user settings presets (localStorage)
│           ├── context-menu.ts   # Right-click context menu
│           ├── color-scale.ts    # Color interpolation for search heatmap
│           ├── theme.ts          # Light/dark theme toggle (persisted)
│           ├── zoom-indicator.ts # Floating zoom widget (-/+ and live %)
│           └── util.ts           # FNV-1a hash + toast error helpers
```

## Development Setup

### Prerequisites
- Python ≥ 3.12
- Linux, macOS, or Windows (process + network discovery is cross-platform; UDS and pipes require Linux)
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
python src/sysgraph/app.py
# → serves at http://localhost:8000
# Alternative: python -m sysgraph

# Or via uvicorn directly
uvicorn sysgraph.app:app --reload --host 0.0.0.0 --port 8000
```

### Frontend Build

The frontend is built with **Vite** and outputs to `src/sysgraph/dist/`. Build scripts use Docker so no host Node.js is needed:

```bash
# Production build (via Docker)
./scripts/build-ui.sh
# → outputs to src/sysgraph/dist/

# Development server with HMR (via Docker)
./scripts/dev-ui.sh
# → Vite dev server on http://localhost:5173
# → Proxies /api requests to http://localhost:8000
# → Run the FastAPI backend separately
```

### Running Tests

```bash
pytest src/sysgraph/tests/
```

Tests require running on Linux for full coverage (pipe discovery tests need `/proc`).

### Linting

**Python:**
```bash
./scripts/lint.sh
# Runs: ruff check, ruff format, isort
```
Ruff is configured in `pyproject.toml` with line-length=79, target Python 3.12.

**Frontend (TypeScript):**
```bash
./scripts/lint-ui.sh          # check
./scripts/lint-ui.sh --fix    # auto-fix
# or locally: npm run lint / npm run lint:fix
```
Biome is configured in `biome.json` (recommended rules, formatter disabled).

### Docker

```bash
./scripts/build-image.sh [tag]    # default tag: dev
./scripts/publish-image.sh [tag]  # builds, tags as gubenkoved/sysgraph, pushes
```

The Dockerfile is a **multi-stage build**: stage 1 builds the frontend with Node.js 22, stage 2 copies the Vite output into the Python runtime image. The container runs uvicorn on `$PORT` (default 8000).

## Backend Details

### Python Modules

| Module | Purpose |
|--------|---------|
| `app.py` | FastAPI app, Pydantic schemas (`GraphSchema`, `GraphNodeSchema`, `GraphEdgeSchema`), serves Vite build output from `dist/`, `/api/graph` and `/api/health` endpoints, `main()` CLI/uvicorn entry point |
| `discovery.py` | OS introspection: `discover_processes()`, `discover_unix_sockets()`, `get_processes_open_files()`, `get_all_net_connections()`, `build_graph()` |
| `graph.py` | Backend graph data structure: `Node`, `Relationship`, `Graph` with `add_node()`, `add_edge()`, `as_dict()` |
| `model.py` | Domain models: `Process`, `ProcessOpenFile`, `UnixDomainSocket`, `UnixDomainSocketConnection`, `NetConnection`, `SocketAddress`, etc. |
| `constants.py` | Node/edge type-name constants (`NODE_*`, `EDGE_*`) and node-ID helpers (`process_node_id()`, `uds_node_id()`, `pipe_node_id()`, `socket_node_id()`, `external_ip_node_id()`) |
| `main.py` | CLI debug script — runs discovery and logs results |
| `__main__.py` | Allows running as `python -m sysgraph` (calls `app.main()`) |

### Static File Serving

The backend serves the Vite-built frontend from `src/sysgraph/dist/`:
- `GET /` → `dist/index.html`
- `GET /*` → catch-all `StaticFiles` mount on `dist/` (after all `/api/*` routes)
- If `dist/` is missing, a warning is logged and the frontend is not served

The `dist/` directory is included in the Python package via `MANIFEST.in` and the `[tool.setuptools.package-data]` entry in `pyproject.toml` (`sysgraph = ["dist/*", "dist/**/*"]`).

### Graph Node Types (generated by backend)
Type-name constants live in `constants.py` (`NODE_*`).
- `process` — OS process (properties: pid, command, user, name, cpu_user, cpu_system, environment)
- `pipe` — Named pipe (FIFO) inode (properties: label)
- `socket` — TCP/UDP socket endpoint (properties: label, state, socket_type)
- `uds` — Unix domain socket endpoint
- `external_ip` — Remote IP not owned by a local process (properties: label)

### Graph Edge Types (generated by backend)
Type-name constants live in `constants.py` (`EDGE_*`).
- `child_process` — Parent→child process relationship
- `uds` — Process→UDS binding
- `uds_connection` — Connection between two UDS endpoints
- `pipe` — Read/write pipe connection (directional; properties: fd, mode)
- `socket` — Process→local socket binding
- `socket_connection` — Connection between local↔remote socket endpoints
- `external_socket` — External IP→socket connection

### Key Discovery Functions
- `discover_processes()` — Uses `psutil.process_iter()` to enumerate all processes (cross-platform)
- `discover_unix_sockets()` — Parses `ss -xp` output to find UDS sockets (Linux only; returns empty list on other platforms)
- `discover_connected_uds()` — Pairs UDS by matching local/peer inodes
- `get_processes_open_files()` — Reads `/proc/[pid]/fd` and `/proc/[pid]/fdinfo` for pipe FDs (Linux only; returns empty dict on other platforms)
- `get_all_net_connections()` — Uses `psutil.net_connections(kind="inet")` for TCP/UDP (cross-platform)
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

The frontend uses **Vite** as the build tool. Source lives in `src/sysgraph-ui/` and builds to `src/sysgraph/dist/`.

**Vite config highlights** (`vite.config.ts`):
- `root`: `src/sysgraph-ui`
- `build.outDir`: `src/sysgraph/dist` (inside the Python package)
- Injects `__APP_VERSION__` into `index.html` from `__init__.py` `__version__`
- Dev server proxies `/api` to `http://localhost:8000` (the FastAPI backend)

**npm dependencies** (`package.json`):
- `force-graph` — Canvas-based force-directed graph
- `d3@7` — Physics simulation, color utilities
- `@material/web` — Material Design 3 web components (buttons, icons, text fields)
- `tweakpane@4` (+ `@tweakpane/core`, `@tweakpane/plugin-essentials`) — Settings panel UI
- `fuse.js@7` — Fuzzy search engine
- `json-formatter-js` — Collapsible JSON display in details panel

**Dev dependencies**: `vite@8`, `typescript@6`, `@types/d3@7`, `@types/node`, `@biomejs/biome@2`

### Module Architecture

**State Management:** `state.ts` holds centralized mutable state:
- `state.graph` — Current `Graph` instance
- `state.currentTool` — Active tool: `"pointer"` | `"rect-select"` | `"search"`
- `state.edit` — Edit-mode state (`active`, `subTool`: `"modify"` | `"connect"`, `pendingEdgeSourceId`)
- `state.selection` — Rectangle selection coordinates, selected node IDs
- `state.highlight` — BFS distance maps for hover highlighting
- `state.adjacencyFilter` — Visible node/hidden count maps for adjacency filter
- `state.search` — Match map and color map from search
- Module-level unsaved-changes flag (`isGraphDirty()` / `setGraphDirty()`) — tracks unexported edits

**Event Bus:** `event-bus.ts` provides generic `on<T>` / `emit<T>` / `registerHandler` / `handle` for decoupled communication. Event and command name constants live in `constants.ts`.

Key events:
- `"node-clicked"`, `"link-clicked"`, `"background-click"` — UI interactions
- `"search-expression-changed"`, `"search-cycle"` — Search input updates / next-prev match cycling
- `"selection-changed"` — Selection set changed
- `"d3-simulation-parameters-changed"` — Force simulation parameter updates
- `"graph-ui-settings-updated"`, `"graph-ui-colors-updated"`, `"graph-ui-links-curvature-updated"` — Settings/colors/curvature changes
- `"clear-button-clicked"` — Reset state
- `"graph-updated"` — Emitted after loading a new graph (e.g., from API, file import, or example)
- `"graph-filters-updated"` — Emitted after changing type filters in settings
- `"theme-changed"` — Light/dark theme toggled

Key commands (1:1 handlers): `"reload-graph"`, `"export-graph"`, `"import-graph"`, `"load-example"`.

**Rendering (`graph-ui.ts`):** Uses the `force-graph` library (canvas-based) with d3 physics simulation. This is the largest module. Key features:
- Custom canvas drawing for nodes (circles with labels, selection indicators, search highlights)
- BFS-based hover highlighting with distance-based opacity
- Adjacency filtering (right-click → show only neighbors)
- Auto-curvature for parallel edges
- Configurable d3 forces (charge, link distance/strength, collision, center, velocity decay)

**Details Panel:** Uses JSONFormatter for collapsible JSON display of node/link properties.

**Settings (`settings.ts` + `settings-pane.ts`):** Tweakpane-based UI panel with:
- D3 force parameters (tunable in real-time)
- Node/edge type filters (toggle visibility per type)
- Node/edge color pickers (per type, with sensible defaults)
- Show/hide isolated nodes toggle
- Export/import graph JSON
- Pin/unpin all nodes

**Search (`search.ts` + `search-parser.ts`):** Search across node properties via Fuse.js. `search-parser.ts` implements a small grammar: `field:value` specifiers, `AND`/`OR` logic (implicit AND via adjacency), parenthesized grouping, and double-quoted strings. Results are color-coded on the graph using `ColorScale`, and the search tool supports cycling through matches.

**Data I/O (`data-io.ts`):** Handles API fetching and flexible JSON parsing. Supports:
- Nodes/edges as arrays or id-keyed maps
- Alternate edge keys: `"relationships"`, `"links"`
- Auto-generates missing edge IDs
- Loads the bundled examples manifest and example graphs from `dist/examples/`

**Edit Mode (`edit-mode.ts` + `details-panel.ts`):** The Edit tool (E) enables graph authoring:
- `modify` sub-tool — click empty canvas to add a node; click a node to edit it
- `connect` sub-tool — click a source node then a target node to create an edge
- The details panel renders an editable form (type + properties) for the selected node/edge
- Any edit marks the graph "dirty"; a `beforeunload` guard warns before losing unexported changes. Loading/importing/exporting clears the dirty flag.

**Theme (`theme.ts`):** Light/dark theme toggle, persisted in `localStorage` (`sysgraph:theme`); emits `"theme-changed"` so the canvas re-derives colors.

**Settings Presets (`settings-presets.ts`):** Predefined and user-defined settings presets persisted in `localStorage` (`sysgraph:settings-presets`).

**Zoom Indicator (`zoom-indicator.ts`):** Floating bottom-left widget showing the live zoom level with `-`/`+` buttons that animate the camera.

**Render Hooks (`render-hooks.ts`):** Registerable pre/post per-frame hooks invoked around each force-graph render frame.

**Standalone mode:** Build-time flag `__STANDALONE__` (declared in `globals.d.ts`, set via `VITE_STANDALONE=true`). When enabled the UI never contacts the backend (no initial `/api/graph` fetch, no reload); graphs are loaded via import or examples.

### UI Components

The toolbar and form elements use **Material Web** (`@material/web`) components:
- `<md-outlined-button>`, `<md-filled-tonal-button>`, `<md-text-button>` — Toolbar buttons
- `<md-icon>` — Material Symbols icons
- `<md-icon-button>` — Icon-only buttons
- `<md-outlined-text-field>` — Search input

Icons are from **Material Symbols Outlined**, loaded via Google Fonts CDN.

## Coding Conventions

### Simplicity & cleanliness (Python & TypeScript)
- Keep the code clean and prefer the simplest solution that works; do not over-engineer
- Avoid unnecessary code duplication — factor out shared logic into a helper instead of copy-pasting
- Avoid excessive complexity (deep nesting, premature abstractions, needless indirection, speculative generality)
- If a change starts to feel overcomplicated, pause and ask the user whether the approach might be over-engineered before continuing

### Comments (Python & TypeScript)
- Start regular comments with a lower-case letter
- Do not end a comment with a period/dot
- Applies to inline (`//`, `#`) and line comments; keep them concise
- Section-divider comments (e.g. `// --- foo ---`) and structured doc comments (JSDoc `/** ... */`, docstrings) are exempt and may use normal sentence capitalization/punctuation
- Explain the "why", not the obvious "what"

### Python
- Line length: 79 (ruff)
- Formatter: ruff format
- Import sorting: isort (profile=black)
- Type hints used (Python 3.12 syntax: `dict[str, Any]`, `list[int]`, `X | None`)
- Models are plain classes (not dataclasses/Pydantic for domain models; Pydantic used only for API schemas in `app.py`)
- Logging via `logging` + `coloredlogs`
- No `__all__` exports convention

### TypeScript
- ES modules bundled by Vite (no framework); strict TypeScript (`strict: true`, `noEmit: true`)
- `moduleResolution: bundler` — `.js` extensions in imports resolve to `.ts` source files
- Types defined per-module and exported with `export type`; no shared `types.ts`
- DOM elements cast to specific types (`HTMLElement`, `HTMLButtonElement`, etc.)
- Arrow functions preferred for short callbacks
- `const` by default, `let` when mutation needed
- npm packages imported by bare specifier (e.g., `import ForceGraph from 'force-graph'`)
- Lint: `npm run lint` / `./scripts/lint-ui.sh`; type-check: `npm run typecheck` / `./scripts/typecheck-ui.sh`

### Design language (styling changes)
All styling flows through the design tokens (CSS custom properties) defined at the top of `styles.css` (`:root` for light, `:root[data-theme="dark"]` for dark). When adjusting visuals, **update the shared design language, don't hot-fix one element**:
- Prefer changing the relevant token (e.g., `--border-subtle`, `--shadow-sm`, `--bg-pill`) so every component that shares it updates uniformly, rather than overriding a color/border/shadow on a single selector.
- Keep token scales monotonic and meaningful — e.g., the border ramp `--border-subtle` < `--border-light` < `--border-medium`, and the shadow ramp `--shadow-xs` < `--shadow-sm` < `--shadow-md`. If you bump one step, keep the ordering consistent (adjust the whole ramp if needed).
- Mirror light/dark: any token added or changed for one theme should have a counterpart in the other so both stay balanced.
- Only add a selector-specific override when a value is genuinely unique to that one element; if a "fix" feels like patching a single spot, step back and adjust the token instead.

### Material Design 3 (MD3) UI Paradigm
The frontend uses **Material Web** (`@material/web@2.x`) — Google's web-component implementation of Material Design 3. All interactive UI chrome (buttons, icon buttons, text fields) must use MD3 components:
- `<md-outlined-button>` — toolbar/action buttons (with optional `<md-icon slot="icon">`)
- `<md-icon-button>` — compact icon-only buttons (panel headers, floating controls)
- `<md-outlined-text-field>` — text inputs (search bar)
- `<md-icon>` — inline icons using Material Symbols Outlined names (e.g., `add`, `remove`, `close`)
- **Custom properties** on MD3 elements (e.g., `--md-icon-button-icon-size`) control sizing; match the design-token scale in `styles.css` (`--button-height`, `--icon-button-size`, `--font-size-*`, `--radius-*`)
- Import new component bundles in `app.ts` before use: `import '@material/web/iconbutton/icon-button.js'`
- Icons come from Material Symbols Outlined — see [Google Fonts icons](https://fonts.google.com/icons) for names

## Common Development Tasks

### Adding a new API endpoint
1. Add route in `src/sysgraph/app.py` with appropriate Pydantic request/response models
2. Implement business logic in `discovery.py` or a new module
3. Update frontend `data-io.ts` if the frontend needs to call it

### Adding a new node/edge type to the graph
1. Create the discovery logic in `discovery.py` inside `build_graph()`
2. Add model classes in `model.py` if needed
3. The frontend auto-discovers new types and creates filter toggles and color pickers
4. Optionally add hardcoded color overrides in `settings.ts` (`overrideNodeColors`/`overrideEdgeColors`)

### Adding a new frontend module
1. Create `src/sysgraph-ui/modules/your-module.ts`
2. Use ES module exports with TypeScript types; use `.js` extension in imports (bundler resolution maps to `.ts`)
3. Wire into the app via `event-bus.ts` events or direct imports in `app.ts`
4. Install new npm packages by adding them to `package.json` and rebuilding via `./scripts/build-ui.sh`

### Adding a new npm dependency
1. Add the package to `package.json` dependencies, then rebuild via `./scripts/build-ui.sh` (do NOT run `npm install` on the host)
2. Import in your JS module with a bare specifier: `import X from 'package'`
3. Vite will bundle it automatically

### Modifying the graph visualization
- Node rendering: `graph-ui.ts` → `nodeCanvasObject` callback
- Link rendering: `graph-ui.ts` → `linkCanvasObject` callback
- Physics: Adjust defaults in `settings.ts` or tune via settings pane at runtime
- Colors: `settings.ts` → `overrideNodeColors` / `overrideEdgeColors` / `palette`

### Modifying the settings panel
- Static settings: Edit `settings-pane.ts` setup code
- Dynamic per-type settings: Modify `updateDynamicGraphPanes()` in `settings-pane.ts`

### Testing
- Backend tests are in `src/sysgraph/tests/` using `unittest`
- Run with `pytest src/sysgraph/tests/`
- Tests run on all platforms; pipe-related tests need Linux `/proc` filesystem
- Frontend has no automated tests; test manually in browser

## Important Caveats

- **Cross-platform discovery:** Process and network discovery works on Linux, macOS, and Windows via psutil. UDS discovery works on Linux only (requires `ss` command). Pipe discovery is Linux-only (reads `/proc`). On unsupported platforms, these features gracefully return empty data.
- **Privileges:** Some process info (e.g., other users' processes) requires root/admin privileges. Run with `sudo` on Linux/macOS for full visibility.
- **Frontend build required:** The backend serves pre-built Vite output from `src/sysgraph/dist/`. You must run `./scripts/build-ui.sh` before the backend can serve the frontend. During development, use the Vite dev server (`./scripts/dev-ui.sh`) for HMR.
- **No host Node.js needed:** All `*-ui.sh` scripts run Node.js inside Docker. If Node.js 22 is available locally, `npm run build/typecheck/lint` also work.
- **Version single source of truth:** The app version is defined in `src/sysgraph/__init__.py` (`__version__`). Vite reads it at build time and injects it into `index.html`.
- **Graph size:** On busy systems the graph can have thousands of nodes. The force simulation may be slow; tune d3 parameters via the settings pane.
- **Graph ID conventions:** Backend generates node IDs as `"process::{pid}"`, `"pipe::{inode}"`, `"socket::{addr}::{type}"`, `"uds::{key}"`, `"external_ip::{ip}"` (see the `*_node_id()` helpers in `constants.py`). Edge IDs are UUIDs.
