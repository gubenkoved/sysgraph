import type {
    DegreeCentralityResult,
    DistanceResult,
    MstResult,
    ShortestPathResult,
    StatsResult,
} from './analytics-algs.js';
import {
    computeStats,
    degreeCentrality,
    distanceFromSource,
    minimumSpanningTree,
    shortestPath,
} from './analytics-algs.js';
import type { CommunityResult } from './analytics-communities.js';
import { DEFAULT_RESOLUTION, detectCommunities } from './analytics-communities.js';
import { DEFAULT_EDGE_WEIGHT_EXPRESSION, makeEdgeWeightFn } from './analytics-helpers.js';
import { EVT_ANALYTICS_UPDATED } from './constants.js';
import { emit } from './event-bus.js';
import type { FGNode } from './graph-ui.js';
import { getVisibleGraph, refreshGraphColors } from './graph-ui.js';
import {
    type AnalyticsAlgorithmId,
    clearAnalyticsRun,
    setAnalyticsAlgorithm,
    setAnalyticsAwaitingPick,
    setAnalyticsDecoration,
    setAnalyticsParam,
    setAnalyticsPick,
    setAnalyticsResult,
    state,
} from './state.js';

// default width multiplier applied to the shortest-path edges; also the
// starting value of the path-width slider in the results section
export const DEFAULT_PATH_EDGE_WIDTH_MULTIPLIER = 1.5;

// ---------------------------------------------------------------------------
// algorithm descriptors
// ---------------------------------------------------------------------------

export interface ParamSpec {
    id: string;
    label: string;
    // 'expression' renders a text field; 'boolean' renders a toggle;
    // 'slider' renders a range input bounded by min/max/step
    type: 'expression' | 'boolean' | 'slider';
    placeholder?: string;
    defaultValue: string;
    // slider bounds (only used when type is 'slider')
    min?: number;
    max?: number;
    step?: number;
    // optional live side effect invoked after the value is stored; used by
    // result tweakers to update the canvas without re-running the algorithm
    onInput?: (value: string) => void;
}

export interface PickSpec {
    role: string;
    label: string;
}

export interface AlgorithmDescriptor {
    id: AnalyticsAlgorithmId;
    label: string;
    icon: string;
    description: string;
    params: ParamSpec[];
    // controls shown in the results section after a run; applied live
    resultTweakers?: ParamSpec[];
    picks: PickSpec[];
    // true when results highlight a subset of nodes/edges on the canvas
    highlights: boolean;
}

const edgeWeightParam: ParamSpec = {
    id: 'edgeWeightExpression',
    label: 'edge weight',
    type: 'expression',
    placeholder: DEFAULT_EDGE_WEIGHT_EXPRESSION,
    defaultValue: DEFAULT_EDGE_WEIGHT_EXPRESSION,
};

const respectDirectionParam: ParamSpec = {
    id: 'respectDirection',
    label: 'respect direction',
    type: 'boolean',
    defaultValue: 'false',
};

// dedicated edge-weight param for the distance heatmap; defaults to the shared
// expression (length, then weight, then 1) so weighted graphs work out of the
// box, while still being independently editable from the other algorithms
const distanceEdgeWeightParam: ParamSpec = {
    id: 'distanceEdgeWeight',
    label: 'edge weight',
    type: 'expression',
    placeholder: DEFAULT_EDGE_WEIGHT_EXPRESSION,
    defaultValue: DEFAULT_EDGE_WEIGHT_EXPRESSION,
};

const resolutionParam: ParamSpec = {
    id: 'resolution',
    label: 'resolution',
    type: 'slider',
    min: 0.1,
    max: 3,
    step: 0.1,
    defaultValue: String(DEFAULT_RESOLUTION),
};

// result tweaker: scales the on-screen width of the shortest-path edges,
// applying live to the active subset decoration without re-running
const pathWidthTweaker: ParamSpec = {
    id: 'pathEdgeWidth',
    label: 'path width',
    type: 'slider',
    min: 0.5,
    max: 5,
    step: 0.1,
    defaultValue: String(DEFAULT_PATH_EDGE_WIDTH_MULTIPLIER),
    onInput: value => {
        const decoration = state.analytics.decoration;
        if (decoration?.kind === 'subset') {
            decoration.edgeWidthMultiplier = Number(value);
        }
        refreshGraphColors();
    },
};

// result tweaker: toggles drawing the raw per-node value next to each node on
// a heatmap decoration, applying live without re-running
const showValuesTweaker: ParamSpec = {
    id: 'showValues',
    label: 'show values',
    type: 'boolean',
    defaultValue: 'false',
    onInput: value => {
        const decoration = state.analytics.decoration;
        if (decoration?.kind === 'heatmap') {
            decoration.showValues = value === 'true';
        }
        refreshGraphColors();
    },
};

/** Formats a numeric metric for display, dropping decimals when integral. */
function formatMetric(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export const ALGORITHMS: AlgorithmDescriptor[] = [
    {
        id: 'stats',
        label: 'Statistics',
        icon: 'bar_chart',
        description: 'Counts, degree distribution and connected components.',
        params: [],
        picks: [],
        highlights: false,
    },
    {
        id: 'shortest-path',
        label: 'Shortest path',
        icon: 'route',
        description: 'Lowest-weight path between two nodes (Dijkstra).',
        params: [edgeWeightParam, respectDirectionParam],
        resultTweakers: [pathWidthTweaker],
        picks: [
            { role: 'source', label: 'source' },
            { role: 'target', label: 'target' },
        ],
        highlights: true,
    },
    {
        id: 'distance',
        label: 'Distance from node',
        icon: 'social_distance',
        description: 'Colors nodes by graph distance from a chosen node (heatmap).',
        params: [distanceEdgeWeightParam, respectDirectionParam],
        resultTweakers: [showValuesTweaker],
        picks: [{ role: 'source', label: 'source' }],
        highlights: true,
    },
    {
        id: 'mst',
        label: 'Spanning tree',
        icon: 'account_tree',
        description: 'Minimum spanning forest (Kruskal).',
        params: [edgeWeightParam],
        picks: [],
        highlights: true,
    },
    {
        id: 'degree',
        label: 'Degree centrality',
        icon: 'hub',
        description: 'Ranks nodes by their number of connections (heatmap).',
        params: [respectDirectionParam],
        resultTweakers: [showValuesTweaker],
        picks: [],
        highlights: true,
    },
    {
        id: 'community',
        label: 'Communities',
        icon: 'workspaces',
        description: 'Detects densely-connected groups (Louvain) and colors them.',
        params: [edgeWeightParam, resolutionParam],
        picks: [],
        highlights: true,
    },
];

export function getAlgorithm(id: AnalyticsAlgorithmId): AlgorithmDescriptor | undefined {
    return ALGORITHMS.find(a => a.id === id);
}

// ---------------------------------------------------------------------------
// result models exposed to the panel
// ---------------------------------------------------------------------------

export interface StatsResultModel {
    kind: 'stats';
    stats: StatsResult;
}

export interface ShortestPathResultModel {
    kind: 'shortest-path';
    result: ShortestPathResult;
    sourceId: string;
    targetId: string;
}

export interface DistanceResultModel {
    kind: 'distance';
    result: DistanceResult;
    sourceId: string;
}

export interface MstResultModel {
    kind: 'mst';
    result: MstResult;
}

export interface DegreeResultModel {
    kind: 'degree';
    result: DegreeCentralityResult;
}

export interface CommunityResultModel {
    kind: 'community';
    result: CommunityResult;
}

export type AnalyticsResultModel =
    | StatsResultModel
    | ShortestPathResultModel
    | DistanceResultModel
    | MstResultModel
    | DegreeResultModel
    | CommunityResultModel;

// ---------------------------------------------------------------------------
// algorithm selection
// ---------------------------------------------------------------------------

/** Selects an algorithm, seeding default parameter values and clearing prior runs. */
export function selectAlgorithm(id: AnalyticsAlgorithmId): void {
    setAnalyticsAlgorithm(id);
    const algo = getAlgorithm(id);
    if (algo) {
        const specs = [...algo.params, ...(algo.resultTweakers ?? [])];
        for (const param of specs) {
            if (state.analytics.params[param.id] === undefined) {
                setAnalyticsParam(param.id, param.defaultValue);
            }
        }
    }
    clearAnalyticsRun();
    refreshGraphColors();
    emit(EVT_ANALYTICS_UPDATED, null);
}

/** Begins awaiting a node pick for the given role. */
export function startPick(role: string): void {
    setAnalyticsAwaitingPick(role);
    emit(EVT_ANALYTICS_UPDATED, null);
}

/** Handles a node click while analytics is awaiting a pick. */
export function handleAnalyticsNodeClick(node: FGNode): void {
    const role = state.analytics.awaitingPickRole;
    if (!role) return;
    setAnalyticsPick(role, node.id);
    setAnalyticsAwaitingPick(null);
    emit(EVT_ANALYTICS_UPDATED, null);
}

// ---------------------------------------------------------------------------
// running algorithms
// ---------------------------------------------------------------------------

/**
 * Applies a persistent canvas decoration that emphasizes the given nodes/edges
 * and dims everything else. Unlike the transient hover highlight, it remains
 * until the algorithm result is cleared.
 */
function decorateSubset(
    nodeIds: Iterable<string>,
    edgeIds: Iterable<string>,
    edgeWidthMultiplier?: number,
): void {
    setAnalyticsDecoration({
        kind: 'subset',
        nodeIds: new Set(nodeIds),
        edgeIds: new Set(edgeIds),
        edgeWidthMultiplier,
    });
    // 2D redraws every frame, but the 3D renderer only recolors on an explicit
    // refresh, so push the new decoration to the active renderer
    refreshGraphColors();
}

/**
 * Applies a persistent heatmap decoration that recolors nodes on a cold-to-hot
 * scale by their normalized value in [0, 1]. Nodes absent from the map are
 * dimmed. Optional nodeLabels carry the raw value text shown next to each node
 * when the show-values tweaker is on. Remains until the result is cleared.
 */
function decorateHeatmap(
    nodeValues: Map<string, number>,
    nodeLabels?: Map<string, string>,
): void {
    setAnalyticsDecoration({
        kind: 'heatmap',
        nodeValues,
        nodeLabels,
        showValues: state.analytics.params.showValues === 'true',
    });
    refreshGraphColors();
}

/**
 * Applies a persistent community decoration that colors each node by its
 * community index using a categorical palette. Remains until the algorithm
 * result is cleared.
 */
function decorateCommunity(nodeCommunity: Map<string, number>, communityCount: number): void {
    setAnalyticsDecoration({ kind: 'community', nodeCommunity, communityCount });
    refreshGraphColors();
}

/** Reads a numeric parameter from analytics state, falling back when unparseable. */
function readNumberParam(id: string, fallback: number): number {
    const raw = state.analytics.params[id];
    if (raw === undefined) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
}

/**
 * Runs the currently selected algorithm. Returns an error message when the
 * required inputs are missing, otherwise null.
 */
export function runAlgorithm(): string | null {
    const id = state.analytics.algorithmId;
    if (!id) return 'No algorithm selected';

    // operate on the graph as currently rendered (post type/adjacency/isolated
    // filters) so results match what the user sees
    const graph = getVisibleGraph();

    if (id === 'stats') {
        const stats = computeStats(graph);
        setAnalyticsDecoration(null);
        refreshGraphColors();
        setAnalyticsResult({ kind: 'stats', stats } satisfies StatsResultModel);
        emit(EVT_ANALYTICS_UPDATED, null);
        return null;
    }

    const weightExpr = state.analytics.params.edgeWeightExpression ?? DEFAULT_EDGE_WEIGHT_EXPRESSION;
    const weightFn = makeEdgeWeightFn(weightExpr);

    if (id === 'shortest-path') {
        const sourceId = state.analytics.pickedNodeIds.source;
        const targetId = state.analytics.pickedNodeIds.target;
        if (!sourceId) return 'Pick a source node';
        if (!targetId) return 'Pick a target node';
        const respectDirection = state.analytics.params.respectDirection === 'true';
        const result = shortestPath(graph, sourceId, targetId, weightFn, respectDirection);
        if (result.found) {
            decorateSubset(
                result.nodeIds,
                result.edgeIds,
                readNumberParam('pathEdgeWidth', DEFAULT_PATH_EDGE_WIDTH_MULTIPLIER),
            );
        } else {
            setAnalyticsDecoration(null);
        }
        setAnalyticsResult({
            kind: 'shortest-path',
            result,
            sourceId,
            targetId,
        } satisfies ShortestPathResultModel);
        emit(EVT_ANALYTICS_UPDATED, null);
        return null;
    }

    if (id === 'distance') {
        const sourceId = state.analytics.pickedNodeIds.source;
        if (!sourceId) return 'Pick a source node';
        // dedicated weight expression (length, then weight, then 1)
        const distanceWeightFn = makeEdgeWeightFn(
            state.analytics.params.distanceEdgeWeight ?? DEFAULT_EDGE_WEIGHT_EXPRESSION,
        );
        const respectDirection = state.analytics.params.respectDirection === 'true';
        const result = distanceFromSource(graph, sourceId, distanceWeightFn, respectDirection);
        // map distance to a heatmap value where the source is hottest (1) and
        // the farthest reachable node is coldest (0); unreachable nodes are
        // omitted so they dim
        const nodeValues = new Map<string, number>();
        const nodeLabels = new Map<string, string>();
        for (const entry of result.entries) {
            const t = result.maxDistance > 0 ? 1 - entry.distance / result.maxDistance : 1;
            nodeValues.set(entry.nodeId, t);
            nodeLabels.set(entry.nodeId, formatMetric(entry.distance));
        }
        decorateHeatmap(nodeValues, nodeLabels);
        setAnalyticsResult({
            kind: 'distance',
            result,
            sourceId,
        } satisfies DistanceResultModel);
        emit(EVT_ANALYTICS_UPDATED, null);
        return null;
    }

    if (id === 'mst') {
        const result = minimumSpanningTree(graph, weightFn);
        decorateSubset(result.nodeIds, result.edgeIds);
        setAnalyticsResult({ kind: 'mst', result } satisfies MstResultModel);
        emit(EVT_ANALYTICS_UPDATED, null);
        return null;
    }

    if (id === 'degree') {
        const respectDirection = state.analytics.params.respectDirection === 'true';
        const result = degreeCentrality(graph, respectDirection);
        // normalize degree into [0, 1] for the heatmap (min-max across the graph)
        const span = result.maxDegree - result.minDegree;
        const nodeValues = new Map<string, number>();
        const nodeLabels = new Map<string, string>();
        for (const entry of result.entries) {
            const t = span > 0 ? (entry.degree - result.minDegree) / span : 0;
            nodeValues.set(entry.nodeId, t);
            nodeLabels.set(entry.nodeId, String(entry.degree));
        }
        decorateHeatmap(nodeValues, nodeLabels);
        setAnalyticsResult({ kind: 'degree', result } satisfies DegreeResultModel);
        emit(EVT_ANALYTICS_UPDATED, null);
        return null;
    }

    if (id === 'community') {
        const resolution = readNumberParam('resolution', DEFAULT_RESOLUTION);
        const result = detectCommunities(graph, weightFn, { resolution });
        decorateCommunity(result.nodeCommunity, result.communityCount);
        setAnalyticsResult({ kind: 'community', result } satisfies CommunityResultModel);
        emit(EVT_ANALYTICS_UPDATED, null);
        return null;
    }

    return null;
}

/** Clears any active analytics highlight and result (e.g. when leaving the tool). */
export function clearAnalytics(): void {
    clearAnalyticsRun();
    refreshGraphColors();
    emit(EVT_ANALYTICS_UPDATED, null);
}

/**
 * Suspends analytics when switching away to another tool: cancels any pending
 * node pick so it doesn't dangle, but preserves picks, result and decoration so
 * the run can be resumed when the tool is re-entered.
 */
export function suspendAnalytics(): void {
    setAnalyticsAwaitingPick(null);
    emit(EVT_ANALYTICS_UPDATED, null);
}
