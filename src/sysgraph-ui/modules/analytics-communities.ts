import type { EdgeWeightFn } from './analytics-algs.js';
import type { Graph } from './graph.js';

// ---------------------------------------------------------------------------
// community detection (Louvain, weighted & undirected)
// ---------------------------------------------------------------------------

export interface Community {
    // stable id assigned after sorting communities by size (0 = largest)
    id: number;
    nodeIds: string[];
    size: number;
}

export interface CommunityResult {
    communities: Community[];
    // base node id -> community id
    nodeCommunity: Map<string, number>;
    communityCount: number;
    // modularity of the final partition (higher is a stronger structure)
    modularity: number;
}

/** Tunable parameters for the Louvain method. */
export interface CommunityOptions {
    // null-model scaling: >1 yields more/smaller communities, <1 fewer/larger
    resolution?: number;
}

// default tuning parameter (also the slider midpoint)
export const DEFAULT_RESOLUTION = 1.0;

// internal convergence caps; effectively never reached on real graphs
const MAX_LEVELS = 20;
const MAX_PASSES = 50;

// weights at or below zero are meaningless for community structure, so clamp
const MIN_COMMUNITY_WEIGHT = 1e-9;

/**
 * Partitions the graph into communities using the Louvain method (modularity
 * maximization). The graph is treated as undirected and weighted via weightFn;
 * self-loops are ignored. Communities are returned sorted by size descending
 * with stable ids (0 = largest).
 */
export function detectCommunities(
    graph: Graph,
    weightFn: EdgeWeightFn,
    options: CommunityOptions = {},
): CommunityResult {
    const resolution = options.resolution ?? DEFAULT_RESOLUTION;

    const nodes = graph.getNodes();
    const n = nodes.length;
    if (n === 0) {
        return { communities: [], nodeCommunity: new Map(), communityCount: 0, modularity: 0 };
    }

    const indexOf = new Map<string, number>();
    nodes.forEach((node, i) => {
        indexOf.set(node.id, i);
    });

    // collapse parallel edges and drop self-loops into a weighted adjacency
    const baseAdj: Map<number, number>[] = Array.from({ length: n }, () => new Map<number, number>());
    for (const edge of graph.getEdges()) {
        const a = indexOf.get(edge.source_id);
        const b = indexOf.get(edge.target_id);
        if (a === undefined || b === undefined || a === b) continue;
        const w = Math.max(weightFn(edge), MIN_COMMUNITY_WEIGHT);
        baseAdj[a]!.set(b, (baseAdj[a]!.get(b) ?? 0) + w);
        baseAdj[b]!.set(a, (baseAdj[b]!.get(a) ?? 0) + w);
    }

    // flat undirected edge list (each pair once) for the modularity computation
    const baseEdges: { a: number; b: number; w: number }[] = [];
    for (let i = 0; i < n; i++) {
        for (const [j, w] of baseAdj[i]!) {
            if (i < j) baseEdges.push({ a: i, b: j, w });
        }
    }

    const rawLabel = runLouvain(baseAdj, n, resolution);

    // group base nodes by final label and sort communities by size descending
    const groups = new Map<number, string[]>();
    for (let i = 0; i < n; i++) {
        const label = rawLabel[i]!;
        const ids = groups.get(label);
        if (ids) ids.push(nodes[i]!.id);
        else groups.set(label, [nodes[i]!.id]);
    }
    const ordered = [...groups.values()].sort((a, b) => b.length - a.length);

    const communities: Community[] = [];
    const nodeCommunity = new Map<string, number>();
    const finalLabel = new Int32Array(n);
    ordered.forEach((nodeIds, id) => {
        communities.push({ id, nodeIds, size: nodeIds.length });
        for (const nodeId of nodeIds) {
            nodeCommunity.set(nodeId, id);
            finalLabel[indexOf.get(nodeId)!] = id;
        }
    });

    const modularity = computeModularity(baseEdges, finalLabel, n, resolution);

    return {
        communities,
        nodeCommunity,
        communityCount: communities.length,
        modularity,
    };
}

/**
 * Runs the multi-level Louvain method and returns a community label per base
 * node index. Labels are arbitrary integers (not yet compacted/sorted).
 */
function runLouvain(
    baseAdj: Map<number, number>[],
    n: number,
    resolution: number,
): Int32Array {
    // current working ("super") graph; starts as the base graph
    let neighbors = baseAdj;
    let selfLoops = new Float64Array(n);
    let levelSize = n;

    // base node index -> current super-node index
    const baseLabel = new Int32Array(n);
    for (let i = 0; i < n; i++) baseLabel[i] = i;

    for (let level = 0; level < MAX_LEVELS; level++) {
        const { community, moved } = localMoving(neighbors, selfLoops, levelSize, resolution);

        // compact the resulting labels into a dense 0..C-1 range
        const relabel = new Map<number, number>();
        const compact = new Int32Array(levelSize);
        let next = 0;
        for (let i = 0; i < levelSize; i++) {
            const c = community[i]!;
            let r = relabel.get(c);
            if (r === undefined) {
                r = next++;
                relabel.set(c, r);
            }
            compact[i] = r;
        }
        const communityCount = next;

        // propagate the new labels down to the base nodes
        for (let i = 0; i < n; i++) baseLabel[i] = compact[baseLabel[i]!]!;

        if (!moved || communityCount === levelSize) break;

        // aggregate communities into the next level's super graph
        const superNeighbors: Map<number, number>[] = Array.from(
            { length: communityCount },
            () => new Map<number, number>(),
        );
        const superSelf = new Float64Array(communityCount);
        for (let i = 0; i < levelSize; i++) {
            const ci = compact[i]!;
            superSelf[ci] += selfLoops[i]!;
            for (const [j, w] of neighbors[i]!) {
                const cj = compact[j]!;
                if (ci === cj) {
                    // each intra-community edge is seen from both endpoints
                    superSelf[ci] += w / 2;
                } else {
                    superNeighbors[ci]!.set(cj, (superNeighbors[ci]!.get(cj) ?? 0) + w);
                }
            }
        }

        neighbors = superNeighbors;
        selfLoops = superSelf;
        levelSize = communityCount;
    }

    return baseLabel;
}

/**
 * One level of Louvain local moving: greedily moves nodes between communities
 * to maximize modularity until no move improves it.
 */
function localMoving(
    neighbors: Map<number, number>[],
    selfLoops: Float64Array,
    size: number,
    resolution: number,
): { community: Int32Array; moved: boolean } {
    // weighted degree k_i = sum of incident weights + twice the self-loop
    const degree = new Float64Array(size);
    let m2 = 0; // 2m: total weighted degree
    for (let i = 0; i < size; i++) {
        let d = 2 * selfLoops[i]!;
        for (const [, w] of neighbors[i]!) d += w;
        degree[i] = d;
        m2 += d;
    }

    const community = new Int32Array(size);
    const sigmaTot = new Float64Array(size);
    for (let i = 0; i < size; i++) {
        community[i] = i;
        sigmaTot[i] = degree[i]!;
    }

    if (m2 === 0) {
        // no edges: every node stays in its own community
        return { community, moved: false };
    }

    let anyMoved = false;
    for (let iter = 0; iter < MAX_PASSES; iter++) {
        let movedThisPass = false;
        for (let i = 0; i < size; i++) {
            const ci = community[i]!;

            // total weight from i to each neighboring community
            const weightToComm = new Map<number, number>();
            for (const [j, w] of neighbors[i]!) {
                const cj = community[j]!;
                weightToComm.set(cj, (weightToComm.get(cj) ?? 0) + w);
            }

            // tentatively remove i from its community
            sigmaTot[ci] -= degree[i]!;

            // staying put is the baseline; only a strictly better gain moves i.
            // the null-model term is scaled by the resolution parameter
            let bestComm = ci;
            let bestGain =
                (weightToComm.get(ci) ?? 0) - (resolution * sigmaTot[ci]! * degree[i]!) / m2;
            for (const [c, wToC] of weightToComm) {
                if (c === ci) continue;
                const gain = wToC - (resolution * sigmaTot[c]! * degree[i]!) / m2;
                if (gain > bestGain) {
                    bestGain = gain;
                    bestComm = c;
                }
            }

            sigmaTot[bestComm] += degree[i]!;
            community[i] = bestComm;
            if (bestComm !== ci) {
                movedThisPass = true;
                anyMoved = true;
            }
        }
        if (!movedThisPass) break;
    }

    return { community, moved: anyMoved };
}

/** Computes the modularity of a partition over the weighted base graph. */
function computeModularity(
    edges: { a: number; b: number; w: number }[],
    label: Int32Array,
    n: number,
    resolution: number,
): number {
    let m = 0;
    const k = new Float64Array(n);
    for (const { a, b, w } of edges) {
        m += w;
        k[a] += w;
        k[b] += w;
    }
    if (m === 0) return 0;

    const intra = new Map<number, number>();
    const tot = new Map<number, number>();
    for (let i = 0; i < n; i++) {
        const c = label[i]!;
        tot.set(c, (tot.get(c) ?? 0) + k[i]!);
    }
    for (const { a, b, w } of edges) {
        if (label[a] === label[b]) {
            const c = label[a]!;
            intra.set(c, (intra.get(c) ?? 0) + w);
        }
    }

    let q = 0;
    for (const [c, t] of tot) {
        const lc = intra.get(c) ?? 0;
        q += lc / m - resolution * (t / (2 * m)) ** 2;
    }
    return q;
}
