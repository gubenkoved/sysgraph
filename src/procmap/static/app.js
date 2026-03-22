import { Pane } from 'https://cdn.jsdelivr.net/npm/tweakpane@4.0.5/dist/tweakpane.min.js';

const linkOpacity = 0.5;

// Tool state
let currentTool = 'pointer';
let selectedNodeIds = new Set();
let isSelecting = false;
let selectionStart = null;
let selectionEnd = null;
let selectionStartCanvas = null;
let selectionEndCanvas = null;

const defaultNodeColor = { r: 40, g: 40, b: 40, a: 1.0 };
const defaultEdgeColor = { r: 40, g: 40, b: 40, a: linkOpacity };

// alpha multipler for distances 0, 1, 2, 3 (and more)
const highlightAlphaMultipliers = [1.0, 1.0, 0.5, 0.1]

const perTypeDefaultColors = {
    nodes: {
        process: { r: 21, g: 127, b: 200, a: 1.0 },
        socket: { r: 220, g: 75, b: 47, a: 1.0 },
        pipe: { r: 169, g: 57, b: 249, a: 1.0 },
        external_ip: { r: 255, g: 103, b: 0, a: 1.0 },
    },
    edges: {
        unix_domain_socket: { r: 31, g: 120, b: 180, a: linkOpacity },
        pipe: { r: 207, g: 110, b: 255, a: linkOpacity },
        socket_connection: { r: 255, g: 76, b: 40, a: linkOpacity },
        socket: { r: 255, g: 76, b: 40, a: linkOpacity },
        child_process: { r: 40, g: 40, b: 40, a: linkOpacity },
    }
}

const settings = {
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
};

const state = {
    highlight: null,
}

const pane = new Pane({
    title: 'parameters',
});

const refreshBtn = pane.addButton({
    title: 'refresh data',
});

refreshBtn.on('click', async () => {
    data = await loadDataFromApi();
    refresh();
});

pane.addBinding(settings, 'd3Charge', { min: -800, max: 100, step: 10 }).on('change', ev => {
    applyD3Params();
});
pane.addBinding(settings, 'd3LinkDistance', { min: 40, max: 300, step: 5 }).on('change', ev => {
    applyD3Params();
});
pane.addBinding(settings, 'd3LinkStrength', { min: 0.0, max: 1.0, step: 0.01 }).on('change', ev => {
    applyD3Params();
});
pane.addBinding(settings, 'd3CollisionMultiplier', { min: 0.5, max: 2.0, step: 0.05 }).on('change', ev => {
    applyD3Params();
});
pane.addBinding(settings, 'd3AlphaTarget', { min: 0.0, max: 0.5, step: 0.01 }).on('change', ev => {
    applyD3Params();
});
pane.addBinding(settings, 'd3VelocityDecay', { min: 0.01, max: 0.99, step: 0.01 }).on('change', ev => {
    applyD3Params();
});
pane.addBinding(settings, 'd3ForceXYStrength', { min: 0.00, max: 0.99, step: 0.01 }).on('change', ev => {
    applyD3Params();
});
pane.addBinding(settings, 'd3CenterForce').on('change', ev => {
    applyD3Params();
});

pane.addBlade({ view: 'separator' });

pane.addBinding(settings, 'showIsolated').on('change', ev => {
    refresh();
});
pane.addBinding(settings, 'curvatureStep', { min: 0.0, max: 0.200, step: 0.001 }).on('change', ev => {
    autoAdjustCurvature();
});

const pinAllBtn = pane.addButton({
    title: 'pin all',
});

const unpinAllBtn = pane.addButton({
    title: 'unpin all',
});

pinAllBtn.on('click', () => {
    pinAll();
});

unpinAllBtn.on('click', () => {
    unpinAll();
});

pane.addBlade({ view: 'separator' });

const cleanBtn = pane.addButton({
    title: 'clear',
});

cleanBtn.on('click', async () => {
    data = initData();
    refresh();
});

const exportBtn = pane.addButton({
    title: 'export data',
});

const importBtn = pane.addButton({
    title: 'import data',
});

let nodeColorsFolder = pane.addFolder({
    title: "node colors",
    explanded: true,
})

let edgeColorsFolder = pane.addFolder({
    title: "edge colors",
    explanded: true,
})

function initData() {
    return {
        nodes: [],
        edges: [],
    }
}

let data = initData();

exportBtn.on('click', () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${timestamp}_graph.json`;
    a.click();
    URL.revokeObjectURL(url);
});

importBtn.on('click', () => {
    document.getElementById('importFile').click();
});

document.getElementById('importFile').addEventListener('change', async (event) => {
    const file = event.target.files[0];

    if (!file) return;

    const text = await file.text();

    // update the data
    data = JSON.parse(text);

    await refresh();

    event.target.value = '';
});

const q = sel => document.querySelector(sel);

function toCssColor({ r, g, b, a }) {
    return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
}

function nodeColorFor(node) {
    const type = node.type;
    if (type in settings.nodeColors) {
        return toCssColor(settings.nodeColors[type]);
    }
    return toCssColor(defaultNodeColor);
}

function edgeColorFor(edge) {
    const type = edge.type;
    if (type in settings.edgeColors) {
        return toCssColor(settings.edgeColors[type]);
    }
    return toCssColor(defaultEdgeColor);
}

async function loadDataFromApi() {
    const res = await fetch('/api/graph');

    if (!res.ok)
        throw new Error('Failed to fetch /api/graph: ' + res.status);

    const response = await res.json();

    const nodes = (response.nodes || []).map(n => ({
        id: n.id,
        type: n.type,
        properties: n.properties || {},
    }));

    const links = (response.edges || []).map(e => ({
        id: e.id,
        source_id: e.source_id,
        target_id: e.target_id,
        type: e.type,
        properties: e.properties || {},
    }));

    return {
        nodes: nodes,
        edges: links,
    };
}

function bfs(startNode, maxDistance) {
    const nodeDistancesMap = new Map();
    const edgeDistancesMap = new Map();

    const queue = [{ node: startNode, distance: 0 }];
    nodeDistancesMap.set(startNode.id, 0);

    // pre-compute map from node id to neighboring edges
    const edgesMap = new Map();
    Graph.graphData().links.forEach(l => {
        const srcId = l.source.id;
        const tgtId = l.target.id;
        if (!edgesMap.has(srcId)) edgesMap.set(srcId, []);
        if (!edgesMap.has(tgtId)) edgesMap.set(tgtId, []);
        edgesMap.get(srcId).push(l);
        edgesMap.get(tgtId).push(l);
    });

    while (queue.length > 0) {
        const { node, distance } = queue.shift();

        if (distance >= maxDistance)
            continue;

        const edges = edgesMap.get(node.id) || [];

        for (const edge of edges) {
            if (edgeDistancesMap.has(edge.id))
                continue;

            edgeDistancesMap.set(edge.id, distance + 1);

            const neighborNode = (edge.source.id === node.id) ? edge.target : edge.source;

            if (!nodeDistancesMap.has(neighborNode.id)) {
                nodeDistancesMap.set(neighborNode.id, distance + 1);
                queue.push({ node: neighborNode, distance: distance + 1 });
            }
        }
    }

    return {
        nodeDistancesMap: nodeDistancesMap,
        edgeDistancesMap: edgeDistancesMap,
    }
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


function drawCicle(ctx, x, y, r, strokeWidth, strokeStyle) {
    ctx.save();
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = strokeStyle;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI, false);
    ctx.stroke();
    ctx.restore();
}

// configure graph
const Graph = ForceGraph()(document.getElementById('graph'))
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

        // regular fill style
        let fillStyle = nodeColorFor(node);
        let alphaMultiplier = 1.0;

        if (state.highlight) {
            alphaMultiplier = highlightAlphaMultipliers[highlightAlphaMultipliers.length - 1];
            const nodeDistance = state.highlight.nodeDistancesMap.get(node.id);

            if (nodeDistance < highlightAlphaMultipliers.length - 1) {
                alphaMultiplier = highlightAlphaMultipliers[nodeDistance];
            }

            fillStyle = colorAdjustAlpha(fillStyle, alphaMultiplier);
        }

        // draw the node as filled circle
        ctx.beginPath();
        ctx.fillStyle = fillStyle;
        ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
        ctx.fill();

        // draw outline for locked (pinned) nodes
        const locked = (node.fx !== undefined || node.fy !== undefined);
        if (locked) {
            // stroke width should scale inversely with zoom so it remains visible
            //const strokeWidth = Math.max(1.2, 2 / globalScale);

            drawCicle(ctx, node.x, node.y, r + 1, 2, colorAdjustAlpha('rgba(0,0,0,0.95)', alphaMultiplier));
            drawCicle(ctx, node.x, node.y, r, 1, colorAdjustAlpha('rgba(255,255,255,0.8)', alphaMultiplier));
        }

        // draw red outline for selected nodes with pulsing radius
        if (selectedNodeIds.has(node.id)) {
            const pulse = 1.2 * Math.sin((Date.now() / 1000) * 2 * Math.PI * 2);
            drawCicle(ctx, node.x, node.y, r + 2 + pulse, 2, 'rgba(255,0,0,1.0)');
        }

        // generic label (use properties.name/label if available, otherwise type + id)
        const name = node.properties && (node.properties.name || node.properties.label);
        const label = name ? name : (node.type ? `${node.type} ${node.id}` : node.id);

        //const fontSize = Math.max(3, 12 / globalScale);
        const fontSize = 12;
        ctx.font = `${fontSize}px Ubuntu, sans-serif`;
        ctx.fillStyle = colorAdjustAlpha('rgba(0,0,0,0.75)', alphaMultiplier);
        ctx.fillText(label, node.x + r + 4, node.y + fontSize / 2.8);
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
        if (currentTool === 'pointer') {
            handleNodeClick(node, event);
        }
    })
    .onLinkClick((link, event) => {
        showDetails(link);
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
            const { nodeDistancesMap, edgeDistancesMap } = bfs(node, 2);

            state.highlight = {
                nodeDistancesMap,
                edgeDistancesMap
            }

            console.log(state.highlight);
        } else {
            state.highlight = null;
        }
    })
    .onBackgroundClick(() => {
        if (currentTool === 'pointer') {
            hideDetails();
        } else if (currentTool === 'rect-select') {
            // Clear selection on background click
            selectedNodeIds.clear();
            updateSelectionInfo();
        }
    })
    .autoPauseRedraw(false)
    // tune d3 forces to reduce overlaps
    .d3Force('charge', d3.forceManyBody().strength(-450))
    .d3Force('link', d3.forceLink().distance(140).strength(0.8))
    .d3Force('collision', d3.forceCollide().radius(d => 18 + (d.val || 1) * 6).strength(1).iterations(4))
    .d3Force('forceX', d3.forceX())
    .d3Force('forceY', d3.forceY());

// export to windows for easy access in devtools
window.settings = settings;
window.graph = Graph;

// Get canvas element for selection logic
const canvas = document.querySelector('#graph canvas');

// Tool switching and selection logic
function setTool(tool) {
    currentTool = tool;
    document.getElementById('toolPointer').classList.toggle('active', tool === 'pointer');
    document.getElementById('toolRectSelect').classList.toggle('active', tool === 'rect-select');

    if (tool === 'pointer') {
        selectionCanvas.style.pointerEvents = 'none';
        canvas.style.cursor = 'default';
        // Re-enable normal click handlers
        Graph.onNodeClick(handleNodeClick);
    } else if (tool === 'rect-select') {
        selectionCanvas.style.pointerEvents = 'auto';
        selectionCanvas.style.cursor = 'crosshair';
        // Disable normal node click handlers for selection tool
        Graph.onNodeClick(null);
    }
}

function handleNodeClick(node, event) {
    if (event && (event.shiftKey || event.altKey)) {
        node.fx = undefined;
        node.fy = undefined;
    } else {
        showDetails(node);
    }
}

function updateSelectionInfo() {
    const info = document.getElementById('selectionInfo');
    if (selectedNodeIds.size > 0) {
        info.textContent = `${selectedNodeIds.size} node${selectedNodeIds.size !== 1 ? 's' : ''} selected`;
    } else {
        info.textContent = '';
    }
}

function isNodeInRect(node, rect) {
    const minX = Math.min(rect.x1, rect.x2);
    const maxX = Math.max(rect.x1, rect.x2);
    const minY = Math.min(rect.y1, rect.y2);
    const maxY = Math.max(rect.y1, rect.y2);

    const r = Math.max(4, (node.val || 1) * 3);
    return node.x + r > minX && node.x - r < maxX && node.y + r > minY && node.y - r < maxY;
}

// Custom overlay for drawing selection rectangle
const selectionCanvas = document.createElement('canvas');
selectionCanvas.style.position = 'absolute';
selectionCanvas.style.top = '0';
selectionCanvas.style.left = '0';
selectionCanvas.style.cursor = 'crosshair';
selectionCanvas.style.zIndex = '50';
selectionCanvas.style.display = 'block';
selectionCanvas.style.pointerEvents = 'none';
selectionCanvas.style.background = 'transparent';
const graphContainer = document.getElementById('graph');
graphContainer.appendChild(selectionCanvas);

function resizeGraphViewport() {
    const rect = graphContainer.getBoundingClientRect();
    Graph.width(rect.width);
    Graph.height(rect.height);
    selectionCanvas.width = rect.width;
    selectionCanvas.height = rect.height;
    // Graph.d3Force('center', d3.forceCenter(rect.width / 2, rect.height / 2));
}

resizeGraphViewport();

function drawSelectionRectangle() {
    const ctx = selectionCanvas.getContext('2d');
    ctx.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);

    if (isSelecting && selectionStartCanvas && selectionEndCanvas) {
        const startX = selectionStartCanvas.x;
        const endX = selectionEndCanvas.x;
        const startY = selectionStartCanvas.y;
        const endY = selectionEndCanvas.y;

        const minX = Math.min(startX, endX);
        const maxX = Math.max(startX, endX);
        const minY = Math.min(startY, endY);
        const maxY = Math.max(startY, endY);

        ctx.fillStyle = 'rgba(33, 150, 243, 0.1)';
        ctx.fillRect(minX, minY, maxX - minX, maxY - minY);

        ctx.strokeStyle = 'rgba(33, 150, 243, 0.8)';
        ctx.lineWidth = 1;
        ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
    }
}

// Mouse event handlers
selectionCanvas.addEventListener('mousedown', (event) => {
    if (currentTool === 'rect-select') {
        const graphRect = graphContainer.getBoundingClientRect();
        const localX = event.clientX - graphRect.left;
        const localY = event.clientY - graphRect.top;
        const graphCoords = Graph.screen2GraphCoords(localX, localY);
        isSelecting = true;
        selectionStart = graphCoords;
        selectionEnd = graphCoords;
        selectionStartCanvas = { x: localX, y: localY };
        selectionEndCanvas = { x: localX, y: localY };
        drawSelectionRectangle();
    }
});

selectionCanvas.addEventListener('mousemove', (event) => {
    if (isSelecting && currentTool === 'rect-select') {
        const graphRect = graphContainer.getBoundingClientRect();
        const localX = event.clientX - graphRect.left;
        const localY = event.clientY - graphRect.top;
        const graphCoords = Graph.screen2GraphCoords(localX, localY);
        selectionEnd = graphCoords;
        selectionEndCanvas = { x: localX, y: localY };
        drawSelectionRectangle();
    }
});

selectionCanvas.addEventListener('mouseup', (event) => {
    if (isSelecting && currentTool === 'rect-select') {
        const graphRect = graphContainer.getBoundingClientRect();
        const localX = event.clientX - graphRect.left;
        const localY = event.clientY - graphRect.top;
        const graphCoords = Graph.screen2GraphCoords(localX, localY);

        selectionEnd = graphCoords;
        selectionEndCanvas = { x: localX, y: localY };
        isSelecting = false;

        // Find nodes in selection rectangle
        const rect = {
            x1: selectionStart.x,
            y1: selectionStart.y,
            x2: selectionEnd.x,
            y2: selectionEnd.y,
        };

        selectedNodeIds.clear();
        const nodes = Graph.graphData().nodes;
        nodes.forEach(node => {
            if (isNodeInRect(node, rect)) {
                selectedNodeIds.add(node.id);
            }
        });

        updateSelectionInfo();
        selectionStartCanvas = null;
        selectionEndCanvas = null;
        drawSelectionRectangle();
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', (event) => {
    if (event.key === 'p' || event.key === 'P') {
        setTool('pointer');
    } else if (event.key === 'r' || event.key === 'R') {
        setTool('rect-select');
    }
});

// Toolbar button handlers
document.getElementById('toolPointer').addEventListener('click', () => {
    setTool('pointer');
    selectedNodeIds.clear();
    updateSelectionInfo();
});

document.getElementById('toolRectSelect').addEventListener('click', () => {
    setTool('rect-select');
});

window.addEventListener('resize', () => {
    resizeGraphViewport();
});

function applyD3Params() {
    const chargeForce = Graph.d3Force('charge');
    if (chargeForce && typeof chargeForce.strength === 'function') chargeForce.strength(settings.d3Charge);

    const linkForce = Graph.d3Force('link');
    if (linkForce) {
        if (typeof linkForce.distance === 'function') linkForce.distance(settings.d3LinkDistance);
        if (typeof linkForce.strength === 'function') linkForce.strength(settings.d3LinkStrength);
    }

    const forceX = Graph.d3Force('forceX');
    const forceY = Graph.d3Force('forceY');

    forceX.strength(settings.d3ForceXYStrength);
    forceY.strength(settings.d3ForceXYStrength);

    if (settings.d3CenterForce) {
        const centerForce = d3.forceCenter();
        Graph.d3Force('center', centerForce);
    } else {
        Graph.d3Force('center', null);
    }

    const collisionForce = Graph.d3Force('collision');
    if (collisionForce && typeof collisionForce.radius === 'function') {
        collisionForce.radius(d => (18 + (d.val || 1) * 6) * settings.d3CollisionMultiplier);
    }

    // velocityDecay and alpha target
    if (typeof Graph.d3VelocityDecay === 'function') Graph.d3VelocityDecay(settings.d3VelocityDecay);
    if (typeof Graph.d3AlphaTarget === 'function') Graph.d3AlphaTarget(settings.d3AlphaTarget);

    // tiny reheat so changes take effect visibly
    if (typeof Graph.d3Alpha === 'function') {
        Graph.d3Alpha(0.25);
        setTimeout(() => { if (typeof Graph.d3AlphaTarget === 'function') Graph.d3AlphaTarget(0); }, 600);
    }
}

function showDetails(node_or_link) {
    const data = {
        id: node_or_link.id,
        type: node_or_link.type,
        kind: node_or_link.kind,
        properties: node_or_link.properties || {},
    };

    const formatter = new JSONFormatter(data, 2);

    const container = document.getElementById('details');
    while (container.firstChild) {
        container.removeChild(container.firstChild);
    }
    container.appendChild(formatter.render());
    container.hidden = false;
}

function hideDetails() {
    q('#details').hidden = true;
}

// NOTE: sometimes source/target are not resolved if graph engine not run yet
// this method will work for both cases (resolved will have link.source as object)
function linkSourceId(link) {
    return (typeof link.source === 'object') ? link.source.id : link.source;
}

function linkTargetId(link) {
    return (typeof link.target === 'object') ? link.target.id : link.target;
}

function autoAdjustCurvature() {
    // (key for pair of nodes) -> links between them (graph wrapped objects)
    let sameNodesLinks = new Map();
    let seenLinks = new Set();

    const links = Graph.graphData().links;

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

function updateColorPanes() {
    nodeColorsFolder.dispose();
    edgeColorsFolder.dispose();

    nodeColorsFolder = pane.addFolder({
        title: "node colors",
        explanded: true,
    })

    edgeColorsFolder = pane.addFolder({
        title: "edge colors",
        explanded: true,
    })

    const nodeTypes = new Set();

    for (const node of data.nodes) {
        nodeTypes.add(node.type);
    }

    const edgeTypes = new Set();

    for (const edge of data.edges) {
        edgeTypes.add(edge.type);
    }

    for (const key of nodeTypes) {
        if (!(key in settings.nodeColors)) {
            settings.nodeColors[key] = structuredClone(perTypeDefaultColors.nodes[key] || defaultNodeColor);
        }
        nodeColorsFolder.addBinding(settings.nodeColors, key);
    }

    for (const key of edgeTypes) {
        if (!(key in settings.edgeColors)) {
            settings.edgeColors[key] = structuredClone(perTypeDefaultColors.edges[key] || defaultEdgeColor);
        }
        edgeColorsFolder.addBinding(settings.edgeColors, key)
    }
}

async function refresh() {
    updateColorPanes();

    // optionally filter out isolated nodes
    const showIsolated = settings.showIsolated;

    let processedData = { nodes: [], edges: [] };

    // transform for graph format
    for (const node of data.nodes) {
        processedData.nodes.push({
            id: node.id,
            type: node.type,
            kind: "node",
            properties: node.properties || {},
        })
    }

    for (const edge of data.edges) {
        processedData.edges.push({
            id: edge.id,
            type: edge.type,
            kind: "edge",
            source: edge.source_id,
            target: edge.target_id,
            properties: edge.properties || {},
        })
    }

    if (!showIsolated) {
        const connected = new Set();
        processedData.edges.forEach(l => {
            connected.add(l.source);
            connected.add(l.target);
        });
        processedData.nodes = data.nodes.filter(n => connected.has(n.id));
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

    renderGraphData(processedData);
}

function renderGraphData(data) {
    console.log('updating graph data:', data.nodes.length, 'nodes,', data.edges.length, 'links');

    // merge new data with existing nodes for smoother updates.
    const current = Graph.graphData() || { nodes: [], links: [] };

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

    Graph.graphData({ nodes: mergedNodes, links: mergedLinks });

    autoAdjustCurvature();
}

async function pinAll() {
    const data = Graph.graphData();

    data.nodes.forEach(node => {
        node.fx = node.x;
        node.fy = node.y;
    });
}

async function unpinAll() {
    const data = Graph.graphData();

    data.nodes.forEach(node => {
        node.fx = undefined;
        node.fy = undefined;
    });
}

// initial load
window.addEventListener('load', async () => {
    console.log("initial loading...");
    applyD3Params();
    data = await loadDataFromApi();
    refresh();
});
