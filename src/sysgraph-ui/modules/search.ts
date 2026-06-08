import type { Expression as FuseExpression, IFuseOptions } from 'fuse.js';
import Fuse from 'fuse.js';
import type { Graph, GraphNode } from './graph.js';
import type { AstNode, TermNode } from './search-parser.js';
import { INVERSE_PREFIX_RE, parse, SearchSyntaxError } from './search-parser.js';

export { SearchSyntaxError };

// prefix that requests an exact (whole-field) match, e.g. ="node 1"
const EXACT_PREFIX = '=';

/**
 * Recursively extracts dot-separated key paths from an object.
 */
function extractKeys(object: Record<string, unknown>, maxDepth = 1): Set<string> {
    const fields = new Set<string>();

    if (maxDepth <= 0) {
        return fields;
    }

    for (const key in object) {
        const value = object[key];
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            for (const subKey of extractKeys(value as Record<string, unknown>, maxDepth - 1)) {
                fields.add(`${key}.${subKey}`);
            }
        } else {
            fields.add(key);
        }
    }
    return fields;
}

/** Represents a single search match for a node. */
export class Match {
    readonly nodeId: string;
    /** Lower is better (0 = exact match). */
    readonly score: number;

    constructor(nodeId: string, score: number) {
        this.nodeId = nodeId;
        this.score = score;
    }
}

/** Shared context threaded through the recursive AST evaluator. */
interface SearchContext {
    fuse: Fuse<GraphNode>;
    nodes: GraphNode[];
    allKeys: Set<string>;
}

/**
 * Build a Fuse.js instance for the given graph nodes, discovering all
 * searchable keys at depth 2.
 */
function buildContext(graph: Graph): SearchContext {
    const nodes = graph.getNodes();

    const allKeys = new Set<string>();
    for (const node of nodes) {
        for (const key of extractKeys(node as unknown as Record<string, unknown>, 2)) {
            allKeys.add(key);
        }
    }

    const fuseOptions: IFuseOptions<GraphNode> = {
        includeScore: true,
        includeMatches: true,
        findAllMatches: true,
        // controls fuzziness - 0 = exact match, higher = more fuzzy
        threshold: 0.1,
        useExtendedSearch: true,
        ignoreLocation: true,
        keys: [...allKeys],
    };

    return { fuse: new Fuse(nodes, fuseOptions), nodes, allKeys };
}

/**
 * Find all discovered keys that contain the field specifier
 * (case-insensitive substring match).
 */
function resolveField(field: string, allKeys: Set<string>): string[] {
    const fieldLower = field.toLowerCase();
    const matches: string[] = [];
    for (const k of allKeys) {
        if (k.toLowerCase().includes(fieldLower)) {
            matches.push(k);
        }
    }
    return matches;
}

/**
 * Convert a single (non-exact) term AST node into a Fuse.js Expression object.
 * Exact-match terms (= prefix) are handled separately by the evaluator since
 * Fuse cannot express an exact match on a multi-word phrase.
 */
function termToFuseExpression(node: TermNode, allKeys: Set<string>): FuseExpression {
    if (!node.field) {
        return node.pattern;
    }

    const keys = resolveField(node.field, allKeys);
    if (keys.length === 0) {
        throw new SearchSyntaxError(`No searchable fields match "${node.field}"`);
    }
    if (keys.length === 1) {
        return { [keys[0]!]: node.pattern } as FuseExpression;
    }

    // inverse terms must hold across every resolved field (the value is absent
    // from all of them), so combine with $and; plain terms match in any field
    // ($or). each term runs as its own Fuse search, so multi-key combos are safe
    const clauses = keys.map(k => ({ [k]: node.pattern }) as FuseExpression);
    return INVERSE_PREFIX_RE.test(node.pattern) ? { $and: clauses } : { $or: clauses };
}

/** Read a (possibly dot-nested) property off a node, e.g. "properties.name". */
function getByPath(node: GraphNode, path: string): unknown {
    let current: unknown = node;
    for (const part of path.split('.')) {
        if (current == null || typeof current !== 'object') {
            return undefined;
        }
        current = (current as Record<string, unknown>)[part];
    }
    return current;
}

/**
 * Evaluate an exact-match term (= prefix) directly against the node fields.
 * A node matches when any targeted field's value equals the phrase
 * (case-insensitive). This is needed because Fuse's extended search splits a
 * pattern on whitespace, so it cannot match a multi-word phrase exactly.
 */
function evalExactTerm(node: TermNode, ctx: SearchContext): Map<string, number> {
    const phrase = node.pattern.slice(EXACT_PREFIX.length).toLowerCase();
    const keys = node.field ? resolveField(node.field, ctx.allKeys) : [...ctx.allKeys];
    if (node.field && keys.length === 0) {
        throw new SearchSyntaxError(`No searchable fields match "${node.field}"`);
    }

    const result = new Map<string, number>();
    for (const graphNode of ctx.nodes) {
        for (const key of keys) {
            const value = getByPath(graphNode, key);
            if (value == null) continue;
            if (String(value).toLowerCase() === phrase) {
                // exact match is the best possible score
                result.set(graphNode.id, 0);
                break;
            }
        }
    }
    return result;
}

/** Run a single non-exact term through Fuse and collect node id -> score. */
function evalFuseTerm(node: TermNode, ctx: SearchContext): Map<string, number> {
    const expr = termToFuseExpression(node, ctx.allKeys);
    const result = new Map<string, number>();
    for (const r of ctx.fuse.search(expr)) {
        result.set(r.item.id, r.score ?? 0);
    }
    return result;
}

/**
 * Recursively evaluate the AST into a map of matching node id -> score (lower
 * is better). AND is set intersection (score = worst/largest child score), OR
 * is set union (score = best/smallest child score).
 */
function evaluate(node: AstNode, ctx: SearchContext): Map<string, number> {
    switch (node.type) {
        case 'term':
            return node.pattern.startsWith(EXACT_PREFIX)
                ? evalExactTerm(node, ctx)
                : evalFuseTerm(node, ctx);
        case 'and': {
            if (node.children.length === 0) {
                return new Map();
            }
            const [first, ...rest] = node.children;
            let acc = evaluate(first!, ctx);
            for (const child of rest) {
                const next = evaluate(child, ctx);
                const merged = new Map<string, number>();
                for (const [id, score] of acc) {
                    const other = next.get(id);
                    if (other !== undefined) {
                        merged.set(id, Math.max(score, other));
                    }
                }
                acc = merged;
            }
            return acc;
        }
        case 'or': {
            const acc = new Map<string, number>();
            for (const child of node.children) {
                for (const [id, score] of evaluate(child, ctx)) {
                    const existing = acc.get(id);
                    acc.set(id, existing === undefined ? score : Math.min(existing, score));
                }
            }
            return acc;
        }
        default: {
            const _exhaustive: never = node;
            throw new Error(`Unknown AST node type: ${(_exhaustive as AstNode).type}`);
        }
    }
}

/**
 * Performs a search across all graph nodes, supporting an advanced expression
 * grammar with field specifiers, AND/OR operators, parenthesized grouping, and
 * double-quote escaping. Non-exact terms use Fuse.js fuzzy matching; exact
 * (=) terms are matched directly so multi-word phrases work as expected.
 */
export function search(graph: Graph, expression: string): Match[] {
    const ctx = buildContext(graph);
    const ast = parse(expression);

    const scores = evaluate(ast, ctx);

    return [...scores]
        .map(([nodeId, score]) => new Match(nodeId, score))
        .sort((a, b) => a.score - b.score);
}
