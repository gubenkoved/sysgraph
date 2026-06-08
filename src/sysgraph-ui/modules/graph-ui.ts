import * as d3 from 'd3';
import type { ForceGraphGeneric, LinkObject, NodeObject } from 'force-graph';
import ForceGraph from 'force-graph';
import { handleAnalyticsNodeClick } from './analytics.js';
import { ColorScale } from './color-scale.js';
import {
    D3_CHARGE_STRENGTH,
    D3_COLLISION_BASE_RADIUS, D3_COLLISION_ITERATIONS,D3_COLLISION_RADIUS_PER_VAL, D3_COLLISION_STRENGTH, D3_LINK_DISTANCE, D3_LINK_STRENGTH,
    EDGE_DARK_MIN_LIGHTNESS,EVT_BACKGROUND_CLICK,EVT_LINK_CLICKED,
    EVT_NODE_CLICKED, GRID_CENTER_COLOR, GRID_CENTER_COLOR_DARK, GRID_CENTER_COLOR_UNSTRESSED, GRID_CENTER_COLOR_UNSTRESSED_DARK,GRID_CENTER_CROSS_HALF, GRID_CROSS_HALF,
    GRID_LINE_COLOR, GRID_LINE_COLOR_DARK, GRID_LINE_COLOR_UNSTRESSED, GRID_LINE_COLOR_UNSTRESSED_DARK,
    GRID_SPACING,
    HEATMAP_COLOR_HIGH, HEATMAP_COLOR_LOW, HEATMAP_COLOR_MID,MAX_CROSSES_PER_AXIS,MAX_NODE_VAL,
    MAX_ZOOM_BOOST, NODE_LABEL_FONT_SIZE, NODE_LABEL_OFFSET,nodePointerRadius,
    nodeRadius, SCORE_EPSILON,
    SEARCH_COLOR_BEST, SEARCH_COLOR_MID, SEARCH_COLOR_WORST,
    SEARCH_NOT_MATCHING_OPACITY,
    SEARCH_PULSE_BASE, SEARCH_PULSE_FREQ,
    UI_FONT_FAMILY,
} from './constants.js';
import type { ContextMenuItem } from './context-menu.js';
import { showContextMenu } from './context-menu.js';
import {
    cancelPendingEdge,
    createNodeAt,
    deleteEdge,
    deleteNode,
    handleEditNodeClick,
    startEdgeFrom,
} from './edit-mode.js';
import { emit } from './event-bus.js';
import type { GraphEdge, GraphNode } from './graph.js';
import { computeNodeDegrees, filterGraph, Graph } from './graph.js';
import { bfs } from './graph-algs.js';
import { labelHelpers } from './graph-ui-helpers.js';
import { callFramePost, callFramePre } from './render-hooks.js';
import { getEdgeCssColor, getEdgeWidth, getNodeCssColor, highlightAlphaMultipliers, settings } from './settings.js';
import { getGraph, setAdjacencyFilter, setEditSubTool, setHighlight, state } from './state.js';
import { getTheme } from './theme.js';
import { updateGraphInfo } from './toolbar.js';

// ---------------------------------------------------------------------------
// Double-click detection (force-graph has no native onNodeDblClick)
// ---------------------------------------------------------------------------

const DOUBLE_CLICK_MS = 300;
let lastClickedNodeId: string | null = null;
let lastClickTime = 0;

// minimum on-screen hit radius (px) for touch long-press node detection, so
// small/zoomed-out nodes are still reachable with a finger
const TOUCH_SLOP_PX = 18;

// ---------------------------------------------------------------------------
// Custom node / link types for force-graph
// ---------------------------------------------------------------------------

export interface FGNode extends NodeObject {
    id: string;
    type: string;
    properties?: Record<string, unknown>;
    kind?: string;
    val?: number;
    source_id?: string;
    target_id?: string;
}

export interface FGLink extends LinkObject<FGNode> {
    id: string;
    type: string;
    properties?: Record<string, unknown>;
    kind?: string;
    curvature?: number;
    source_id?: string;
    target_id?: string;
}

// Force-graph exposes d3ReheatSimulation / d3VelocityDecay / refresh at runtime
// but some are absent from its shipped .d.ts. We extend the type here.
type FGBaseType<N extends NodeObject, L extends LinkObject<N>> = ForceGraphGeneric<FGBaseType<N, L>, N, L>;
type ForceGraphInstance = FGBaseType<FGNode, FGLink> & {
    refresh(): ForceGraphInstance;
};

// ---------------------------------------------------------------------------
// Label & sizing helpers
// ---------------------------------------------------------------------------

function getNodeLabel(node: FGNode): string {
    switch (settings.nodeLabelMode) {
        case 'none':
            return '';
        case 'type':
            return node.type || node.id;
        case 'id':
            return String(node.id);
        case 'expression':
            try {
                const fn = new Function('node', '__helpers', `with(__helpers){with(node){return String(${settings.nodeLabelExpression})}}`);
                return fn(node, labelHelpers) as string;
            } catch {
                return '<expr error>';
            }
        default:
            return String(node.id);
    }
}

function getNodeVal(node: FGNode, degree: number): number {
    switch (settings.nodeSizingMode) {
        case 'constant':
            return settings.nodeSizingConstant;
        case 'expression':
            try {
                const fn = new Function('node', 'degree', `with(node){return (${settings.nodeSizingExpression})}`);
                const val = (fn(node, degree) as number) || 1;
                return Math.min(val, MAX_NODE_VAL);
            } catch {
                return 1;
            }
        default:
            return Math.sqrt(Math.max(1, degree));
    }
}

// ---------------------------------------------------------------------------
// Color caches
// ---------------------------------------------------------------------------

const nodeCssColorCache = new Map<string, string>();
const edgeCssColorCache = new Map<string, string>();

function clearColorCaches(): void {
    nodeCssColorCache.clear();
    edgeCssColorCache.clear();
}

function getCachedNodeCssColor(nodeType: string): string {
    if (!nodeCssColorCache.has(nodeType)) {
        nodeCssColorCache.set(nodeType, getNodeCssColor(nodeType));
    }
    return nodeCssColorCache.get(nodeType)!;
}

function getCachedEdgeCssColor(edgeType: string): string {
    if (!edgeCssColorCache.has(edgeType)) {
        edgeCssColorCache.set(edgeType, adjustEdgeColorForTheme(getEdgeCssColor(edgeType)));
    }
    return edgeCssColorCache.get(edgeType)!;
}

// ---------------------------------------------------------------------------
// Search match color scale
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Per-element color / width helpers
// ---------------------------------------------------------------------------

function nodeColorFor(node: FGNode): string {
    return getCachedNodeCssColor(node.type);
}

function edgeColorFor(edge: FGLink): string {
    return getCachedEdgeCssColor(edge.type);
}

function edgeWidthFor(edge: FGLink): number {
    return getEdgeWidth(edge.type);
}

// Curvature applied to a single self-referencing edge so force-graph draws a
// visible loop (a zero-curvature self-link is degenerate/invisible). Additional
// self-loops on the same node are fanned out by SELF_LOOP_CURVATURE_STEP.
const SELF_LOOP_BASE_CURVATURE = 0.4;
const SELF_LOOP_CURVATURE_STEP = 0.2;

function linkSourceId(link: FGLink): string {
    return (typeof link.source === 'object' && link.source !== null)
        ? (link.source as FGNode).id
        : (link.source as string);
}

function linkTargetId(link: FGLink): string {
    return (typeof link.target === 'object' && link.target !== null)
        ? (link.target as FGNode).id
        : (link.target as string);
}

function _colorWithAlpha(color: string, alpha: number): string {
    const col = d3.color(color);
    if (!col) return color;
    col.opacity = alpha;
    return col.toString();
}

function colorAdjustAlpha(color: string, factor: number): string {
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
function nodeOutlineColor(color: string): string {
    return getTheme() === 'dark' ? brighterColor(color) : darkerColor(color);
}

/**
 * In dark mode, raises the lightness of edge colours that are too dark to be
 * legible against the dark canvas up to EDGE_DARK_MIN_LIGHTNESS, preserving hue,
 * saturation and opacity. Already-bright colours are returned unchanged. In
 * light mode the colour is returned as-is.
 */
function adjustEdgeColorForTheme(color: string): string {
    if (getTheme() !== 'dark') return color;
    const hsl = d3.hsl(color);
    if (hsl.l >= EDGE_DARK_MIN_LIGHTNESS) return color;
    hsl.l = EDGE_DARK_MIN_LIGHTNESS;
    return hsl.toString();
}

// ---------------------------------------------------------------------------
// Canvas drawing helpers
// ---------------------------------------------------------------------------

function drawCircle(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, r: number,
    strokeWidth: number, strokeStyle: string,
): void {
    ctx.save();
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = strokeStyle;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI, false);
    ctx.stroke();
    ctx.restore();
}

function drawDashedCircle(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, r: number,
    strokeWidth: number, strokeStyle: string,
    dashSegments: number[],
    angle = 0,
): void {
    ctx.save();
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = strokeStyle;
    ctx.setLineDash(dashSegments);
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, 2 * Math.PI, false);
    ctx.stroke();
    ctx.restore();
}

function drawText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number, y: number,
    fontSize: number, fillStyle: string,
    textBaseline: CanvasTextBaseline = 'middle',
    textAlign: CanvasTextAlign = 'left',
    dropEmptyLines = true,
): void {
    ctx.save();
    ctx.font = `${fontSize}px ${UI_FONT_FAMILY}`;
    ctx.textAlign = textAlign;
    ctx.textBaseline = textBaseline;
    ctx.fillStyle = fillStyle;

    let lines = text.split('\n');
    if (dropEmptyLines) {
        lines = lines.filter(l => l.length > 0);
    }

    const multiline = lines.length > 1;
    const lineHeight = fontSize * 1.2;
    const blockHeight = (lines.length - 1) * lineHeight;
    const startY = y - blockHeight / 2;

    for (let i = 0; i < lines.length; i++) {
        ctx.font = (multiline && i === 0)
            ? `bold ${fontSize}px ${UI_FONT_FAMILY}`
            : `${fontSize}px ${UI_FONT_FAMILY}`;
        ctx.fillText(lines[i]!, x, startY + i * lineHeight);
    }

    ctx.restore();
}

function drawTextWithStroke(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number, y: number,
    fontSize: number, fillStyle: string, strokeStyle: string, strokeWidth: number,
    textBaseline: CanvasTextBaseline = 'middle',
    textAlign: CanvasTextAlign = 'center',
    bold = false,
): void {
    ctx.save();
    ctx.font = `${bold ? 'bold ' : ''}${fontSize}px ${UI_FONT_FAMILY}`;
    ctx.textAlign = textAlign;
    ctx.textBaseline = textBaseline;
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = strokeStyle;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fillStyle;
    ctx.fillText(text, x, y);
    ctx.restore();
}

// ---------------------------------------------------------------------------
// Node pin helpers
// ---------------------------------------------------------------------------

export function pinNode(node: FGNode): void {
    node.fx = node.x;
    node.fy = node.y;
}

export function unpinNode(node: FGNode): void {
    node.fx = undefined;
    node.fy = undefined;
}

export function isNodePinned(node: FGNode): boolean {
    return node.fx !== undefined || node.fy !== undefined;
}

// ---------------------------------------------------------------------------
// Edit-mode helpers (new-node placement & pointer tracking)
// ---------------------------------------------------------------------------

/** Graph coordinates to assign to freshly created nodes on next merge. */
const pendingNodePositions = new Map<string, { x: number; y: number }>();

/** Records where a newly created node should appear (in graph coordinates). */
export function setPendingNodePosition(id: string, x: number, y: number): void {
    pendingNodePositions.set(id, { x, y });
}

/** Last known pointer position in graph coordinates (for the edit rubber band). */
const pointerGraphPos = { x: 0, y: 0 };

const graphContainerEl = document.getElementById('graph') as HTMLElement;
graphContainerEl.addEventListener('mousemove', (event) => {
    const rect = graphContainerEl.getBoundingClientRect();
    const coords = ForceGraphInstance.screen2GraphCoords(
        event.clientX - rect.left,
        event.clientY - rect.top,
    );
    pointerGraphPos.x = coords.x;
    pointerGraphPos.y = coords.y;
});

// ---------------------------------------------------------------------------
// ForceGraph instance
// ---------------------------------------------------------------------------

export const ForceGraphInstance = new ForceGraph<FGNode, FGLink>(
    document.getElementById('graph') as HTMLElement,
) as unknown as ForceGraphInstance;

const RECENTER_VIEW_DURATION_MS = 400;

// recenter the camera on the origin at 100% zoom
function recenterView(durationMs: number): void {
    ForceGraphInstance.centerAt(0, 0, durationMs);
    ForceGraphInstance.zoom(1.0, durationMs);
}

// request a recenter on the next animation frame
export function requestRecenterView(): void {
    requestAnimationFrame(() => recenterView(RECENTER_VIEW_DURATION_MS));
}

/** Pans the camera to center on the given node, if present and positioned. */
export function centerOnNode(nodeId: string, durationMs = 500): void {
    const node = (ForceGraphInstance.graphData().nodes as FGNode[]).find(n => n.id === nodeId);
    if (node?.x != null && node.y != null) {
        ForceGraphInstance.centerAt(node.x, node.y, durationMs);
    }
}

ForceGraphInstance
    .nodeId('id')
    .graphData({ nodes: [], links: [] })
    .nodeLabel(n => {
        const label = getNodeLabel(n);
        return label + (n.type ? `\n(${n.type})` : '');
    })
    .linkCurvature(l => l.curvature ?? 0)
    .linkWidth(l => edgeWidthFor(l))
    .linkColor(l => {
        let fillStyle = edgeColorFor(l);
        let alphaMultiplier = 1.0;

        // persistent analytics decoration takes precedence over hover/search,
        // but only while the analytics tool is active; it is preserved (yet
        // hidden) when the user switches to another tool such as search
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
    })
    .linkLabel(l => l.properties?.label as string || l.type)
    .linkDirectionalParticleColor(l => edgeColorFor(l))
    .linkDirectionalParticles(0)
    .linkDirectionalArrowLength(link => {
        if (link.properties?.directional === false) {
            return 0;
        }
        // Grow the arrow sub-linearly with line width so thick edges don't get
        // overwhelmingly large arrowheads. Tuned so width 1 keeps the original
        // size (~6) and width 10 caps around ~19 instead of a linear ~60.
        return 6 * Math.sqrt(edgeWidthFor(link));
    })
    .linkDirectionalArrowRelPos(0.55)
    .linkLineDash(link => {
        if (link.properties?.dashed === true) {
            return [4, 4];
        }
        return null;
    })
    .nodeRelSize(6)
    .nodeCanvasObject((node, ctx, globalScale) => {
        const r = nodeRadius(node);
        const zoomBoost = Math.min(MAX_ZOOM_BOOST, Math.max(1, 1 / globalScale));

        let alphaMultiplier = 1.0;
        let baseColor = nodeColorFor(node);

        // persistent analytics decoration takes precedence over hover/search,
        // but only while the analytics tool is active; it is preserved (yet
        // hidden) when the user switches to another tool such as search
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

        const fillStyle = colorAdjustAlpha(baseColor, alphaMultiplier);

        ctx.beginPath();
        ctx.fillStyle = fillStyle;
        ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI, false);
        ctx.fill();

        ctx.beginPath();
        (ctx as unknown as Record<string, unknown>).strokeWidth = 1;
        ctx.strokeStyle = nodeOutlineColor(fillStyle);
        ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI, false);
        ctx.stroke();

        const locked = isNodePinned(node);
        if (locked) {
            // invert the ring colors in dark mode so the thicker outer ring
            // stays visible against the dark canvas background
            const outerRingColor = getTheme() === 'dark' ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.95)';
            const innerRingColor = getTheme() === 'dark' ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.8)';
            drawCircle(ctx, node.x!, node.y!, r + 1, 2, colorAdjustAlpha(outerRingColor, alphaMultiplier));
            drawCircle(ctx, node.x!, node.y!, r, 1, colorAdjustAlpha(innerRingColor, alphaMultiplier));
        }

        if (state.selection.selectedNodeIds.has(node.id)) {
            const rotation = (Date.now() / 1000) % (2 * Math.PI);
            drawDashedCircle(ctx, node.x!, node.y!, r + 2 * zoomBoost, 2 * zoomBoost, colorAdjustAlpha('rgba(255,0,0,1.0)', alphaMultiplier), [3 * zoomBoost, 2 * zoomBoost], rotation);
        }

        if (state.search?.matchesMap.has(node.id)) {
            const matchColor = state.search.matchColorsMap.get(node.id) ?? SEARCH_COLOR_BEST;
            const pulse = 2 * Math.sin((Date.now() / 1000) * 2 * Math.PI * SEARCH_PULSE_FREQ);
            drawCircle(ctx, node.x!, node.y!, r + (SEARCH_PULSE_BASE + pulse) * zoomBoost, 3 * zoomBoost, matchColor);
        }

        if (state.edit.active && state.edit.pendingEdgeSourceId === node.id) {
            const pulse = 2 * Math.sin((Date.now() / 1000) * 2 * Math.PI * SEARCH_PULSE_FREQ);
            drawCircle(ctx, node.x!, node.y!, r + (SEARCH_PULSE_BASE + pulse) * zoomBoost, 2.5 * zoomBoost, 'rgb(33, 150, 243)');
        }

        const label = getNodeLabel(node);
        drawText(ctx, label, node.x! + r + NODE_LABEL_OFFSET, node.y!, NODE_LABEL_FONT_SIZE, colorAdjustAlpha(getTheme() === 'dark' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.75)', alphaMultiplier));

        // show hidden nodes counters in adjacency filtered mode
        if (state.adjacencyFilter?.hiddenCounts.get(node.id)) {
            const hiddenCount = state.adjacencyFilter.hiddenCounts.get(node.id) ?? 0;
            drawTextWithStroke(
                ctx, `+${hiddenCount}`, node.x! - r, node.y! - r, 9,
                colorAdjustAlpha('rgba(8, 168, 8, 0.95)', alphaMultiplier),
                colorAdjustAlpha('rgba(255, 255, 255, 0.9)', alphaMultiplier),
                1.0, 'alphabetic', 'right', true,
            );
        }
    })
    .nodePointerAreaPaint((node, color, ctx) => {
        const r = nodePointerRadius(node);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI, false);
        ctx.fill();
    })
    .onNodeClick((node, event) => {
        const now = Date.now();
        if (node.id === lastClickedNodeId && now - lastClickTime < DOUBLE_CLICK_MS) {
            lastClickedNodeId = null;
            lastClickTime = 0;
            handleNodeDoubleClick(node);
        } else {
            lastClickedNodeId = node.id;
            lastClickTime = now;
        }

        if (state.edit.active) {
            handleEditNodeClick(node);
            return;
        }

        if (state.analytics.active && state.analytics.awaitingPickRole) {
            handleAnalyticsNodeClick(node);
            return;
        }

        if (state.currentTool === 'pointer') {
            if (event?.altKey) {
                unpinNode(node);
            }
        }
        emit(EVT_NODE_CLICKED, { data: node, shiftKey: event?.shiftKey ?? false });
    })
    .onLinkClick((link, event) => {
        emit(EVT_LINK_CLICKED, { data: link, shiftKey: event?.shiftKey ?? false });
    })
    .onLinkRightClick((link, event) => {
        event.preventDefault();
        showLinkContextMenu(link, event.clientX, event.clientY);
    })
    .onNodeDrag(node => {
        pinNode(node);
    })
    .onNodeDragEnd(node => {
        pinNode(node);
    })
    .onNodeHover((node, _prevNode) => {
        // keep a persistent analytics decoration in place; don't let hover
        // override the algorithm result highlight (only while it is shown)
        if (state.analytics.active && state.analytics.decoration) {
            return;
        }
        if (node != null) {
            const graph = getGraph();
            const { nodeDistancesMap, edgeDistancesMap } = bfs(graph, node.id, 2);
            setHighlight({ nodeDistancesMap, edgeDistancesMap });
        } else {
            setHighlight(null);
        }
    })
    .onNodeRightClick((node, event) => {
        event.preventDefault();
        showNodeContextMenu(node, event.clientX, event.clientY);
    })
    .onBackgroundRightClick((event) => {
        event.preventDefault();
        showBackgroundContextMenu(event.clientX, event.clientY);
    })
    .onBackgroundClick((event) => {
        if (state.edit.active) {
            if (state.edit.subTool === 'connect' && state.edit.pendingEdgeSourceId) {
                cancelPendingEdge();
                return;
            }
            const rect = graphContainerEl.getBoundingClientRect();
            const coords = ForceGraphInstance.screen2GraphCoords(
                event.clientX - rect.left,
                event.clientY - rect.top,
            );
            createNodeAt(coords.x, coords.y);
            return;
        }
        if (state.currentTool === 'pointer') {
            emit(EVT_BACKGROUND_CLICK, null);
        } else if (state.currentTool === 'rect-select') {
            state.selection.selectedNodeIds.clear();
        }
    })
    .autoPauseRedraw(false)
    .onRenderFramePre((ctx, globalScale) => {
        callFramePre();

        // edit-mode rubber band: line from pending edge source to the pointer
        if (state.edit.active && state.edit.subTool === 'connect' && state.edit.pendingEdgeSourceId) {
            const source = (ForceGraphInstance.graphData().nodes as FGNode[])
                .find(n => n.id === state.edit.pendingEdgeSourceId);
            if (source?.x != null && source.y != null) {
                ctx.save();
                ctx.strokeStyle = 'rgba(33, 150, 243, 0.8)';
                ctx.lineWidth = 1.5 / globalScale;
                ctx.setLineDash([6 / globalScale, 4 / globalScale]);
                ctx.beginPath();
                ctx.moveTo(source.x, source.y);
                ctx.lineTo(pointerGraphPos.x, pointerGraphPos.y);
                ctx.stroke();
                ctx.restore();
            }
        }

        if (!settings.showGrid) return;

        const topLeft = ForceGraphInstance.screen2GraphCoords(0, 0);
        const bottomRight = ForceGraphInstance.screen2GraphCoords(ctx.canvas.width, ctx.canvas.height);

        const spacing = GRID_SPACING;
        const halfSmall = GRID_CROSS_HALF;
        const halfBig = GRID_CENTER_CROSS_HALF;
        const lw = 1 / globalScale;

        const xMin = Math.floor(topLeft.x / spacing) * spacing;
        const xMax = Math.ceil(bottomRight.x / spacing) * spacing;
        const yMin = Math.floor(topLeft.y / spacing) * spacing;
        const yMax = Math.ceil(bottomRight.y / spacing) * spacing;

        const xCount = (xMax - xMin) / spacing;
        const yCount = (yMax - yMin) / spacing;
        const drawGrid = xCount <= MAX_CROSSES_PER_AXIS && yCount <= MAX_CROSSES_PER_AXIS;

        ctx.save();
        ctx.lineWidth = lw;

        const dark = getTheme() === 'dark';
        const gridLineColor = dark ? GRID_LINE_COLOR_DARK : GRID_LINE_COLOR;
        const gridLineColorUnstressed = dark ? GRID_LINE_COLOR_UNSTRESSED_DARK : GRID_LINE_COLOR_UNSTRESSED;
        const gridCenterColor = dark ? GRID_CENTER_COLOR_DARK : GRID_CENTER_COLOR;
        const gridCenterColorUnstressed = dark ? GRID_CENTER_COLOR_UNSTRESSED_DARK : GRID_CENTER_COLOR_UNSTRESSED;

        if (drawGrid) {
            ctx.strokeStyle = state.highlight ? gridLineColorUnstressed : gridLineColor;

            ctx.beginPath();
            for (let gx = xMin; gx <= xMax; gx += spacing) {
                for (let gy = yMin; gy <= yMax; gy += spacing) {
                    if (gx === 0 && gy === 0) continue;
                    ctx.moveTo(gx - halfSmall, gy);
                    ctx.lineTo(gx + halfSmall, gy);
                    ctx.moveTo(gx, gy - halfSmall);
                    ctx.lineTo(gx, gy + halfSmall);
                }
            }
            ctx.stroke();
        }

        ctx.strokeStyle = state.highlight ? gridCenterColorUnstressed : gridCenterColor;
        ctx.lineWidth = lw * 1.5;
        ctx.beginPath();
        ctx.moveTo(-halfBig, 0);
        ctx.lineTo(halfBig, 0);
        ctx.moveTo(0, -halfBig);
        ctx.lineTo(0, halfBig);
        ctx.stroke();

        ctx.restore();
    })
    .onRenderFramePost(() => {
        callFramePost();
    })
    .d3Force('charge', d3.forceManyBody().strength(D3_CHARGE_STRENGTH))
    .d3Force('link', d3.forceLink<FGNode, d3.SimulationLinkDatum<FGNode>>().distance(D3_LINK_DISTANCE).strength(D3_LINK_STRENGTH))
    .d3Force('collision', d3.forceCollide<FGNode>().radius(d => D3_COLLISION_BASE_RADIUS + (d.val ?? 1) * D3_COLLISION_RADIUS_PER_VAL).strength(D3_COLLISION_STRENGTH).iterations(D3_COLLISION_ITERATIONS))
    .d3Force('forceX', d3.forceX<FGNode>())
    .d3Force('forceY', d3.forceY<FGNode>());

// ---------------------------------------------------------------------------
// Node double-click handler
// ---------------------------------------------------------------------------

function handleNodeDoubleClick(node: FGNode): void {
    if (state.adjacencyFilter) {
        updateAdjacencyFilter([node.id], true);
        void refreshGraphUI();
    }
}

// ---------------------------------------------------------------------------
// Adjacency filter
// ---------------------------------------------------------------------------

function updateAdjacencyFilter(seedNodeIds: Iterable<string> | null, extendExisting = false): void {
    const graph = getGraph();

    if (seedNodeIds !== null) {
        const nodeIds = new Set<string>(seedNodeIds);

        for (const seedId of seedNodeIds) {
            const edges = graph.getAdjacentEdges(seedId);
            for (const edge of edges) {
                const adjacentNodeId = edge.source_id === seedId ? edge.target_id : edge.source_id;
                nodeIds.add(adjacentNodeId);
            }
        }

        if (!extendExisting) {
            setAdjacencyFilter({
                visibleNodeIds: nodeIds,
                hiddenCounts: new Map(),
            });
        } else {
            for (const id of nodeIds) {
                state.adjacencyFilter!.visibleNodeIds.add(id);
            }
        }

        const hiddenCounts = new Map<string, number>();
        for (const id of state.adjacencyFilter!.visibleNodeIds) {
            const adjacencyHiddenNodesIds = new Set<string>();
            for (const edge of graph.getAdjacentEdges(id)) {
                const adjacentNodeId = edge.source_id === id ? edge.target_id : edge.source_id;
                if (!state.adjacencyFilter!.visibleNodeIds.has(adjacentNodeId)) {
                    adjacencyHiddenNodesIds.add(adjacentNodeId);
                }
            }
            hiddenCounts.set(id, adjacencyHiddenNodesIds.size);
        }
        state.adjacencyFilter!.hiddenCounts = hiddenCounts;
    } else {
        setAdjacencyFilter(null);
    }
}

// ---------------------------------------------------------------------------
// Context menus (shared by right-click and touch long-press)
// ---------------------------------------------------------------------------

/** Builds and shows the node context menu at the given screen coordinates. */
export function showNodeContextMenu(node: FGNode, clientX: number, clientY: number): void {
    const items: ContextMenuItem[] = [];

    if (state.edit.active) {
        items.push({
            label: 'Start edge from here',
            icon: 'add_link',
            action: () => {
                setEditSubTool('connect');
                startEdgeFrom(node.id);
            },
        });
        items.push({
            label: 'Delete node',
            icon: 'delete',
            action: () => deleteNode(node.id),
        });
        items.push({ divider: true });
    }

    if (isNodePinned(node)) {
        items.push({ label: 'Unpin', icon: 'keep_off', action: () => unpinNode(node) });
    } else {
        items.push({ label: 'Pin', icon: 'push_pin', action: () => pinNode(node) });
    }

    items.push({ divider: true });

    items.push({
        label: 'Show adjacent only',
        icon: 'filter_alt',
        action: () => {
            updateAdjacencyFilter([node.id], false);
            void refreshGraphUI();
        },
    });

    if (state.selection.selectedNodeIds.size > 0) {
        items.push({
            label: 'Show adjacent only (all selected)',
            icon: 'filter_alt',
            action: () => {
                updateAdjacencyFilter(state.selection.selectedNodeIds, false);
                void refreshGraphUI();
            },
        });
    }

    if (state.adjacencyFilter) {
        items.push({
            label: 'Show adjacent (extend)',
            icon: 'expand',
            action: () => {
                updateAdjacencyFilter([node.id], true);
                void refreshGraphUI();
            },
        });

        items.push({
            label: 'Reset adjacency filter',
            icon: 'filter_alt_off',
            action: () => {
                updateAdjacencyFilter(null);
                void refreshGraphUI();
            },
        });
    }

    showContextMenu(clientX, clientY, items);
}

/** Builds and shows the link context menu at the given screen coordinates. */
export function showLinkContextMenu(link: FGLink, clientX: number, clientY: number): void {
    if (!state.edit.active) return;
    showContextMenu(clientX, clientY, [{
        label: 'Delete edge',
        icon: 'delete',
        action: () => deleteEdge(link.id),
    }]);
}

/** Builds and shows the background context menu at the given screen coordinates. */
export function showBackgroundContextMenu(clientX: number, clientY: number): void {
    if (state.adjacencyFilter) {
        showContextMenu(clientX, clientY, [{
            label: 'Reset adjacency filter',
            icon: 'filter_alt_off',
            action: () => {
                setAdjacencyFilter(null);
                void refreshGraphUI();
            },
        }]);
    }
}

/**
 * Hit-tests the graph for a node under the given screen coordinates, returning
 * the closest node within a finger-sized radius, or null. Used by touch
 * long-press, which cannot rely on force-graph's mouse hover state.
 *
 * The test is done in screen space (after projecting each node through the
 * current zoom/pan) and padded with a touch slop, so it stays reliable when
 * the graph is zoomed out and nodes are visually tiny.
 */
export function getNodeAtScreen(clientX: number, clientY: number): FGNode | null {
    const rect = graphContainerEl.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const k = ForceGraphInstance.zoom();

    let closest: FGNode | null = null;
    let closestDist = Number.POSITIVE_INFINITY;

    for (const node of ForceGraphInstance.graphData().nodes as FGNode[]) {
        if (node.x == null || node.y == null) continue;
        const screen = ForceGraphInstance.graph2ScreenCoords(node.x, node.y);
        const dist = Math.hypot(screen.x - px, screen.y - py);
        // node's on-screen radius, with a minimum finger target size
        const hitRadius = Math.max(nodeRadius(node) * k, TOUCH_SLOP_PX);
        if (dist <= hitRadius && dist < closestDist) {
            closest = node;
            closestDist = dist;
        }
    }

    return closest;
}

// ---------------------------------------------------------------------------
// Graph UI refresh
// ---------------------------------------------------------------------------

/**
 * Builds the graph as currently rendered on the canvas by applying, in order:
 * node/edge type filters, the adjacency focus filter and the hide-isolated
 * toggle. This is the single source of truth for "what is visible", shared by
 * rendering and analytics so they can never diverge.
 */
export function getVisibleGraph(): Graph {
    const typeFiltered = filterGraph(
        getGraph(),
        node => settings.nodeFilters[node.type] !== false,
        edge => settings.edgeFilters[edge.type] !== false,
    );

    let nodes = typeFiltered.getNodes();
    let edges = typeFiltered.getEdges();

    if (state.adjacencyFilter) {
        const visible = state.adjacencyFilter.visibleNodeIds;
        nodes = nodes.filter(n => visible.has(n.id));
        edges = edges.filter(e => visible.has(e.source_id) && visible.has(e.target_id));
    }

    if (!settings.showIsolated) {
        const connected = new Set<string>();
        for (const e of edges) {
            connected.add(e.source_id);
            connected.add(e.target_id);
        }
        nodes = nodes.filter(n => connected.has(n.id));
    }

    return new Graph(nodes, edges);
}

export async function refreshGraphUI(): Promise<void> {
    clearColorCaches();

    const graph = getVisibleGraph();

    const nodes: FGNode[] = graph.getNodes().map(n => ({ ...(n as GraphNode), kind: 'node' } as FGNode));
    const edges: FGLink[] = graph.getEdges().map(e => ({ ...(e as GraphEdge), kind: 'edge' } as FGLink));

    const nodeDegreesMap = computeNodeDegrees(graph);
    for (const n of nodes) {
        const degree = nodeDegreesMap.get(n.id) ?? 0;
        n.val = getNodeVal(n, degree);
    }

    mergeGraphDataIntoForceGraph(nodes, edges);
    updateGraphInfo();
}

export function refreshGraphColors(): void {
    clearColorCaches();
    if (typeof (ForceGraphInstance as unknown as Record<string, unknown>).refresh === 'function') {
        ForceGraphInstance.refresh();
    }
}

function mergeGraphDataIntoForceGraph(nodes: FGNode[], edges: FGLink[]): void {
    console.log('updating graph data:', nodes.length, 'nodes,', edges.length, 'links');

    const current = ForceGraphInstance.graphData() ?? { nodes: [], links: [] };

    const existingNodesById = new Map((current.nodes ?? []).map(n => [n.id, n]));
    const existingLinksById = new Map((current.links ?? []).map(l => [l.id, l]));

    const mergedNodes: FGNode[] = [];
    const mergedLinks: FGLink[] = [];

    for (const node of nodes) {
        node.kind = 'node';
        const existing = existingNodesById.get(node.id);
        if (existing) {
            Object.assign(existing, node);
            mergedNodes.push(existing);
        } else {
            const pos = pendingNodePositions.get(node.id);
            if (pos) {
                node.x = pos.x;
                node.y = pos.y;
                node.fx = pos.x;
                node.fy = pos.y;
                pendingNodePositions.delete(node.id);
            }
            mergedNodes.push(node);
        }
    }

    for (const edge of edges) {
        edge.kind = 'edge';
        edge.source = edge.source_id;
        edge.target = edge.target_id;

        const existing = existingLinksById.get(edge.id);
        if (existing) {
            existing.kind = edge.kind;
            existing.type = edge.type;
            existing.properties = edge.properties;
            existing.source_id = edge.source_id;
            existing.target_id = edge.target_id;
            mergedLinks.push(existing);
        } else {
            mergedLinks.push(edge);
        }
    }

    ForceGraphInstance.graphData({ nodes: mergedNodes, links: mergedLinks });

    autoAdjustCurvature();
}

export function autoAdjustCurvature(): void {
    const sameNodesLinks = new Map<string, FGLink[]>();
    const selfLoops = new Map<string, FGLink[]>();
    const seenLinks = new Set<string>();

    const links = ForceGraphInstance.graphData().links;

    for (const l of links) {
        if (seenLinks.has(l.id)) continue;
        seenLinks.add(l.id);

        const srcId = linkSourceId(l);
        const tgtId = linkTargetId(l);

        if (srcId === tgtId) {
            // Self-referencing edge (loop): group by the single node so that
            // multiple self-loops on the same node can be spread apart.
            if (!selfLoops.has(srcId)) {
                selfLoops.set(srcId, []);
            }
            selfLoops.get(srcId)!.push(l);
            continue;
        }

        const pairKey = srcId < tgtId ? `${srcId}::${tgtId}` : `${tgtId}::${srcId}`;

        if (!sameNodesLinks.has(pairKey)) {
            sameNodesLinks.set(pairKey, []);
        }
        sameNodesLinks.get(pairKey)!.push(l);
    }

    for (const linksGroup of sameNodesLinks.values()) {
        if (linksGroup.length <= 1) {
            for (const l of linksGroup) l.curvature = 0;
            continue;
        }

        const n = linksGroup.length;
        const maxCurvature = Math.min(1, settings.curvatureStep * n);
        const intervalSize = maxCurvature * 2;
        const intervalStep = intervalSize / (n - 1);

        const firstSrcId = linkSourceId(linksGroup[0]!);
        for (let idx = 0; idx < n; idx++) {
            linksGroup[idx]!.curvature = -maxCurvature + idx * intervalStep;
            if (linkSourceId(linksGroup[idx]!) !== firstSrcId) {
                linksGroup[idx]!.curvature! *= -1;
            }
        }
    }

    // Self-loops require a non-zero curvature to be drawn at all by force-graph
    // (a zero-curvature link from a node to itself is degenerate/invisible).
    // Give each loop a distinct curvature so multiple loops fan out.
    for (const loopGroup of selfLoops.values()) {
        for (let idx = 0; idx < loopGroup.length; idx++) {
            loopGroup[idx]!.curvature = SELF_LOOP_BASE_CURVATURE + idx * SELF_LOOP_CURVATURE_STEP;
        }
    }
}

export function applyD3Params(): void {
    if (!settings.d3EnablePhysics) {
        // Freeze the engine: it stops after the next tick check.
        ForceGraphInstance.cooldownTicks(0);
        return;
    }

    ForceGraphInstance.cooldownTicks(Infinity);

    const chargeForce = ForceGraphInstance.d3Force('charge');
    if (chargeForce && typeof chargeForce.strength === 'function') chargeForce.strength(settings.d3Charge);

    const linkForce = ForceGraphInstance.d3Force('link');
    if (linkForce) {
        if (typeof linkForce.distance === 'function') linkForce.distance(settings.d3LinkDistance);
        if (typeof linkForce.strength === 'function') linkForce.strength(settings.d3LinkStrength);
    }

    const forceX = ForceGraphInstance.d3Force('forceX');
    const forceY = ForceGraphInstance.d3Force('forceY');

    if (forceX && typeof forceX.strength === 'function') forceX.strength(settings.d3ForceXYStrength);
    if (forceY && typeof forceY.strength === 'function') forceY.strength(settings.d3ForceXYStrength);

    if (settings.d3CenterForce) {
        ForceGraphInstance.d3Force('center', d3.forceCenter());
    } else {
        ForceGraphInstance.d3Force('center', null);
    }

    const collisionForce = ForceGraphInstance.d3Force('collision');
    if (collisionForce && typeof collisionForce.radius === 'function') {
        collisionForce.radius((d: FGNode) => (D3_COLLISION_BASE_RADIUS + (d.val ?? 1) * D3_COLLISION_RADIUS_PER_VAL) * settings.d3CollisionMultiplier);
    }

    if (typeof ForceGraphInstance.d3VelocityDecay === 'function') {
        ForceGraphInstance.d3VelocityDecay(settings.d3VelocityDecay);
    }

    // Reheat so updated forces (and a re-enabled engine) take effect.
    // d3ReheatSimulation sets alpha=1 and restarts the cooled-down engine.
    ForceGraphInstance.d3ReheatSimulation();
}
