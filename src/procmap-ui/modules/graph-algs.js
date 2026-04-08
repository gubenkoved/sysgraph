/**
 * Breadth-first search from a starting node up to a maximum distance.
 * @param {import('./graph.js').Graph} graph
 * @param {string} startNodeId
 * @param {number} maxDistance
 * @returns {{ nodeDistancesMap: Map<string, number>, edgeDistancesMap: Map<string, number> }}
 */
export function bfs(graph, startNodeId, maxDistance) {
    const nodeDistancesMap = new Map();
    const edgeDistancesMap = new Map();

    const queue = [{ nodeId: startNodeId, distance: 0 }];
    nodeDistancesMap.set(startNodeId, 0);

    while (queue.length > 0) {
        const { nodeId, distance } = queue.shift();

        if (distance >= maxDistance)
            continue;

        const edges = graph.adjacency.get(nodeId) || [];

        for (const edge of edges) {
            if (edgeDistancesMap.has(edge.id))
                continue;

            edgeDistancesMap.set(edge.id, distance + 1);

            const neighborNodeId = (edge.source_id === nodeId) ? edge.target_id : edge.source_id;

            if (!nodeDistancesMap.has(neighborNodeId)) {
                nodeDistancesMap.set(neighborNodeId, distance + 1);
                queue.push({ nodeId: neighborNodeId, distance: distance + 1 });
            }
        }
    }

    return {
        nodeDistancesMap: nodeDistancesMap,
        edgeDistancesMap: edgeDistancesMap,
    }
}
