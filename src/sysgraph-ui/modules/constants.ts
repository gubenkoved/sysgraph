// ── event names ─────────────────────────────────────────────
export const EVT_GRAPH_UPDATED = 'graph-updated';
export const EVT_CLEAR_CLICKED = 'clear-button-clicked';
export const EVT_FILTERS_UPDATED = 'graph-filters-updated';
// fired after a refresh whose visible node set actually changed (any filter
// path, including the adjacency filter which bypasses EVT_FILTERS_UPDATED)
export const EVT_VISIBLE_GRAPH_CHANGED = 'visible-graph-changed';
export const EVT_SEARCH_CHANGED = 'search-expression-changed';
export const EVT_SELECTION_CHANGED = 'selection-changed';
export const EVT_SETTINGS_UPDATED = 'graph-ui-settings-updated';
export const EVT_NODE_SIZING_UPDATED = 'node-sizing-updated';
export const EVT_RENDER_OPTIONS_CHANGED = 'webgpu-render-options-changed';
export const EVT_COLORS_UPDATED = 'graph-ui-colors-updated';
export const EVT_WIDTHS_UPDATED = 'graph-ui-widths-updated';
export const EVT_GPU_PARAMS_CHANGED = 'gpu-layout-parameters-changed';
export const EVT_SEARCH_CYCLE = 'search-cycle';
export const EVT_NODE_CLICKED = 'node-clicked';
export const EVT_LINK_CLICKED = 'link-clicked';
export const EVT_BACKGROUND_CLICK = 'background-click';
export const EVT_THEME_CHANGED = 'theme-changed';
export const EVT_TOOL_CHANGED = 'tool-changed';
export const EVT_ANALYTICS_UPDATED = 'analytics-updated';
export const EVT_LAYOUT_CHANGED = 'layout-changed';
export const EVT_RENDER_MODE_CHANGED = 'render-mode-changed';

// ── dock panel ids ──────────────────────────────────────────
export const PANEL_GRAPH = 'graph';
export const PANEL_DETAILS = 'details';
export const PANEL_ANALYTICS = 'analytics';
export const PANEL_SETTINGS = 'settings';
export const PANEL_TEMPLATES = 'templates';

// ── command names ───────────────────────────────────────────
export const CMD_RELOAD = 'reload-graph';
export const CMD_EXPORT = 'export-graph';
export const CMD_IMPORT = 'import-graph';
export const CMD_LOAD_EXAMPLE = 'load-example';
export const CMD_SHARE = 'share-graph';

// ── share-as-link ───────────────────────────────────────────
// graphs are serialized, gzipped and base64url-encoded into the URL hash
// fragment (never a query param, so the backend never sees the payload)
/** Hash-fragment key carrying the encoded graph (e.g. #share=1<base64url>). */
export const SHARE_HASH_KEY = 'share';
/** Payload format version, prefixed to the encoded data for forward compat. */
export const SHARE_VERSION = '1';
/**
 * Encoded URL size (bytes) beyond which a data URL is flagged as large. We
 * still let the user copy it, but warn that some clients (chat apps, email,
 * QR codes) may truncate the link and suggest file export as a fallback.
 */
export const SHARE_MAX_URL_BYTES = 8000;
/**
 * Hard cap on the decompressed payload size (bytes) when decoding a shared
 * link — guards against a decompression-bomb in a hostile URL.
 */
export const SHARE_MAX_DECODED_BYTES = 16 * 1024 * 1024;

// ── build-time configuration ────────────────────────────────
/**
 * Standalone mode (build-time flag). When true the UI never contacts the
 * backend: no initial /api/graph fetch and no "reload sysgraph" action.
 * Graphs can still be loaded via JSON import. Set VITE_STANDALONE=true at
 * build time to enable.
 */
export const STANDALONE = __STANDALONE__;

// ── toolbar ─────────────────────────────────────────────────
// px slack when deciding if the toolbar overflows / sits at a scroll edge, to
// absorb sub-pixel rounding so the scroll affordance never flickers at rest
export const TOOLBAR_SCROLL_EDGE_EPSILON_PX = 1;

// ── expression editor ───────────────────────────────────────
// how many sample entities the expression editor evaluates for its live
// preview; the selection is preferred, then the first nodes/edges in the graph
export const EXPR_PREVIEW_SAMPLE_LIMIT = 6;

// ── node rendering ──────────────────────────────────────────
export const MIN_NODE_RADIUS = 0.3;
export const MIN_POINTER_AREA_RADIUS = 8;
export const NODE_RADIUS_MULTIPLIER = 3;
export const MAX_NODE_VAL = 64;
// target on-screen label size in CSS px. labels are rendered at a roughly
// constant screen size (world font = this / globalScale) so zooming in spreads
// nodes apart without inflating the text — that is what lets the decluttering
// pass progressively reveal more labels as you zoom
export const NODE_LABEL_SCREEN_PX = 12;
export const NODE_LABEL_OFFSET = 4;
// clamp the derived world-space font so labels never collapse to nothing when
// zoomed far out, nor balloon when zoomed far in
export const NODE_LABEL_MIN_WORLD = 1.5;
export const NODE_LABEL_MAX_WORLD = 36;
// padding (screen px) added around each label box when packing labels so
// neighbours keep a small gutter instead of touching
export const LABEL_BOX_PAD_PX = 3;
// extra screen-px margin beyond the viewport when culling off-screen labels, so
// labels near the edge do not pop in/out abruptly while panning
export const LABEL_CULL_MARGIN_PX = 64;
// time (ms) for a label to fade fully in/out when its visibility changes in
// declutter mode — stateful smoothing that hides the per-frame collision churn
export const LABEL_FADE_MS = 180;
// a label counts as "currently shown" (and so keeps its slot via hysteresis)
// once its fade alpha is above this; below it, it no longer reserves space
export const LABEL_STICKY_ALPHA = 0.5;
// 3D label declutter: screen-space grid cell size (px). in 'auto' mode only the
// single most-important label whose projected position falls in a given cell is
// shown, thinning dense clusters; both dimensions scale with the text-scale
// slider so bigger text reserves proportionally more room
export const LABEL_CELL_W_PX = 120;
export const LABEL_CELL_H_PX = 30;
// time (ms) to ease the hover-highlight dim in/out so the spotlight effect
// glides instead of snapping when a hover starts/ends
export const HIGHLIGHT_INERTIA_MS = 160;
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

// In dark mode, edge colours darker than this HSL lightness (0..1) are raised
// to this floor so they stay legible against the dark canvas. Hue, saturation
// and opacity are preserved; already-bright edges are left untouched.
export const EDGE_DARK_MIN_LIGHTNESS = 0.55;

// Same idea for node fills: in dark mode node colours darker than this HSL
// lightness are raised to this floor so near-black nodes don't disappear
// against the dark canvas. Nodes are filled shapes, so the floor can sit a
// little lower than the edge floor.
export const NODE_DARK_MIN_LIGHTNESS = 0.4;

// ── search & highlight ──────────────────────────────────────
export const SEARCH_NOT_MATCHING_OPACITY = 0.28;
export const SCORE_EPSILON = 1e-12;

export const SEARCH_COLOR_BEST = 'rgb(100, 74, 242)';
export const SEARCH_COLOR_MID = 'rgb(34, 115, 231)';
export const SEARCH_COLOR_WORST = 'rgb(0, 164, 194)';

// ── analytics heatmap scale (cold → hot) ────────────────────
export const HEATMAP_COLOR_LOW = 'rgb(44, 123, 182)';
export const HEATMAP_COLOR_MID = 'rgb(255, 225, 100)';
export const HEATMAP_COLOR_HIGH = 'rgb(215, 25, 28)';
