export class Graph {
    constructor(nodes = [], edges = []) {
        this.nodes = new Map(nodes.map(n => [n.id, n]));
        this.edges = new Map(edges.map(edge => [edge.id, edge]));

        // pre-compute adjacency (edge direction is not considered)
        this.adjacency = new Map();

        for (const nodeId of this.nodes.keys()) {
            this.adjacency.set(nodeId, []);
        }

        for (const edge of edges.values()) {
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
        return [...this.nodes.values()];
    }

    getEdges() {
        return [...this.edges.values()];
    }
}
