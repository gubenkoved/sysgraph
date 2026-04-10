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
export const EVT_NODE_CLICKED = 'node-clicked';
export const EVT_LINK_CLICKED = 'link-clicked';
export const EVT_BACKGROUND_CLICK = 'background-click';

// ── Command names ───────────────────────────────────────────
export const CMD_RELOAD = 'reload-graph';
export const CMD_EXPORT = 'export-graph';
export const CMD_IMPORT = 'import-graph';

// ── Node rendering ──────────────────────────────────────────
export const MIN_NODE_RADIUS = 4;
export const MIN_POINTER_AREA_RADIUS = 8;
export const NODE_RADIUS_MULTIPLIER = 3;
export const MAX_NODE_VAL = 10;
export const NODE_LABEL_FONT_SIZE = 12;
export const NODE_LABEL_OFFSET = 4;
export const UI_FONT_FAMILY = "'Ubuntu', 'Segoe UI', 'Arial', sans-serif";

/**
 * Computes the display radius for a node.
 * @param {{ val?: number }} node
 * @returns {number}
 */
export function nodeRadius(node) {
    return Math.max(MIN_NODE_RADIUS, (node.val || 1) * NODE_RADIUS_MULTIPLIER);
}

/**
 * Computes the pointer hit-test radius for a node (slightly larger).
 * @param {{ val?: number }} node
 * @returns {number}
 */
export function nodePointerRadius(node) {
    return Math.max(MIN_POINTER_AREA_RADIUS, (node.val || 1) * NODE_RADIUS_MULTIPLIER);
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

// ── Search & highlight ──────────────────────────────────────
export const SEARCH_NOT_MATCHING_OPACITY = 0.5;
export const SCORE_EPSILON = 1e-12;

export const SEARCH_COLOR_BEST = 'rgb(255, 0, 0)';
export const SEARCH_COLOR_MID = 'rgb(255, 140, 0)';
export const SEARCH_COLOR_WORST = 'rgb(195, 179, 41)';

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
