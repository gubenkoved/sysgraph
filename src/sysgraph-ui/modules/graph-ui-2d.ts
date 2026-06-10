import * as d3 from 'd3';
import ForceGraph from 'force-graph';
import {
    D3_CHARGE_STRENGTH,
    D3_COLLISION_BASE_RADIUS, D3_COLLISION_ITERATIONS, D3_COLLISION_RADIUS_PER_VAL, D3_COLLISION_STRENGTH, D3_LINK_DISTANCE, D3_LINK_STRENGTH,
    GRID_CENTER_COLOR, GRID_CENTER_COLOR_DARK, GRID_CENTER_COLOR_UNSTRESSED, GRID_CENTER_COLOR_UNSTRESSED_DARK, GRID_CENTER_CROSS_HALF, GRID_CROSS_HALF,
    GRID_LINE_COLOR, GRID_LINE_COLOR_DARK, GRID_LINE_COLOR_UNSTRESSED, GRID_LINE_COLOR_UNSTRESSED_DARK,
    GRID_SPACING,
    MAX_CROSSES_PER_AXIS, MAX_ZOOM_BOOST,
    NODE_LABEL_FONT_SIZE,
    NODE_LABEL_OFFSET,
    NODE_LABEL_ZOOM_DAMP, NODE_LABEL_ZOOM_THRESHOLD,
    nodePointerRadius, nodeRadius,
    SEARCH_COLOR_BEST, SEARCH_PULSE_BASE, SEARCH_PULSE_FREQ,
    UI_FONT_FAMILY,
} from './constants.js';
import {
    colorAdjustAlpha,
    edgeColorFor,
    getNodeLabel,
    isNodePinned,
    linkTooltip,
    nodeOutlineColor,
    nodeTooltip,
    resolveLinkArrowLength,
    resolveLinkColor,
    resolveLinkCurvature,
    resolveLinkWidth,
    resolveNodeAppearance,
} from './graph-ui-appearance.js';
import type { FGLink, FGNode, ForceGraphInstance, RendererHandlers } from './graph-ui-types.js';
import { settings } from './settings.js';
import { state } from './state.js';
import { getTheme } from './theme.js';

// 2D canvas renderer backed by the force-graph library. All node/link
// appearance comes from graph-ui-appearance; this module owns the canvas
// drawing primitives, the per-frame grid/rubber-band overlay and the d3 force
// configuration specific to the planar simulation.

// ---------------------------------------------------------------------------
// Canvas drawing helpers
// ---------------------------------------------------------------------------

// dampen label growth above a zoom threshold so dense text stays legible;
// below the threshold the label keeps its nominal size. this is intrinsically a
// 2D concept — it scales with the canvas globalScale (zoom); the 3D renderer
// sizes labels in world units instead
function labelFontSize(globalScale: number): number {
    if (globalScale <= NODE_LABEL_ZOOM_THRESHOLD) {
        return NODE_LABEL_FONT_SIZE;
    }
    const damp = (NODE_LABEL_ZOOM_THRESHOLD / globalScale) ** NODE_LABEL_ZOOM_DAMP;
    return NODE_LABEL_FONT_SIZE * damp;
}

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
    outline?: { strokeStyle: string; strokeWidth: number },
): void {
    ctx.save();
    ctx.font = `${fontSize}px ${UI_FONT_FAMILY}`;
    ctx.textAlign = textAlign;
    ctx.textBaseline = textBaseline;

    let lines = text.split('\n');
    if (dropEmptyLines) {
        lines = lines.filter(l => l.length > 0);
    }

    const lineHeight = fontSize * 1.2;
    const blockHeight = (lines.length - 1) * lineHeight;
    const startY = y - blockHeight / 2;

    if (outline) {
        ctx.lineWidth = outline.strokeWidth;
        ctx.strokeStyle = outline.strokeStyle;
        // round joins keep the halo smooth around glyph corners
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;
    }

    for (let i = 0; i < lines.length; i++) {
        // always bold the first line, even when it is the only line
        ctx.font = (i === 0)
            ? `bold ${fontSize}px ${UI_FONT_FAMILY}`
            : `${fontSize}px ${UI_FONT_FAMILY}`;
        const lineY = startY + i * lineHeight;
        if (outline) {
            ctx.strokeText(lines[i]!, x, lineY);
        }
        ctx.fillStyle = fillStyle;
        ctx.fillText(lines[i]!, x, lineY);
    }

    ctx.restore();
}

// ---------------------------------------------------------------------------
// Accessors & per-frame drawing (named callbacks wired into the builder below)
// ---------------------------------------------------------------------------

// dashed style for links flagged with properties.dashed
function resolveLinkLineDash(link: FGLink): number[] | null {
    if (link.properties?.dashed === true) {
        return [4, 4];
    }
    return null;
}

// main per-node canvas painter: fill, outline, pin ring, selection ring, search
// pulse, edit rubber-band source pulse, label and analytics/adjacency overlays
function drawNode(node: FGNode, ctx: CanvasRenderingContext2D, globalScale: number): void {
    const r = nodeRadius(node);
    const zoomBoost = Math.min(MAX_ZOOM_BOOST, Math.max(1, 1 / globalScale));

    // shared with the 3D nodeColor accessor so colors stay identical
    const decoration = state.analytics.active ? state.analytics.decoration : null;
    const { fillStyle, alphaMultiplier } = resolveNodeAppearance(node);

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
    const labelDark = getTheme() === 'dark';
    // contrasting halo: dark theme has light text -> dark outline, and vice versa
    const labelOutline = settings.nodeLabelOutline
        ? {
            strokeStyle: colorAdjustAlpha(labelDark ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.9)', alphaMultiplier),
            strokeWidth: 2.5,
        }
        : undefined;
    drawText(ctx, label, node.x! + r + NODE_LABEL_OFFSET, node.y!, labelFontSize(globalScale), colorAdjustAlpha(labelDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.75)', alphaMultiplier), 'middle', 'left', true, labelOutline);

    // analytics heatmap raw value drawn under the node (e.g. distance)
    if (decoration?.kind === 'heatmap' && decoration.showValues) {
        const valueText = decoration.nodeLabels?.get(node.id);
        if (valueText !== undefined) {
            const dark = getTheme() === 'dark';
            drawText(
                ctx, valueText, node.x!, node.y! + r + NODE_LABEL_OFFSET,
                labelFontSize(globalScale),
                colorAdjustAlpha(dark ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.9)', alphaMultiplier),
                'top', 'center', true,
                {
                    strokeStyle: colorAdjustAlpha(dark ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.9)', alphaMultiplier),
                    strokeWidth: 2.5,
                },
            );
        }
    }

    // show hidden nodes counters in adjacency filtered mode
    if (state.adjacencyFilter?.hiddenCounts.get(node.id)) {
        const hiddenCount = state.adjacencyFilter.hiddenCounts.get(node.id) ?? 0;
        drawText(
            ctx, `+${hiddenCount}`, node.x! - r, node.y! - r, 9,
            colorAdjustAlpha('rgba(8, 168, 8, 0.95)', alphaMultiplier),
            'alphabetic', 'right', true,
            {
                strokeStyle: colorAdjustAlpha('rgba(255, 255, 255, 0.9)', alphaMultiplier),
                strokeWidth: 1.0,
            },
        );
    }
}

// paints the enlarged invisible hit area used for pointer picking
function paintNodePointerArea(node: FGNode, color: string, ctx: CanvasRenderingContext2D): void {
    const r = nodePointerRadius(node);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI, false);
    ctx.fill();
}

// edit-mode rubber band: line from the pending edge source to the pointer
function drawEditRubberBand(
    fg: ForceGraphInstance,
    pointerGraphPos: { x: number; y: number },
    ctx: CanvasRenderingContext2D,
    globalScale: number,
): void {
    if (!(state.edit.active && state.edit.subTool === 'connect' && state.edit.pendingEdgeSourceId)) {
        return;
    }
    const source = (fg.graphData().nodes as FGNode[])
        .find(n => n.id === state.edit.pendingEdgeSourceId);
    if (source?.x == null || source.y == null) return;
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

// background reference grid with an accented center cross
function drawGrid(fg: ForceGraphInstance, ctx: CanvasRenderingContext2D, globalScale: number): void {
    if (!settings.showGrid) return;

    const topLeft = fg.screen2GraphCoords(0, 0);
    const bottomRight = fg.screen2GraphCoords(ctx.canvas.width, ctx.canvas.height);

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
    const shouldDrawCrosses = xCount <= MAX_CROSSES_PER_AXIS && yCount <= MAX_CROSSES_PER_AXIS;

    ctx.save();
    ctx.lineWidth = lw;

    const dark = getTheme() === 'dark';
    const gridLineColor = dark ? GRID_LINE_COLOR_DARK : GRID_LINE_COLOR;
    const gridLineColorUnstressed = dark ? GRID_LINE_COLOR_UNSTRESSED_DARK : GRID_LINE_COLOR_UNSTRESSED;
    const gridCenterColor = dark ? GRID_CENTER_COLOR_DARK : GRID_CENTER_COLOR;
    const gridCenterColorUnstressed = dark ? GRID_CENTER_COLOR_UNSTRESSED_DARK : GRID_CENTER_COLOR_UNSTRESSED;

    if (shouldDrawCrosses) {
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
}

// pre-frame overlay: edit rubber band then the reference grid
function renderFramePre(
    fg: ForceGraphInstance,
    pointerGraphPos: { x: number; y: number },
    ctx: CanvasRenderingContext2D,
    globalScale: number,
): void {
    drawEditRubberBand(fg, pointerGraphPos, ctx, globalScale);
    drawGrid(fg, ctx, globalScale);
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Builds the 2D canvas renderer mounted into `host`. Interaction callbacks come
 * from `handlers` and the edit rubber band reads the live pointer position from
 * `pointerGraphPos` (both owned by the orchestrator) so this module stays free
 * of circular dependencies on graph-ui.
 */
export function build2DRenderer(
    host: HTMLElement,
    handlers: RendererHandlers,
    pointerGraphPos: { x: number; y: number },
): ForceGraphInstance {
    const fg = new ForceGraph<FGNode, FGLink>(host) as unknown as ForceGraphInstance;
    fg
    .nodeId('id')
    .graphData({ nodes: [], links: [] })
    .nodeLabel(nodeTooltip)
    .linkCurvature(resolveLinkCurvature)
    .linkWidth(resolveLinkWidth)
    .linkColor(resolveLinkColor)
    .linkLabel(linkTooltip)
    .linkDirectionalParticleColor(l => edgeColorFor(l))
    .linkDirectionalParticles(0)
    .linkDirectionalArrowLength(resolveLinkArrowLength)
    .linkDirectionalArrowRelPos(0.55)
    .linkLineDash(resolveLinkLineDash)
    .nodeRelSize(6)
    .nodeCanvasObject(drawNode)
    .nodePointerAreaPaint(paintNodePointerArea)
    .onNodeClick(handlers.onNodeClick)
    .onLinkClick(handlers.onLinkClick)
    .onLinkRightClick(handlers.onLinkRightClick)
    .onNodeDrag(handlers.onNodeDrag)
    .onNodeDragEnd(handlers.onNodeDrag)
    .onNodeHover(handlers.onNodeHover)
    .onNodeRightClick(handlers.onNodeRightClick)
    .onBackgroundRightClick(handlers.onBackgroundRightClick)
    .onBackgroundClick(handlers.onBackgroundClick)
    .autoPauseRedraw(false)
    .onRenderFramePre((ctx, globalScale) => renderFramePre(fg, pointerGraphPos, ctx, globalScale))
    .d3Force('charge', d3.forceManyBody().strength(D3_CHARGE_STRENGTH))
    .d3Force('link', d3.forceLink<FGNode, d3.SimulationLinkDatum<FGNode>>().distance(D3_LINK_DISTANCE).strength(D3_LINK_STRENGTH))
    .d3Force('collision', d3.forceCollide<FGNode>().radius(d => D3_COLLISION_BASE_RADIUS + (d.val ?? 1) * D3_COLLISION_RADIUS_PER_VAL).strength(D3_COLLISION_STRENGTH).iterations(D3_COLLISION_ITERATIONS))
    .d3Force('forceX', d3.forceX<FGNode>())
    .d3Force('forceY', d3.forceY<FGNode>());

    return fg;
}

// ---------------------------------------------------------------------------
// Camera helpers
// ---------------------------------------------------------------------------

/** Recenters the 2D camera on the origin at unit zoom. */
export function recenter2D(fg: ForceGraphInstance, durationMs: number): void {
    fg.centerAt(0, 0, durationMs);
    fg.zoom(1.0, durationMs);
}

/** Pans the 2D camera to focus on the given node, if positioned. */
export function focusNode2D(fg: ForceGraphInstance, node: FGNode, durationMs: number): void {
    if (node.x != null && node.y != null) {
        fg.centerAt(node.x, node.y, durationMs);
    }
}
