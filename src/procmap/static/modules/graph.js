/**
 * @typedef {Object} GraphNode
 * @property {string} id
 * @property {string} type
 * @property {Object} [properties]
 */

/**
 * @typedef {Object} GraphEdge
 * @property {string} id
 * @property {string} source_id
 * @property {string} target_id
 * @property {string} type
 * @property {Object} [properties]
 */

/**
 * Directed graph with pre-computed adjacency lists.
 */
export class Graph {
    /**
     * @param {GraphNode[]} nodes
     * @param {GraphEdge[]} edges
     */
    constructor(nodes = [], edges = []) {
        /** @type {Map<string, GraphNode>} */
        this.nodesMap = new Map(nodes.map(n => [n.id, n]));
        /** @type {Map<string, GraphEdge>} */
        this.edgesMap = new Map(edges.map(edge => [edge.id, edge]));

        /** @type {Map<string, GraphEdge[]>} */
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
            this.adjacency.get(edge.source_id).push(edge);
            this.adjacency.get(edge.target_id).push(edge);
        }
    }

    /**
     * @returns {GraphNode[]}
     */
    getNodes() {
        return [...this.nodesMap.values()];
    }

    /**
     * @returns {GraphEdge[]}
     */
    getEdges() {
        return [...this.edgesMap.values()];
    }

    /**
     * @param {string} nodeId
     * @returns {GraphEdge[]}
     */
    getAdjacentEdges(nodeId) {
        return this.adjacency.get(nodeId) || [];
    }

    /**
     * @returns {{ nodes: GraphNode[], edges: GraphEdge[] }}
     */
    toData() {
        return {
            nodes: this.getNodes(),
            edges: this.getEdges(),
        }
    }
}

/**
 * Filters a graph based on inclusion functions for nodes and edges.
 * @param {Graph} graph
 * @param {Function} nodeShouldBeIncludedFn
 * @param {Function} edgeShouldBeIncludedFn
 * @returns {Graph}
 */
export function filterGraph(graph, nodeShouldBeIncludedFn, edgeShouldBeIncludedFn) {
    const filteredNodesMap = new Map();

    for (const node of graph.getNodes()) {
        if (!nodeShouldBeIncludedFn(node)) {
            continue;
        }

        filteredNodesMap.set(node.id, node);
    }

    const filteredEdges = new Array();

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
 * @param {Graph} graph
 * @returns {Map<string, number>}
 */
export function computeNodeDegrees(graph) {
    const degrees = new Map();

    for (const node of graph.getNodes()) {
        degrees.set(node.id, 0);
    }

    for (const edge of graph.getEdges()) {
        degrees.set(edge.source_id, degrees.get(edge.source_id) + 1);
        degrees.set(edge.target_id, degrees.get(edge.target_id) + 1);
    }

    return degrees;
}
