import { state, setHighlight, setAdjacencyFilter } from './state.js';
import { emit } from './event-bus.js';
import { bfs } from './graph-algs.js';
import { getGraph } from './state.js';
import { settings, highlightAlphaMultipliers, getNodeColor, getEdgeColor, getEdgeWidth } from './settings.js'
import { showContextMenu } from './context-menu.js';
import { ColorScale } from './color-scale.js';
import {
    EVT_NODE_CLICKED, EVT_LINK_CLICKED, EVT_BACKGROUND_CLICK,
    nodeRadius, nodePointerRadius, MAX_NODE_VAL, NODE_LABEL_FONT_SIZE, NODE_LABEL_OFFSET,
    SEARCH_NOT_MATCHING_OPACITY, SCORE_EPSILON,
    SEARCH_COLOR_BEST, SEARCH_COLOR_MID, SEARCH_COLOR_WORST,
    GRID_SPACING, GRID_CROSS_HALF, GRID_CENTER_CROSS_HALF, MAX_CROSSES_PER_AXIS,
    GRID_LINE_COLOR, GRID_LINE_COLOR_UNSTRESSED, GRID_CENTER_COLOR, GRID_CENTER_COLOR_UNSTRESSED,
    MAX_ZOOM_BOOST, REHEAT_ALPHA, REHEAT_TIMEOUT_MS,
    SEARCH_PULSE_BASE, SEARCH_PULSE_FREQ,
    D3_CHARGE_STRENGTH, D3_LINK_DISTANCE, D3_LINK_STRENGTH,
    D3_COLLISION_BASE_RADIUS, D3_COLLISION_RADIUS_PER_VAL, D3_COLLISION_STRENGTH, D3_COLLISION_ITERATIONS,
} from './constants.js';

import ForceGraph from 'force-graph';
import * as d3 from 'd3';
import { filterGraph, computeNodeDegrees } from './graph.js';

/**
 * Computes the display label for a node based on the current label mode.
 * @param {Object} node
 * @returns {string}
 */
function getNodeLabel(node) {
    switch (settings.nodeLabelMode) {
        case 'type':
            return node.type || node.id;
        case 'id':
            return String(node.id);
        case 'expression':
            try {
                const fn = new Function('node', `with(node){return String(${settings.nodeLabelExpression})}`);
                return fn(node);
            } catch {
                return `<expr error>`;
            }
        default: {
            const name = node.properties && (node.properties.name || node.properties.label);
            return name ? name : (node.type ? `${node.type} ${node.id}` : node.id);
        }
    }
}

/**
 * Computes the display size value for a node based on the current sizing mode.
 * @param {Object} node
 * @param {number} degree
 * @returns {number}
 */
function getNodeVal(node, degree) {
    switch (settings.nodeSizingMode) {
        case 'constant':
            return settings.nodeSizingConstant;
        case 'expression':
            try {
                const fn = new Function('node', 'degree', `with(node){return (${settings.nodeSizingExpression})}`);
                const val = fn(node, degree) || 1;
                return Math.min(val, MAX_NODE_VAL);
            } catch {
                return 1;
            }
        default:
            return Math.sqrt(Math.max(1, degree));
    }
}

/**
 * @typedef {Object} RgbaColor
 * @property {number} r
 * @property {number} g
 * @property {number} b
 * @property {number} a
 */

const fontFamily = 'Ubuntu';

/** Color scale for search match scores: best match (0) → red, worst (1) → yellow. */
const searchMatchColorScale = new ColorScale([
    [SEARCH_COLOR_BEST, 0],
    [SEARCH_COLOR_MID, 0.5],
    [SEARCH_COLOR_WORST, 1],
]);

/**
 * Computes a normalized color map for a set of search matches using a log
 * transform of the Fuse.js scores.  Fuse scores are tiny (near 0 = best),
 * so −log₁₀(score) spreads differences that linear mapping would hide.
 *
 * @param {Map<string, import('./search.js').Match>} matchesMap
 * @returns {Map<string, string>} nodeId → CSS color
 */
export function computeMatchColors(matchesMap) {
    const colors = new Map();
    if (!matchesMap || matchesMap.size === 0) return colors;

    const logScores = [];

    for (const [nodeId, match] of matchesMap) {
        // −log₁₀: higher value = better match
        logScores.push({ nodeId, logScore: -Math.log10(match.score + SCORE_EPSILON) });
    }

    let minLog = Infinity;
    let maxLog = -Infinity;
    for (const { logScore } of logScores) {
        if (logScore < minLog) minLog = logScore;
        if (logScore > maxLog) maxLog = logScore;
    }

    for (const { nodeId, logScore } of logScores) {
        // normalize so best match → 0, worst → 1
        const t = maxLog === minLog ? 0 : (maxLog - logScore) / (maxLog - minLog);
        colors.set(nodeId, searchMatchColorScale.getColor(t));
    }

    return colors;
}

/**
 * Converts an RGBA color struct to a CSS rgba() string.
 * @param {RgbaColor} color
 * @returns {string}
 */
function toCssColor({ r, g, b, a }) {
    return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
}

/**
 * Returns the CSS color for a node based on its type.
 * @param {{ type: string }} node
 * @returns {string}
 */
function nodeColorFor(node) {
    return toCssColor(getNodeColor(node.type));
}

/**
 * Returns the CSS color for an edge based on its type.
 * @param {{ type: string }} edge
 * @returns {string}
 */
function edgeColorFor(edge) {
    return toCssColor(getEdgeColor(edge.type));
}

/**
 * Returns the width for an edge based on its type.
 * @param {{ type: string }} edge
 * @returns {number}
 */
function edgeWidthFor(edge) {
    return getEdgeWidth(edge.type);
}

/**
 * Returns the source node ID of a force-graph link (handles both resolved and unresolved forms).
 * @param {Object} link
 * @returns {string}
 */
function linkSourceId(link) {
    return (typeof link.source === 'object') ? link.source.id : link.source;
}

/**
 * Returns the target node ID of a force-graph link (handles both resolved and unresolved forms).
 * @param {Object} link
 * @returns {string}
 */
function linkTargetId(link) {
    return (typeof link.target === 'object') ? link.target.id : link.target;
}

/**
 * Returns a CSS color string with the given alpha.
 * @param {string} color - CSS color string.
 * @param {number} alpha - Opacity value (0–1).
 * @returns {string}
 */
function colorWithAlpha(color, alpha) {
    const col = d3.color(color);
    col.opacity = alpha;
    return col.toString();
}

/**
 * Multiplies the opacity of a CSS color by a factor.
 * @param {string} color - CSS color string.
 * @param {number} factor - Multiplier applied to the existing opacity.
 * @returns {string}
 */
function colorAdjustAlpha(color, factor) {
    const col = d3.color(color);
    col.opacity *= factor;
    return col.toString();
}

/**
 * Returns a darker variant of the given CSS color.
 * @param {string} color
 * @returns {Object} d3 color — darker variant.
 */
function darkerColor(color) {
    return d3.color(color).darker();
}

/**
 * Draws a circle outline on a canvas context.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} r
 * @param {number} strokeWidth
 * @param {string} strokeStyle
 */
function drawCircle(ctx, x, y, r, strokeWidth, strokeStyle) {
    ctx.save();
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = strokeStyle;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI, false);
    ctx.stroke();
    ctx.restore();
}

/**
 * Draws a dashed circle outline on a canvas context with equally spaced dashes.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} r
 * @param {number} strokeWidth
 * @param {string} strokeStyle
* @param {number[]} dashSegments - Array of numbers specifying the lengths of dashes and gaps (e.g. [4, 4] for equal dashes and gaps).
 * @param {number} [angle=0] - Rotation angle in radians
 */
function drawDashedCircle(ctx, x, y, r, strokeWidth, strokeStyle, dashSegments, angle = 0) {
    ctx.save();
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = strokeStyle;

    // Set dash pattern with equal dash and gap lengths for even spacing
    ctx.setLineDash(dashSegments);

    // Move to center and rotate
    ctx.translate(x, y);
    ctx.rotate(angle);

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, 2 * Math.PI, false);
    ctx.stroke();

    ctx.restore();
}

/**
 * Draws plain text on a canvas context.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {number} fontSize
 * @param {string} fillStyle
 * @param {CanvasTextBaseline} [textBaseline='middle']
 * @param {CanvasTextAlign} [textAlign='left']
 */
function drawText(ctx, text, x, y, fontSize, fillStyle, textBaseline = 'middle', textAlign = 'left') {
    ctx.save();
    ctx.font = `${fontSize}px ${fontFamily}, sans-serif`;
    ctx.textAlign = textAlign;
    ctx.textBaseline = textBaseline;

    ctx.fillStyle = fillStyle;

    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], x, y + i * fontSize * 1.2);
    }

    ctx.restore();
}

/**
 * Draws text with a stroke outline on a canvas context.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {number} fontSize
 * @param {string} fillStyle
 * @param {string} strokeStyle
 * @param {number} strokeWidth
 * @param {CanvasTextBaseline} [textBaseline='middle']
 * @param {CanvasTextAlign} [textAlign='center']
 */
function drawTextWithStroke(ctx, text, x, y, fontSize, fillStyle, strokeStyle, strokeWidth, textBaseline = 'middle', textAlign = 'center') {
    ctx.save();
    ctx.font = `${fontSize}px ${fontFamily}, sans-serif`;

    ctx.textAlign = textAlign;
    ctx.textBaseline = textBaseline;

    // outline
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = strokeStyle;
    ctx.strokeText(text, x, y);

    // fill
    ctx.fillStyle = fillStyle;
    ctx.fillText(text, x, y);

    ctx.restore();
}

/** @param {Object} node */
export function pinNode(node) {
    node.fx = node.x;
    node.fy = node.y;
}

/** @param {Object} node */
export function unpinNode(node) {
    node.fx = undefined;
    node.fy = undefined;
}

/** @param {Object} node */
export function isNodePinned(node) {
    return node.fx !== undefined || node.fy !== undefined;
}

export const ForceGraphInstance = ForceGraph()(document.getElementById('graph'))
    .nodeId('id')
    .graphData({ nodes: [], links: [] })
    .nodeLabel(n => {
        const label = getNodeLabel(n);
        return label + (n.type ? `\n(${n.type})` : '');
    })
    .linkCurvature(l => l.curvature || 0)
    .linkWidth(l => edgeWidthFor(l))
    .linkColor(l => {
        let fillStyle = edgeColorFor(l);
        let alphaMultiplier = 1.0;

        // decrease opacity by default if in search mode to make matches stand out mode
        if (!state.highlight && state.search) {
            alphaMultiplier = SEARCH_NOT_MATCHING_OPACITY;
        }

        if (state.highlight) {
            alphaMultiplier = highlightAlphaMultipliers[highlightAlphaMultipliers.length - 1];
            const edgeDistance = state.highlight.edgeDistancesMap.get(l.id);

            if (edgeDistance < highlightAlphaMultipliers.length - 1) {
                alphaMultiplier = highlightAlphaMultipliers[edgeDistance];
            }

            fillStyle = colorAdjustAlpha(fillStyle, alphaMultiplier);
        }

        return fillStyle;
    })
    .linkLabel(l => {
        return l.properties.label || l.type;
    })
    .linkDirectionalParticleColor(l => {
        return edgeColorFor(l);
    })
    .linkDirectionalParticles(0)
    .linkDirectionalArrowLength(link => {
        if (link.properties && link.properties.directional === false) {
            return 0;
        }
        return 6 * edgeWidthFor(link);
    })
    .linkDirectionalArrowRelPos(0.55)
    .linkLineDash(link => {
        if (link.properties && link.properties.dashed === true) {
            return [4, 4];
        }
        return null;
    })
    .nodeRelSize(6)
    // custom canvas drawing: keep node size constant on zoom and draw labels scaled nicely
    .nodeCanvasObject((node, ctx, globalScale) => {
        const r = nodeRadius(node);

        // scale up selection/search indicators when zoomed out (up to 3x)
        const zoomBoost = Math.min(MAX_ZOOM_BOOST, Math.max(1, 1 / globalScale));

        let alphaMultiplier = 1.0;

        // decrease opacity by default if in search mode to make matches stand out mode
        if (!state.highlight && state.search && !state.search.matchesMap.has(node.id)) {
            alphaMultiplier = SEARCH_NOT_MATCHING_OPACITY;
        }

        if (state.highlight) {
            alphaMultiplier = highlightAlphaMultipliers[highlightAlphaMultipliers.length - 1];
            const nodeDistance = state.highlight.nodeDistancesMap.get(node.id);

            if (nodeDistance < highlightAlphaMultipliers.length - 1) {
                alphaMultiplier = highlightAlphaMultipliers[nodeDistance];
            }
        }

        let fillStyle = colorAdjustAlpha(nodeColorFor(node), alphaMultiplier);

        // draw the node as filled circle
        ctx.beginPath();
        ctx.fillStyle = fillStyle;
        ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
        ctx.fill();

        // bit darker outline
        ctx.beginPath();
        ctx.strokeWidth = 1;
        ctx.strokeStyle = darkerColor(fillStyle);
        ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
        ctx.stroke();

        // in case of adjacency filter mode show hidden count as visual hint
        if (state.adjacencyFilter && state.adjacencyFilter.hiddenCounts.get(node.id, 0)) {
            const hiddenCount = state.adjacencyFilter.hiddenCounts.get(node.id, 0);
            drawTextWithStroke(
                ctx, `+${hiddenCount}`, node.x + r, node.y - r, 9,
                colorAdjustAlpha('rgba(17, 214, 27, 0.9)', alphaMultiplier),
                colorAdjustAlpha('rgba(8, 168, 8, 0.91)', alphaMultiplier),
                0.3, 'baseline', 'left',
            );
        }

        // draw outline for locked (pinned) nodes
        const locked = isNodePinned(node);
        if (locked) {
            // stroke width should scale inversely with zoom so it remains visible
            //const strokeWidth = Math.max(1.2, 2 / globalScale);

            drawCircle(ctx, node.x, node.y, r + 1, 2, colorAdjustAlpha('rgba(0,0,0,0.95)', alphaMultiplier));
            drawCircle(ctx, node.x, node.y, r, 1, colorAdjustAlpha('rgba(255,255,255,0.8)', alphaMultiplier));
        }

        // draw red outline for selected nodes
        if (state.selection.selectedNodeIds.has(node.id)) {
            const rotation = (Date.now() / 1000) % (2 * Math.PI);
            drawDashedCircle(ctx, node.x, node.y, r + 2 * zoomBoost, 2 * zoomBoost, colorAdjustAlpha('rgba(255,0,0,1.0)', alphaMultiplier), [3 * zoomBoost, 2 * zoomBoost], rotation);
        }

        // show search matches via color-coded pulsing outline
        if (state.search && state.search.matchesMap.has(node.id)) {
            const matchColor = state.search.matchColorsMap.get(node.id) || SEARCH_COLOR_BEST;
            const pulse = 2 * Math.sin((Date.now() / 1000) * 2 * Math.PI * SEARCH_PULSE_FREQ);
            drawCircle(ctx, node.x, node.y, r + (SEARCH_PULSE_BASE + pulse) * zoomBoost, 3 * zoomBoost, matchColor);
        }

        // generic label based on current label mode
        const label = getNodeLabel(node);

        //const fontSize = Math.max(3, 12 / globalScale);
        drawText(ctx, label, node.x + r + NODE_LABEL_OFFSET, node.y, NODE_LABEL_FONT_SIZE, colorAdjustAlpha('rgba(0,0,0,0.75)', alphaMultiplier));
    })
    // pointer area for interactions (keeps it reasonably large for hit testing)
    .nodePointerAreaPaint((node, color, ctx) => {
        const r = nodePointerRadius(node);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
        ctx.fill();
    })
    .onNodeClick((node, event) => {
        if (state.currentTool === 'pointer') {
            if (event && event.altKey) {
                unpinNode(node);
            }
        }
        emit(EVT_NODE_CLICKED, { data: node, shiftKey: event?.shiftKey ?? false });
    })
    .onLinkClick((link, event) => {
        emit(EVT_LINK_CLICKED, { data: link, shiftKey: event?.shiftKey ?? false });
    })
    .onNodeDrag(node => {
        // keep node pinned while dragging
        pinNode(node);
    })
    .onNodeDragEnd(node => {
        // fix node in place after drag
        pinNode(node);
    })
    .onNodeHover((node, prevNode) => {
        if (node != null) {
            const graph = getGraph();

            const { nodeDistancesMap, edgeDistancesMap } = bfs(graph, node.id, 2);

            setHighlight({
                nodeDistancesMap,
                edgeDistancesMap
            })
        } else {
            setHighlight(null);
        }
    })
    .onNodeRightClick((node, event) => {
        event.preventDefault();
        const items = [];

        if (isNodePinned(node)) {
            items.push({
                label: 'Unpin',
                action: () => unpinNode(node)
            });
        } else {
            items.push({
                label: 'Pin',
                action: () => pinNode(node)
            });
        }

        items.push({ divider: true });

        items.push({
            label: 'Show adjacent only',
            action: () => {
                updateAdjacencyFilter(node.id, false);
                refreshGraphUI();
            }
        });

        if (state.adjacencyFilter) {
            items.push({
                label: 'Show adjacent (extend)',
                action: () => {
                    updateAdjacencyFilter(node.id, true);
                    refreshGraphUI();
                }
            });

            items.push({
                label: 'Reset adjacency filter',
                action: () => {
                    updateAdjacencyFilter(null);
                    refreshGraphUI();
                }
            });
        }

        showContextMenu(event.clientX, event.clientY, items);
    })
    .onBackgroundRightClick((event) => {
        event.preventDefault();
        if (state.adjacencyFilter) {
            showContextMenu(event.clientX, event.clientY, [{
                label: 'Reset adjacency filter',
                action: () => {
                    setAdjacencyFilter(null);
                    refreshGraphUI();
                }
            }]);
        }
    })
    .onBackgroundClick(() => {
        if (state.currentTool === 'pointer') {
        emit(EVT_BACKGROUND_CLICK, null);
        } else if (state.currentTool === 'rect-select') {
            // TODO: is this even reachable?
            // Clear selection on background click
            state.selection.selectedNodeIds.clear();
            // updateSelectionInfo();
        }
    })
    .autoPauseRedraw(false)
    .onRenderFramePre((ctx, globalScale) => {
        if (!settings.showGrid) return;

        // figure out visible area in graph coordinates
        const topLeft = ForceGraphInstance.screen2GraphCoords(0, 0);
        const bottomRight = ForceGraphInstance.screen2GraphCoords(ctx.canvas.width, ctx.canvas.height);

        const spacing = GRID_SPACING;
        const halfSmall = GRID_CROSS_HALF;
        const halfBig = GRID_CENTER_CROSS_HALF;
        const lw = 1 / globalScale;

        // snap visible range to grid
        const xMin = Math.floor(topLeft.x / spacing) * spacing;
        const xMax = Math.ceil(bottomRight.x / spacing) * spacing;
        const yMin = Math.floor(topLeft.y / spacing) * spacing;
        const yMax = Math.ceil(bottomRight.y / spacing) * spacing;

        const xCount = (xMax - xMin) / spacing;
        const yCount = (yMax - yMin) / spacing;
        const drawGrid = xCount <= MAX_CROSSES_PER_AXIS && yCount <= MAX_CROSSES_PER_AXIS;

        ctx.save();
        ctx.lineWidth = lw;

        // draw regular grid crosses (skip if zoomed out too far)
        if (drawGrid) {

            // in highlight more make it less prominent
            if (!state.highlight) {
                ctx.strokeStyle = GRID_LINE_COLOR
            } else {
                ctx.strokeStyle = GRID_LINE_COLOR_UNSTRESSED;
            }

            ctx.beginPath();
            for (let gx = xMin; gx <= xMax; gx += spacing) {
                for (let gy = yMin; gy <= yMax; gy += spacing) {
                    if (gx === 0 && gy === 0) continue; // skip center
                    ctx.moveTo(gx - halfSmall, gy);
                    ctx.lineTo(gx + halfSmall, gy);
                    ctx.moveTo(gx, gy - halfSmall);
                    ctx.lineTo(gx, gy + halfSmall);
                }
            }
            ctx.stroke();
        }

        // draw center cross — bigger and more prominent than rest of the grid
        if (!state.highlight) {
            ctx.strokeStyle = GRID_CENTER_COLOR;
        }
        else {
            ctx.strokeStyle = GRID_CENTER_COLOR_UNSTRESSED;
        }

        ctx.lineWidth = lw * 1.5;
        ctx.beginPath();
        ctx.moveTo(-halfBig, 0);
        ctx.lineTo(halfBig, 0);
        ctx.moveTo(0, -halfBig);
        ctx.lineTo(0, halfBig);
        ctx.stroke();

        ctx.restore();
    })
    // tune d3 forces to reduce overlaps
    .d3Force('charge', d3.forceManyBody().strength(D3_CHARGE_STRENGTH))
    .d3Force('link', d3.forceLink().distance(D3_LINK_DISTANCE).strength(D3_LINK_STRENGTH))
    .d3Force('collision', d3.forceCollide().radius(d => D3_COLLISION_BASE_RADIUS + (d.val || 1) * D3_COLLISION_RADIUS_PER_VAL).strength(D3_COLLISION_STRENGTH).iterations(D3_COLLISION_ITERATIONS))
    .d3Force('forceX', d3.forceX())
    .d3Force('forceY', d3.forceY());


/**
 * Updates or resets the adjacency filter to show only the given node and its
 * direct neighbours.
 * @param {string | null} nodeId - Centre node, or `null` to clear the filter.
 * @param {boolean} [extendExisting=false] - When true, extends the current filter
 *   rather than replacing it.
 */
function updateAdjacencyFilter(nodeId, extendExisting = false) {
    const graph = getGraph();

    if (nodeId !== null) {
        const nodeIds = new Set([nodeId]);

        const edges = graph.getAdjacentEdges(nodeId);;

        for (const edge of edges) {
            const adjacentNodeId = edge.source_id === nodeId ? edge.target_id : edge.source_id;
            nodeIds.add(adjacentNodeId);
        }

        if (!extendExisting) {
            setAdjacencyFilter({
                visibleNodeIds: nodeIds,
                hiddenCounts: new Map(),
            });
        } else {
            for (const nodeId of nodeIds) {
                state.adjacencyFilter.visibleNodeIds.add(nodeId);
            }
        }

        // TODO: these counters should work on ALREADY filtered graph; this will require proper
        // graph filtering pipeline with layered filters:
        //      raw graph -> deleted nodes filter -> node/edge filters -> adjacency filters)
        // with counts reflecting hidden by the adjacency filters specifically

        // iterate adjacency visible nodes and evaluate if there are nodes that are hidden
        // due to adjacency filtering in its neighborhood
        const hiddenCounts = new Map();
        for (const nodeId of state.adjacencyFilter.visibleNodeIds) {
            const adjacencyHiddenNodesIds = new Set();
            for (const edge of graph.getAdjacentEdges(nodeId)) {
                const adjacentNodeId = edge.source_id === nodeId ? edge.target_id : edge.source_id;
                if (!state.adjacencyFilter.visibleNodeIds.has(adjacentNodeId)) {
                    adjacencyHiddenNodesIds.add(adjacentNodeId);
                }
            }
            hiddenCounts.set(nodeId, adjacencyHiddenNodesIds.size);
        }
        state.adjacencyFilter.hiddenCounts = hiddenCounts;
    } else {
        // reset the filter
        setAdjacencyFilter(null);
    }
}


/**
 * Re-processes the current graph through all active filters and updates the
 * force-graph visualisation.
 * @returns {Promise<void>}
 */
export async function refreshGraphUI() {
    // apply type filters
    const graph = filterGraph(
        getGraph(),
        node => settings.nodeFilters[node.type] !== false,
        edge => settings.edgeFilters[edge.type] !== false,
    )

    let nodes = graph.getNodes().map(n => ({ ...n }));
    let edges = graph.getEdges().map(e => ({ ...e }));

    // apply adjacency filters (show only the center node and its direct neighbors)
    if (state.adjacencyFilter) {
        const visible = state.adjacencyFilter.visibleNodeIds;
        nodes = nodes.filter(n => visible.has(n.id));
        edges = edges.filter(e => visible.has(e.source_id) && visible.has(e.target_id));
    }

    // optionally filter out isolated nodes
    if (!settings.showIsolated) {
        const connected = new Set();
        edges.forEach(l => {
            connected.add(l.source_id);
            connected.add(l.target_id);
        });
        nodes = nodes.filter(n => connected.has(n.id));
    }

    // size the nodes based on the current sizing mode
    const nodeDegreesMap = computeNodeDegrees(graph);
    nodes.forEach(n => {
        const degree = nodeDegreesMap.get(n.id) || 0;
        n.val = getNodeVal(n, degree);
    });

    mergeGraphDataIntoForceGraph(nodes, edges);
}

/**
 * Merges new processed graph data into the force-graph instance, reusing
 * existing node/link objects for smoother updates.
 * @param {GraphNode[]} nodes
 * @param {GraphEdge[]} edges
 */
function mergeGraphDataIntoForceGraph(nodes, edges) {
    console.log('updating graph data:', nodes.length, 'nodes,', edges.length, 'links');

    // merge new data with existing nodes for smoother updates.
    const current = ForceGraphInstance.graphData() || { nodes: [], links: [] };

    // index existing nodes & links
    const existingNodesById = new Map((current.nodes || []).map(n => [n.id, n]));
    const existingLinksById = new Map((current.links || []).map(l => [l.id, l]));

    // build merged node list reusing objects when possible
    const mergedNodes = [];
    const mergedLinks = [];

    nodes.forEach(node => {
        node.kind = 'node';

        const existing = existingNodesById.get(node.id);
        if (existing) {
            Object.assign(existing, node);
            mergedNodes.push(existing);
        } else {
            mergedNodes.push(node);
        }
    });

    edges.forEach(edge => {
        edge.kind = 'edge';

        // update the format of source/target references
        edge.source = edge.source_id;
        edge.target = edge.target_id;

        const key = edge.id;
        const existing = existingLinksById.get(key);
        if (existing) {
            // NOTE: in existing data source/targets are objects, while in the
            //  new data they are IDs, so we cannot do full Object.assign here;
            existing.properties = edge.properties;
            mergedLinks.push(existing);
        } else {
            mergedLinks.push(edge);
        }
    });

    ForceGraphInstance.graphData({ nodes: mergedNodes, links: mergedLinks });

    autoAdjustCurvature();
}

/**
 * Distributes curvature values for links that share the same pair of nodes so
 * that parallel edges fan out symmetrically.
 */
export function autoAdjustCurvature() {
    // (key for pair of nodes) -> links between them (graph wrapped objects)
    let sameNodesLinks = new Map();
    let seenLinks = new Set();

    const links = ForceGraphInstance.graphData().links;

    links.forEach(l => {
        // FIXME: why do we have these duplicates?
        if (seenLinks.has(l.id)) {
            return;
        }
        seenLinks.add(l.id);

        let pairKey = linkSourceId(l) < linkTargetId(l) ? `${linkSourceId(l)}::${linkTargetId(l)}` : `${linkTargetId(l)}::${linkSourceId(l)}`;

        if (!sameNodesLinks.has(pairKey)) {
            sameNodesLinks.set(pairKey, []);
        }
        sameNodesLinks.get(pairKey).push(l)
    })


    // update curvature for multiple links between same nodes
    for (const links of sameNodesLinks.values()) {
        if (links.length <= 1) {
            links.forEach(l => l.curvature = 0);
            continue;
        }

        const n = links.length;
        const maxCurvature = Math.min(1, settings.curvatureStep * n);
        const intervalSize = maxCurvature * 2;
        const intervalStep = intervalSize / (n - 1);

        // NOTE: we need to pick some "canonical" link direction to handle
        // links in different directions properly
        for (let idx = 0; idx < n; idx++) {
            links[idx].curvature = -maxCurvature + idx * intervalStep;
            if (linkSourceId(links[idx]) != linkSourceId(links[0])) {
                links[idx].curvature *= -1;
            }
        }
    }
}

/**
 * Applies the current d3 simulation parameters from `settings` to the
 * force-graph instance.
 */
export function applyD3Params() {
    const chargeForce = ForceGraphInstance.d3Force('charge');
    if (chargeForce && typeof chargeForce.strength === 'function') chargeForce.strength(settings.d3Charge);

    const linkForce = ForceGraphInstance.d3Force('link');
    if (linkForce) {
        if (typeof linkForce.distance === 'function') linkForce.distance(settings.d3LinkDistance);
        if (typeof linkForce.strength === 'function') linkForce.strength(settings.d3LinkStrength);
    }

    const forceX = ForceGraphInstance.d3Force('forceX');
    const forceY = ForceGraphInstance.d3Force('forceY');

    forceX.strength(settings.d3ForceXYStrength);
    forceY.strength(settings.d3ForceXYStrength);

    if (settings.d3CenterForce) {
        const centerForce = d3.forceCenter();
        ForceGraphInstance.d3Force('center', centerForce);
    } else {
        ForceGraphInstance.d3Force('center', null);
    }

    const collisionForce = ForceGraphInstance.d3Force('collision');
    if (collisionForce && typeof collisionForce.radius === 'function') {
        collisionForce.radius(d => (D3_COLLISION_BASE_RADIUS + (d.val || 1) * D3_COLLISION_RADIUS_PER_VAL) * settings.d3CollisionMultiplier);
    }

    // velocityDecay and alpha target
    if (typeof ForceGraphInstance.d3VelocityDecay === 'function') ForceGraphInstance.d3VelocityDecay(settings.d3VelocityDecay);
    if (typeof ForceGraphInstance.d3AlphaTarget === 'function') ForceGraphInstance.d3AlphaTarget(settings.d3AlphaTarget);

    // tiny reheat so changes take effect visibly
    if (typeof ForceGraphInstance.d3Alpha === 'function') {
        ForceGraphInstance.d3Alpha(REHEAT_ALPHA);
        setTimeout(() => { if (typeof ForceGraphInstance.d3AlphaTarget === 'function') ForceGraphInstance.d3AlphaTarget(0); }, REHEAT_TIMEOUT_MS);
    }
}
