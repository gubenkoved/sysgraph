import { CMD_LOAD_EXAMPLE, LARGE_EXAMPLE_THRESHOLD } from './constants.js';
import type { ContextMenuItem } from './context-menu.js';
import { handle } from './event-bus.js';
import { type Graph, type GraphDisplay, type GraphEdge, type GraphNode, generateId } from './graph.js';
import { showError } from './util.js';

/** Result of loading or parsing graph data, including any embedded display block. */
export interface LoadedGraphData {
    nodes: GraphNode[];
    edges: GraphEdge[];
    display?: GraphDisplay;
    /** Edges dropped during import because an endpoint did not match any node. */
    skippedEdges?: number;
}

/** Extracts a top-level display block when it is a plain object. */
function extractDisplay(data: Record<string, unknown>): GraphDisplay | undefined {
    const display = data.display;
    if (display != null && typeof display === 'object' && !Array.isArray(display)) {
        return display as GraphDisplay;
    }
    return undefined;
}

/**
 * Fetches graph data from the backend API.
 */
export async function loadDataFromApi(): Promise<LoadedGraphData> {
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

    return normalizeGraphData(response);
}

/**
 * Serialises a Graph instance to a pretty-printed JSON string.
 */
export function serializeGraph(graph: Graph): string {
    return JSON.stringify(graph.toData(), null, 2);
}

/** Default node type when an imported node carries none. */
const DEFAULT_NODE_TYPE = 'node';

/** Default edge type when an imported edge carries none. */
const DEFAULT_EDGE_TYPE = 'edge';

// keys consumed by the native schema (or known aliases) that must not leak into
// the merged `properties` dict
const NODE_KEYS = new Set(['id', 'key', 'type', 'properties', 'attributes']);
const EDGE_KEYS = new Set([
    'id',
    'type',
    'properties',
    'attributes',
    'source_id',
    'target_id',
    'source',
    'target',
    'from',
    'to',
    'start',
    'end',
]);

/** Coerces an id-like value to a string, returning undefined for null/empty. */
function coerceId(value: unknown): string | undefined {
    if (value == null) return undefined;
    if (typeof value === 'string') return value.length > 0 ? value : undefined;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return undefined;
}

/** Returns the first key present on `obj` from `keys`, else undefined. */
function pickId(obj: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
        const id = coerceId(obj[key]);
        if (id !== undefined) return id;
    }
    return undefined;
}

/**
 * Converts a raw nodes/edges value into an array of plain entry objects.
 * Accepts an array as-is, or an id-keyed map (injecting the key as `id`).
 */
function toEntries(raw: unknown): Record<string, unknown>[] {
    if (Array.isArray(raw)) return raw as Record<string, unknown>[];
    if (raw != null && typeof raw === 'object') {
        return Object.entries(raw as Record<string, unknown>).map(
            ([id, v]) => ({ ...(v as Record<string, unknown>), id }),
        );
    }
    return [];
}

/** Type-guard for a plain object (a dict), excluding null and arrays. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value != null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Merges properties that sit outside the `properties` dict into it. Also folds
 * in a foreign `attributes` block (polinode/graphology style) so external
 * metadata is preserved under the native `properties` key. Only genuine dicts
 * are folded in; a non-dict `properties`/`attributes` (e.g. a JSON-encoded
 * string) is preserved verbatim under its own key instead of being spread.
 */
function collectProperties(
    obj: Record<string, unknown>,
    knownKeys: Set<string>,
): Record<string, unknown> {
    const inner = isPlainObject(obj.properties) ? obj.properties : {};
    const attributes = isPlainObject(obj.attributes) ? obj.attributes : {};
    const outer: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
        if (!knownKeys.has(key)) {
            outer[key] = obj[key];
        }
    }
    const merged = { ...attributes, ...inner, ...outer };
    // preserve a non-dict attributes/properties value (e.g. a JSON string)
    // verbatim rather than spreading its characters into the props
    if (obj.attributes != null && !isPlainObject(obj.attributes)) {
        merged.attributes = obj.attributes;
    }
    if (obj.properties != null && !isPlainObject(obj.properties)) {
        merged.properties = obj.properties;
    }
    return merged;
}

/**
 * Normalises a raw nodes value (array or id-keyed map) into a uniform array.
 * Accepts native (`id`/`type`/`properties`) as well as foreign shapes that use
 * `key`/`attributes` and omit a type.
 */
function normalizeNodes(raw: unknown): GraphNode[] {
    return toEntries(raw).map(n => ({
        id: pickId(n, ['id', 'key', 'name']) ?? `auto:${generateId()}`,
        type: coerceId(n.type) ?? DEFAULT_NODE_TYPE,
        properties: collectProperties(n, NODE_KEYS),
    }));
}

/**
 * Normalises a raw edges value (array or id-keyed map) into a uniform array,
 * generating missing edge IDs automatically. Accepts native
 * (`source_id`/`target_id`) as well as the common `source`/`target` (and
 * `from`/`to`, `start`/`end`) endpoint aliases.
 */
function normalizeEdges(raw: unknown): GraphEdge[] {
    return toEntries(raw).map(e => ({
        id: coerceId(e.id) ?? `auto:${generateId()}`,
        source_id: pickId(e, ['source_id', 'source', 'from', 'start']) ?? '',
        target_id: pickId(e, ['target_id', 'target', 'to', 'end']) ?? '',
        type: coerceId(e.type) ?? DEFAULT_EDGE_TYPE,
        properties: collectProperties(e, EDGE_KEYS),
    }));
}

/**
 * Drops edges whose endpoints do not resolve to a known node id. This guards
 * the force-graph layout, whose d3-force link binding throws on a missing node.
 */
function dropDanglingEdges(
    nodes: GraphNode[],
    edges: GraphEdge[],
): { edges: GraphEdge[]; skipped: number } {
    const nodeIds = new Set(nodes.map(n => n.id));
    const kept: GraphEdge[] = [];
    for (const edge of edges) {
        if (nodeIds.has(edge.source_id) && nodeIds.has(edge.target_id)) {
            kept.push(edge);
        }
    }
    return { edges: kept, skipped: edges.length - kept.length };
}

/** Unwraps a top-level `graph` (or `data`) container around nodes/edges. */
function unwrapRoot(data: Record<string, unknown>): Record<string, unknown> {
    for (const key of ['graph', 'data']) {
        const inner = data[key];
        if (
            inner != null &&
            typeof inner === 'object' &&
            !Array.isArray(inner) &&
            ('nodes' in inner || 'edges' in inner || 'links' in inner || 'relationships' in inner)
        ) {
            return inner as Record<string, unknown>;
        }
    }
    return data;
}

/**
 * Normalises an already-parsed graph object (native or foreign shape) into
 * uniform graph data, dropping edges with unresolved endpoints.
 */
function normalizeGraphData(data: Record<string, unknown>): LoadedGraphData {
    const inner = unwrapRoot(data);
    const nodes = normalizeNodes(inner.nodes);
    const allEdges = normalizeEdges(
        inner.edges ?? inner.relationships ?? inner.links,
    );
    const { edges, skipped } = dropDanglingEdges(nodes, allEdges);
    return {
        nodes,
        edges,
        display: extractDisplay(inner),
        skippedEdges: skipped,
    };
}

/**
 * Parses a JSON string into normalized graph data.
 */
export function parseGraphData(text: string): LoadedGraphData {
    return normalizeGraphData(JSON.parse(text) as Record<string, unknown>);
}

/** A built-in example graph as listed in examples/index.json. */
export interface ExampleInfo {
    file: string;
    title: string;
    nodes: number;
    edges: number;
}

/**
 * Loads the manifest of built-in example graphs. Returns an empty list when
 * the manifest is missing or unreadable (e.g. dist built without examples).
 */
export async function loadExamplesManifest(): Promise<ExampleInfo[]> {
    const url = `${import.meta.env.BASE_URL}examples/index.json`;
    try {
        const res = await fetch(url);
        if (!res.ok) return [];
        return await res.json() as ExampleInfo[];
    } catch {
        return [];
    }
}

/**
 * Maps the examples manifest into context-menu items, flagging graphs whose
 * total node + edge count exceeds LARGE_EXAMPLE_THRESHOLD with a warning badge.
 */
export function buildExampleMenuItems(examples: ExampleInfo[]): ContextMenuItem[] {
    return examples.map((example) => {
        const isLarge =
            example.nodes + example.edges > LARGE_EXAMPLE_THRESHOLD;
        return {
            label: `${example.title} (${example.nodes}n / ${example.edges}e)`,
            icon: 'category',
            badge: isLarge
                ? {
                      text: 'large',
                      icon: 'warning',
                      title: 'Large graph — may render slowly',
                      tone: 'warning' as const,
                  }
                : undefined,
            action: async () => {
                try {
                    await handle(CMD_LOAD_EXAMPLE, example.file);
                } catch (err) {
                    console.error('load example failed:', err);
                    showError(
                        `Load example failed: ${err instanceof Error ? err.message : String(err)}`,
                    );
                }
            },
        };
    });
}

/**
 * Fetches and parses a built-in example graph by its manifest filename.
 */
export async function loadExampleGraph(
    file: string,
): Promise<LoadedGraphData> {
    const url = `${import.meta.env.BASE_URL}examples/${file}`;
    let res: Response;
    try {
        res = await fetch(url);
    } catch (err) {
        throw new Error(`Network error fetching ${url}: ${(err as Error).message}`);
    }
    if (!res.ok)
        throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
    return parseGraphData(await res.text());
}
