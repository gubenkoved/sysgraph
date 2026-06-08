import { Graph } from './graph.js';
import type { Match } from './search.js';

export interface SelectionState {
    selectedNodeIds: Set<string>;
    isSelecting: boolean;
    selectionStart: { x: number; y: number } | null;
    selectionEnd: { x: number; y: number } | null;
    selectionStartCanvas: { x: number; y: number } | null;
    selectionEndCanvas: { x: number; y: number } | null;
    // when true, a new rectangle adds to the existing selection instead of
    // replacing it; primarily a touch affordance since mobile lacks Shift
    additive: boolean;
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

export type AnalyticsAlgorithmId = 'stats' | 'shortest-path' | 'mst' | 'degree';

/**
 * Subset decoration: the listed nodes/edges stay emphasized while everything
 * else is dimmed (e.g. a shortest path or spanning tree).
 */
export interface SubsetDecoration {
    kind: 'subset';
    nodeIds: Set<string>;
    edgeIds: Set<string>;
}

/**
 * Heatmap decoration: each node is recolored on a cold-to-hot scale by its
 * normalized value in [0, 1]; nodes absent from the map are dimmed (e.g. a
 * centrality score across the graph).
 */
export interface HeatmapDecoration {
    kind: 'heatmap';
    nodeValues: Map<string, number>;
}

/**
 * Persistent visual decoration produced by an analytics algorithm; unlike the
 * transient hover highlight, it survives until the result is cleared.
 */
export type AnalyticsDecoration = SubsetDecoration | HeatmapDecoration;

export interface AnalyticsState {
    active: boolean;
    algorithmId: AnalyticsAlgorithmId | null;
    // per-algorithm parameter values keyed by parameter id
    params: Record<string, string>;
    // picked node ids keyed by role (e.g. 'source', 'target')
    pickedNodeIds: Record<string, string>;
    // role currently awaiting a node click, or null when not picking
    awaitingPickRole: string | null;
    // latest computed result (algorithm-specific shape)
    result: unknown | null;
    // persistent canvas decoration for the latest result
    decoration: AnalyticsDecoration | null;
}

export interface AppState {
    graph: Graph;
    highlight: HighlightState | null;
    currentTool: string;
    adjacencyFilter: AdjacencyFilter | null;
    selection: SelectionState;
    search: SearchState | null;
    edit: EditState;
    analytics: AnalyticsState;
}

function initializeSelectionState(): SelectionState {
    return {
        selectedNodeIds: new Set(),
        isSelecting: false,
        selectionStart: null,
        selectionEnd: null,
        selectionStartCanvas: null,
        selectionEndCanvas: null,
        additive: false,
    };
}

function initializeEditState(): EditState {
    return {
        active: false,
        subTool: 'modify',
        pendingEdgeSourceId: null,
    };
}

function initializeAnalyticsState(): AnalyticsState {
    return {
        active: false,
        algorithmId: null,
        params: {},
        pickedNodeIds: {},
        awaitingPickRole: null,
        result: null,
        decoration: null,
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
    analytics: initializeAnalyticsState(),
};

/** Resets all application state to initial defaults. */
export function resetState(): void {
    state.graph = initializeEmptyGraph();
    state.selection = initializeSelectionState();
    state.adjacencyFilter = null;
    state.highlight = null;
    state.search = null;
    state.edit.pendingEdgeSourceId = null;
    state.analytics.pickedNodeIds = {};
    state.analytics.awaitingPickRole = null;
    state.analytics.result = null;
    state.analytics.decoration = null;
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

export function setAnalyticsActive(active: boolean): void {
    state.analytics.active = active;
}

export function setAnalyticsAlgorithm(id: AnalyticsAlgorithmId | null): void {
    state.analytics.algorithmId = id;
}

export function setAnalyticsParam(key: string, value: string): void {
    state.analytics.params[key] = value;
}

export function setAnalyticsPick(role: string, nodeId: string): void {
    state.analytics.pickedNodeIds[role] = nodeId;
}

export function clearAnalyticsPick(role: string): void {
    delete state.analytics.pickedNodeIds[role];
}

export function setAnalyticsAwaitingPick(role: string | null): void {
    state.analytics.awaitingPickRole = role;
}

export function setAnalyticsResult(result: unknown | null): void {
    state.analytics.result = result;
}

export function setAnalyticsDecoration(decoration: AnalyticsDecoration | null): void {
    state.analytics.decoration = decoration;
}

/** Clears analytics picks, awaiting state, result and decoration (keeps params). */
export function clearAnalyticsRun(): void {
    state.analytics.pickedNodeIds = {};
    state.analytics.awaitingPickRole = null;
    state.analytics.result = null;
    state.analytics.decoration = null;
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
