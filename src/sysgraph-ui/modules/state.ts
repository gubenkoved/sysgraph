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
    matchColorsMap: Map<string, string>;
    matches: Match[];
    matchesMap: Map<string, Match>;
    currentMatchIndex: number; // -1 = no match focused yet
}

export type EditSubTool = 'modify' | 'connect';

export interface EditState {
    active: boolean;
    subTool: EditSubTool;
    pendingEdgeSourceId: string | null;
}

export interface AppState {
    graph: Graph;
    highlight: HighlightState | null;
    currentTool: string;
    adjacencyFilter: AdjacencyFilter | null;
    selection: SelectionState;
    search: SearchState | null;
    edit: EditState;
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

function initializeEditState(): EditState {
    return {
        active: false,
        subTool: 'modify',
        pendingEdgeSourceId: null,
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
    edit: initializeEditState(),
};

/** Resets all application state to initial defaults. */
export function resetState(): void {
    state.graph = initializeEmptyGraph();
    state.selection = initializeSelectionState();
    state.adjacencyFilter = null;
    state.highlight = null;
    state.search = null;
    state.edit.pendingEdgeSourceId = null;
    graphDirty = false;
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

export function setEditActive(active: boolean): void {
    state.edit.active = active;
}

export function setEditSubTool(subTool: EditSubTool): void {
    state.edit.subTool = subTool;
}

export function setPendingEdgeSource(nodeId: string | null): void {
    state.edit.pendingEdgeSourceId = nodeId;
}

// --- unsaved-changes tracking -------------------------------------------
// tracks whether the current graph holds data that has not been exported
// since it was last modified; used to warn the user before they close the
// app and lose unexported work
let graphDirty = false;

export function setGraphDirty(value: boolean): void {
    graphDirty = value;
}

export function isGraphDirty(): boolean {
    return graphDirty;
}
