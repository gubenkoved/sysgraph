import * as d3 from 'd3';
import { handleAnalyticsNodeClick } from './analytics.js';
import {
    D3_COLLISION_BASE_RADIUS, D3_COLLISION_RADIUS_PER_VAL,
    D3_COOLDOWN_TIME_MS,
    EVT_BACKGROUND_CLICK, EVT_LINK_CLICKED,
    EVT_NODE_CLICKED, EVT_RENDER_MODE_CHANGED,
    nodeRadius,
    PANEL_GRAPH,
    RENDER_TRANSITION_MS,
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
import { build2DRenderer, focusNode2D, getView2D, recenter2D, setView2D } from './graph-ui-2d.js';
import { alignTopDown3D, build3DRenderer, distanceFrom2DZoom, focusNode3D, get3DCameraParams, placeTopDown3D, pulseSearchMatches3D, recenter3D, refreshColors3D, refreshLinkWidths3D, revealPerspective3D, updateAdjacencyCounts3D, updateAxisCross3D, updateHeatmapValues3D, updateOrbitCenter3D, updatePinIndicators3D, updateSelectionIndicators3D, world2DZoomFromDistance } from './graph-ui-3d.js';
import {
    clearColorCaches,
    getNodeVal,
    isNodePinned,
    linkSourceId,
    linkTargetId,
    makeEdgeFilterFn,
    makeLinkDistanceFn,
    makeNodeFilterFn,
    pinNode,
    unpinNode,
} from './graph-ui-appearance.js';
import type { FGLink, FGNode, ForceGraphInstance as ForceGraphInstanceType, RendererHandlers } from './graph-ui-types.js';
import { registerPanel } from './layout.js';
import { isQuickStartVisible } from './quick-start.js';
import { callFramePost, callFramePre } from './render-hooks.js';
import { getRenderMode, is3D, persistRenderMode, type RenderMode } from './render-mode.js';
import { settings } from './settings.js';
import { getGraph, setAdjacencyFilter, setEditSubTool, setHighlight, state } from './state.js';
import { updateGraphInfo } from './toolbar.js';

// graph-ui is the thin orchestrator/facade over the renderer modules: it owns
// the active renderer instance, the interaction handlers, camera control, the
// adjacency filter, context menus and the graph-data refresh pipeline. The
// renderer-agnostic appearance logic lives in graph-ui-appearance and the
// renderer-specific builders in graph-ui-2d / graph-ui-3d.

// re-export the public appearance API so existing importers of graph-ui keep
// working unchanged
export {
    analyticsHeatmapColorScale,
    communityColor,
    computeMatchColors,
    pinNode,
    unpinNode,
} from './graph-ui-appearance.js';
export type { FGLink, FGNode } from './graph-ui-types.js';

// ── double-click detection (force-graph has no native onNodeDblClick) ─

const DOUBLE_CLICK_MS = 300;
let lastClickedNodeId: string | null = null;
let lastClickTime = 0;

// minimum on-screen hit radius (px) for touch long-press node detection, so
// small/zoomed-out nodes are still reachable with a finger
const TOUCH_SLOP_PX = 18;

// Curvature applied to a single self-referencing edge so force-graph draws a
// visible loop (a zero-curvature self-link is degenerate/invisible). Additional
// self-loops on the same node are fanned out by SELF_LOOP_CURVATURE_STEP.
const SELF_LOOP_BASE_CURVATURE = 0.4;
const SELF_LOOP_CURVATURE_STEP = 0.2;

// ── edit-mode helpers (new-node placement & pointer tracking) ─

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
    // pointer tracking feeds the 2D edit rubber band only; the 3D renderer has
    // no equivalent and its screen2GraphCoords has a different signature
    if (is3D()) return;
    const rect = graphContainerEl.getBoundingClientRect();
    const coords = ForceGraphInstance.screen2GraphCoords(
        event.clientX - rect.left,
        event.clientY - rect.top,
    );
    pointerGraphPos.x = coords.x;
    pointerGraphPos.y = coords.y;
});

// ── renderer host ───────────────────────────────────────────

// the active renderer mounts into a dedicated host inside #graph so switching
// between the 2D and 3D renderers never disturbs the selection overlay canvas,
// which is a sibling child of #graph
const rendererHost = document.createElement('div');
rendererHost.style.position = 'absolute';
rendererHost.style.inset = '0';
graphContainerEl.appendChild(rendererHost);

// ── interaction handlers (wired into both renderers via RendererHandlers) ─

function handleNodeClick(node: FGNode, event?: MouseEvent): void {
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
}

function handleLinkClick(link: FGLink, event?: MouseEvent): void {
    emit(EVT_LINK_CLICKED, { data: link, shiftKey: event?.shiftKey ?? false });
}

function handleLinkRightClick(link: FGLink, event: MouseEvent): void {
    event.preventDefault();
    showLinkContextMenu(link, event.clientX, event.clientY);
}

function handleNodeDrag(node: FGNode): void {
    pinNode(node);
}

function handleNodeHover(node: FGNode | null): void {
    // keep a persistent analytics decoration in place; don't let hover override
    // the algorithm result highlight (only while it is shown)
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
    // 2D re-reads the color accessors on every canvas frame, so the BFS dimming
    // appears automatically; the 3D renderer only recolors on demand, so push
    // the new highlight into it explicitly (cheap, color-only — mirrors the
    // search-as-you-type recolor path)
    if (is3D()) {
        refreshGraphColors();
    }
}

function handleNodeRightClick(node: FGNode, event: MouseEvent): void {
    event.preventDefault();
    showNodeContextMenu(node, event.clientX, event.clientY);
}

function handleBackgroundRightClick(event: MouseEvent): void {
    event.preventDefault();
    showBackgroundContextMenu(event.clientX, event.clientY);
}

function handleBackgroundClick(event: MouseEvent): void {
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
}

// the handler bundle passed into each renderer builder; function declarations
// above are hoisted, so this can be defined before the instance is built
const rendererHandlers: RendererHandlers = {
    onNodeClick: handleNodeClick,
    onLinkClick: handleLinkClick,
    onLinkRightClick: handleLinkRightClick,
    onNodeDrag: handleNodeDrag,
    onNodeHover: handleNodeHover,
    onNodeRightClick: handleNodeRightClick,
    onBackgroundRightClick: handleBackgroundRightClick,
    onBackgroundClick: handleBackgroundClick,
};

// ── active renderer instance ────────────────────────────────

// the active renderer; reassigned (an ES-module live binding) when the user
// toggles render mode, which automatically propagates to every module that
// imports it by name
export let ForceGraphInstance: ForceGraphInstanceType = is3D()
    ? build3DRenderer(rendererHost, rendererHandlers)
    : build2DRenderer(rendererHost, rendererHandlers, pointerGraphPos);

// the graph is the locked center dock panel; register the wrapper (which holds
// the renderer host plus the graph-area chrome) so the layout mounts it as one
// unit and keeps it always present
registerPanel({
    id: PANEL_GRAPH,
    component: PANEL_GRAPH,
    title: 'Graph',
    element: document.getElementById('graphPanel') as HTMLElement,
});

// ── frame loop (drives the FPS indicator for both renderers) ─

// a single always-on rAF loop drives the per-frame hooks (the FPS graph). rAF
// is synced to the display's repaint, so this reflects the real frame rate —
// including dropped frames — regardless of which renderer is active. the 2D
// force-graph and the 3D three.js renderer each run their own internal render
// loop, so we measure cadence here rather than hooking either one (3d-force-
// graph has no per-frame render hook anyway)
function frameLoop(): void {
    callFramePre();
    // the 3D renderer has no per-frame draw callback, so the search-match pulse
    // (2D draws its pulsing ring every frame), the pinned-node spike marker, the
    // selection ring and the adjacency hidden-count badge are driven from here
    if (is3D()) {
        pulseSearchMatches3D(ForceGraphInstance);
        updatePinIndicators3D(ForceGraphInstance);
        updateSelectionIndicators3D(ForceGraphInstance);
        updateAdjacencyCounts3D(ForceGraphInstance);
        updateHeatmapValues3D(ForceGraphInstance);
        updateAxisCross3D();
        updateOrbitCenter3D(ForceGraphInstance);
    }
    callFramePost();
    requestAnimationFrame(frameLoop);
}
requestAnimationFrame(frameLoop);


// ── camera control ──────────────────────────────────────────

const RECENTER_VIEW_DURATION_MS = 400;

// 3D camera glide duration when focusing a node (e.g. cycling search matches);
// longer than the 2D pan so the spatial travel stays legible
const FOCUS_3D_DURATION_MS = 1200;

// recenter the camera on the origin (2D) or fit the whole graph (3D)
function recenterView(durationMs: number): void {
    if (is3D()) {
        recenter3D(ForceGraphInstance, durationMs);
        return;
    }
    recenter2D(ForceGraphInstance, durationMs);
}

// request a recenter on the next animation frame
export function requestRecenterView(): void {
    requestAnimationFrame(() => recenterView(RECENTER_VIEW_DURATION_MS));
}

/** Pans/orbits the camera to focus on the given node, if present and positioned. */
export function centerOnNode(nodeId: string, durationMs = 500): void {
    const node = (ForceGraphInstance.graphData().nodes as FGNode[]).find(n => n.id === nodeId);
    if (!node) return;
    if (is3D()) {
        // a slower glide in 3D so the camera travel reads as continuous motion
        // (preserving the user's spatial orientation) rather than a hard snap
        focusNode3D(ForceGraphInstance, node, Math.max(durationMs, FOCUS_3D_DURATION_MS));
        return;
    }
    focusNode2D(ForceGraphInstance, node, durationMs);
}

/**
 * Switches the active renderer between 2D and 3D. The current graph data is
 * preserved across the swap (positions re-simulate). Reassigning the exported
 * ForceGraphInstance live-binding propagates the new instance to all importers.
 */
export function setRenderMode(mode: RenderMode): void {
    if (mode === getRenderMode()) return;
    // ignore re-entry while a transition is mid-flight so the camera glide and
    // renderer swap aren't interleaved
    if (transitioning) return;

    // a seamless aligned transition needs an existing 2D layout to project; with
    // no positioned nodes (empty/freshly loaded graph) just swap and recenter
    const nodes = ForceGraphInstance.graphData().nodes as FGNode[];
    const hasLayout = nodes.length > 0 && nodes.some(n => n.x != null && n.y != null);
    if (!hasLayout) {
        swapRenderer(mode);
        requestRecenterView();
        return;
    }

    if (mode === '3d') transitionToThreeD();
    else transitionToTwoD();
}

// guards against overlapping transitions (camera glide + deferred swap)
let transitioning = false;

/**
 * Rebuilds the active renderer for the given mode, preserving graph data. Does
 * not touch the camera — callers position it (seamlessly, or via recenter).
 */
function swapRenderer(mode: RenderMode): void {
    const data = ForceGraphInstance.graphData();
    const prev = ForceGraphInstance as unknown as { _destructor?: () => void };

    // a lingering hover highlight from the previous renderer would carry over
    // (the swap rebuilds the instance, losing its hover-out event), so reset it
    // on every mode switch to start clean
    setHighlight(null);

    persistRenderMode(mode);
    prev._destructor?.();
    rendererHost.replaceChildren();

    ForceGraphInstance = is3D()
        ? build3DRenderer(rendererHost, rendererHandlers)
        : build2DRenderer(rendererHost, rendererHandlers, pointerGraphPos);
    ForceGraphInstance.graphData(data);
    applyD3Params();
    void refreshGraphUI();

    emit(EVT_RENDER_MODE_CHANGED, mode);
}

/**
 * 3D→2D: glide the 3D camera straight overhead (axis-aligned, preserving zoom),
 * then swap to the 2D renderer and snap its view so the projection matches
 * exactly — no visible jump at the swap.
 */
function transitionToTwoD(): void {
    transitioning = true;
    const info = alignTopDown3D(ForceGraphInstance, RENDER_TRANSITION_MS);
    window.setTimeout(() => {
        swapRenderer('2d');
        const zoom = world2DZoomFromDistance(info.distance, info.fov, info.height);
        setView2D(ForceGraphInstance, info.cx, info.cy, zoom);
        transitioning = false;
    }, RENDER_TRANSITION_MS);
}

/**
 * 2D→3D: build the 3D renderer and place its camera top-down so the first frame
 * projects identically to the 2D view (nodes flattened to z=0), then orbit out
 * to a resting perspective pose to reveal depth.
 */
function transitionToThreeD(): void {
    transitioning = true;
    const view = getView2D(ForceGraphInstance);
    const height = ForceGraphInstance.height();

    // flatten depth so the first 3D frame matches the 2D plane; the force engine
    // (if physics is on) then spreads the nodes in z during the reveal
    for (const node of ForceGraphInstance.graphData().nodes as (FGNode & { z?: number })[]) {
        node.z = 0;
    }

    swapRenderer('3d');

    const { fov } = get3DCameraParams(ForceGraphInstance);
    const distance = distanceFrom2DZoom(view.k, fov, height);
    placeTopDown3D(ForceGraphInstance, view.cx, view.cy, distance);

    // reveal on the next frame so the aligned frame paints first
    requestAnimationFrame(() => {
        revealPerspective3D(ForceGraphInstance, RENDER_TRANSITION_MS, () => {
            transitioning = false;
        });
    });
}

// ── node double-click handler ───────────────────────────────

function handleNodeDoubleClick(node: FGNode): void {
    if (state.adjacencyFilter) {
        updateAdjacencyFilter([node.id], true);
        void refreshGraphUI();
    }
}

// ── adjacency filter ────────────────────────────────────────

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

// ── context menus (shared by right-click and touch long-press) ─

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

    items.push({ divider: true });
    items.push({
        label: 'Delete node',
        icon: 'delete',
        danger: true,
        action: () => deleteNode(node.id),
    });

    showContextMenu(clientX, clientY, items);
}

/** Builds and shows the link context menu at the given screen coordinates. */
export function showLinkContextMenu(link: FGLink, clientX: number, clientY: number): void {
    showContextMenu(clientX, clientY, [{
        label: 'Delete edge',
        icon: 'delete',
        danger: true,
        action: () => deleteEdge(link.id),
    }]);
}

/** Builds and shows the background context menu at the given screen coordinates. */
export function showBackgroundContextMenu(clientX: number, clientY: number): void {
    // the quick-start overlay covers an empty graph, where none of these actions
    // make sense; skip the menu while it is shown
    if (isQuickStartVisible()) {
        return;
    }

    const items: ContextMenuItem[] = [];

    items.push({
        label: 'Pin all',
        icon: 'push_pin',
        action: () => {
            for (const node of ForceGraphInstance.graphData().nodes as FGNode[]) {
                pinNode(node);
            }
        },
    });
    items.push({
        label: 'Unpin all',
        icon: 'keep_off',
        action: () => {
            for (const node of ForceGraphInstance.graphData().nodes as FGNode[]) {
                unpinNode(node);
            }
        },
    });

    items.push({ divider: true });

    items.push({
        label: 'Recenter view',
        icon: 'filter_center_focus',
        action: () => requestRecenterView(),
    });

    items.push({ divider: true });

    const selectedCount = state.selection.selectedNodeIds.size;
    items.push({
        label: 'Select all',
        icon: 'select_all',
        action: () => {
            for (const id of state.graph.nodesMap.keys()) {
                state.selection.selectedNodeIds.add(id);
            }
            updateGraphInfo();
        },
    });
    items.push({
        label: 'Unselect all',
        icon: 'deselect',
        disabled: selectedCount === 0,
        action: () => {
            state.selection.selectedNodeIds.clear();
            updateGraphInfo();
        },
    });

    if (state.adjacencyFilter) {
        items.push({ divider: true });
        items.push({
            label: 'Reset adjacency filter',
            icon: 'filter_alt_off',
            action: () => {
                setAdjacencyFilter(null);
                void refreshGraphUI();
            },
        });
    }

    showContextMenu(clientX, clientY, items);
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
    // 2D-only hit test (uses the 2D zoom/projection); the 3D renderer resolves
    // node picks through its own pointer handling
    if (is3D()) return null;
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

// ── graph UI refresh ────────────────────────────────────────

/**
 * Builds the graph as currently rendered on the canvas by applying, in order:
 * node/edge type filters, the adjacency focus filter, the node/edge filter
 * expressions and the hide-isolated toggle. This is the single source of truth
 * for "what is visible", shared by rendering and analytics so they can never
 * diverge.
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

    if (settings.nodeFilterExpression.trim()) {
        // evaluate the user predicate in node scope (degree computed on the
        // graph as filtered so far), then drop edges whose endpoints are gone
        const filterFn = makeNodeFilterFn(settings.nodeFilterExpression);
        const degrees = computeNodeDegrees(new Graph(nodes, edges));
        nodes = nodes.filter(n => filterFn(n as FGNode, degrees.get(n.id) ?? 0));
        const kept = new Set(nodes.map(n => n.id));
        edges = edges.filter(e => kept.has(e.source_id) && kept.has(e.target_id));
    }

    if (settings.edgeFilterExpression.trim()) {
        const filterFn = makeEdgeFilterFn(settings.edgeFilterExpression);
        edges = edges.filter(e => filterFn(e as FGLink));
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
    if (is3D()) {
        // cheap color-only update: re-applies the color accessors without
        // flushing/rebuilding the node label sprites (see refreshColors3D). this
        // keeps search-as-you-type responsive on large 3D graphs
        refreshColors3D(ForceGraphInstance);
        return;
    }
    if (typeof (ForceGraphInstance as unknown as Record<string, unknown>).refresh === 'function') {
        ForceGraphInstance.refresh();
    }
}

// re-applies edge widths after an edge-width setting changes. in 2D the canvas
// re-reads the width accessor on its next repaint, so a refresh() suffices; in
// 3D the link geometry must be explicitly rebuilt (see refreshLinkWidths3D)
export function refreshGraphLinkWidths(): void {
    if (is3D()) {
        refreshLinkWidths3D(ForceGraphInstance);
        return;
    }
    if (typeof (ForceGraphInstance as unknown as Record<string, unknown>).refresh === 'function') {
        ForceGraphInstance.refresh();
    }
}

// full rebuild of the renderer's objects. in 3D this regenerates the node label
// sprites (whose text color is baked per theme), so it is needed when the theme
// changes; in 2D the canvas repaints every frame so a color refresh suffices
export function rebuildGraphObjects(): void {
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

    // the 3D renderer builds link geometry lazily and caches it, so mutating
    // link curvature above has no effect until we force a rebuild; 2D re-reads
    // accessors every frame and needs no refresh
    if (is3D()) {
        ForceGraphInstance.refresh();
    }
}

export function applyD3Params(): void {
    // the transient runtime override wins over the persisted setting (without
    // mutating it), so a toolbar pause never leaks into the exported settings
    const physicsEnabled = state.physicsOverride ?? settings.d3EnablePhysics;
    if (!physicsEnabled) {
        // Freeze the engine: it stops after the next tick check.
        ForceGraphInstance.cooldownTicks(0);
        return;
    }

    // an empty graph has nothing to simulate, so don't warm/reheat the engine —
    // otherwise it ticks forever on the blank startup page and the physics
    // indicator shows as "running" for no reason
    if (getVisibleGraph().getNodes().length === 0) {
        ForceGraphInstance.cooldownTicks(0);
        return;
    }

    ForceGraphInstance.cooldownTicks(Infinity);

    const chargeForce = ForceGraphInstance.d3Force('charge');
    if (chargeForce && typeof chargeForce.strength === 'function') chargeForce.strength(settings.d3Charge);

    const linkForce = ForceGraphInstance.d3Force('link');
    if (linkForce) {
        if (typeof linkForce.distance === 'function') {
            // expression mode drives per-link distance from edge properties
            // (e.g. road length); otherwise the slider value is a flat distance
            if (settings.d3LinkDistanceMode === 'expression') {
                linkForce.distance(makeLinkDistanceFn(settings.d3LinkDistanceExpression, settings.d3LinkDistance));
            } else {
                linkForce.distance(settings.d3LinkDistance);
            }
        }
        if (typeof linkForce.strength === 'function') linkForce.strength(settings.d3LinkStrength);
    }

    const forceX = ForceGraphInstance.d3Force('forceX');
    const forceY = ForceGraphInstance.d3Force('forceY');

    if (forceX && typeof forceX.strength === 'function') forceX.strength(settings.d3ForceXYStrength);
    if (forceY && typeof forceY.strength === 'function') forceY.strength(settings.d3ForceXYStrength);

    // the 2D d3.forceCenter only acts on x/y; the 3D renderer relies on its
    // own dimension-aware centering, so only manage this force in 2D
    if (!is3D()) {
        if (settings.d3CenterForce) {
            ForceGraphInstance.d3Force('center', d3.forceCenter());
        } else {
            ForceGraphInstance.d3Force('center', null);
        }
    }

    const collisionForce = ForceGraphInstance.d3Force('collision');
    if (collisionForce && typeof collisionForce.radius === 'function') {
        collisionForce.radius((d: FGNode) => (D3_COLLISION_BASE_RADIUS + (d.val ?? 1) * D3_COLLISION_RADIUS_PER_VAL) * settings.d3CollisionMultiplier);
    }

    if (typeof ForceGraphInstance.d3VelocityDecay === 'function') {
        ForceGraphInstance.d3VelocityDecay(settings.d3VelocityDecay);
    }

    // alpha target keeps the simulation "warm": a value > 0 means the engine
    // never fully cools, so the layout stays in gentle continuous motion. The
    // engine also stops once cooldownTime elapses, so lift that cap while a
    // positive target is set; otherwise restore the default so a target of 0
    // settles to rest as usual
    if (typeof ForceGraphInstance.d3AlphaTarget === 'function') {
        ForceGraphInstance.d3AlphaTarget(settings.d3AlphaTarget);
    }
    if (typeof ForceGraphInstance.cooldownTime === 'function') {
        ForceGraphInstance.cooldownTime(settings.d3AlphaTarget > 0 ? Infinity : D3_COOLDOWN_TIME_MS);
    }

    // Reheat so updated forces (and a re-enabled engine) take effect.
    // d3ReheatSimulation sets alpha=1 and restarts the cooled-down engine.
    ForceGraphInstance.d3ReheatSimulation();
}
