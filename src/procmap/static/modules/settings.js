import { fnv1a } from './util.js'

/**
 * @typedef {Object} RgbaColor
 * @property {number} r
 * @property {number} g
 * @property {number} b
 * @property {number} a
 */

/** Application-wide settings for d3 simulation, display, and colours. */
export const settings = {
    d3Charge: -400,
    d3LinkDistance: 140,
    d3LinkStrength: 0.8,
    d3CollisionMultiplier: 1.0,
    d3AlphaTarget: 0.0,
    d3VelocityDecay: 0.80,
    d3ForceXYStrength: 0.1,
    d3CenterForce: true,

    showIsolated: true,

    // curvature interval per each link when there are multiple
    curvatureStep: 0.005,

    nodeColors: {},
    edgeColors: {},

    nodeFilters: {},
    edgeFilters: {},
};

/** @type {number} Default link opacity. */
export const defaultLinkOpacity = 0.5;

/** @type {number[]} Alpha multipliers for highlight distances 0, 1, 2, 3+. */
export const highlightAlphaMultipliers = [1.0, 1.0, 0.5, 0.1]

const overrideNodeColors = {
    process: { r: 21, g: 127, b: 200, a: 1.0 },
    socket: { r: 220, g: 75, b: 47, a: 1.0 },
    pipe: { r: 169, g: 57, b: 249, a: 1.0 },
    external_ip: { r: 255, g: 103, b: 0, a: 1.0 },
}

const overrideEdgeColors = {
    unix_domain_socket: { r: 31, g: 120, b: 180, a: defaultLinkOpacity },
    pipe: { r: 207, g: 110, b: 255, a: defaultLinkOpacity },
    socket_connection: { r: 255, g: 76, b: 40, a: defaultLinkOpacity },
    socket: { r: 255, g: 76, b: 40, a: defaultLinkOpacity },
    child_process: { r: 40, g: 40, b: 40, a: defaultLinkOpacity },
}

const palette = [
    // --- Blues & Cyans (dominant group)
    { r: 52, g: 152, b: 219 },  // blue
    { r: 41, g: 128, b: 185 },  // deep blue
    { r: 31, g: 97, b: 141 },  // darker blue
    { r: 93, g: 173, b: 226 },  // light blue (still saturated)

    { r: 26, g: 188, b: 156 },  // aqua
    { r: 22, g: 160, b: 133 },  // teal
    { r: 0, g: 121, b: 107 },  // deep teal
    { r: 0, g: 150, b: 136 },  // cyan-teal

    { r: 103, g: 58, b: 183 },  // indigo
    { r: 142, g: 68, b: 173 },  // purple-blue
    { r: 75, g: 0, b: 130 },  // deep indigo

    // --- Greens
    { r: 39, g: 174, b: 96 },  // green
    { r: 46, g: 204, b: 113 },  // bright green
    { r: 0, g: 200, b: 83 },  // vivid green

    // --- Warm accents (reduced reds)
    { r: 230, g: 126, b: 34 },  // orange
    { r: 211, g: 84, b: 0 },  // burnt orange

    { r: 241, g: 196, b: 15 },  // strong yellow
    { r: 183, g: 149, b: 11 },  // darker yellow

    { r: 231, g: 76, b: 60 },  // red (only 1 strong red)
    { r: 192, g: 57, b: 43 },  // dark red

    { r: 233, g: 30, b: 99 },  // pink
    { r: 192, g: 57, b: 120 },  // deep pink

    // --- Neutrals for balance
    { r: 52, g: 73, b: 94 },  // dark slate
    { r: 127, g: 140, b: 141 }   // gray
];

/**
 * Returns the default RGBA colour for a node type, using overrides or a
 * palette hash.
 * @param {string} node_type
 * @returns {RgbaColor}
 */
export function getDefaultNodeColor(node_type) {
    if (node_type in overrideNodeColors) {
        return overrideNodeColors[node_type]
    }

    const hash = fnv1a(node_type);

    const paletteColor = palette[hash % palette.length];

    return {
        ...paletteColor,
        a: 1.0,
    }
}

/**
 * Derives an RGBA colour from a hash value by extracting byte channels.
 * @param {number} hash
 * @returns {RgbaColor}
 */
function colorByHash(hash) {
    return {
        r: (hash >> 0) & 0xFF,
        g: (hash >> 8) & 0xFF,
        b: (hash >> 16) & 0xFF,
        a: 1.0,
    }
}

/**
 * Returns the default RGBA colour for an edge type, using overrides or a
 * palette hash.
 * @param {string} edge_type
 * @returns {RgbaColor}
 */
export function getDefaultEdgeColor(edge_type) {
    if (edge_type in overrideEdgeColors) {
        return overrideEdgeColors[edge_type]
    }

    const hash = fnv1a(edge_type);

    const paletteColor = palette[hash % palette.length];

    return {
        ...paletteColor,
        a: defaultLinkOpacity,
    }
}
