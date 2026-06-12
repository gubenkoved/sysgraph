import { EVT_GRAPH_UPDATED, EVT_SELECTION_CHANGED, nodeRadius } from './constants.js';
import { emit } from './event-bus.js';
import { filterGraph } from './graph.js';
import { ForceGraphInstance } from './graph-ui.js';
import { is3D } from './render-mode.js';
import { getGraph, state, updateGraph } from './state.js';

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
    // prevent the browser from claiming touch gestures (scroll/pinch) on the
    // overlay so a one-finger drag can draw the selection rectangle instead
    selectionCanvas.style.touchAction = 'none';
    // a fresh canvas defaults to 300x150; zero the backing store so the first
    // resizeGraphViewport() call sees prevW/prevH == 0 and skips anchor
    // preservation (otherwise it would center on a bogus 150,75 anchor and push
    // the origin off to the bottom-right)
    selectionCanvas.width = 0;
    selectionCanvas.height = 0;
    graphContainer.appendChild(selectionCanvas);

    function resizeGraphViewport(): void {
        const rect = graphContainer.getBoundingClientRect();
        const newW = rect.width;
        const newH = rect.height;
        const prevW = selectionCanvas.width;
        const prevH = selectionCanvas.height;

        // keep whatever graph content sat at the old viewport center anchored at
        // the new center, so resizing the dock region (opening/closing/resizing
        // panels) pans the view instead of letting the graph drift off-screen
        let anchor: { x: number; y: number } | null = null;
        if (!is3D() && prevW > 0 && prevH > 0 && (newW !== prevW || newH !== prevH)) {
            anchor = ForceGraphInstance.screen2GraphCoords(prevW / 2, prevH / 2);
        }

        ForceGraphInstance.width(newW);
        ForceGraphInstance.height(newH);
        selectionCanvas.width = newW;
        selectionCanvas.height = newH;

        if (anchor) {
            ForceGraphInstance.centerAt(anchor.x, anchor.y);
        }

        // resizing the canvas backing store clears it; force-graph would only
        // repaint on its next animation frame, but ResizeObserver runs after
        // force-graph's frame yet before the browser paints, so the cleared
        // (white) canvas gets composited every frame while dragging the dock
        // splitter -> repaint synchronously now to avoid the white flash. 2D
        // only: this is a canvas-backing-store concern; the 3D WebGL renderer
        // redraws continuously and pausing/resuming its loop here crashes its
        // not-yet-ready layout tick and leaves the loop dead (freezing orbit
        // controls), so never do it in 3D
        if (!is3D() && newW > 0 && newH > 0) {
            ForceGraphInstance.pauseAnimation().resumeAnimation();
        }
    }

    resizeGraphViewport();

    window.addEventListener('resize', () => {
        resizeGraphViewport();
    });

    // the graph lives inside a dock region whose size changes when panels open,
    // close, resize or re-dock — observe the container directly so the canvas
    // and force-graph viewport always match the real available area (keeps the
    // graph centered instead of underlapping panels)
    const resizeObserver = new ResizeObserver(() => {
        resizeGraphViewport();
    });
    resizeObserver.observe(graphContainer);

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

    // resolves the active renderer canvas at call time; it is rebuilt when the
    // 2D/3D render mode is toggled, so it must not be cached
    function graphCanvas(): HTMLCanvasElement {
        return document.querySelector('#graph canvas') as HTMLCanvasElement;
    }

    // forward wheel events to the force-graph canvas for zoom (2D only; in 3D
    // the overlay is inert so wheel events reach the renderer directly)
    selectionCanvas.addEventListener('wheel', (event) => {
        if (is3D()) return;
        event.preventDefault();
        graphCanvas().dispatchEvent(new WheelEvent(event.type, event));
    }, { passive: false });

    // middle-click panning (works in ALL tool modes)
    let middleDrag: { lastX: number; lastY: number } | null = null;
    let savedCursor: string | null = null;

    graphContainer.addEventListener('mousedown', (event) => {
        // let the 3D renderer's orbit controls handle middle-drag natively
        if (is3D()) return;
        if (event.button === 1) {
            event.preventDefault();
            event.stopPropagation();
            const target = state.currentTool === 'rect-select' ? selectionCanvas : graphCanvas();
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
            const target = state.currentTool === 'rect-select' ? selectionCanvas : graphCanvas();
            target.style.cursor = savedCursor ?? '';
            middleDrag = null;
            savedCursor = null;
        }
    });

    // begins a rectangular selection at the given overlay-local coordinates
    function beginSelection(localX: number, localY: number): void {
        const graphCoords = ForceGraphInstance.screen2GraphCoords(localX, localY);
        state.selection.isSelecting = true;
        state.selection.selectionStart = graphCoords;
        state.selection.selectionEnd = graphCoords;
        state.selection.selectionStartCanvas = { x: localX, y: localY };
        state.selection.selectionEndCanvas = { x: localX, y: localY };
        drawSelectionRectangle();
    }

    // updates the in-progress selection rectangle's far corner
    function updateSelection(localX: number, localY: number): void {
        const graphCoords = ForceGraphInstance.screen2GraphCoords(localX, localY);
        state.selection.selectionEnd = graphCoords;
        state.selection.selectionEndCanvas = { x: localX, y: localY };
        drawSelectionRectangle();
    }

    // finalizes the selection: hit-tests nodes against the rectangle and
    // updates the selected set. when `additive` is false the previous
    // selection is replaced, otherwise the matched nodes are added
    function finishSelection(localX: number, localY: number, additive: boolean): void {
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

        if (!additive) {
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

    // mouse event handlers
    selectionCanvas.addEventListener('mousedown', (event) => {
        if (state.currentTool === 'rect-select') {
            if (event.button !== 0) return;

            const graphRect = graphContainer.getBoundingClientRect();
            beginSelection(event.clientX - graphRect.left, event.clientY - graphRect.top);
        }
    });

    selectionCanvas.addEventListener('mousemove', (event) => {
        if (state.selection.isSelecting && state.currentTool === 'rect-select') {
            const graphRect = graphContainer.getBoundingClientRect();
            updateSelection(event.clientX - graphRect.left, event.clientY - graphRect.top);
        }
    });

    selectionCanvas.addEventListener('mouseup', (event) => {
        if (state.selection.isSelecting && state.currentTool === 'rect-select') {
            const graphRect = graphContainer.getBoundingClientRect();
            const additive = event.shiftKey || state.selection.additive;
            finishSelection(event.clientX - graphRect.left, event.clientY - graphRect.top, additive);
        }
    });

    // touch event handlers (mobile); the overlay only receives these while the
    // rect-select tool is active (pointer-events toggled by the toolbar), so a
    // single-finger drag draws the selection rectangle instead of panning
    selectionCanvas.addEventListener('touchstart', (event) => {
        if (state.currentTool !== 'rect-select') return;
        if (event.touches.length !== 1) return;

        event.preventDefault();
        const touch = event.touches[0];
        const graphRect = graphContainer.getBoundingClientRect();
        beginSelection(touch.clientX - graphRect.left, touch.clientY - graphRect.top);
    }, { passive: false });

    selectionCanvas.addEventListener('touchmove', (event) => {
        if (!state.selection.isSelecting || state.currentTool !== 'rect-select') return;
        if (event.touches.length !== 1) return;

        event.preventDefault();
        const touch = event.touches[0];
        const graphRect = graphContainer.getBoundingClientRect();
        updateSelection(touch.clientX - graphRect.left, touch.clientY - graphRect.top);
    }, { passive: false });

    selectionCanvas.addEventListener('touchend', (event) => {
        if (!state.selection.isSelecting || state.currentTool !== 'rect-select') return;

        event.preventDefault();
        const touch = event.changedTouches[0];
        const graphRect = graphContainer.getBoundingClientRect();
        finishSelection(touch.clientX - graphRect.left, touch.clientY - graphRect.top, state.selection.additive);
    }, { passive: false });

    return { selectionCanvas, canvas: graphCanvas() };
}
