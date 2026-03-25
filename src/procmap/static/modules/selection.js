import { state, getGraph, updateGraph } from './state.js';
import { Graph } from './graph.js';
import { ForceGraphInstance, refreshGraphUI } from './graph-ui.js';

let _updateSelectionInfo = () => {};

export function setUpdateSelectionInfo(fn) {
    _updateSelectionInfo = fn;
}

export async function deleteSelectedNodes() {
    const graph = getGraph();

    // drop selected nodes
    const remainingNodes = graph.getNodes().filter(
        node => !state.selection.selectedNodeIds.has(node.id));

    // filter out edges that connect to/from deleted nodes
    const remainingEdges = graph.getEdges().filter(edge =>
        !state.selection.selectedNodeIds.has(edge.source_id) &&
        !state.selection.selectedNodeIds.has(edge.target_id)
    );

    const filteredGraph = new Graph(remainingNodes, remainingEdges);
    updateGraph(filteredGraph);

    await refreshGraphUI();

    state.selection.selectedNodeIds.clear();
    _updateSelectionInfo();
}

function isNodeInRect(node, rect) {
    const minX = Math.min(rect.x1, rect.x2);
    const maxX = Math.max(rect.x1, rect.x2);
    const minY = Math.min(rect.y1, rect.y2);
    const maxY = Math.max(rect.y1, rect.y2);

    const r = Math.max(4, (node.val || 1) * 3);
    return node.x + r > minX && node.x - r < maxX && node.y + r > minY && node.y - r < maxY;
}

export function initSelection() {
    const graphContainer = document.getElementById('graph');

    // custom overlay for drawing selection rectangle
    const selectionCanvas = document.createElement('canvas');
    selectionCanvas.style.position = 'absolute';
    selectionCanvas.style.top = '0';
    selectionCanvas.style.left = '0';
    selectionCanvas.style.cursor = 'crosshair';
    selectionCanvas.style.zIndex = '50';
    selectionCanvas.style.display = 'block';
    selectionCanvas.style.pointerEvents = 'none';
    selectionCanvas.style.background = 'transparent';
    graphContainer.appendChild(selectionCanvas);

    function resizeGraphViewport() {
        const rect = graphContainer.getBoundingClientRect();
        ForceGraphInstance.width(rect.width);
        ForceGraphInstance.height(rect.height);
        selectionCanvas.width = rect.width;
        selectionCanvas.height = rect.height;
    }

    resizeGraphViewport();

    window.addEventListener('resize', () => {
        resizeGraphViewport();
    });

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

    // mouse event handlers
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

            // find nodes in selection rectangle
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

            _updateSelectionInfo();
            state.selection.selectionStartCanvas = null;
            state.selection.selectionEndCanvas = null;
            drawSelectionRectangle();
        }
    });

    // return references needed by toolbar
    const canvas = document.querySelector('#graph canvas');
    return { selectionCanvas, canvas };
}
