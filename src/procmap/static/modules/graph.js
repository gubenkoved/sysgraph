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
 * Undirected graph with pre-computed adjacency lists.
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
