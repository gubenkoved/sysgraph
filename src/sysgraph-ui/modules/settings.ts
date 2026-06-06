import { fnv1a } from './util.js';

export interface RgbaColor {
    r: number;
    g: number;
    b: number;
    a: number;
}

export type ColorMap = Record<string, RgbaColor>;
export type AuthoredColorMap = Record<string, string>;
export type EdgeWidthMap = Record<string, number>;
export type FilterMap = Record<string, boolean>;

export interface SettingsShape {
    d3EnablePhysics: boolean;
    d3Charge: number;
    d3LinkDistance: number;
    d3LinkStrength: number;
    d3CollisionMultiplier: number;
    d3AlphaTarget: number;
    d3VelocityDecay: number;
    d3ForceXYStrength: number;
    d3CenterForce: boolean;
    showIsolated: boolean;
    showGrid: boolean;
    curvatureStep: number;
    globalEdgeAlphaOffset: number;
    globalEdgeWidthMultiplier: number;
    nodeLabelMode: string;
    nodeLabelExpression: string;
    nodeSizingMode: string;
    nodeSizingConstant: number;
    nodeSizingExpression: string;
    nodeColors: ColorMap;
    edgeColors: ColorMap;
    edgeWidths: EdgeWidthMap;
    nodeFilters: FilterMap;
    edgeFilters: FilterMap;
}

export function createDefaultSettings(): SettingsShape {
    return {
        d3EnablePhysics: true,
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

        curvatureStep: 0.005,

        globalEdgeAlphaOffset: 0,
        globalEdgeWidthMultiplier: 1,

        nodeLabelMode: 'expression',
        nodeLabelExpression: 'type + "\\n" + (properties.name || properties.label || "")',

        nodeSizingMode: 'degree',
        nodeSizingConstant: 3,
        nodeSizingExpression: 'Math.sqrt(Math.max(1, degree))',

        nodeColors: {},
        edgeColors: {},
        edgeWidths: {},

        nodeFilters: {},
        edgeFilters: {},
    };
}

/** Application-wide settings for d3 simulation, display, and colours. */
export const settings: SettingsShape = createDefaultSettings();

/** Default link opacity. */
export const defaultLinkOpacity = 0.5;

/** Default link width. */
export const defaultEdgeWidth = 1;

/** Alpha multipliers for highlight distances 0, 1, 2, 3+. */
export const highlightAlphaMultipliers: number[] = [1.0, 1.0, 0.5, 0.1];

const defaultNodeColorHexes: AuthoredColorMap = {
    process: '#157fc8',
    socket: '#dc4b2f',
    uds: '#36bc7b',
    pipe: '#a939f9',
    external_ip: '#ff6700',
};

const defaultEdgeColorHexes: AuthoredColorMap = {
    uds: '#1b7c4d',
    uds_connection: '#1b7c4d',
    pipe: '#cf6eff',
    socket_connection: '#ff4c28',
    socket: '#ff4c28',
    child_process: '#282828',
};

const defaultEdgeWidths: EdgeWidthMap = {
    child_process: 1,
    pipe: 1,
    socket: 1,
    socket_connection: 1,
    uds: 1,
    uds_connection: 1,
};

const paletteHexes: string[] = [
    // --- Blues & Cyans (dominant group)
    '#3498db', '#2980b9', '#1f618d', '#5dade2',
    '#1abc9c', '#16a085', '#00796b', '#009688',
    '#673ab7', '#8e44ad', '#4b0082',
    // --- Greens
    '#27ae60', '#2ecc71', '#00c853',
    // --- Warm accents (reduced reds)
    '#e67e22', '#d35400',
    '#f1c40f', '#b7950b',
    '#e74c3c', '#c0392b',
    '#e91e63', '#c03978',
    // --- Neutrals for balance
    '#34495e', '#7f8c8d',
];

function hexToRgbaColor(hex: string, alpha: number): RgbaColor {
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

function normalizeAuthoredColorMap(authoredColors: AuthoredColorMap, alpha: number): ColorMap {
    return Object.fromEntries(
        Object.entries(authoredColors).map(([key, value]) => [key, hexToRgbaColor(value, alpha)])
    );
}

function normalizeAuthoredPalette(authoredPalette: string[], alpha: number): RgbaColor[] {
    return authoredPalette.map((value) => hexToRgbaColor(value, alpha));
}

const defaultNodeColors: ColorMap = normalizeAuthoredColorMap(defaultNodeColorHexes, 1.0);
const defaultEdgeColors: ColorMap = normalizeAuthoredColorMap(defaultEdgeColorHexes, defaultLinkOpacity);
const palette: RgbaColor[] = normalizeAuthoredPalette(paletteHexes, 1.0);

/** Canonical display order for known node types (declared colour order). */
const nodeTypeOrder: string[] = Object.keys(defaultNodeColorHexes);
/** Canonical display order for known edge types (declared colour order). */
const edgeTypeOrder: string[] = Object.keys(defaultEdgeColorHexes);

/**
 * Sorts type names by their position in a canonical order list. Known types
 * keep their canonical order; unknown types are appended alphabetically.
 */
function sortByCanonicalOrder(types: Iterable<string>, order: string[]): string[] {
    return [...types].sort((a, b) => {
        const ia = order.indexOf(a);
        const ib = order.indexOf(b);
        if (ia !== -1 && ib !== -1) {
            return ia - ib;
        }
        if (ia !== -1) {
            return -1;
        }
        if (ib !== -1) {
            return 1;
        }
        return a.localeCompare(b);
    });
}

/** Sorts node type names for stable display in the settings UI. */
export function sortNodeTypes(types: Iterable<string>): string[] {
    return sortByCanonicalOrder(types, nodeTypeOrder);
}

/** Sorts edge type names for stable display in the settings UI. */
export function sortEdgeTypes(types: Iterable<string>): string[] {
    return sortByCanonicalOrder(types, edgeTypeOrder);
}

/**
 * Converts an RGBA colour object to a CSS rgba() string.
 */
export function colorToCss(color: RgbaColor): string {
    return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${color.a})`;
}

/**
 * Returns the RGBA colour for a node type — checks user settings first,
 * then curated defaults, then palette hash.
 */
export function getNodeColor(node_type: string): RgbaColor {
    if (node_type in settings.nodeColors) {
        return settings.nodeColors[node_type]!;
    }
    if (node_type in defaultNodeColors) {
        return defaultNodeColors[node_type]!;
    }
    const hash = fnv1a(node_type);
    return { ...palette[hash % palette.length]!, a: 1.0 };
}

/**
 * Returns the RGBA colour for an edge type — checks user settings first,
 * then curated defaults, then palette hash.
 */
export function getEdgeColor(edge_type: string): RgbaColor {
    let color: RgbaColor;
    if (edge_type in settings.edgeColors) {
        color = settings.edgeColors[edge_type]!;
    } else if (edge_type in defaultEdgeColors) {
        color = defaultEdgeColors[edge_type]!;
    } else {
        const hash = fnv1a(edge_type);
        color = { ...palette[hash % palette.length]!, a: defaultLinkOpacity };
    }
    const a = Math.max(0, Math.min(1, color.a + settings.globalEdgeAlphaOffset));
    return { ...color, a };
}

/**
 * Returns the CSS colour for a node type.
 */
export function getNodeCssColor(node_type: string): string {
    return colorToCss(getNodeColor(node_type));
}

/**
 * Returns the CSS colour for an edge type.
 */
export function getEdgeCssColor(edge_type: string): string {
    return colorToCss(getEdgeColor(edge_type));
}

/**
 * Returns the width for an edge type — checks user settings first,
 * then curated defaults, then global default.
 */
export function getEdgeWidth(edge_type: string): number {
    let width: number;
    if (edge_type in settings.edgeWidths) {
        width = settings.edgeWidths[edge_type]!;
    } else if (edge_type in defaultEdgeWidths) {
        width = defaultEdgeWidths[edge_type]!;
    } else {
        width = defaultEdgeWidth;
    }
    return width * settings.globalEdgeWidthMultiplier;
}
