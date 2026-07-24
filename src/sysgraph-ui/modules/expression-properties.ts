// Discovers the "vocabulary" of the currently-loaded graph so the expression
// editor can adapt to any dataset — not just the process graph. It surfaces the
// distinct node/edge types, the property keys present, and an inferred value
// kind (number/string/other) per property. This drives graph-aware autocomplete
// suggestions, click-to-insert chips and contextual examples.

import { getGraph } from './state.js';

// caps how many entities we scan; large graphs have uniform property shapes, so
// sampling the first N keeps discovery cheap without missing real keys
const MAX_SCAN = 2000;

export type PropKind = 'number' | 'string' | 'other';

export interface PropInfo {
    key: string;
    kind: PropKind;
}

export interface GraphVocabulary {
    // node/edge types ordered by frequency (most common first)
    nodeTypes: string[];
    edgeTypes: string[];
    // property keys with an inferred value kind, sorted by key
    nodeProps: PropInfo[];
    edgeProps: PropInfo[];
}

type Entity = { type?: string; properties?: Record<string, unknown> };

// a string that parses cleanly as a finite number counts as numeric, since many
// datasets store numbers as strings (e.g. "population": "8336817")
function looksNumeric(value: string): boolean {
    return value.trim() !== '' && Number.isFinite(Number(value));
}

function classifyProps(entities: Iterable<Entity>): PropInfo[] {
    const counts = new Map<string, { num: number; str: number }>();
    let scanned = 0;
    for (const entity of entities) {
        if (entity.properties) {
            for (const [key, value] of Object.entries(entity.properties)) {
                const tally = counts.get(key) ?? { num: 0, str: 0 };
                if (typeof value === 'number' && Number.isFinite(value)) {
                    tally.num++;
                } else if (typeof value === 'string') {
                    if (looksNumeric(value)) tally.num++;
                    else tally.str++;
                }
                counts.set(key, tally);
            }
        }
        if (++scanned >= MAX_SCAN) break;
    }
    return [...counts.entries()]
        .map(([key, { num, str }]): PropInfo => {
            let kind: PropKind = 'other';
            if (num > 0 || str > 0) kind = num >= str ? 'number' : 'string';
            return { key, kind };
        })
        .sort((a, b) => a.key.localeCompare(b.key));
}

function collectTypes(entities: Iterable<Entity>): string[] {
    const counts = new Map<string, number>();
    let scanned = 0;
    for (const entity of entities) {
        if (entity.type) counts.set(entity.type, (counts.get(entity.type) ?? 0) + 1);
        if (++scanned >= MAX_SCAN) break;
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([type]) => type);
}

/** Describes the loaded graph's types and property shapes for the editor. */
export function describeGraphVocabulary(): GraphVocabulary {
    const graph = getGraph();
    return {
        nodeTypes: collectTypes(graph.getNodes()),
        edgeTypes: collectTypes(graph.getEdges()),
        nodeProps: classifyProps(graph.getNodes()),
        edgeProps: classifyProps(graph.getEdges()),
    };
}

/** Unique property keys present across the loaded graph's nodes. */
export function collectNodePropertyKeys(): string[] {
    return describeGraphVocabulary().nodeProps.map((prop) => prop.key);
}

/** Unique property keys present across the loaded graph's edges. */
export function collectEdgePropertyKeys(): string[] {
    return describeGraphVocabulary().edgeProps.map((prop) => prop.key);
}
