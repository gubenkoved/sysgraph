export async function loadDataFromApi() {
    const res = await fetch('/api/graph');

    if (!res.ok)
        throw new Error('Failed to fetch /api/graph: ' + res.status);

    const response = await res.json();

    const nodes = (response.nodes || []).map(n => ({
        id: n.id,
        type: n.type,
        properties: n.properties || {},
    }));

    const links = (response.edges || []).map(e => ({
        id: e.id,
        source_id: e.source_id,
        target_id: e.target_id,
        type: e.type,
        properties: e.properties || {},
    }));

    return {
        nodes: nodes,
        edges: links,
    };
}

export function serializeGraph(graph) {
    return JSON.stringify(graph.toData(), null, 2);
}

export function parseGraphData(text) {
    const data = JSON.parse(text);
    // initialize edge ID if missing
    data.edges.forEach(e => {
        e.id ??= "auto:" + crypto.randomUUID();
        e.type ??= "unknown";
    });
    return data;
}
