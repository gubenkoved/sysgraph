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
    d3LinkDistanceMode: string;
    d3LinkDistanceExpression: string;
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
    nodeLabelOutline: boolean;
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
        d3LinkDistanceMode: 'constant',
        d3LinkDistanceExpression:
            'Number(properties.length) || Number(properties.weight) || 140',
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
        nodeLabelOutline: false,

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

const paletteHexes: string[] = [
    // blues & cyans (dominant group)
    '#3498db', '#2980b9', '#1f618d', '#5dade2',
    '#1abc9c', '#16a085', '#00796b', '#009688',
    '#673ab7', '#8e44ad', '#4b0082',
    // greens
    '#27ae60', '#2ecc71', '#00c853',
    // warm accents (reduced reds)
    '#e67e22', '#d35400',
    '#f1c40f', '#b7950b',
    '#e74c3c', '#c0392b',
    '#e91e63', '#c03978',
    // neutrals for balance
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

function normalizeAuthoredPalette(authoredPalette: string[], alpha: number): RgbaColor[] {
    return authoredPalette.map((value) => hexToRgbaColor(value, alpha));
}

const palette: RgbaColor[] = normalizeAuthoredPalette(paletteHexes, 1.0);

/**
 * Sorts type names alphabetically for stable display in the settings UI.
 */
function sortTypesAlphabetically(types: Iterable<string>): string[] {
    return [...types].sort((a, b) => a.localeCompare(b));
}

/** Sorts node type names for stable display in the settings UI. */
export function sortNodeTypes(types: Iterable<string>): string[] {
    return sortTypesAlphabetically(types);
}

/** Sorts edge type names for stable display in the settings UI. */
export function sortEdgeTypes(types: Iterable<string>): string[] {
    return sortTypesAlphabetically(types);
}

/**
 * Converts an RGBA colour object to a CSS rgba() string.
 */
export function colorToCss(color: RgbaColor): string {
    return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${color.a})`;
}

/**
 * Returns the RGBA colour for a node type — checks user settings first,
 * then falls back to a stable palette hash.
 */
export function getNodeColor(node_type: string): RgbaColor {
    if (node_type in settings.nodeColors) {
        return settings.nodeColors[node_type]!;
    }
    const hash = fnv1a(node_type);
    return { ...palette[hash % palette.length]!, a: 1.0 };
}

/**
 * Returns the RGBA colour for an edge type — checks user settings first,
 * then falls back to a stable palette hash.
 */
export function getEdgeColor(edge_type: string): RgbaColor {
    let color: RgbaColor;
    if (edge_type in settings.edgeColors) {
        color = settings.edgeColors[edge_type]!;
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
 * then the global default.
 */
export function getEdgeWidth(edge_type: string): number {
    let width: number;
    if (edge_type in settings.edgeWidths) {
        width = settings.edgeWidths[edge_type]!;
    } else {
        width = defaultEdgeWidth;
    }
    return width * settings.globalEdgeWidthMultiplier;
}
