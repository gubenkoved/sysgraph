export class Graph {
    constructor(nodes = [], edges = []) {
        this.nodesMap = new Map(nodes.map(n => [n.id, n]));
        this.edgesMap = new Map(edges.map(edge => [edge.id, edge]));

        // pre-compute adjacency (edge direction is not considered)
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

    getNodes() {
        return [...this.nodesMap.values()];
    }

    getEdges() {
        return [...this.edgesMap.values()];
    }

    toData() {
        return {
            nodes: this.getNodes(),
            edges: this.getEdges(),
        }
    }
}
