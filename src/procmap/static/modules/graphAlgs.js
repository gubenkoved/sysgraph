// TODO: introduce a static type to statically represent graph structure
export function bfs(graph, startNodeId, maxDistance) {
    const nodeDistancesMap = new Map();
    const edgeDistancesMap = new Map();

    const queue = [{ nodeId: startNodeId, distance: 0 }];
    nodeDistancesMap.set(startNodeId, 0);

    // pre-compute map from node id to neighboring edges
    const edgesMap = new Map();

    graph.edges.forEach(edge => {
        const srcId = edge.source_id;
        const tgtId = edge.target_id;

        if (!edgesMap.has(srcId))
            edgesMap.set(srcId, []);

        if (!edgesMap.has(tgtId))
            edgesMap.set(tgtId, []);

        edgesMap.get(srcId).push(edge);
        edgesMap.get(tgtId).push(edge);
    });

    while (queue.length > 0) {
        const { nodeId, distance } = queue.shift();

        if (distance >= maxDistance)
            continue;

        const edges = edgesMap.get(nodeId) || [];

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
