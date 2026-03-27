import { state } from './state.js';
import { on, emit } from './event-bus.js';
import { bfs } from './graph-algs.js';
import { getGraph } from './state.js';
import { settings, highlightAlphaMultipliers, getDefaultNodeColor, getDefaultEdgeColor } from './settings.js'
import { showContextMenu } from './context-menu.js';

import ForceGraph from "https://cdn.jsdelivr.net/npm/force-graph/+esm";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@6/+esm";

const fontFamily = 'Ubuntu';

// setup event handlers
on("graph-ui-links-curvature-updated", autoAdjustCurvature);
on("d3-simulation-parameters-changed", applyD3Params);

const searchNotMatchingBaseOpacity = 0.5;

function toCssColor({ r, g, b, a }) {
    return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
}

function nodeColorFor(node) {
    let colorStruct = getDefaultNodeColor(node.type);

    if (node.type in settings.nodeColors) {
        colorStruct = settings.nodeColors[node.type]
    }

    return toCssColor(colorStruct);
}

function edgeColorFor(edge) {
    let colorStruct = getDefaultEdgeColor(edge.type);

    if (edge.type in settings.edgeColors) {
        colorStruct = settings.edgeColors[edge.type];
    }

    return toCssColor(colorStruct);
}

// NOTE: sometimes source/target are not resolved if graph engine not run yet
// this method will work for both cases (resolved will have link.source as object)
function linkSourceId(link) {
    return (typeof link.source === 'object') ? link.source.id : link.source;
}

function linkTargetId(link) {
    return (typeof link.target === 'object') ? link.target.id : link.target;
}

function colorWithAlpha(color, alpha) {
    const col = d3.color(color);
    col.opacity = alpha;
    return col.toString();
}

function colorAdjustAlpha(color, factor) {
    const col = d3.color(color);
    col.opacity *= factor;
    return col.toString();
}

function darkerColor(color) {
    return d3.color(color).darker();
}

function drawCircle(ctx, x, y, r, strokeWidth, strokeStyle) {
    ctx.save();
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = strokeStyle;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI, false);
    ctx.stroke();
    ctx.restore();
}

function drawText(ctx, text, x, y, fontSize, fillStyle, textBaseline = 'middle', textAlign = 'left') {
    ctx.save();
    ctx.font = `${fontSize}px ${fontFamily}, sans-serif`;
    ctx.textAlign = textAlign;
    ctx.textBaseline = textBaseline;

    ctx.fillStyle = fillStyle;
    ctx.fillText(text, x, y);
    ctx.restore();
}

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

export const ForceGraphInstance = ForceGraph()(document.getElementById('graph'))
    .nodeId('id')
    .graphData({ nodes: [], links: [] })
    .nodeLabel(n => {
        const name = n.properties && (n.properties.name || n.properties.label);
        const label = name ? name : (n.type ? `${n.type} ${n.id}` : n.id);
        return label + (n.type ? `\n(${n.type})` : '');
    })
    .linkCurvature(l => l.curvature || 0)
    .linkColor(l => {
        let fillStyle = edgeColorFor(l);
        let alphaMultiplier = 1.0;

        // decrease opacity by default if in search mode to make matches stand out mode
        if (!state.highlight && state.search) {
            alphaMultiplier = searchNotMatchingBaseOpacity;
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
        return 6;
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
        const baseSize = Math.max(4, (node.val || 1) * 3);
        //const r = Math.max(3, baseSize / globalScale); // keep circle size roughly constant on screen
        const r = baseSize;

        let alphaMultiplier = 1.0;

        // decrease opacity by default if in search mode to make matches stand out mode
        if (!state.highlight && state.search && !state.search.matchesMap.has(node.id)) {
            alphaMultiplier = searchNotMatchingBaseOpacity;
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
        const locked = (node.fx !== undefined || node.fy !== undefined);
        if (locked) {
            // stroke width should scale inversely with zoom so it remains visible
            //const strokeWidth = Math.max(1.2, 2 / globalScale);

            drawCircle(ctx, node.x, node.y, r + 1, 2, colorAdjustAlpha('rgba(0,0,0,0.95)', alphaMultiplier));
            drawCircle(ctx, node.x, node.y, r, 1, colorAdjustAlpha('rgba(255,255,255,0.8)', alphaMultiplier));
        }

        // draw red outline for selected nodes
        if (state.selection.selectedNodeIds.has(node.id)) {
            drawCircle(ctx, node.x, node.y, r + 2, 2, colorAdjustAlpha('rgba(255,0,0,1.0)', alphaMultiplier));
        }

        // show search matches via pulsing outline
        // TODO: use color scale to show match score (log scale)
        if (state.search && state.search.matchesMap.has(node.id)) {
            const pulse = 2 * Math.sin((Date.now() / 1000) * 2 * Math.PI * 2);
            drawCircle(ctx, node.x, node.y, r + 5 + pulse, 3, 'rgba(255,0,0,1.0)');
        }

        // generic label (use properties.name/label if available, otherwise type + id)
        const name = node.properties && (node.properties.name || node.properties.label);
        const label = name ? name : (node.type ? `${node.type} ${node.id}` : node.id);

        //const fontSize = Math.max(3, 12 / globalScale);
        drawText(ctx, label, node.x + r + 4, node.y, 12, colorAdjustAlpha('rgba(0,0,0,0.75)', alphaMultiplier));
    })
    // pointer area for interactions (keeps it reasonably large for hit testing)
    .nodePointerAreaPaint((node, color, ctx) => {
        const r = Math.max(8, (node.val || 1) * 3);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
        ctx.fill();
    })
    .onNodeClick((node, event) => {
        if (state.currentTool === 'pointer') {
            if (event && (event.shiftKey || event.altKey)) {
                node.fx = undefined;
                node.fy = undefined;
            }
        }
        emit("node-clicked", node);
    })
    .onLinkClick((link, event) => {
        emit("link-clicked", link);
    })
    .onNodeDrag(node => {
        // keep node pinned while dragging
        node.fx = node.x;
        node.fy = node.y;
    })
    .onNodeDragEnd(node => {
        // fix node in place after drag
        node.fx = node.x;
        node.fy = node.y;
    })
    .onNodeHover((node, prevNode) => {
        if (node != null) {
            const graph = getGraph();

            const { nodeDistancesMap, edgeDistancesMap } = bfs(graph, node.id, 2);

            state.highlight = {
                nodeDistancesMap,
                edgeDistancesMap
            }

            console.log(state.highlight);
        } else {
            state.highlight = null;
        }
    })
    .onNodeRightClick((node, event) => {
        event.preventDefault();
        const items = [];

        items.push({
            label: 'Show adjacent only',
            action: () => {
                updateAdjacenyFilter(node.id, false);
                refreshGraphUI();
            }
        });

        if (state.adjacencyFilter) {
            items.push({
                label: 'Show adjacent (extend)',
                action: () => {
                    updateAdjacenyFilter(node.id, true);
                    refreshGraphUI();
                }
            });

            items.push({
                label: 'Reset adjacency filter',
                action: () => {
                    updateAdjacenyFilter(null);
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
                    state.adjacencyFilter = null;
                    refreshGraphUI();
                }
            }]);
        }
    })
    .onBackgroundClick(() => {
        if (state.currentTool === 'pointer') {
            emit('background-click', null);
        } else if (state.currentTool === 'rect-select') {
            // TODO: is this even reachable?
            // Clear selection on background click
            state.selection.selectedNodeIds.clear();
            // updateSelectionInfo();
        }
    })
    .autoPauseRedraw(false)
    // tune d3 forces to reduce overlaps
    .d3Force('charge', d3.forceManyBody().strength(-450))
    .d3Force('link', d3.forceLink().distance(140).strength(0.8))
    .d3Force('collision', d3.forceCollide().radius(d => 18 + (d.val || 1) * 6).strength(1).iterations(4))
    .d3Force('forceX', d3.forceX())
    .d3Force('forceY', d3.forceY());


function updateAdjacenyFilter(nodeId, extendExisting = false) {
    const graph = getGraph();

    if (nodeId !== null )
    {
        const nodeIds = new Set([nodeId]);

        const edges = graph.getAdjacentEdges(nodeId);;

        for (const edge of edges) {
            const adjacentNodeId = edge.source_id === nodeId ? edge.target_id : edge.source_id;
            nodeIds.add(adjacentNodeId);
        }

        if (!extendExisting) {
            state.adjacencyFilter = {
                visibleNodeIds: nodeIds,
                hiddenCounts: new Map(),
            };
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
        state.adjacencyFilter = null;
    }
}


export async function refreshGraphUI() {
    emit('pre-graph-ui-refresh', null);

    const graph = getGraph();

    // TODO: do the graph processing using the Graph object. Start by cloning
    // existing Graph and gradually apply the filters, etc. This will allow to
    // reuse Graph alogrithms

    let processedData = { nodes: [], edges: [] };

    // transform for graph format
    for (const node of graph.getNodes()) {
        processedData.nodes.push({
            id: node.id,
            type: node.type,
            kind: "node",
            properties: node.properties || {},
        })
    }

    for (const edge of graph.getEdges()) {
        processedData.edges.push({
            id: edge.id,
            type: edge.type,
            kind: "edge",
            source: edge.source_id,
            target: edge.target_id,
            properties: edge.properties || {},
        })
    }

    // filter out excluded node types and their connected edges
    const filteredNodeIds = new Set();
    for (const [type, enabled] of Object.entries(settings.nodeFilters)) {
        if (!enabled) {
            for (const n of processedData.nodes) {
                if (n.type === type) filteredNodeIds.add(n.id);
            }
        }
    }
    if (filteredNodeIds.size > 0) {
        processedData.nodes = processedData.nodes.filter(n => !filteredNodeIds.has(n.id));
        processedData.edges = processedData.edges.filter(e => !filteredNodeIds.has(e.source) && !filteredNodeIds.has(e.target));
    }

    // filter out excluded edge types
    for (const [type, enabled] of Object.entries(settings.edgeFilters)) {
        if (!enabled) {
            processedData.edges = processedData.edges.filter(e => e.type !== type);
        }
    }

    // adjacency filter: show only the center node and its direct neighbors
    if (state.adjacencyFilter) {
        const visible = state.adjacencyFilter.visibleNodeIds;
        processedData.nodes = processedData.nodes.filter(n => visible.has(n.id));
        processedData.edges = processedData.edges.filter(e => visible.has(e.source) && visible.has(e.target));
    }

    // optionally filter out isolated nodes
    if (!settings.showIsolated) {
        const connected = new Set();
        processedData.edges.forEach(l => {
            connected.add(l.source);
            connected.add(l.target);
        });
        processedData.nodes = graph.getNodes().filter(n => connected.has(n.id));
    }

    // compute size by degree
    const deg = new Map();

    processedData.nodes.forEach(n => {
        deg.set(n.id, 0);
    });
    processedData.edges.forEach(l => {
        deg.set(l.source, (deg.get(l.source) || 0) + 1);
        deg.set(l.target, (deg.get(l.target) || 0) + 1);
    });
    processedData.nodes.forEach(n => {
        n.val = Math.sqrt(Math.max(1, (deg.get(n.id) || 0)));
    });

    mergeGraphData(processedData);
}

// merge is needed so that we do not recreate nodes/edges which already exist so that they
// are kept intact between updates
function mergeGraphData(data) {
    console.log('updating graph data:', data.nodes.length, 'nodes,', data.edges.length, 'links');

    // merge new data with existing nodes for smoother updates.
    const current = ForceGraphInstance.graphData() || { nodes: [], links: [] };

    // index existing nodes & links
    const existingNodesById = new Map((current.nodes || []).map(n => [n.id, n]));
    const existingLinksById = new Map((current.links || []).map(l => [l.id, l]));

    // build merged node list reusing objects when possible
    const mergedNodes = [];
    const mergedLinks = [];

    data.nodes.forEach(n => {
        const ex = existingNodesById.get(n.id);
        if (ex) {
            Object.assign(ex, n);
            mergedNodes.push(ex);
        } else {
            //console.log('new node', n);
            mergedNodes.push(n);
        }
    });

    data.edges.forEach(l => {
        const key = l.id;
        const existing = existingLinksById.get(key);
        if (existing) {
            // NOTE: in existing data source/targets are objects, while in the
            //  new data they are IDs, so we cannot do full Object.assign here;
            existing.properties = l.properties;
            mergedLinks.push(existing);
        } else {
            //console.log('new link', l);
            mergedLinks.push(l);
        }
    });

    ForceGraphInstance.graphData({ nodes: mergedNodes, links: mergedLinks });

    autoAdjustCurvature();
}

function autoAdjustCurvature() {
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

    // console.log(sameNodesLinks);

    // update curvature for multiple links between same nodes
    for (const [nodesKey, links] of sameNodesLinks) {
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

function applyD3Params() {
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
        collisionForce.radius(d => (18 + (d.val || 1) * 6) * settings.d3CollisionMultiplier);
    }

    // velocityDecay and alpha target
    if (typeof ForceGraphInstance.d3VelocityDecay === 'function') ForceGraphInstance.d3VelocityDecay(settings.d3VelocityDecay);
    if (typeof ForceGraphInstance.d3AlphaTarget === 'function') ForceGraphInstance.d3AlphaTarget(settings.d3AlphaTarget);

    // tiny reheat so changes take effect visibly
    if (typeof ForceGraphInstance.d3Alpha === 'function') {
        ForceGraphInstance.d3Alpha(0.25);
        setTimeout(() => { if (typeof ForceGraphInstance.d3AlphaTarget === 'function') ForceGraphInstance.d3AlphaTarget(0); }, 600);
    }
}
