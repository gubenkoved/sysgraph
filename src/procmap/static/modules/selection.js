import { state, getGraph, updateGraph } from './state.js';
import { Graph } from './graph.js';
import { ForceGraphInstance, refreshGraphUI } from './graph-ui.js';
import { emit } from './event-bus.js';

/**
 * Removes all currently selected nodes (and their connected edges) from the
 * graph and refreshes the UI.
 * @returns {Promise<void>}
 */
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
    emit("selection-changed", null);
}

/**
 * Tests whether a node's circle intersects a selection rectangle.
 * @param {{ x: number, y: number, val?: number }} node
 * @param {{ x1: number, y1: number, x2: number, y2: number }} rect
 * @returns {boolean}
 */
function isNodeInRect(node, rect) {
    const minX = Math.min(rect.x1, rect.x2);
    const maxX = Math.max(rect.x1, rect.x2);
    const minY = Math.min(rect.y1, rect.y2);
    const maxY = Math.max(rect.y1, rect.y2);

    const r = Math.max(4, (node.val || 1) * 3);
    return node.x + r > minX && node.x - r < maxX && node.y + r > minY && node.y - r < maxY;
}

/**
 * Creates the selection overlay canvas, wires mouse events for rectangular
 * selection, and sets up viewport resizing.
 * @returns {{ selectionCanvas: HTMLCanvasElement, canvas: HTMLCanvasElement }}
 */
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

    // get the force-graph canvas for event forwarding
    const canvas = document.querySelector('#graph canvas');

    // forward wheel events to the force-graph canvas for zoom
    selectionCanvas.addEventListener('wheel', (event) => {
        event.preventDefault();
        canvas.dispatchEvent(new WheelEvent(event.type, event));
    }, { passive: false });

    // --- middle-click panning (works in ALL tool modes) ---
    let middleDrag = null;
    let savedCursor = null;

    graphContainer.addEventListener('mousedown', (event) => {
        if (event.button === 1) {
            event.preventDefault();
            event.stopPropagation();
            const target = state.currentTool === 'rect-select' ? selectionCanvas : canvas;
            savedCursor = target.style.cursor;
            target.style.cursor = 'grabbing';
            middleDrag = { lastX: event.clientX, lastY: event.clientY };
        }
    }, true);

    window.addEventListener('mousemove', (event) => {
        if (middleDrag) {
            const dx = event.clientX - middleDrag.lastX;
            const dy = event.clientY - middleDrag.lastY;
            middleDrag.lastX = event.clientX;
            middleDrag.lastY = event.clientY;
            const k = ForceGraphInstance.zoom();
            const center = ForceGraphInstance.centerAt();
            ForceGraphInstance.centerAt(center.x - dx / k, center.y - dy / k);
        }
    });

    window.addEventListener('mouseup', (event) => {
        if (middleDrag && event.button === 1) {
            const target = state.currentTool === 'rect-select' ? selectionCanvas : canvas;
            target.style.cursor = savedCursor || '';
            middleDrag = null;
            savedCursor = null;
        }
    });

    // mouse event handlers
    selectionCanvas.addEventListener('mousedown', (event) => {
        if (state.currentTool === 'rect-select') {
            // only left-click starts rectangle selection
            if (event.button !== 0) return;

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

            emit("selection-changed", null);
            state.selection.selectionStartCanvas = null;
            state.selection.selectionEndCanvas = null;
            drawSelectionRectangle();
        }
    });

    return { selectionCanvas, canvas };
}
