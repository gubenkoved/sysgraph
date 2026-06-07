import type { Graph, GraphEdge } from './graph.js';

/** Per-edge weight function used by weighted algorithms. */
export type EdgeWeightFn = (edge: GraphEdge) => number;

// ---------------------------------------------------------------------------
// graph statistics
// ---------------------------------------------------------------------------

export interface StatsResult {
    nodeCount: number;
    edgeCount: number;
    nodeTypeCounts: [string, number][];
    edgeTypeCounts: [string, number][];
    degreeMin: number;
    degreeMax: number;
    degreeAvg: number;
    isolatedCount: number;
    componentCount: number;
    largestComponentSize: number;
}

/** Computes summary statistics for the graph (undirected interpretation). */
export function computeStats(graph: Graph): StatsResult {
    const nodes = graph.getNodes();
    const edges = graph.getEdges();

    const nodeTypeCounts = new Map<string, number>();
    for (const node of nodes) {
        nodeTypeCounts.set(node.type, (nodeTypeCounts.get(node.type) ?? 0) + 1);
    }

    const edgeTypeCounts = new Map<string, number>();
    for (const edge of edges) {
        edgeTypeCounts.set(edge.type, (edgeTypeCounts.get(edge.type) ?? 0) + 1);
    }

    // degree = number of incident edges (adjacency holds both directions)
    let degreeMin = Number.POSITIVE_INFINITY;
    let degreeMax = 0;
    let degreeSum = 0;
    let isolatedCount = 0;
    for (const node of nodes) {
        const degree = graph.getAdjacentEdges(node.id).length;
        degreeMin = Math.min(degreeMin, degree);
        degreeMax = Math.max(degreeMax, degree);
        degreeSum += degree;
        if (degree === 0) isolatedCount++;
    }
    if (nodes.length === 0) degreeMin = 0;

    const { componentCount, largestComponentSize } = computeComponents(graph);

    return {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        nodeTypeCounts: [...nodeTypeCounts.entries()].sort((a, b) => b[1] - a[1]),
        edgeTypeCounts: [...edgeTypeCounts.entries()].sort((a, b) => b[1] - a[1]),
        degreeMin,
        degreeMax,
        degreeAvg: nodes.length > 0 ? degreeSum / nodes.length : 0,
        isolatedCount,
        componentCount,
        largestComponentSize,
    };
}

/** Counts connected components (undirected) and the largest component size. */
function computeComponents(graph: Graph): {
    componentCount: number;
    largestComponentSize: number;
} {
    const visited = new Set<string>();
    let componentCount = 0;
    let largestComponentSize = 0;

    for (const node of graph.getNodes()) {
        if (visited.has(node.id)) continue;
        componentCount++;
        let size = 0;
        const stack = [node.id];
        visited.add(node.id);
        while (stack.length > 0) {
            const current = stack.pop()!;
            size++;
            for (const edge of graph.getAdjacentEdges(current)) {
                const neighbor = edge.source_id === current ? edge.target_id : edge.source_id;
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    stack.push(neighbor);
                }
            }
        }
        largestComponentSize = Math.max(largestComponentSize, size);
    }

    return { componentCount, largestComponentSize };
}

// ---------------------------------------------------------------------------
// shortest path (Dijkstra, undirected)
// ---------------------------------------------------------------------------

export interface ShortestPathResult {
    found: boolean;
    nodeIds: string[];
    edgeIds: string[];
    // cumulative weight from the source to each node in nodeIds (aligned 1:1)
    nodeDistances: number[];
    totalWeight: number;
}

/**
 * Finds the lowest-weight path between two nodes using Dijkstra's algorithm.
 * Edge weights are produced by weightFn; non-positive weights are clamped to a
 * small positive epsilon. When respectDirection is true, edges may only be
 * traversed from source_id to target_id; otherwise the graph is treated as
 * undirected.
 */
export function shortestPath(
    graph: Graph,
    sourceId: string,
    targetId: string,
    weightFn: EdgeWeightFn,
    respectDirection = false,
): ShortestPathResult {
    const empty: ShortestPathResult = {
        found: false,
        nodeIds: [],
        edgeIds: [],
        nodeDistances: [],
        totalWeight: 0,
    };
    if (!graph.getNode(sourceId) || !graph.getNode(targetId)) return empty;

    const distances = new Map<string, number>();
    const prevEdge = new Map<string, GraphEdge>();
    const visited = new Set<string>();
    distances.set(sourceId, 0);

    // simple O(V^2) selection; adequate for interactive graph sizes
    const pending = new Set<string>([sourceId]);
    for (const edge of graph.getEdges()) {
        pending.add(edge.source_id);
        pending.add(edge.target_id);
    }

    while (pending.size > 0) {
        let current: string | null = null;
        let best = Number.POSITIVE_INFINITY;
        for (const id of pending) {
            const d = distances.get(id) ?? Number.POSITIVE_INFINITY;
            if (d < best) {
                best = d;
                current = id;
            }
        }
        if (current === null || best === Number.POSITIVE_INFINITY) break;

        pending.delete(current);
        visited.add(current);
        if (current === targetId) break;

        for (const edge of graph.getAdjacentEdges(current)) {
            // in directed mode only follow edges leaving the current node
            if (respectDirection && edge.source_id !== current) continue;
            const neighbor = edge.source_id === current ? edge.target_id : edge.source_id;
            if (visited.has(neighbor)) continue;
            const weight = Math.max(weightFn(edge), 1e-9);
            const candidate = best + weight;
            if (candidate < (distances.get(neighbor) ?? Number.POSITIVE_INFINITY)) {
                distances.set(neighbor, candidate);
                prevEdge.set(neighbor, edge);
            }
        }
    }

    if (!distances.has(targetId)) return empty;

    // reconstruct path from target back to source
    const nodeIds: string[] = [];
    const edgeIds: string[] = [];
    let cursor = targetId;
    while (cursor !== sourceId) {
        nodeIds.push(cursor);
        const edge = prevEdge.get(cursor);
        if (!edge) return empty;
        edgeIds.push(edge.id);
        cursor = edge.source_id === cursor ? edge.target_id : edge.source_id;
    }
    nodeIds.push(sourceId);
    nodeIds.reverse();
    edgeIds.reverse();

    const nodeDistances = nodeIds.map(id => distances.get(id) ?? 0);

    return {
        found: true,
        nodeIds,
        edgeIds,
        nodeDistances,
        totalWeight: distances.get(targetId) ?? 0,
    };
}

// ---------------------------------------------------------------------------
// minimum spanning tree (Kruskal)
// ---------------------------------------------------------------------------

export interface MstResult {
    edgeIds: string[];
    nodeIds: string[];
    totalWeight: number;
    components: number;
}

/**
 * Computes a minimum spanning forest using Kruskal's algorithm. For graphs with
 * multiple connected components, one spanning tree per component is produced.
 */
export function minimumSpanningTree(graph: Graph, weightFn: EdgeWeightFn): MstResult {
    const parent = new Map<string, string>();
    const rank = new Map<string, number>();
    for (const node of graph.getNodes()) {
        parent.set(node.id, node.id);
        rank.set(node.id, 0);
    }

    const find = (x: string): string => {
        let root = x;
        while (parent.get(root) !== root) {
            root = parent.get(root)!;
        }
        // path compression
        let cursor = x;
        while (parent.get(cursor) !== root) {
            const next = parent.get(cursor)!;
            parent.set(cursor, root);
            cursor = next;
        }
        return root;
    };

    const union = (a: string, b: string): boolean => {
        const ra = find(a);
        const rb = find(b);
        if (ra === rb) return false;
        const rankA = rank.get(ra)!;
        const rankB = rank.get(rb)!;
        if (rankA < rankB) {
            parent.set(ra, rb);
        } else if (rankA > rankB) {
            parent.set(rb, ra);
        } else {
            parent.set(rb, ra);
            rank.set(ra, rankA + 1);
        }
        return true;
    };

    const sortedEdges = graph
        .getEdges()
        .map(edge => ({ edge, weight: weightFn(edge) }))
        .sort((a, b) => a.weight - b.weight);

    const edgeIds: string[] = [];
    const nodeIds = new Set<string>();
    let totalWeight = 0;
    for (const { edge, weight } of sortedEdges) {
        if (union(edge.source_id, edge.target_id)) {
            edgeIds.push(edge.id);
            nodeIds.add(edge.source_id);
            nodeIds.add(edge.target_id);
            totalWeight += weight;
        }
    }

    // count distinct components (roots)
    const roots = new Set<string>();
    for (const node of graph.getNodes()) {
        roots.add(find(node.id));
    }

    return {
        edgeIds,
        nodeIds: [...nodeIds],
        totalWeight,
        components: roots.size,
    };
}

// ---------------------------------------------------------------------------
// degree centrality
// ---------------------------------------------------------------------------

export interface DegreeEntry {
    nodeId: string;
    // total incident edges (counts both directions)
    degree: number;
    // edges pointing at the node (only meaningful when respectDirection)
    inDegree: number;
    // edges leaving the node (only meaningful when respectDirection)
    outDegree: number;
    // degree divided by (N - 1); the classic degree-centrality measure
    normalized: number;
}

export interface DegreeCentralityResult {
    // entries sorted by degree descending
    entries: DegreeEntry[];
    minDegree: number;
    maxDegree: number;
    respectDirection: boolean;
}

/**
 * Computes degree centrality for every node. The total degree counts all
 * incident edges; when respectDirection is true the in/out split is also
 * reported (self-loops contribute to both). Ranking is always by total degree.
 */
export function degreeCentrality(graph: Graph, respectDirection = false): DegreeCentralityResult {
    const nodes = graph.getNodes();
    const denominator = nodes.length > 1 ? nodes.length - 1 : 1;

    const entries: DegreeEntry[] = [];
    let minDegree = Number.POSITIVE_INFINITY;
    let maxDegree = 0;

    for (const node of nodes) {
        const adjacent = graph.getAdjacentEdges(node.id);
        const degree = adjacent.length;

        let inDegree = 0;
        let outDegree = 0;
        if (respectDirection) {
            for (const edge of adjacent) {
                if (edge.target_id === node.id) inDegree++;
                if (edge.source_id === node.id) outDegree++;
            }
        }

        minDegree = Math.min(minDegree, degree);
        maxDegree = Math.max(maxDegree, degree);

        entries.push({
            nodeId: node.id,
            degree,
            inDegree,
            outDegree,
            normalized: degree / denominator,
        });
    }

    if (nodes.length === 0) minDegree = 0;
    entries.sort((a, b) => b.degree - a.degree);

    return { entries, minDegree, maxDegree, respectDirection };
}
