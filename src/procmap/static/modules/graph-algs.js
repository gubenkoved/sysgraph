/**
 @param {import('./graph.js').Graph} graph
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

/**
 *
 * @returns {boolean} True if matching
 */
function isMatching(data, expression) {
    // Convert primitive values to string and check
    if (data === null || data === undefined) return false;

    if (typeof data !== "object") {
        return String(data).includes(expression);
    }

    // If data is an object/array, recursively check all values
    for (const key in data) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
            const value = data[key];
            if (isMatching(value, expression)) {
                return true;
            }
        }
    }

    return false;
}

/**
 @param {import('./graph.js').Graph} graph
*/
export function search(graph, expression) {
    const matchedNodeIds = new Set();

    for (const node of graph.getNodes()) {
        if (isMatching(node, expression)) {
            matchedNodeIds.add(node.id);
        }
    }

    return {
        nodeIds: [],
    }
}
