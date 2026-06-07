import type {
    DegreeCentralityResult,
    MstResult,
    ShortestPathResult,
    StatsResult,
} from './analytics-algs.js';
import { computeStats, degreeCentrality, minimumSpanningTree, shortestPath } from './analytics-algs.js';
import { DEFAULT_EDGE_WEIGHT_EXPRESSION, makeEdgeWeightFn } from './analytics-helpers.js';
import { EVT_ANALYTICS_UPDATED } from './constants.js';
import { emit } from './event-bus.js';
import type { FGNode } from './graph-ui.js';
import { getVisibleGraph } from './graph-ui.js';
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

// ---------------------------------------------------------------------------
// algorithm descriptors
// ---------------------------------------------------------------------------

export interface ParamSpec {
    id: string;
    label: string;
    // 'expression' renders a text field; 'boolean' renders a checkbox toggle
    type: 'expression' | 'boolean';
    placeholder?: string;
    defaultValue: string;
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
        picks: [
            { role: 'source', label: 'source' },
            { role: 'target', label: 'target' },
        ],
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

export interface MstResultModel {
    kind: 'mst';
    result: MstResult;
}

export interface DegreeResultModel {
    kind: 'degree';
    result: DegreeCentralityResult;
}

export type AnalyticsResultModel =
    | StatsResultModel
    | ShortestPathResultModel
    | MstResultModel
    | DegreeResultModel;

// ---------------------------------------------------------------------------
// algorithm selection
// ---------------------------------------------------------------------------

/** Selects an algorithm, seeding default parameter values and clearing prior runs. */
export function selectAlgorithm(id: AnalyticsAlgorithmId): void {
    setAnalyticsAlgorithm(id);
    const algo = getAlgorithm(id);
    if (algo) {
        for (const param of algo.params) {
            if (state.analytics.params[param.id] === undefined) {
                setAnalyticsParam(param.id, param.defaultValue);
            }
        }
    }
    clearAnalyticsRun();
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
function decorateSubset(nodeIds: Iterable<string>, edgeIds: Iterable<string>): void {
    setAnalyticsDecoration({
        kind: 'subset',
        nodeIds: new Set(nodeIds),
        edgeIds: new Set(edgeIds),
    });
}

/**
 * Applies a persistent heatmap decoration that recolors nodes on a cold-to-hot
 * scale by their normalized value in [0, 1]. Nodes absent from the map are
 * dimmed. Remains until the algorithm result is cleared.
 */
function decorateHeatmap(nodeValues: Map<string, number>): void {
    setAnalyticsDecoration({ kind: 'heatmap', nodeValues });
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
            decorateSubset(result.nodeIds, result.edgeIds);
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
        for (const entry of result.entries) {
            const t = span > 0 ? (entry.degree - result.minDegree) / span : 0;
            nodeValues.set(entry.nodeId, t);
        }
        decorateHeatmap(nodeValues);
        setAnalyticsResult({ kind: 'degree', result } satisfies DegreeResultModel);
        emit(EVT_ANALYTICS_UPDATED, null);
        return null;
    }

    return null;
}

/** Clears any active analytics highlight and result (e.g. when leaving the tool). */
export function clearAnalytics(): void {
    clearAnalyticsRun();
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
