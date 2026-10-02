import { handleAnalyticsNodeClick } from './analytics.js';
import { EVT_BACKGROUND_CLICK, EVT_LINK_CLICKED, EVT_NODE_CLICKED, EVT_RENDER_MODE_CHANGED, EVT_VISIBLE_GRAPH_CHANGED, PANEL_GRAPH } from './constants.js';
import type { ContextMenuItem } from './context-menu.js';
import { showContextMenu } from './context-menu.js';
import { cancelPendingEdge, createNodeAt, deleteEdge, deleteNode, handleEditNodeClick, startEdgeFrom } from './edit-mode.js';
import { emit } from './event-bus.js';
import { computeNodeDegrees, filterGraph, Graph } from './graph.js';
import { bfs } from './graph-algs.js';
import { clearColorCaches, unpinNode as clearPinned, getNodeVal, isNodePinned, makeEdgeFilterFn, makeNodeFilterFn, pinNode as markPinned } from './graph-ui-appearance.js';
import type { FGLink, FGNode, RendererHandlers } from './graph-ui-types.js';
import { registerPanel } from './layout.js';
import { isQuickStartVisible } from './quick-start.js';
import { callFramePost, callFramePre } from './render-hooks.js';
import { getRenderMode, is3D, persistRenderMode, type RenderMode } from './render-mode.js';
import { settings } from './settings.js';
import { getGraph, setAdjacencyFilter, setEditSubTool, setHighlight, state } from './state.js';
import { updateGraphInfo } from './toolbar.js';
import { fnv1a } from './util.js';
import { WebGPUGraphView } from './webgpu-graph-view.js';

export { analyticsHeatmapColorScale, communityColor, computeMatchColors } from './graph-ui-appearance.js';
export type { FGLink, FGNode } from './graph-ui-types.js';

const DOUBLE_CLICK_MS = 300;
let lastClickedNodeId: string | null = null;
let lastClickTime = 0;
const pendingNodePositions = new Map<string, { x: number; y: number }>();
export function setPendingNodePosition(id: string, x: number, y: number): void { pendingNodePositions.set(id, { x, y }); }
const graphContainerEl = document.getElementById('graph') as HTMLElement;
const rendererHost = document.createElement('div');
rendererHost.style.cssText = 'position:absolute;inset:0';
graphContainerEl.append(rendererHost);

function handleNodeClick(node: FGNode, event?: MouseEvent): void {
    const now = Date.now();
    if (node.id === lastClickedNodeId && now - lastClickTime < DOUBLE_CLICK_MS) {
        lastClickedNodeId = null; lastClickTime = 0;
        if (state.adjacencyFilter) { updateAdjacencyFilter([node.id], true); void refreshGraphUI(); }
    } else { lastClickedNodeId = node.id; lastClickTime = now; }
    if (state.edit.active) { handleEditNodeClick(node); return; }
    if (state.analytics.active && state.analytics.awaitingPickRole) { handleAnalyticsNodeClick(node); return; }
    if (event?.altKey) unpinNode(node);
    emit(EVT_NODE_CLICKED, { data: node, shiftKey: event?.shiftKey ?? false });
}
function handleNodeHover(node: FGNode | null): void {
    if (state.analytics.active && state.analytics.decoration) return;
    if (!settings.highlightOnHover || !node) { setHighlight(null); return; }
    setHighlight(bfs(getGraph(), node.id, 2));
}
function handleBackgroundClick(event: MouseEvent): void {
    if (state.edit.active) {
        if (state.edit.subTool === 'connect' && state.edit.pendingEdgeSourceId) { cancelPendingEdge(); return; }
        const rect = graphContainerEl.getBoundingClientRect();
        const point = GraphViewInstance.screen2GraphCoords(event.clientX - rect.left, event.clientY - rect.top);
        createNodeAt(point.x, point.y);
    } else if (state.currentTool === 'pointer') emit(EVT_BACKGROUND_CLICK, null);
}
const handlers: RendererHandlers = {
    onNodeClick: handleNodeClick,
    onLinkClick: (link, event) => emit(EVT_LINK_CLICKED, { data: link, shiftKey: event?.shiftKey ?? false }),
    onLinkRightClick: (link, event) => showLinkContextMenu(link, event.clientX, event.clientY),
    onNodeHover: handleNodeHover,
    onNodeRightClick: (node, event) => showNodeContextMenu(node, event.clientX, event.clientY),
    onBackgroundRightClick: event => showBackgroundContextMenu(event.clientX, event.clientY),
    onBackgroundClick: handleBackgroundClick,
};
export const GraphViewInstance = new WebGPUGraphView(rendererHost, handlers, is3D());
registerPanel({ id: PANEL_GRAPH, component: PANEL_GRAPH, title: 'Graph', element: document.getElementById('graphPanel') as HTMLElement });
function frameLoop(timestamp: number): void { callFramePre(timestamp); callFramePost(timestamp); requestAnimationFrame(frameLoop); }
requestAnimationFrame(frameLoop);

export function pinNode(node: FGNode): void { markPinned(node); GraphViewInstance.pinNode(node); }
export function unpinNode(node: FGNode): void { clearPinned(node); GraphViewInstance.unpinNode(node); }
export function requestRecenterView(): void { requestAnimationFrame(() => GraphViewInstance.fitView()); }
export function centerOnNode(nodeId: string, durationMs = 500): void {
    GraphViewInstance.centerOnNodeId(nodeId, durationMs);
}
export function setRenderMode(mode: RenderMode): void {
    if (mode === getRenderMode()) return;
    persistRenderMode(mode);
    setHighlight(null);
    GraphViewInstance.setMode(mode === '3d');
    emit(EVT_RENDER_MODE_CHANGED, mode);
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

    items.push({
        label: 'Center camera here',
        icon: 'filter_center_focus',
        action: () => centerOnNode(node.id),
    });
    items.push({ divider: true });

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
            for (const node of GraphViewInstance.graphData().nodes) {
                pinNode(node);
            }
        },
    });
    items.push({
        label: 'Unpin all',
        icon: 'keep_off',
        action: () => {
            for (const node of GraphViewInstance.graphData().nodes) {
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
            GraphViewInstance.refreshSelection();
        },
    });
    items.push({
        label: 'Unselect all',
        icon: 'deselect',
        disabled: selectedCount === 0,
        action: () => {
            state.selection.selectedNodeIds.clear();
            updateGraphInfo();
            GraphViewInstance.refreshSelection();
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

export function getNodeAtScreen(clientX: number, clientY: number): FGNode | null { return GraphViewInstance.pick(clientX, clientY); }
let lastVisibleSignature: string | null = null;
export async function refreshGraphUI(graphChanged = false): Promise<void> {
    clearColorCaches();
    const graph = getVisibleGraph();
    const degrees = computeNodeDegrees(graph);
    const nodes = graph.getNodes().map(n => ({ ...n, kind: 'node',
        authoredX: n.x, authoredY: n.y, authoredZ: n.z,
        val: getNodeVal(n as FGNode, degrees.get(n.id) ?? 0) } as FGNode));
    const links = graph.getEdges().map(e => ({ ...e, kind: 'edge', source: e.source_id, target: e.target_id } as FGLink));
    if (graphChanged && settings.gpuLinkDistanceMode === 'expression') GraphViewInstance.invalidateLayout();
    mergeGraphData(nodes, links);
    updateGraphInfo();
    const signature = `${nodes.length}:${fnv1a(nodes.map(n => n.id).join('\u0000'))}`;
    if (signature !== lastVisibleSignature) { lastVisibleSignature = signature; emit(EVT_VISIBLE_GRAPH_CHANGED, null); }
}
function mergeGraphData(nodes: FGNode[], links: FGLink[]): void {
    const current = GraphViewInstance.graphData();
    const oldNodes = new Map(current.nodes.map(n => [n.id, n]));
    const merged = nodes.map(node => {
        const existing = oldNodes.get(node.id);
        if (existing) return Object.assign(existing, node);
        const point = pendingNodePositions.get(node.id);
        if (point) { node.x = point.x; node.y = point.y; node.fx = point.x; node.fy = point.y; pendingNodePositions.delete(node.id); }
        return node;
    });
    GraphViewInstance.graphData({ nodes: merged, links });
    GraphViewInstance.setPhysics(state.physicsOverride ?? settings.gpuEnablePhysics);
}
export function refreshGraphColors(): void { clearColorCaches(); GraphViewInstance.refresh(); }
export function refreshNodeSizing(): void {
    const { nodes, links } = GraphViewInstance.graphData();
    const degrees = new Map<string, number>();
    if (settings.nodeSizingMode !== 'constant') for (const link of links) {
        degrees.set(link.source_id, (degrees.get(link.source_id) ?? 0) + 1);
        degrees.set(link.target_id, (degrees.get(link.target_id) ?? 0) + 1);
    }
    for (const node of nodes) node.val = getNodeVal(node, degrees.get(node.id) ?? 0);
    GraphViewInstance.resizeNodes();
}
export function refreshGraphSelection(): void { GraphViewInstance.refreshSelection(); }
export function refreshRenderOptions(): void { GraphViewInstance.syncOptions(); }
export function refreshGraphLinkWidths(): void { GraphViewInstance.refresh(); }
export function rebuildGraphObjects(): void { clearColorCaches(); GraphViewInstance.refresh(); GraphViewInstance.refreshTheme(); }
export function applyGpuParams(): void { GraphViewInstance.updateLayoutOptions(); }
