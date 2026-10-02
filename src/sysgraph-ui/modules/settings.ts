import type { LabelRendering, LabelStyle } from '../engine/labels.js';
import type { LayoutDirection, LayoutMode } from './automatic-layout.js';
import { fnv1a } from './util.js';

export function validLayoutMode(value: unknown): value is LayoutMode {
    return value === 'force' || value === 'layered' || value === 'radial' ||
        value === 'circular' || value === 'concentric' || value === 'grid';
}

export function validLayoutDirection(value: unknown): value is LayoutDirection {
    return value === 'TB' || value === 'BT' || value === 'LR' || value === 'RL';
}

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
export type CameraProjection = 'perspective' | 'orthographic';
export type NodeRenderStyle = 'simple' | 'solid';

/** The visual grid is measured in the same world units as graph positions. */
export function validGridStep(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 25 && value <= 500;
}

export function validSceneBrightness(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0.5 && value <= 2;
}

export function validLabelStyle(value: unknown): value is LabelStyle {
    return value === 'plain' || value === 'outlined' || value === 'soft-background' || value === 'plate';
}

export function validLabelRendering(value: unknown): value is LabelRendering {
    return value === 'glyphs' || value === 'glyphs-filtered' || value === 'whole' || value === 'whole-snapped';
}

export interface SettingsShape {
    layoutMode: LayoutMode;
    layoutSpacing: number;
    layoutRankSpacing: number;
    layoutDirection: LayoutDirection;
    layoutRootId: string;
    gpuEnablePhysics: boolean;
    gpuLayoutRate: number;
    gpuWarmupMs: number;
    gpuLinkDistance: number;
    gpuLinkDistanceMode: string;
    gpuLinkDistanceExpression: string;
    gpuCharge: number;
    gpuLinkStrength: number;
    gpuCollisionMultiplier: number;
    gpuVelocityDecay: number;
    gpuForceXYStrength: number;
    gpuEdgeStyle: 'thin' | 'smooth';
    gpuEdgeWidth: number;
    gpuShowNodes: boolean;
    gpuNodeOutline: number;
    cameraProjection: CameraProjection;
    nodeRenderStyle: NodeRenderStyle;
    sceneBrightness: number;
    showGrid: boolean;
    gridStep: number;
    showIsolated: boolean;
    globalEdgeAlphaOffset: number;
    globalEdgeWidthMultiplier: number;
    nodeLabelMode: string;
    nodeLabelExpression: string;
    labelDensity: string;
    labelStyle: LabelStyle;
    labelRendering: LabelRendering;
    highlightOnHover: boolean;
    nodeSizingMode: string;
    nodeSizeScale: number;
    nodeSizingConstant: number;
    nodeSizingExpression: string;
    nodeFilterExpression: string;
    edgeFilterExpression: string;
    nodeColors: ColorMap;
    edgeColors: ColorMap;
    edgeWidths: EdgeWidthMap;
    nodeFilters: FilterMap;
    edgeFilters: FilterMap;
}

export function createDefaultSettings(): SettingsShape {
    return {
        layoutMode: 'force',
        layoutSpacing: 90,
        layoutRankSpacing: 140,
        layoutDirection: 'TB',
        layoutRootId: '',
        gpuEnablePhysics: true,
        gpuLayoutRate: 60,
        gpuWarmupMs: 900,
        gpuLinkDistance: 140,
        gpuLinkDistanceMode: 'constant',
        gpuLinkDistanceExpression: 'Number(properties.length) || Number(properties.weight) || 140',
        gpuCharge: -400,
        gpuLinkStrength: 0.8,
        gpuCollisionMultiplier: 1,
        gpuVelocityDecay: 0.4,
        gpuForceXYStrength: 0.1,
        gpuEdgeStyle: 'smooth',
        gpuEdgeWidth: 1.5,
        gpuShowNodes: true,
        gpuNodeOutline: 1.2,
        cameraProjection: 'perspective',
        nodeRenderStyle: 'solid',
        sceneBrightness: 1.2,
        showGrid: false,
        gridStep: 100,
        showIsolated: true,

        globalEdgeAlphaOffset: 0,
        globalEdgeWidthMultiplier: 1,

        nodeLabelMode: 'expression',
        nodeLabelExpression: 'type + "\\n" + (properties.name || properties.label || "")',
        // 'auto' = collision-aware decluttering; 'focus' = hovered neighborhood.
        labelDensity: 'auto',
        labelStyle: 'outlined',
        labelRendering: 'glyphs-filtered',
        // dim a hovered node's non-neighbours to spotlight its local graph
        highlightOnHover: true,

        nodeSizingMode: 'degree',
        nodeSizeScale: 1,
        nodeSizingConstant: 3,
        nodeSizingExpression: 'Math.sqrt(Math.max(1, degree))',

        nodeFilterExpression: '',
        edgeFilterExpression: '',

        nodeColors: {},
        edgeColors: {},
        edgeWidths: {},

        nodeFilters: {},
        edgeFilters: {},
    };
}

const LIVE_SETTINGS_KEY = 'sysgraph:webgpu-display';

function restoreSettings(): SettingsShape {
    const defaults = createDefaultSettings();
    try {
        const value: unknown = JSON.parse(window.localStorage.getItem(LIVE_SETTINGS_KEY) ?? 'null');
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            for (const key of Object.keys(defaults) as (keyof SettingsShape)[]) {
                if (!(key in value)) continue;
                const candidate = (value as Record<string, unknown>)[key];
                if (key === 'layoutMode' && !validLayoutMode(candidate)) continue;
                if (key === 'layoutDirection' && !validLayoutDirection(candidate)) continue;
                if (key === 'cameraProjection' && candidate !== 'perspective' && candidate !== 'orthographic') continue;
                if (key === 'nodeRenderStyle' && candidate !== 'simple' && candidate !== 'solid') continue;
                if (key === 'sceneBrightness' && !validSceneBrightness(candidate)) continue;
                if (key === 'showGrid' && typeof candidate !== 'boolean') continue;
                if (key === 'gridStep' && !validGridStep(candidate)) continue;
                if (key === 'labelStyle' && !validLabelStyle(candidate)) continue;
                if (key === 'labelRendering' && !validLabelRendering(candidate)) continue;
                (defaults as unknown as Record<string, unknown>)[key] = candidate;
            }
        }
    } catch { /* Storage is optional. */ }
    return defaults;
}

/** Application-wide WebGPU display and layout settings. */
export const settings: SettingsShape = restoreSettings();

export function persistSettings(): void {
    try { window.localStorage.setItem(LIVE_SETTINGS_KEY, JSON.stringify(settings)); }
    catch { /* Storage is optional. */ }
}

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
