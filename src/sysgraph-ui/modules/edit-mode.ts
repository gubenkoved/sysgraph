import { EVT_GRAPH_UPDATED, EVT_NODE_CLICKED } from './constants.js';
import { emit } from './event-bus.js';
import type { GraphEdge, GraphNode } from './graph.js';
import { generateId } from './graph.js';
import type { FGNode } from './graph-ui.js';
import { ForceGraphInstance, setPendingNodePosition } from './graph-ui.js';
import { getGraph, setGraphDirty, setPendingEdgeSource, state } from './state.js';

let newNodeCounter = 0;

/** Re-emits a node click so its (editable) details form opens. */
function selectNodeById(id: string): void {
    const fgNode = (ForceGraphInstance.graphData().nodes as FGNode[]).find(n => n.id === id);
    if (fgNode) {
        emit(EVT_NODE_CLICKED, { data: fgNode, shiftKey: false });
    }
}

/** Creates a new node at the given graph coordinates and selects it. */
export function createNodeAt(graphX: number, graphY: number): void {
    newNodeCounter++;
    const node: GraphNode = {
        id: generateId(),
        type: 'node',
        properties: { label: `node ${newNodeCounter}` },
    };
    setPendingNodePosition(node.id, graphX, graphY);
    getGraph().addNode(node);
    setGraphDirty(true);
    emit(EVT_GRAPH_UPDATED, null);
    selectNodeById(node.id);
}

/** Creates a directed edge between two existing nodes. */
export function createEdge(sourceId: string, targetId: string): void {
    const edge: GraphEdge = {
        id: generateId(),
        source_id: sourceId,
        target_id: targetId,
        type: 'edge',
        properties: {},
    };
    getGraph().addEdge(edge);
    setGraphDirty(true);
    emit(EVT_GRAPH_UPDATED, null);
}

/** Handles a node click while in edit mode (connect vs. modify sub-tools). */
export function handleEditNodeClick(node: FGNode): void {
    if (state.edit.subTool === 'connect') {
        const sourceId = state.edit.pendingEdgeSourceId;
        if (!sourceId) {
            setPendingEdgeSource(node.id);
            return;
        }
        createEdge(sourceId, node.id);
        setPendingEdgeSource(null);
        return;
    }
    // modify: open the editable form for this node
    emit(EVT_NODE_CLICKED, { data: node, shiftKey: false });
}

/** Starts an edge from the given node (connect sub-tool). */
export function startEdgeFrom(nodeId: string): void {
    setPendingEdgeSource(nodeId);
}

/** Cancels a pending edge creation, if any. */
export function cancelPendingEdge(): void {
    if (state.edit.pendingEdgeSourceId) {
        setPendingEdgeSource(null);
    }
}

/** Removes a node (and its incident edges) from the graph. */
export function deleteNode(id: string): void {
    getGraph().removeNode(id);
    state.selection.selectedNodeIds.delete(id);
    if (state.edit.pendingEdgeSourceId === id) {
        setPendingEdgeSource(null);
    }
    setGraphDirty(true);
    emit(EVT_GRAPH_UPDATED, null);
}

/** Removes an edge from the graph. */
export function deleteEdge(id: string): void {
    getGraph().removeEdge(id);
    setGraphDirty(true);
    emit(EVT_GRAPH_UPDATED, null);
}
