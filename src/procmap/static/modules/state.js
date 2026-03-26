import { Graph } from './graph.js';

export const state = {
    graph: initializeEmptyGraph(),
    highlight: null,
    currentTool: "pointer",
    adjacencyFilter: null,
    selection: initializeSelectionState(),
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
