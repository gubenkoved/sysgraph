// ── event names ─────────────────────────────────────────────
export const EVT_GRAPH_UPDATED = 'graph-updated';
export const EVT_CLEAR_CLICKED = 'clear-button-clicked';
export const EVT_FILTERS_UPDATED = 'graph-filters-updated';
export const EVT_SEARCH_CHANGED = 'search-expression-changed';
export const EVT_SELECTION_CHANGED = 'selection-changed';
export const EVT_SETTINGS_UPDATED = 'graph-ui-settings-updated';
export const EVT_COLORS_UPDATED = 'graph-ui-colors-updated';
export const EVT_WIDTHS_UPDATED = 'graph-ui-widths-updated';
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

// ── node rendering ──────────────────────────────────────────
export const MIN_NODE_RADIUS = 4;
export const MIN_POINTER_AREA_RADIUS = 8;
export const NODE_RADIUS_MULTIPLIER = 3;
export const MAX_NODE_VAL = 10;
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

// ── grid ────────────────────────────────────────────────────
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

// Same idea for node fills: in dark mode node colours darker than this HSL
// lightness are raised to this floor so near-black nodes don't disappear
// against the dark canvas. Nodes are filled shapes, so the floor can sit a
// little lower than the edge floor.
export const NODE_DARK_MIN_LIGHTNESS = 0.4;

// ── search & highlight ──────────────────────────────────────
export const SEARCH_NOT_MATCHING_OPACITY = 0.5;
export const SCORE_EPSILON = 1e-12;

export const SEARCH_COLOR_BEST = 'rgb(255, 0, 0)';
export const SEARCH_COLOR_MID = 'rgb(255, 140, 0)';
export const SEARCH_COLOR_WORST = 'rgb(195, 179, 41)';

// ── analytics heatmap scale (cold → hot) ────────────────────
export const HEATMAP_COLOR_LOW = 'rgb(44, 123, 182)';
export const HEATMAP_COLOR_MID = 'rgb(255, 225, 100)';
export const HEATMAP_COLOR_HIGH = 'rgb(215, 25, 28)';

// ── animation & zoom ────────────────────────────────────────
export const MAX_ZOOM_BOOST = 3;
export const REHEAT_ALPHA = 0.25;
export const REHEAT_TIMEOUT_MS = 600;
export const SEARCH_PULSE_BASE = 5;
export const SEARCH_PULSE_FREQ = 2;

// ── selection indicator (3D) ────────────────────────────────
// the 2D renderer draws an animated red dashed ring around selected nodes
// (canvas-drawn in graph-ui-2d.ts); the 3D renderer mounts an equivalent
// billboarded, spinning dashed ring. these tune the 3D ring only
export const SELECTION_RING_COLOR = 'rgb(255, 0, 0)';
// number of dash segments around the ring
export const SELECTION_RING_DASHES = 8;
// fraction of each dash slot that is "on" (the rest is the gap)
export const SELECTION_RING_DASH_FILL = 0.55;
// world-unit gap between the node's surface and the ring
export const SELECTION_RING_GAP = 4;
// ring tube thickness (world units)
export const SELECTION_RING_TUBE = 1.4;
// ring spin rate (revolutions per second), mirroring the 2D rotation
export const SELECTION_RING_SPIN_FREQ = 0.15;

// ── D3 force defaults ───────────────────────────────────────
export const D3_CHARGE_STRENGTH = -450;
export const D3_LINK_DISTANCE = 140;
export const D3_LINK_STRENGTH = 0.8;
export const D3_COLLISION_BASE_RADIUS = 18;
export const D3_COLLISION_RADIUS_PER_VAL = 6;
export const D3_COLLISION_STRENGTH = 1;
export const D3_COLLISION_ITERATIONS = 4;

// how long the force engine keeps ticking before it stops (ms); lifted to
// Infinity while a positive alpha target keeps the layout in motion
export const D3_COOLDOWN_TIME_MS = 10000;

// ── render-mode transition (2D ↔ 3D) ────────────────────────
// switching renderers animates the 3D camera into an axis-aligned top-down
// pose that projects the xy-plane exactly like the 2D canvas, so the swap is
// seamless: 3D→2D glides overhead then swaps; 2D→3D starts aligned then orbits
// out to reveal depth. this is the glide duration (ms)
export const RENDER_TRANSITION_MS = 1000;

// resting 3D pose the camera reveals to after a 2D→3D switch, as a tilt away
// from straight-down (degrees): elevation lifts the camera off the plane and
// azimuth swings it sideways so depth becomes legible
export const RENDER_REVEAL_ELEVATION_DEG = 35;
export const RENDER_REVEAL_AZIMUTH_DEG = 25;
