// ── Event names ─────────────────────────────────────────────
export const EVT_GRAPH_UPDATED = 'graph-updated';
export const EVT_CLEAR_CLICKED = 'clear-button-clicked';
export const EVT_FILTERS_UPDATED = 'graph-filters-updated';
export const EVT_SEARCH_CHANGED = 'search-expression-changed';
export const EVT_SELECTION_CHANGED = 'selection-changed';
export const EVT_SETTINGS_UPDATED = 'graph-ui-settings-updated';
export const EVT_COLORS_UPDATED = 'graph-ui-colors-updated';
export const EVT_CURVATURE_UPDATED = 'graph-ui-links-curvature-updated';
export const EVT_D3_PARAMS_CHANGED = 'd3-simulation-parameters-changed';
export const EVT_SEARCH_CYCLE = 'search-cycle';
export const EVT_NODE_CLICKED = 'node-clicked';
export const EVT_LINK_CLICKED = 'link-clicked';
export const EVT_BACKGROUND_CLICK = 'background-click';
export const EVT_THEME_CHANGED = 'theme-changed';
export const EVT_TOOL_CHANGED = 'tool-changed';
export const EVT_ANALYTICS_UPDATED = 'analytics-updated';
export const EVT_LAYOUT_CHANGED = 'layout-changed';

// ── Dock panel ids ──────────────────────────────────────────
export const PANEL_GRAPH = 'graph';
export const PANEL_DETAILS = 'details';
export const PANEL_ANALYTICS = 'analytics';
export const PANEL_SETTINGS = 'settings';

// ── Command names ───────────────────────────────────────────
export const CMD_RELOAD = 'reload-graph';
export const CMD_EXPORT = 'export-graph';
export const CMD_IMPORT = 'import-graph';
export const CMD_LOAD_EXAMPLE = 'load-example';

// ── Build-time configuration ────────────────────────────────
/**
 * Standalone mode (build-time flag). When true the UI never contacts the
 * backend: no initial /api/graph fetch and no "reload sysgraph" action.
 * Graphs can still be loaded via JSON import. Set VITE_STANDALONE=true at
 * build time to enable.
 */
export const STANDALONE = __STANDALONE__;

// ── Node rendering ──────────────────────────────────────────
export const MIN_NODE_RADIUS = 4;
export const MIN_POINTER_AREA_RADIUS = 8;
export const NODE_RADIUS_MULTIPLIER = 3;
export const MAX_NODE_VAL = 10;
export const NODE_LABEL_FONT_SIZE = 12;
export const NODE_LABEL_OFFSET = 4;
// dampen on-screen label growth above this zoom level (globalScale; 2 = 200%)
// so dense labels stay distinguishable when zoomed in
export const NODE_LABEL_ZOOM_THRESHOLD = 2;
// 0 = no dampening (linear growth), 1 = fully pinned size; 0.5 -> sqrt growth
export const NODE_LABEL_ZOOM_DAMP = 0.5;
export const UI_FONT_FAMILY = "'Ubuntu', 'Roboto', 'Segoe UI', 'Arial', sans-serif";

/**
 * Computes the display radius for a node.
 */
export function nodeRadius(node: { val?: number }): number {
    return Math.max(MIN_NODE_RADIUS, (node.val ?? 1) * NODE_RADIUS_MULTIPLIER);
}

/**
 * Computes the pointer hit-test radius for a node (slightly larger).
 */
export function nodePointerRadius(node: { val?: number }): number {
    return Math.max(MIN_POINTER_AREA_RADIUS, (node.val ?? 1) * NODE_RADIUS_MULTIPLIER);
}

// ── Grid ────────────────────────────────────────────────────
export const GRID_SPACING = 100;
export const GRID_CROSS_HALF = 5;
export const GRID_CENTER_CROSS_HALF = 10;
export const MAX_CROSSES_PER_AXIS = 100;

export const GRID_LINE_COLOR = 'rgba(0, 0, 0, 0.15)';
export const GRID_LINE_COLOR_UNSTRESSED = 'rgba(0, 0, 0, 0.07)';
export const GRID_CENTER_COLOR = 'rgba(255, 0, 0, 0.3)';
export const GRID_CENTER_COLOR_UNSTRESSED = 'rgba(255, 0, 0, 0.1)';

// dark-theme grid variants (lighter lines on a dark canvas)
export const GRID_LINE_COLOR_DARK = 'rgba(255, 255, 255, 0.28)';
export const GRID_LINE_COLOR_UNSTRESSED_DARK = 'rgba(255, 255, 255, 0.12)';
export const GRID_CENTER_COLOR_DARK = 'rgba(255, 80, 80, 0.45)';
export const GRID_CENTER_COLOR_UNSTRESSED_DARK = 'rgba(255, 80, 80, 0.18)';

// In dark mode, edge colours darker than this HSL lightness (0..1) are raised
// to this floor so they stay legible against the dark canvas. Hue, saturation
// and opacity are preserved; already-bright edges are left untouched.
export const EDGE_DARK_MIN_LIGHTNESS = 0.55;

// ── Search & highlight ──────────────────────────────────────
export const SEARCH_NOT_MATCHING_OPACITY = 0.5;
export const SCORE_EPSILON = 1e-12;

export const SEARCH_COLOR_BEST = 'rgb(255, 0, 0)';
export const SEARCH_COLOR_MID = 'rgb(255, 140, 0)';
export const SEARCH_COLOR_WORST = 'rgb(195, 179, 41)';

// ── Analytics heatmap scale (cold → hot) ────────────────────
export const HEATMAP_COLOR_LOW = 'rgb(44, 123, 182)';
export const HEATMAP_COLOR_MID = 'rgb(255, 225, 100)';
export const HEATMAP_COLOR_HIGH = 'rgb(215, 25, 28)';

// ── Animation & zoom ────────────────────────────────────────
export const MAX_ZOOM_BOOST = 3;
export const REHEAT_ALPHA = 0.25;
export const REHEAT_TIMEOUT_MS = 600;
export const SEARCH_PULSE_BASE = 5;
export const SEARCH_PULSE_FREQ = 2;

// ── D3 force defaults ───────────────────────────────────────
export const D3_CHARGE_STRENGTH = -450;
export const D3_LINK_DISTANCE = 140;
export const D3_LINK_STRENGTH = 0.8;
export const D3_COLLISION_BASE_RADIUS = 18;
export const D3_COLLISION_RADIUS_PER_VAL = 6;
export const D3_COLLISION_STRENGTH = 1;
export const D3_COLLISION_ITERATIONS = 4;
