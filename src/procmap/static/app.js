import { settings, getDefaultNodeColor, getDefaultEdgeColor } from './modules/settings.js';
import { state, data, initData, updateData } from './modules/state.js';
import { ForceGraphInstance, refreshGraphUI } from './modules/graph-ui.js'
import { on, emit } from './modules/event-bus.js';

import { Pane } from 'https://cdn.jsdelivr.net/npm/tweakpane@4.0.5/dist/tweakpane.min.js';
import JSONFormatter from "https://cdn.jsdelivr.net/npm/json-formatter-js/+esm";


// setup graph UI handlers
on("node-clicked", node => {
    showDetails(node);
});

on("link-clicked", link => {
    showDetails(link);
});

on("pre-graph-ui-refresh", _ => {
    updateColorPanes();
});

on("background-click", _ => {
    hideDetails();
});

const pane = new Pane({
    title: 'parameters',
    container: document.getElementById("settingsPane"),
});

const refreshBtn = pane.addButton({
    title: 'refresh data',
});

refreshBtn.on('click', async () => {
    const loadedData = await loadDataFromApi();
    updateData(loadedData);
    refreshGraphUI();
});

function emitD3SimulationParamtersUpdatedEvent() {
    emit("d3-simulation-paramters-changed", null);
}

pane.addBinding(settings, 'd3Charge', { min: -800, max: 100, step: 10 }).on('change', ev => {
    emitD3SimulationParamtersUpdatedEvent();
});
pane.addBinding(settings, 'd3LinkDistance', { min: 40, max: 300, step: 5 }).on('change', ev => {
    emitD3SimulationParamtersUpdatedEvent();
});
pane.addBinding(settings, 'd3LinkStrength', { min: 0.0, max: 1.0, step: 0.01 }).on('change', ev => {
    emitD3SimulationParamtersUpdatedEvent();
});
pane.addBinding(settings, 'd3CollisionMultiplier', { min: 0.5, max: 2.0, step: 0.05 }).on('change', ev => {
    emitD3SimulationParamtersUpdatedEvent();
});
pane.addBinding(settings, 'd3AlphaTarget', { min: 0.0, max: 0.5, step: 0.01 }).on('change', ev => {
    emitD3SimulationParamtersUpdatedEvent();
});
pane.addBinding(settings, 'd3VelocityDecay', { min: 0.01, max: 0.99, step: 0.01 }).on('change', ev => {
    emitD3SimulationParamtersUpdatedEvent();
});
pane.addBinding(settings, 'd3ForceXYStrength', { min: 0.00, max: 0.99, step: 0.01 }).on('change', ev => {
    emitD3SimulationParamtersUpdatedEvent();
});
pane.addBinding(settings, 'd3CenterForce').on('change', ev => {
    emitD3SimulationParamtersUpdatedEvent();
});

pane.addBlade({ view: 'separator' });

pane.addBinding(settings, 'showIsolated').on('change', ev => {
    refreshGraphUI();
});
pane.addBinding(settings, 'curvatureStep', { min: 0.0, max: 0.200, step: 0.001 }).on('change', ev => {
    emit("graph-ui-links-curvature-updated", null);
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
    const emptyData = initData();
    updateData(emptyData);
    refreshGraphUI();
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

    const loadedData = JSON.parse(text);

    updateData(loadedData);

    preProcessData();

    await refreshGraphUI();

    event.target.value = '';
});

function preProcessData() {
    // generate edge IDs if unspecified as we will need it
    for (const edge of data.edges) {
        if (edge.id === undefined) {
            edge.id = "auto:" + crypto.randomUUID();
        }
    }
}

const q = sel => document.querySelector(sel);

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

// export to windows for easy access in devtools
window.settings = settings;
window.graph = ForceGraphInstance;

// Get canvas element for selection logic
const canvas = document.querySelector('#graph canvas');

// Tool switching and selection logic
function setTool(tool) {
    state.currentTool = tool;
    document.getElementById('toolPointer').classList.toggle('active', tool === 'pointer');
    document.getElementById('toolRectSelect').classList.toggle('active', tool === 'rect-select');

    if (tool === 'pointer') {
        selectionCanvas.style.pointerEvents = 'none';
        canvas.style.cursor = 'default';
    } else if (tool === 'rect-select') {
        selectionCanvas.style.pointerEvents = 'auto';
        selectionCanvas.style.cursor = 'crosshair';
    }

    updateSelectionInfo();
}

function updateSelectionInfo() {
    const info = document.getElementById('selectionInfo');
    const deleteButton = document.getElementById('deleteSelected');
    if (state.selection.selectedNodeIds.size > 0) {
        info.textContent = `${state.selection.selectedNodeIds.size} node${state.selection.selectedNodeIds.size !== 1 ? 's' : ''} selected`;
        deleteButton.style.display = state.currentTool === 'rect-select' ? 'inline-block' : 'none';
    } else {
        info.textContent = '';
        deleteButton.style.display = 'none';
    }
}

async function deleteSelectedNodes() {
    // edit the source data, not the current graph state, so that
    // any changes on graph can be exported as well

    // drop selected nodes
    const remainingNodes = data.nodes.filter(
        node => !state.selection.selectedNodeIds.has(node.id));

    // filter out edges that connect to/from deleted nodes
    const remainingEdges = data.edges.filter(edge =>
        !state.selection.selectedNodeIds.has(edge.source_id) &&
        !state.selection.selectedNodeIds.has(edge.target_id)
    );

    data.nodes = remainingNodes;
    data.edges = remainingEdges;

    await refreshGraphUI();

    // clear the selection
    state.selection.selectedNodeIds.clear();
    updateSelectionInfo();
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
    ForceGraphInstance.width(rect.width);
    ForceGraphInstance.height(rect.height);
    selectionCanvas.width = rect.width;
    selectionCanvas.height = rect.height;
}

resizeGraphViewport();

function drawSelectionRectangle() {
    const ctx = selectionCanvas.getContext('2d');
    ctx.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);

    if (state.selection.isSelecting && state.selection.selectionStartCanvas && state.selection.selectionEndCanvas) {
        const startX = state.selection.selectionStartCanvas.x;
        const endX = state.selection.selectionEndCanvas.x;
        const startY = state.selection.selectionStartCanvas.y;
        const endY = state.selection.selectionEndCanvas.y;

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
    if (state.currentTool === 'rect-select') {
        const graphRect = graphContainer.getBoundingClientRect();
        const localX = event.clientX - graphRect.left;
        const localY = event.clientY - graphRect.top;
        const graphCoords = ForceGraphInstance.screen2GraphCoords(localX, localY);
        state.selection.isSelecting = true;
        state.selection.selectionStart = graphCoords;
        state.selection.selectionEnd = graphCoords;
        state.selection.selectionStartCanvas = { x: localX, y: localY };
        state.selection.selectionEndCanvas = { x: localX, y: localY };
        drawSelectionRectangle();
    }
});

selectionCanvas.addEventListener('mousemove', (event) => {
    if (state.selection.isSelecting && state.currentTool === 'rect-select') {
        const graphRect = graphContainer.getBoundingClientRect();
        const localX = event.clientX - graphRect.left;
        const localY = event.clientY - graphRect.top;
        const graphCoords = ForceGraphInstance.screen2GraphCoords(localX, localY);
        state.selection.selectionEnd = graphCoords;
        state.selection.selectionEndCanvas = { x: localX, y: localY };
        drawSelectionRectangle();
    }
});

selectionCanvas.addEventListener('mouseup', (event) => {
    if (state.selection.isSelecting && state.currentTool === 'rect-select') {
        const graphRect = graphContainer.getBoundingClientRect();
        const localX = event.clientX - graphRect.left;
        const localY = event.clientY - graphRect.top;
        const graphCoords = ForceGraphInstance.screen2GraphCoords(localX, localY);

        state.selection.selectionEnd = graphCoords;
        state.selection.selectionEndCanvas = { x: localX, y: localY };
        state.selection.isSelecting = false;

        // Find nodes in selection rectangle
        const rect = {
            x1: state.selection.selectionStart.x,
            y1: state.selection.selectionStart.y,
            x2: state.selection.selectionEnd.x,
            y2: state.selection.selectionEnd.y,
        };

        // replace current selection unless Shift key is pressed
        if (!event.shiftKey) {
            state.selection.selectedNodeIds.clear();
        }

        const nodes = ForceGraphInstance.graphData().nodes;
        nodes.forEach(node => {
            if (isNodeInRect(node, rect)) {
                state.selection.selectedNodeIds.add(node.id);
            }
        });

        updateSelectionInfo();
        state.selection.selectionStartCanvas = null;
        state.selection.selectionEndCanvas = null;
        drawSelectionRectangle();
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', async (event) => {
    if (event.key === 'p' || event.key === 'P') {
        setTool('pointer');
    } else if (event.key === 'r' || event.key === 'R') {
        setTool('rect-select');
    } else if (event.key === 'Delete' && state.currentTool === 'rect-select' && state.selection.selectedNodeIds.size > 0) {
        await deleteSelectedNodes();
    }
});

// Toolbar button handlers
document.getElementById('toolPointer').addEventListener('click', () => {
    setTool('pointer');
    state.selection.selectedNodeIds.clear();
    updateSelectionInfo();
});

document.getElementById('toolRectSelect').addEventListener('click', () => {
    setTool('rect-select');
});

document.getElementById('deleteSelected').addEventListener('click', async () => {
    await deleteSelectedNodes();
});

window.addEventListener('resize', () => {
    resizeGraphViewport();
});

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
            settings.nodeColors[key] = structuredClone(getDefaultNodeColor(key));
        }
        nodeColorsFolder.addBinding(settings.nodeColors, key);
    }

    for (const key of edgeTypes) {
        if (!(key in settings.edgeColors)) {
            settings.edgeColors[key] = structuredClone(getDefaultEdgeColor(key));
        }
        edgeColorsFolder.addBinding(settings.edgeColors, key)
    }
}

async function pinAll() {
    const graphData = ForceGraphInstance.graphData();

    graphData.nodes.forEach(node => {
        node.fx = node.x;
        node.fy = node.y;
    });
}

async function unpinAll() {
    const graphData = ForceGraphInstance.graphData();

    graphData.nodes.forEach(node => {
        node.fx = undefined;
        node.fy = undefined;
    });
}

// initial load
window.addEventListener('load', async () => {
    console.log("initial loading...");
    emit("d3-simulation-paramters-changed", null);
    const loadedData = await loadDataFromApi();
    updateData(loadedData);
    refreshGraphUI();
});
