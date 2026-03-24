import { Graph } from './graph.js';

export const state = {
    highlight: null,
    currentTool: "pointer",
    selection: {
        selectedNodeIds: new Set(),
        isSelecting: false,
        selectionStart: null,
        selectionEnd: null,
        selectionStartCanvas: null,
        selectionEndCanvas: null,
    }
}

let graph = initializeEmptyGraph();

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
    graph = newGraph;
}

/**
 @returns {Graph}
*/
export function getGraph() {
    return graph;
}
