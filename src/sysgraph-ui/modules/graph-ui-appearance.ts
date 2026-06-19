import * as d3 from 'd3';
import { ColorScale } from './color-scale.js';
import {
    EDGE_DARK_MIN_LIGHTNESS,
    HEATMAP_COLOR_HIGH, HEATMAP_COLOR_LOW, HEATMAP_COLOR_MID,
    MAX_NODE_VAL,
    NODE_DARK_MIN_LIGHTNESS,
    SCORE_EPSILON,
    SEARCH_COLOR_BEST, SEARCH_COLOR_MID, SEARCH_COLOR_WORST,
    SEARCH_NOT_MATCHING_OPACITY,
} from './constants.js';
import { buildScopedExpression } from './expression.js';
import { labelHelpers } from './graph-ui-helpers.js';
import type { FGLink, FGNode } from './graph-ui-types.js';
import { getEdgeCssColor, getEdgeWidth, getNodeCssColor, highlightAlphaMultipliers, settings } from './settings.js';
import { state } from './state.js';
import { getTheme } from './theme.js';

// This module holds the renderer-agnostic appearance logic — colors, sizes,
// labels and the resolve* accessors — shared by the 2D canvas renderer and the
// 3D WebGL renderer so both decorate nodes and links identically.

// ── label & sizing helpers ──────────────────────────────────

export function getNodeLabel(node: FGNode): string {
    switch (settings.nodeLabelMode) {
        case 'none':
            return '';
        case 'type':
            return node.type || node.id;
        case 'id':
            return String(node.id);
        case 'expression':
            try {
                // expose node keys (id/type/properties), each property as a bare
                // identifier, and the label helpers; precedence (low→high) is
                // helpers < properties < node, so a well-known node key always
                // wins over a same-named property, and the const re-bindings of
                // the injected names win over everything
                const fn = buildScopedExpression(
                    `String(${settings.nodeLabelExpression})`,
                    ['node', 'properties', 'helpers'],
                    ['helpers', 'properties', 'node'],
                );
                return fn(node, node.properties ?? {}, labelHelpers) as string;
            } catch {
                return '<expr error>';
            }
        default:
            return String(node.id);
    }
}

export function getNodeVal(node: FGNode, degree: number): number {
    switch (settings.nodeSizingMode) {
        case 'constant':
            return settings.nodeSizingConstant;
        case 'expression':
            try {
                // expose node keys plus each property as a bare identifier;
                // properties < node so well-known node keys win
                const fn = buildScopedExpression(
                    settings.nodeSizingExpression,
                    ['node', 'properties', 'degree'],
                    ['properties', 'node'],
                );
                const val = (fn(node, node.properties ?? {}, degree) as number) || 1;
                return Math.min(val, MAX_NODE_VAL);
            } catch {
                return 1;
            }
        default:
            return Math.sqrt(Math.max(1, degree));
    }
}

/**
 * Compiles a link-distance expression into a d3 link-force distance accessor.
 * The expression is evaluated with the edge's `properties` in scope plus the
 * resolved `source`/`target` node objects (mirroring the edge-weight mechanism),
 * so real-world metrics like `properties.length` can drive layout distance. On
 * any error — or a non-finite result — it falls back to the provided value (the
 * link-distance slider).
 */
export function makeLinkDistanceFn(
    expression: string,
    fallback: number,
): (link: FGLink) => number {
    let compiled: ((...args: unknown[]) => unknown) | null = null;
    try {
        // properties < edge so well-known edge keys (id/type/source/target) win
        compiled = buildScopedExpression(
            expression.trim(),
            ['edge', 'properties', 'source', 'target'],
            ['properties', 'edge'],
        );
    } catch {
        compiled = null;
    }

    return (link: FGLink): number => {
        if (!compiled) return fallback;
        try {
            const value = compiled(
                link,
                link.properties ?? {},
                link.source,
                link.target,
            );
            const num = Number(value);
            return Number.isFinite(num) ? num : fallback;
        } catch {
            return fallback;
        }
    };
}

/**
 * Validates a link-distance expression by attempting to compile it. Returns an
 * error message when the expression is syntactically invalid, otherwise null.
 */
export function validateLinkDistanceExpression(expression: string): string | null {
    try {
        buildScopedExpression(
            expression.trim(),
            ['edge', 'properties', 'source', 'target'],
            ['properties', 'edge'],
        );
        return null;
    } catch (err) {
        return err instanceof Error ? err.message : 'invalid expression';
    }
}

/**
 * Compiles a node-filter expression into a predicate deciding whether a node
 * stays on the canvas. The expression is evaluated with the node's keys
 * (id/type/properties), each property as a bare identifier, the computed
 * `degree`, and the label helpers in scope (mirroring the node-sizing scope), so
 * a truthy result keeps the node. A compile failure yields a predicate that
 * keeps every node (fail-open); a per-node runtime error excludes that node.
 */
export function makeNodeFilterFn(
    expression: string,
): (node: FGNode, degree: number) => boolean {
    let compiled: ((...args: unknown[]) => unknown) | null = null;
    try {
        // helpers < properties < node so well-known node keys win
        compiled = buildScopedExpression(
            expression.trim(),
            ['node', 'properties', 'degree', 'helpers'],
            ['helpers', 'properties', 'node'],
        );
    } catch {
        compiled = null;
    }

    return (node: FGNode, degree: number): boolean => {
        if (!compiled) return true;
        try {
            return Boolean(compiled(node, node.properties ?? {}, degree, labelHelpers));
        } catch {
            return false;
        }
    };
}

/**
 * Validates a node-filter expression by attempting to compile it. Returns an
 * error message when the expression is syntactically invalid, otherwise null.
 */
export function validateNodeFilterExpression(expression: string): string | null {
    try {
        buildScopedExpression(
            expression.trim(),
            ['node', 'properties', 'degree', 'helpers'],
            ['helpers', 'properties', 'node'],
        );
        return null;
    } catch (err) {
        return err instanceof Error ? err.message : 'invalid expression';
    }
}

/**
 * Compiles an edge-filter expression into a predicate deciding whether an edge
 * stays on the canvas. The expression is evaluated with the edge's keys
 * (id/type/source_id/target_id/properties), each property as a bare identifier,
 * and the label helpers in scope, so a truthy result keeps the edge. A compile
 * failure yields a predicate that keeps every edge (fail-open); a per-edge
 * runtime error excludes that edge.
 */
export function makeEdgeFilterFn(
    expression: string,
): (edge: FGLink) => boolean {
    let compiled: ((...args: unknown[]) => unknown) | null = null;
    try {
        // helpers < properties < edge so well-known edge keys win
        compiled = buildScopedExpression(
            expression.trim(),
            ['edge', 'properties', 'helpers'],
            ['helpers', 'properties', 'edge'],
        );
    } catch {
        compiled = null;
    }

    return (edge: FGLink): boolean => {
        if (!compiled) return true;
        try {
            return Boolean(compiled(edge, edge.properties ?? {}, labelHelpers));
        } catch {
            return false;
        }
    };
}

/**
 * Validates an edge-filter expression by attempting to compile it. Returns an
 * error message when the expression is syntactically invalid, otherwise null.
 */
export function validateEdgeFilterExpression(expression: string): string | null {
    try {
        buildScopedExpression(
            expression.trim(),
            ['edge', 'properties', 'helpers'],
            ['helpers', 'properties', 'edge'],
        );
        return null;
    } catch (err) {
        return err instanceof Error ? err.message : 'invalid expression';
    }
}

// ── color caches ────────────────────────────────────────────

const nodeCssColorCache = new Map<string, string>();
const edgeCssColorCache = new Map<string, string>();

export function clearColorCaches(): void {
    nodeCssColorCache.clear();
    edgeCssColorCache.clear();
}

function getCachedNodeCssColor(nodeType: string): string {
    if (!nodeCssColorCache.has(nodeType)) {
        nodeCssColorCache.set(nodeType, adjustNodeColorForTheme(getNodeCssColor(nodeType)));
    }
    return nodeCssColorCache.get(nodeType)!;
}

function getCachedEdgeCssColor(edgeType: string): string {
    if (!edgeCssColorCache.has(edgeType)) {
        edgeCssColorCache.set(edgeType, adjustEdgeColorForTheme(getEdgeCssColor(edgeType)));
    }
    return edgeCssColorCache.get(edgeType)!;
}

// ── search match color scale ────────────────────────────────

const searchMatchColorScale = new ColorScale([
    [SEARCH_COLOR_BEST, 0],
    [SEARCH_COLOR_MID, 0.5],
    [SEARCH_COLOR_WORST, 1],
]);

/** Cold-to-hot scale used by analytics heatmap decorations (value in [0, 1]). */
export const analyticsHeatmapColorScale = new ColorScale([
    [HEATMAP_COLOR_LOW, 0],
    [HEATMAP_COLOR_MID, 0.5],
    [HEATMAP_COLOR_HIGH, 1],
]);

/**
 * Categorical palette used by analytics community decorations. Colors repeat
 * for graphs with more communities than entries.
 */
export const COMMUNITY_PALETTE: string[] = [
    '#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#b07aa1',
    '#76b7b2', '#edc948', '#ff9da7', '#9c755f', '#bab0ac',
    '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
    '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
];

/** Returns a stable CSS color for the given community index. */
export function communityColor(index: number): string {
    return COMMUNITY_PALETTE[index % COMMUNITY_PALETTE.length]!;
}

/**
 * Computes a normalized color map for a set of search matches.
 */
export function computeMatchColors(matchesMap: Map<string, { score: number }>): Map<string, string> {
    const colors = new Map<string, string>();
    if (!matchesMap || matchesMap.size === 0) return colors;

    const logScores: { nodeId: string; logScore: number }[] = [];

    for (const [nodeId, match] of matchesMap) {
        logScores.push({ nodeId, logScore: -Math.log10(match.score + SCORE_EPSILON) });
    }

    let minLog = Number.POSITIVE_INFINITY;
    let maxLog = Number.NEGATIVE_INFINITY;
    for (const { logScore } of logScores) {
        if (logScore < minLog) minLog = logScore;
        if (logScore > maxLog) maxLog = logScore;
    }

    for (const { nodeId, logScore } of logScores) {
        const t = maxLog === minLog ? 0 : (maxLog - logScore) / (maxLog - minLog);
        colors.set(nodeId, searchMatchColorScale.getColor(t));
    }

    return colors;
}

// ── per-element color / width helpers ───────────────────────

export function nodeColorFor(node: FGNode): string {
    return getCachedNodeCssColor(node.type);
}

export function edgeColorFor(edge: FGLink): string {
    return getCachedEdgeCssColor(edge.type);
}

export function edgeWidthFor(edge: FGLink): number {
    return getEdgeWidth(edge.type);
}

export function linkSourceId(link: FGLink): string {
    return (typeof link.source === 'object' && link.source !== null)
        ? (link.source as FGNode).id
        : (link.source as string);
}

export function linkTargetId(link: FGLink): string {
    return (typeof link.target === 'object' && link.target !== null)
        ? (link.target as FGNode).id
        : (link.target as string);
}

// ── color utilities ─────────────────────────────────────────

export function colorAdjustAlpha(color: string, factor: number): string {
    const col = d3.color(color);
    if (!col) return color;
    col.opacity *= factor;
    return col.toString();
}

function darkerColor(color: string): string {
    const col = d3.color(color);
    if (!col) return color;
    return col.darker().toString();
}

function brighterColor(color: string): string {
    const col = d3.color(color);
    if (!col) return color;
    return col.brighter().toString();
}

/**
 * Node outline color: darker than the fill in light mode, lighter in dark mode
 * so the outline stays visible against the dark canvas.
 */
export function nodeOutlineColor(color: string): string {
    return getTheme() === 'dark' ? brighterColor(color) : darkerColor(color);
}

/**
 * In dark mode, raises the lightness of a colour that is too dark to stay
 * legible against the dark canvas up to `floor`, preserving hue, saturation and
 * opacity. Already-bright colours are returned unchanged; in light mode the
 * colour is returned as-is.
 */
function raiseLightnessFloorInDark(color: string, floor: number): string {
    if (getTheme() !== 'dark') return color;
    const hsl = d3.hsl(color);
    if (hsl.l >= floor) return color;
    hsl.l = floor;
    return hsl.toString();
}

/** Edge colour adjusted for the active theme (see raiseLightnessFloorInDark). */
function adjustEdgeColorForTheme(color: string): string {
    return raiseLightnessFloorInDark(color, EDGE_DARK_MIN_LIGHTNESS);
}

/** Node fill adjusted for the active theme (see raiseLightnessFloorInDark). */
function adjustNodeColorForTheme(color: string): string {
    return raiseLightnessFloorInDark(color, NODE_DARK_MIN_LIGHTNESS);
}

// ── node pin helpers ────────────────────────────────────────

export function pinNode(node: FGNode): void {
    node.fx = node.x;
    node.fy = node.y;
    // also pin the depth axis when present (3D renderer)
    const n3d = node as FGNode & { z?: number; fz?: number };
    if (n3d.z !== undefined) {
        n3d.fz = n3d.z;
    }
}

export function unpinNode(node: FGNode): void {
    node.fx = undefined;
    node.fy = undefined;
    (node as FGNode & { fz?: number }).fz = undefined;
}

export function isNodePinned(node: FGNode): boolean {
    return node.fx !== undefined || node.fy !== undefined;
}

// ── shared accessors (node/link appearance resolution) ──────

export function nodeTooltip(n: FGNode): string {
    const label = getNodeLabel(n);
    return label + (n.type ? `\n(${n.type})` : '');
}

export function linkTooltip(l: FGLink): string {
    return (l.properties?.label as string) || l.type;
}

export function resolveLinkCurvature(l: FGLink): number {
    return l.curvature ?? 0;
}

export function resolveLinkWidth(l: FGLink): number {
    const base = edgeWidthFor(l);
    // widen the emphasized edges of a subset decoration (e.g. shortest path) by
    // its configurable multiplier while the analytics tool is on
    const decoration = state.analytics.active ? state.analytics.decoration : null;
    if (decoration?.kind === 'subset' && decoration.edgeIds.has(l.id)) {
        return base * (decoration.edgeWidthMultiplier ?? 1);
    }
    return base;
}

export function resolveLinkColor(l: FGLink): string {
    let fillStyle = edgeColorFor(l);
    let alphaMultiplier = 1.0;

    // persistent analytics decoration takes precedence over hover/search, but
    // only while the analytics tool is active; it is preserved (yet hidden) when
    // the user switches to another tool such as search
    const decoration = state.analytics.active ? state.analytics.decoration : null;
    if (decoration) {
        // heatmap recolors nodes only; leave edges at their normal color
        if (decoration.kind === 'heatmap') {
            return fillStyle;
        }
        if (decoration.kind === 'community') {
            // color edges within a community by its color, dim the rest
            const sourceCommunity = decoration.nodeCommunity.get(linkSourceId(l));
            const targetCommunity = decoration.nodeCommunity.get(linkTargetId(l));
            const focused = decoration.focusedCommunities;
            const hasFocus = focused !== undefined && focused.size > 0;
            if (
                sourceCommunity !== undefined &&
                sourceCommunity === targetCommunity &&
                (!hasFocus || focused.has(sourceCommunity))
            ) {
                return communityColor(sourceCommunity);
            }
            return colorAdjustAlpha(
                fillStyle,
                highlightAlphaMultipliers[highlightAlphaMultipliers.length - 1]!,
            );
        }
        alphaMultiplier = decoration.edgeIds.has(l.id)
            ? 1.0
            : highlightAlphaMultipliers[highlightAlphaMultipliers.length - 1]!;
        return colorAdjustAlpha(fillStyle, alphaMultiplier);
    }

    if (!state.highlight && state.search) {
        alphaMultiplier = SEARCH_NOT_MATCHING_OPACITY;
    }

    if (state.highlight) {
        alphaMultiplier = highlightAlphaMultipliers[highlightAlphaMultipliers.length - 1]!;
        const edgeDistance = state.highlight.edgeDistancesMap.get(l.id);

        if (edgeDistance !== undefined && edgeDistance < highlightAlphaMultipliers.length - 1) {
            alphaMultiplier = highlightAlphaMultipliers[edgeDistance]!;
        }

        fillStyle = colorAdjustAlpha(fillStyle, alphaMultiplier);
    }

    return fillStyle;
}

export function resolveLinkArrowLength(link: FGLink): number {
    if (link.properties?.directional === false) {
        return 0;
    }
    // Grow the arrow sub-linearly with line width so thick edges don't get
    // overwhelmingly large arrowheads. Tuned so width 1 keeps the original
    // size (~6) and width 10 caps around ~19 instead of a linear ~60.
    return 6 * Math.sqrt(edgeWidthFor(link));
}

/**
 * Resolves a node's final fill color and the alpha multiplier applied by the
 * active decoration/search/highlight state. Shared by the 2D canvas drawing and
 * the 3D nodeColor accessor so both renderers color nodes identically.
 */
export function resolveNodeAppearance(node: FGNode): { fillStyle: string; alphaMultiplier: number } {
    let alphaMultiplier = 1.0;
    let baseColor = nodeColorFor(node);

    const decoration = state.analytics.active ? state.analytics.decoration : null;
    if (decoration) {
        if (decoration.kind === 'heatmap') {
            const value = decoration.nodeValues.get(node.id);
            if (value !== undefined) {
                baseColor = analyticsHeatmapColorScale.getColor(value);
            } else {
                // nodes without a score are dimmed
                alphaMultiplier = highlightAlphaMultipliers[highlightAlphaMultipliers.length - 1]!;
            }
        } else if (decoration.kind === 'community') {
            const community = decoration.nodeCommunity.get(node.id);
            const focused = decoration.focusedCommunities;
            const hasFocus = focused !== undefined && focused.size > 0;
            if (community !== undefined && (!hasFocus || focused.has(community))) {
                baseColor = communityColor(community);
            } else {
                // nodes outside any community (or outside the focused set) are dimmed
                alphaMultiplier = highlightAlphaMultipliers[highlightAlphaMultipliers.length - 1]!;
            }
        } else {
            alphaMultiplier = decoration.nodeIds.has(node.id)
                ? 1.0
                : highlightAlphaMultipliers[highlightAlphaMultipliers.length - 1]!;
        }
    } else {
        if (!state.highlight && state.search && !state.search.matchesMap.has(node.id)) {
            alphaMultiplier = SEARCH_NOT_MATCHING_OPACITY;
        }

        if (state.highlight) {
            alphaMultiplier = highlightAlphaMultipliers[highlightAlphaMultipliers.length - 1]!;
            const nodeDistance = state.highlight.nodeDistancesMap.get(node.id);

            if (nodeDistance !== undefined && nodeDistance < highlightAlphaMultipliers.length - 1) {
                alphaMultiplier = highlightAlphaMultipliers[nodeDistance]!;
            }
        }
    }

    return { fillStyle: colorAdjustAlpha(baseColor, alphaMultiplier), alphaMultiplier };
}

export function resolveNodeColor(node: FGNode): string {
    return resolveNodeAppearance(node).fillStyle;
}
