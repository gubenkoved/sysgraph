import { state, getGraph, updateGraph } from './state.js';
import { filterGraph } from './graph.js';
import { ForceGraphInstance } from './graph-ui.js';
import { emit } from './event-bus.js';
import { EVT_GRAPH_UPDATED, EVT_SELECTION_CHANGED, nodeRadius } from './constants.js';

/**
 * Removes all currently selected nodes (and their connected edges) from the
 * graph and refreshes the UI.
 */
export async function deleteSelectedNodes(): Promise<void> {
    const graph = getGraph();

    const nodeShouldBeIncludedFn = (node: { id: string }) =>
        !state.selection.selectedNodeIds.has(node.id);

    const edgeShouldBeIncludedFn = (edge: { source_id: string; target_id: string }) =>
        !state.selection.selectedNodeIds.has(edge.source_id) &&
        !state.selection.selectedNodeIds.has(edge.target_id);

    const filteredGraph = filterGraph(graph, nodeShouldBeIncludedFn, edgeShouldBeIncludedFn);

    updateGraph(filteredGraph);
    emit(EVT_GRAPH_UPDATED, null);

    state.selection.selectedNodeIds.clear();
    emit(EVT_SELECTION_CHANGED, null);
}

interface Rect {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

/**
 * Tests whether a node's circle intersects a selection rectangle.
 */
function isNodeInRect(node: { x: number; y: number; val?: number }, rect: Rect): boolean {
    const minX = Math.min(rect.x1, rect.x2);
    const maxX = Math.max(rect.x1, rect.x2);
    const minY = Math.min(rect.y1, rect.y2);
    const maxY = Math.max(rect.y1, rect.y2);

    const r = nodeRadius(node);
    return node.x + r > minX && node.x - r < maxX && node.y + r > minY && node.y - r < maxY;
}

/**
 * Creates the selection overlay canvas, wires mouse events for rectangular
 * selection, and sets up viewport resizing.
 */
export function initSelection(): { selectionCanvas: HTMLCanvasElement; canvas: HTMLCanvasElement } {
    const graphContainer = document.getElementById('graph') as HTMLElement;

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

    function resizeGraphViewport(): void {
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

    function drawSelectionRectangle(): void {
        const ctx = selectionCanvas.getContext('2d')!;
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

    const canvas = document.querySelector('#graph canvas') as HTMLCanvasElement;

    // forward wheel events to the force-graph canvas for zoom
    selectionCanvas.addEventListener('wheel', (event) => {
        event.preventDefault();
        canvas.dispatchEvent(new WheelEvent(event.type, event));
    }, { passive: false });

    // --- middle-click panning (works in ALL tool modes) ---
    let middleDrag: { lastX: number; lastY: number } | null = null;
    let savedCursor: string | null = null;

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
            target.style.cursor = savedCursor ?? '';
            middleDrag = null;
            savedCursor = null;
        }
    });

    // mouse event handlers
    selectionCanvas.addEventListener('mousedown', (event) => {
        if (state.currentTool === 'rect-select') {
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

            const rect: Rect = {
                x1: state.selection.selectionStart!.x,
                y1: state.selection.selectionStart!.y,
                x2: state.selection.selectionEnd!.x,
                y2: state.selection.selectionEnd!.y,
            };

            if (!event.shiftKey) {
                state.selection.selectedNodeIds.clear();
            }

            const nodes = ForceGraphInstance.graphData().nodes as Array<{ id: string; x: number; y: number; val?: number }>;
            for (const node of nodes) {
                if (isNodeInRect(node, rect)) {
                    state.selection.selectedNodeIds.add(node.id);
                }
            }

            emit(EVT_SELECTION_CHANGED, null);
            state.selection.selectionStartCanvas = null;
            state.selection.selectionEndCanvas = null;
            drawSelectionRectangle();
        }
    });

    return { selectionCanvas, canvas };
}
