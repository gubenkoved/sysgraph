import { Graph } from './graph.js';

// TODO: introduce IMMUTABLE source graph that is only modified via extra stored
// filters; this way it would be easy to reconstuct the filtered graph state and
// have arbitrary undo/redo logic that would not require copying source graph;
// also it would allow better layering of filters for instance ajdacency filter
// should go AFTER we already filtered the grap nodes/edges by type and adjacency
// should be calculate on ALREADY filtered graph
export const state = {
    graph: initializeEmptyGraph(),

    // highlight represents the state to implement feature of highliting
    // neighbor nodes while hovering the node on the graph
    highlight: null,
    currentTool: "pointer",
    adjacencyFilter: null,
    selection: initializeSelectionState(),
    search: null,
}

function initializeSelectionState() {
    return {
        selectedNodeIds: new Set(),
        isSelecting: false,
        selectionStart: null,
        selectionEnd: null,
        selectionStartCanvas: null,
        selectionEndCanvas: null,
    }
}

export function resetState() {
    state.graph = initializeEmptyGraph();
    state.selection = initializeSelectionState();
    state.adjacencyFilter = null;
    state.highlight = null;
    state.search = null;
}

/**
 @returns {Graph}
*/
export function initializeEmptyGraph() {
    return new Graph();
}

/**
 @param {Graph} newGraph
*/
export function updateGraph(newGraph) {
    state.graph = newGraph;
}

/**
 @returns {Graph}
*/
export function getGraph() {
    return state.graph;
}
