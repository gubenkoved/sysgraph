import type { GraphNode, GraphEdge, Graph } from './graph.js';

/**
 * Fetches graph data from the backend API.
 */
export async function loadDataFromApi(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    let res: Response;
    try {
        res = await fetch('/api/graph');
    } catch (err) {
        throw new Error(`Network error fetching /api/graph: ${(err as Error).message}`);
    }

    if (!res.ok)
        throw new Error(`Failed to fetch /api/graph: HTTP ${res.status}`);

    let response: Record<string, unknown>;
    try {
        response = await res.json() as Record<string, unknown>;
    } catch (err) {
        throw new Error(`Invalid JSON from /api/graph: ${(err as Error).message}`);
    }

    const rawNodes = (response.nodes as unknown[] | undefined) ?? [];
    const rawEdges = (response.edges as unknown[] | undefined) ?? [];

    const nodes: GraphNode[] = rawNodes.map(n => {
        const node = n as Record<string, unknown>;
        return {
            id: node.id as string,
            type: node.type as string,
            properties: (node.properties as Record<string, unknown>) ?? {},
        };
    });

    const edges: GraphEdge[] = rawEdges.map(e => {
        const edge = e as Record<string, unknown>;
        return {
            id: edge.id as string,
            source_id: edge.source_id as string,
            target_id: edge.target_id as string,
            type: edge.type as string,
            properties: (edge.properties as Record<string, unknown>) ?? {},
        };
    });

    return { nodes, edges };
}

/**
 * Serialises a Graph instance to a pretty-printed JSON string.
 */
export function serializeGraph(graph: Graph): string {
    return JSON.stringify(graph.toData(), null, 2);
}

/** Keys that stay on the outer node object. */
const NODE_KEYS = new Set(['id', 'type', 'properties']);

/** Keys that stay on the outer edge object. */
const EDGE_KEYS = new Set(['id', 'type', 'source_id', 'target_id', 'properties']);

/**
 * Merges properties that sit outside the `properties` dict into it.
 */
function collectProperties(
    obj: Record<string, unknown>,
    knownKeys: Set<string>,
): Record<string, unknown> {
    const inner = (obj.properties as Record<string, unknown> | undefined) ?? {};
    const outer: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
        if (!knownKeys.has(key)) {
            outer[key] = obj[key];
        }
    }
    return { ...inner, ...outer };
}

/**
 * Normalises a raw nodes value (array or id-keyed map) into a uniform array.
 */
function normalizeNodes(raw: unknown[] | Record<string, unknown>): GraphNode[] {
    const entries: Record<string, unknown>[] = Array.isArray(raw)
        ? raw as Record<string, unknown>[]
        : Object.entries(raw).map(([id, v]) => ({ ...(v as Record<string, unknown>), id }));

    return entries.map(n => ({
        id: n.id as string,
        type: (n.type as string | undefined) ?? null as unknown as string,
        properties: collectProperties(n, NODE_KEYS),
    }));
}

/**
 * Normalises a raw edges value (array or id-keyed map) into a uniform array,
 * generating missing edge IDs automatically.
 */
function normalizeEdges(raw: unknown[] | Record<string, unknown>): GraphEdge[] {
    const entries: Record<string, unknown>[] = Array.isArray(raw)
        ? raw as Record<string, unknown>[]
        : Object.entries(raw).map(([id, v]) => ({ ...(v as Record<string, unknown>), id }));

    return entries.map(e => ({
        id: (e.id as string | undefined) ?? (`auto:${crypto.randomUUID()}`),
        source_id: e.source_id as string,
        target_id: e.target_id as string,
        type: (e.type as string | undefined) ?? null as unknown as string,
        properties: collectProperties(e, EDGE_KEYS),
    }));
}

/**
 * Parses a JSON string into normalized graph data.
 */
export function parseGraphData(text: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const data = JSON.parse(text) as Record<string, unknown>;
    return {
        nodes: normalizeNodes((data.nodes as unknown[] | undefined) ?? []),
        edges: normalizeEdges(
            (data.edges ?? data.relationships ?? data.links ?? []) as unknown[],
        ),
    };
}
