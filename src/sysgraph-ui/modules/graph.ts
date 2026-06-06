export interface GraphNode {
    id: string;
    type: string;
    properties?: Record<string, unknown>;
}

export interface GraphEdge {
    id: string;
    source_id: string;
    target_id: string;
    type: string;
    properties?: Record<string, unknown>;
}

/**
 * Directed graph with pre-computed adjacency lists.
 */
export class Graph {
    readonly nodesMap: Map<string, GraphNode>;
    readonly edgesMap: Map<string, GraphEdge>;
    readonly adjacency: Map<string, GraphEdge[]>;

    constructor(nodes: GraphNode[] = [], edges: GraphEdge[] = []) {
        this.nodesMap = new Map(nodes.map(n => [n.id, n]));
        this.edgesMap = new Map(edges.map(edge => [edge.id, edge]));
        this.adjacency = new Map();

        for (const nodeId of this.nodesMap.keys()) {
            this.adjacency.set(nodeId, []);
        }

        for (const edge of this.edgesMap.values()) {
            if (!this.adjacency.has(edge.source_id)) {
                this.adjacency.set(edge.source_id, []);
            }
            if (!this.adjacency.has(edge.target_id)) {
                this.adjacency.set(edge.target_id, []);
            }
            this.adjacency.get(edge.source_id)!.push(edge);
            this.adjacency.get(edge.target_id)!.push(edge);
        }
    }

    getNodes(): GraphNode[] {
        return [...this.nodesMap.values()];
    }

    getEdges(): GraphEdge[] {
        return [...this.edgesMap.values()];
    }

    getAdjacentEdges(nodeId: string): GraphEdge[] {
        return this.adjacency.get(nodeId) ?? [];
    }

    getNode(nodeId: string): GraphNode | undefined {
        return this.nodesMap.get(nodeId);
    }

    getEdge(edgeId: string): GraphEdge | undefined {
        return this.edgesMap.get(edgeId);
    }

    /** Adds a node. Existing nodes with the same id are replaced. */
    addNode(node: GraphNode): void {
        this.nodesMap.set(node.id, node);
        if (!this.adjacency.has(node.id)) {
            this.adjacency.set(node.id, []);
        }
    }

    /** Adds an edge and updates the adjacency index. */
    addEdge(edge: GraphEdge): void {
        this.edgesMap.set(edge.id, edge);
        if (!this.adjacency.has(edge.source_id)) {
            this.adjacency.set(edge.source_id, []);
        }
        if (!this.adjacency.has(edge.target_id)) {
            this.adjacency.set(edge.target_id, []);
        }
        this.adjacency.get(edge.source_id)!.push(edge);
        if (edge.source_id !== edge.target_id) {
            this.adjacency.get(edge.target_id)!.push(edge);
        }
    }

    /** Removes an edge by id and updates the adjacency index. */
    removeEdge(edgeId: string): void {
        const edge = this.edgesMap.get(edgeId);
        if (!edge) {
            return;
        }
        this.edgesMap.delete(edgeId);

        const sourceEdges = this.adjacency.get(edge.source_id);
        if (sourceEdges) {
            this.adjacency.set(
                edge.source_id,
                sourceEdges.filter(e => e.id !== edgeId),
            );
        }
        const targetEdges = this.adjacency.get(edge.target_id);
        if (targetEdges) {
            this.adjacency.set(
                edge.target_id,
                targetEdges.filter(e => e.id !== edgeId),
            );
        }
    }

    /** Removes a node by id along with all edges incident to it. */
    removeNode(nodeId: string): void {
        for (const edge of this.getEdges()) {
            if (edge.source_id === nodeId || edge.target_id === nodeId) {
                this.removeEdge(edge.id);
            }
        }
        this.nodesMap.delete(nodeId);
        this.adjacency.delete(nodeId);
    }

    toData(): { nodes: GraphNode[]; edges: GraphEdge[] } {
        return {
            nodes: this.getNodes(),
            edges: this.getEdges(),
        };
    }
}

/** Generates a unique id suitable for new nodes or edges. */
export function generateId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Filters a graph based on inclusion predicates for nodes and edges.
 */
export function filterGraph(
    graph: Graph,
    nodeShouldBeIncludedFn: (node: GraphNode) => boolean,
    edgeShouldBeIncludedFn: (edge: GraphEdge) => boolean,
): Graph {
    const filteredNodesMap = new Map<string, GraphNode>();

    for (const node of graph.getNodes()) {
        if (!nodeShouldBeIncludedFn(node)) {
            continue;
        }
        filteredNodesMap.set(node.id, node);
    }

    const filteredEdges: GraphEdge[] = [];

    for (const edge of graph.getEdges()) {
        if (!filteredNodesMap.has(edge.source_id) || !filteredNodesMap.has(edge.target_id)) {
            continue;
        }
        if (!edgeShouldBeIncludedFn(edge)) {
            continue;
        }
        filteredEdges.push(edge);
    }

    return new Graph(Array.from(filteredNodesMap.values()), filteredEdges);
}

/**
 * Computes the degree of each node in the graph.
 */
export function computeNodeDegrees(graph: Graph): Map<string, number> {
    const degrees = new Map<string, number>();

    for (const node of graph.getNodes()) {
        degrees.set(node.id, 0);
    }

    for (const edge of graph.getEdges()) {
        degrees.set(edge.source_id, (degrees.get(edge.source_id) ?? 0) + 1);
        degrees.set(edge.target_id, (degrees.get(edge.target_id) ?? 0) + 1);
    }

    return degrees;
}
