import { fnv1a } from './util.js'

/**
 * @typedef {Object} RgbaColor
 * @property {number} r
 * @property {number} g
 * @property {number} b
 * @property {number} a
 */

/** @typedef {Record<string, RgbaColor>} ColorMap */
/** @typedef {Record<string, string>} AuthoredColorMap */
/** @typedef {Record<string, number>} EdgeWidthMap */
/** @typedef {Record<string, boolean>} FilterMap */

/**
 * @typedef {Object} SettingsShape
 * @property {number} d3Charge
 * @property {number} d3LinkDistance
 * @property {number} d3LinkStrength
 * @property {number} d3CollisionMultiplier
 * @property {number} d3AlphaTarget
 * @property {number} d3VelocityDecay
 * @property {number} d3ForceXYStrength
 * @property {boolean} d3CenterForce
 * @property {boolean} showIsolated
 * @property {boolean} showGrid
 * @property {number} curvatureStep
 * @property {string} nodeLabelMode
 * @property {string} nodeLabelExpression
 * @property {string} nodeSizingMode
 * @property {number} nodeSizingConstant
 * @property {string} nodeSizingExpression
 * @property {ColorMap} nodeColors
 * @property {ColorMap} edgeColors
 * @property {EdgeWidthMap} edgeWidths
 * @property {FilterMap} nodeFilters
 * @property {FilterMap} edgeFilters
 */

/** @returns {SettingsShape} */
export function createDefaultSettings() {
    return {
        d3Charge: -400,
        d3LinkDistance: 140,
        d3LinkStrength: 0.8,
        d3CollisionMultiplier: 1.0,
        d3AlphaTarget: 0.0,
        d3VelocityDecay: 0.80,
        d3ForceXYStrength: 0.1,
        d3CenterForce: true,

        showIsolated: true,
        showGrid: true,

        // curvature interval per each link when there are multiple
        curvatureStep: 0.005,

        // node label mode: 'none' | 'type' | 'id' | 'expression'
        nodeLabelMode: 'expression',
        // expression template used when nodeLabelMode === 'expression'
        nodeLabelExpression: 'type + "\\n" + (properties.name || properties.label || "")',


        // node sizing mode: 'degree' | 'constant' | 'expression'
        nodeSizingMode: 'degree',
        // constant node size used when nodeSizingMode === 'constant'
        nodeSizingConstant: 3,
        // expression evaluated per node when nodeSizingMode === 'expression'
        nodeSizingExpression: 'Math.sqrt(Math.max(1, degree))',

        nodeColors: {},
        edgeColors: {},
        edgeWidths: {},

        nodeFilters: {},
        edgeFilters: {},
    };
}

/** Application-wide settings for d3 simulation, display, and colours. */
export const settings = createDefaultSettings();

/** @type {number} Default link opacity. */
export const defaultLinkOpacity = 0.5;

/** @type {number} Default link width. */
export const defaultEdgeWidth = 1;

/** @type {number[]} Alpha multipliers for highlight distances 0, 1, 2, 3+. */
export const highlightAlphaMultipliers = [1.0, 1.0, 0.5, 0.1]

/** @type {AuthoredColorMap} */
const defaultNodeColorHexes = {
    process: '#157fc8',
    socket: '#dc4b2f',
    uds: '#36bc7b',
    pipe: '#a939f9',
    external_ip: '#ff6700',
}

/** @type {AuthoredColorMap} */
const defaultEdgeColorHexes = {
    uds: '#1b7c4d',
    uds_connection: '#1b7c4d',
    pipe: '#cf6eff',
    socket_connection: '#ff4c28',
    socket: '#ff4c28',
    child_process: '#282828',
}

/** @type {EdgeWidthMap} */
const defaultEdgeWidths = {
    child_process: 1,
    pipe: 1,
    socket: 1,
    socket_connection: 1,
    uds: 1,
    uds_connection: 1,
}

const paletteHexes = [
    // --- Blues & Cyans (dominant group)
    '#3498db',  // blue
    '#2980b9',  // deep blue
    '#1f618d',  // darker blue
    '#5dade2',  // light blue (still saturated)

    '#1abc9c',  // aqua
    '#16a085',  // teal
    '#00796b',  // deep teal
    '#009688',  // cyan-teal

    '#673ab7',  // indigo
    '#8e44ad',  // purple-blue
    '#4b0082',  // deep indigo

    // --- Greens
    '#27ae60',  // green
    '#2ecc71',  // bright green
    '#00c853',  // vivid green

    // --- Warm accents (reduced reds)
    '#e67e22',  // orange
    '#d35400',  // burnt orange

    '#f1c40f',  // strong yellow
    '#b7950b',  // darker yellow

    '#e74c3c',  // red (only 1 strong red)
    '#c0392b',  // dark red

    '#e91e63',  // pink
    '#c03978',  // deep pink

    // --- Neutrals for balance
    '#34495e',  // dark slate
    '#7f8c8d'   // gray
];

/**
 * Converts a hex colour string to an RGBA object.
 * @param {string} hex
 * @param {number} alpha
 * @returns {RgbaColor}
 */
function hexToRgbaColor(hex, alpha) {
    const trimmed = hex.trim();
    const value = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
    const normalized = value.length === 3
        ? value.split('').map((char) => char + char).join('')
        : value;

    if (normalized.length !== 6) {
        throw new Error(`Unsupported hex colour: ${hex}`);
    }

    return {
        r: Number.parseInt(normalized.slice(0, 2), 16),
        g: Number.parseInt(normalized.slice(2, 4), 16),
        b: Number.parseInt(normalized.slice(4, 6), 16),
        a: alpha,
    };
}

/**
 * Converts authored hex colours into runtime RGBA objects.
 * @param {AuthoredColorMap} authoredColors
 * @param {number} alpha
 * @returns {ColorMap}
 */
function normalizeAuthoredColorMap(authoredColors, alpha) {
    return Object.fromEntries(
        Object.entries(authoredColors).map(([key, value]) => [key, hexToRgbaColor(value, alpha)])
    );
}

/**
 * Converts authored palette hex colours into runtime RGBA objects.
 * @param {string[]} authoredPalette
 * @param {number} alpha
 * @returns {RgbaColor[]}
 */
function normalizeAuthoredPalette(authoredPalette, alpha) {
    return authoredPalette.map((value) => hexToRgbaColor(value, alpha));
}

/** @type {ColorMap} */
const defaultNodeColors = normalizeAuthoredColorMap(defaultNodeColorHexes, 1.0);

/** @type {ColorMap} */
const defaultEdgeColors = normalizeAuthoredColorMap(defaultEdgeColorHexes, defaultLinkOpacity);

/** @type {RgbaColor[]} */
const palette = normalizeAuthoredPalette(paletteHexes, 1.0);

/**
 * Converts an RGBA colour object to a CSS rgba() string.
 * @param {RgbaColor} color
 * @returns {string}
 */
export function colorToCss(color) {
    return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${color.a})`;
}

/**
 * Returns the RGBA colour for a node type — checks user settings first,
 * then curated defaults, then palette hash.
 * @param {string} node_type
 * @returns {RgbaColor}
 */
export function getNodeColor(node_type) {
    if (node_type in settings.nodeColors) {
        return settings.nodeColors[node_type];
    }
    if (node_type in defaultNodeColors) {
        return defaultNodeColors[node_type];
    }
    const hash = fnv1a(node_type);
    return { ...palette[hash % palette.length], a: 1.0 };
}

/**
 * Returns the RGBA colour for an edge type — checks user settings first,
 * then curated defaults, then palette hash.
 * @param {string} edge_type
 * @returns {RgbaColor}
 */
export function getEdgeColor(edge_type) {
    if (edge_type in settings.edgeColors) {
        return settings.edgeColors[edge_type];
    }
    if (edge_type in defaultEdgeColors) {
        return defaultEdgeColors[edge_type];
    }
    const hash = fnv1a(edge_type);
    return { ...palette[hash % palette.length], a: defaultLinkOpacity };
}

/**
 * Returns the CSS colour for a node type.
 * @param {string} node_type
 * @returns {string}
 */
export function getNodeCssColor(node_type) {
    return colorToCss(getNodeColor(node_type));
}

/**
 * Returns the CSS colour for an edge type.
 * @param {string} edge_type
 * @returns {string}
 */
export function getEdgeCssColor(edge_type) {
    return colorToCss(getEdgeColor(edge_type));
}

/**
 * Returns the width for an edge type — checks user settings first,
 * then curated defaults, then global default.
 * @param {string} edge_type
 * @returns {number}
 */
export function getEdgeWidth(edge_type) {
    if (edge_type in settings.edgeWidths) {
        return settings.edgeWidths[edge_type];
    }
    if (edge_type in defaultEdgeWidths) {
        return defaultEdgeWidths[edge_type];
    }
    return defaultEdgeWidth;
}
