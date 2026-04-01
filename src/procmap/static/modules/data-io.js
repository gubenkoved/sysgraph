/**
 * Fetches graph data from the backend API.
 * @returns {Promise<{ nodes: import('./graph.js').GraphNode[], edges: import('./graph.js').GraphEdge[] }>}
 */
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

/**
 * Serialises a Graph instance to a pretty-printed JSON string.
 * @param {import('./graph.js').Graph} graph
 * @returns {string}
 */
export function serializeGraph(graph) {
    return JSON.stringify(graph.toData(), null, 2);
}

/** @type {Set<string>} Keys that stay on the outer node object. */
const NODE_KEYS = new Set(['id', 'type', 'properties']);

/** @type {Set<string>} Keys that stay on the outer edge object. */
const EDGE_KEYS = new Set(['id', 'type', 'source_id', 'target_id', 'properties']);

/**
 * Merges properties that sit outside the `properties` dict into it.
 * Outer keys override inner keys on conflict.
 * @param {Object} obj - Raw node or edge object.
 * @param {Set<string>} knownKeys - Keys that belong on the outer object.
 * @returns {Object}
 */
function collectProperties(obj, knownKeys) {
    const inner = obj.properties || {};
    const outer = {};
    for (const key of Object.keys(obj)) {
        if (!knownKeys.has(key)) {
            outer[key] = obj[key];
        }
    }
    return { ...inner, ...outer };
}

/**
 * Normalises a raw nodes value (array or id-keyed map) into a uniform array
 * of `{ id, type, properties }` objects.
 * @param {Object[]|Object} raw
 * @returns {{ id: string, type: string|null, properties: Object }[]}
 */
function normalizeNodes(raw) {
    const entries = Array.isArray(raw)
        ? raw
        : Object.entries(raw).map(([id, v]) => ({ ...v, id }));

    return entries.map(n => ({
        id: n.id,
        type: n.type ?? null,
        properties: collectProperties(n, NODE_KEYS),
    }));
}

/**
 * Normalises a raw edges value (array or id-keyed map) into a uniform array
 * of `{ id, source_id, target_id, type, properties }` objects, generating
 * missing edge IDs automatically.
 * @param {Object[]|Object} raw
 * @returns {{ id: string, source_id: string, target_id: string, type: string|null, properties: Object }[]}
 */
function normalizeEdges(raw) {
    const entries = Array.isArray(raw)
        ? raw
        : Object.entries(raw).map(([id, v]) => ({ ...v, id }));

    return entries.map(e => ({
        id: e.id ?? 'auto:' + crypto.randomUUID(),
        source_id: e.source_id,
        target_id: e.target_id,
        type: e.type ?? null,
        properties: collectProperties(e, EDGE_KEYS),
    }));
}

/**
 * Parses a JSON string into normalized graph data.
 *
 * Supports nodes/edges as arrays or as maps keyed by id. Type is optional
 * (defaults to null). Extra keys outside `id`, `type`, and `properties`
 * (plus `source_id`/`target_id` for edges) are merged into `properties`.
 * Edge IDs are auto-generated when missing.
 * @param {string} text
 * @returns {{ nodes: Object[], edges: Object[] }}
 */
export function parseGraphData(text) {
    const data = JSON.parse(text);
    return {
        nodes: normalizeNodes(data.nodes || []),
        edges: normalizeEdges(data.edges || data.relationships || data.links || []),
    };
}
