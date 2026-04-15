import { Graph } from './graph.js';
import type { Match } from './search.js';

export interface SelectionState {
    selectedNodeIds: Set<string>;
    isSelecting: boolean;
    selectionStart: { x: number; y: number } | null;
    selectionEnd: { x: number; y: number } | null;
    selectionStartCanvas: { x: number; y: number } | null;
    selectionEndCanvas: { x: number; y: number } | null;
}

export interface AdjacencyFilter {
    visibleNodeIds: Set<string>;
    hiddenCounts: Map<string, number>;
}

export interface HighlightState {
    nodeDistancesMap: Map<string, number>;
    edgeDistancesMap: Map<string, number>;
}

export interface SearchState {
    matchesMap: Map<string, Match>;
    matchColorsMap: Map<string, string>;
}

export interface AppState {
    graph: Graph;
    highlight: HighlightState | null;
    currentTool: string;
    adjacencyFilter: AdjacencyFilter | null;
    selection: SelectionState;
    search: SearchState | null;
}

function initializeSelectionState(): SelectionState {
    return {
        selectedNodeIds: new Set(),
        isSelecting: false,
        selectionStart: null,
        selectionEnd: null,
        selectionStartCanvas: null,
        selectionEndCanvas: null,
    };
}

export function initializeEmptyGraph(): Graph {
    return new Graph();
}

export const state: AppState = {
    graph: initializeEmptyGraph(),
    highlight: null,
    currentTool: 'pointer',
    adjacencyFilter: null,
    selection: initializeSelectionState(),
    search: null,
};

/** Resets all application state to initial defaults. */
export function resetState(): void {
    state.graph = initializeEmptyGraph();
    state.selection = initializeSelectionState();
    state.adjacencyFilter = null;
    state.highlight = null;
    state.search = null;
}

export function updateGraph(newGraph: Graph): void {
    state.graph = newGraph;
}

export function getGraph(): Graph {
    return state.graph;
}

export function setHighlight(value: HighlightState | null): void {
    state.highlight = value;
}

export function setSearch(value: SearchState | null): void {
    state.search = value;
}

export function setAdjacencyFilter(value: AdjacencyFilter | null): void {
    state.adjacencyFilter = value;
}

export function setCurrentTool(tool: string): void {
    state.currentTool = tool;
}
