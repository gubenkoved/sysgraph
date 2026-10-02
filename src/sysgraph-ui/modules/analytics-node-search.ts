import type { Graph, GraphNode } from './graph.js';
import { SearchSyntaxError, search } from './search.js';

export interface NodeCandidates {
    nodes: GraphNode[];
    total: number;
    error: string | null;
}

/** Uses the toolbar's search grammar while keeping the candidate list bounded. */
export function findNodeCandidates(graph: Graph, query: string, limit = 60): NodeCandidates {
    if (graph.nodesMap.size === 0) return { nodes: [], total: 0, error: null };
    if (!query.trim()) {
        const nodes = graph.getNodes();
        return { nodes: nodes.slice(0, limit), total: nodes.length, error: null };
    }
    try {
        const matches = search(graph, query);
        return {
            nodes: matches.slice(0, limit).flatMap(match => {
                const node = graph.getNode(match.nodeId);
                return node ? [node] : [];
            }),
            total: matches.length,
            error: null,
        };
    } catch (error) {
        if (error instanceof SearchSyntaxError) {
            return { nodes: [], total: 0, error: error.message };
        }
        throw error;
    }
}
